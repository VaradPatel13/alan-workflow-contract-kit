import { Command, CommanderError, Option } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AlanAdapter,
  createUnavailableTransport,
  type AlanTransport,
} from "../adapters/alan-mcp";
import { FixtureAdapter } from "../adapters/fixture";
import { IntegrationError, type Adapter } from "../adapters/types";
import { diffResult, type ContractDiff } from "../baseline/diff";
import { DEFAULT_BASELINE_PATH, baselineKey } from "../baseline/model";
import { acceptResults, loadBaseline, saveBaseline } from "../baseline/store";
import { ContractError, loadContracts } from "../contracts/load";
import type { Contract } from "../contracts/schema";
import { runContract, type ContractResult } from "../engine/run";
import { renderJUnit } from "../report/junit";
import { renderMarkdown } from "../report/markdown";
import { renderDiff, renderTerminal } from "../report/terminal";
import { fromSavedRun, savedRunSchema, toSavedRun, type SavedRun } from "./saved-run";

export const EXIT = {
  pass: 0,
  contractFailure: 1,
  config: 2,
  integration: 3,
} as const;

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const consoleIO: CliIO = {
  stdout: (text) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`),
  stderr: (text) => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
};

interface RunOptions {
  contracts: string[];
  adapter: string;
  fixtures: string;
  runs?: string;
  json: boolean;
  junit?: string;
  markdown?: string;
  baseline: string;
  diff: boolean;
  allowFail: boolean;
  save: string;
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ContractError(`${flag} expects a positive integer, got "${value}"`);
  }
  return parsed;
}

/**
 * Adapter selection. Fixture runs offline; live runs need a transport module,
 * which is how the Mode A (P0) spike plugs in without touching the engine.
 */
async function buildAdapter(options: { adapter: string; fixtures: string }): Promise<Adapter> {
  if (options.adapter === "fixture") {
    return new FixtureAdapter(options.fixtures);
  }

  const modulePath = process.env.AWC_TRANSPORT_MODULE;
  if (!modulePath) {
    return new AlanAdapter({
      transport: createUnavailableTransport(
        "set AWC_TRANSPORT_MODULE to a module exporting an AlanTransport, or run with --adapter fixture",
      ),
    });
  }

  const loaded = (await import(pathToFileURL(resolve(modulePath)).href)) as {
    default?: AlanTransport;
  };
  if (!loaded.default) {
    throw new IntegrationError(
      `transport module ${modulePath} has no default export implementing AlanTransport`,
    );
  }

  return new AlanAdapter({
    transport: loaded.default,
    pollIntervalMs: Number(process.env.AWC_POLL_MS ?? 3_000),
    timeoutMs: Number(process.env.AWC_TIMEOUT_MS ?? 10 * 60_000),
  });
}

async function executeContracts(options: RunOptions): Promise<ContractResult[]> {
  const contracts: Contract[] = await loadContracts(options.contracts);
  const adapter = await buildAdapter(options);
  const runsOverride = options.runs === undefined ? undefined : positiveInt(options.runs, "--runs");

  const results: ContractResult[] = [];
  for (const contract of contracts) {
    results.push(await runContract(contract, adapter, { runs: runsOverride }));
  }
  return results;
}

function wantsColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

async function writeOutputs(
  results: ContractResult[],
  diff: ContractDiff[] | undefined,
  options: Pick<RunOptions, "junit" | "markdown">,
  io: CliIO,
): Promise<void> {
  if (options.junit) {
    const path = resolve(options.junit);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderJUnit(results), "utf8");
    io.stderr(`awc: wrote ${path}`);
  }
  if (options.markdown) {
    const path = resolve(options.markdown);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderMarkdown(results, diff), "utf8");
    io.stderr(`awc: wrote ${path}`);
  }
}

async function saveRun(
  results: ContractResult[],
  adapter: string,
  path: string,
): Promise<SavedRun> {
  const saved = toSavedRun(results, adapter);
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(saved, null, 2)}\n`, "utf8");
  return saved;
}

export async function run(argv: string[], io: CliIO = consoleIO): Promise<number> {
  let exitCode: number = EXIT.pass;

  const program = new Command();
  program
    .name("awc")
    .description("Deterministic contract tests for Alan workflows")
    .version("0.1.0")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout(text.trimEnd()),
      writeErr: (text) => io.stderr(text.trimEnd()),
    });

  program
    .command("run")
    .description("execute contracts and gate on the verdict")
    .option("-c, --contracts <paths...>", "contract files or directories", ["contracts"])
    .addOption(
      new Option("--adapter <name>", "execution adapter").choices(["alan", "fixture"]).default("alan"),
    )
    .option("--fixtures <dir>", "fixture directory for --adapter fixture", "fixtures")
    .option("--runs <n>", "override the contract run count")
    .option("--json", "print a machine-readable verdict", false)
    .option("--junit <file>", "write JUnit XML")
    .option("--markdown <file>", "write Markdown")
    .option("--baseline <path>", "baseline path used by --diff", DEFAULT_BASELINE_PATH)
    .option("--diff", "diff this run against the baseline", false)
    .option("--allow-fail", "exit 0 even when the contract fails", false)
    .option("--save <path>", "where to write the run snapshot", ".awc/last-run.json")
    .action(async (options: RunOptions) => {
      const results = await executeContracts(options);
      let diffs: ContractDiff[] | undefined;
      if (options.diff) {
        const baseline = await loadBaseline(options.baseline);
        diffs = results.map((result) => diffResult(baseline, result));
      }

      await writeOutputs(results, diffs, options, io);
      const saved = await saveRun(results, options.adapter, options.save);

      if (options.json) {
        io.stdout(JSON.stringify({ ...saved, ...(diffs ? { diffs } : {}) }, null, 2));
      } else {
        io.stdout(renderTerminal(results, { color: wantsColor(), ...(diffs ? { diff: diffs } : {}) }));
      }

      const failed = results.some((result) => !result.ok);
      exitCode = failed && !options.allowFail ? EXIT.contractFailure : EXIT.pass;
    });

  program
    .command("baseline")
    .description("manage the committed baseline")
    .command("accept")
    .description("run contracts and record their current verdicts as the baseline")
    .option("-c, --contracts <paths...>", "contract files or directories", ["contracts"])
    .addOption(
      new Option("--adapter <name>", "execution adapter").choices(["alan", "fixture"]).default("alan"),
    )
    .option("--fixtures <dir>", "fixture directory for --adapter fixture", "fixtures")
    .option("--runs <n>", "override the contract run count")
    .option("--baseline <path>", "baseline file", DEFAULT_BASELINE_PATH)
    .action(
      async (options: {
        contracts: string[];
        adapter: string;
        fixtures: string;
        runs?: string;
        baseline: string;
      }) => {
        const results = await executeContracts({
          ...options,
          json: false,
          diff: false,
          allowFail: false,
          save: ".awc/last-run.json",
        } as RunOptions);

        const baseline = await loadBaseline(options.baseline);
        const written = await saveBaseline(options.baseline, acceptResults(baseline, results));
        for (const result of results) {
          io.stdout(`${result.contract.name}  ${result.totals.passingRuns}/${result.totals.runs} runs  →  ${baselineKey(result.contract)}`);
        }
        io.stdout(`awc: baseline written to ${written}`);
      },
    );

  program
    .command("diff")
    .description("run contracts and compare the verdicts with the baseline")
    .option("-c, --contracts <paths...>", "contract files or directories", ["contracts"])
    .addOption(
      new Option("--adapter <name>", "execution adapter").choices(["alan", "fixture"]).default("alan"),
    )
    .option("--fixtures <dir>", "fixture directory for --adapter fixture", "fixtures")
    .option("--runs <n>", "override the contract run count")
    .option("--baseline <path>", "baseline file", DEFAULT_BASELINE_PATH)
    .option("--json", "print the diff as JSON", false)
    .action(
      async (options: {
        contracts: string[];
        adapter: string;
        fixtures: string;
        runs?: string;
        baseline: string;
        json: boolean;
      }) => {
        const results = await executeContracts({
          ...options,
          junit: undefined,
          markdown: undefined,
          diff: false,
          allowFail: true,
          save: ".awc/last-run.json",
        } as RunOptions);

        const baseline = await loadBaseline(options.baseline);
        const diffs = results.map((result) => diffResult(baseline, result));

        if (options.json) {
          io.stdout(JSON.stringify(diffs, null, 2));
        } else {
          io.stdout(renderDiff(diffs, { color: wantsColor() }).join("\n"));
        }

        const regressions = diffs.reduce(
          (sum, diff) => sum + diff.counts["new-failure"] + diff.counts.flaky,
          0,
        );
        exitCode = regressions > 0 ? EXIT.contractFailure : EXIT.pass;
      },
    );

  program
    .command("report")
    .description("render JUnit or Markdown from the last run snapshot")
    .option("--from <file>", "snapshot written by awc run", ".awc/last-run.json")
    .option("--junit <file>", "write JUnit XML")
    .option("--markdown <file>", "write Markdown")
    .action(async (options: { from: string; junit?: string; markdown?: string }) => {
      let text: string;
      try {
        text = await readFile(resolve(options.from), "utf8");
      } catch {
        throw new ContractError(
          `no run snapshot at ${options.from}; run \`awc run\` first or pass --from`,
        );
      }

      const parsed = savedRunSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new ContractError(`run snapshot ${options.from} has an unexpected shape`);
      }
      const results = fromSavedRun(parsed.data);

      if (!options.junit && !options.markdown) {
        io.stdout(renderMarkdown(results));
        return;
      }
      await writeOutputs(results, undefined, options, io);
    });

  try {
    await program.parseAsync(argv, { from: "node" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? EXIT.pass : EXIT.config;
    }
    if (error instanceof ContractError) {
      io.stderr(`awc: ${error.message}`);
      return EXIT.config;
    }
    if (error instanceof IntegrationError) {
      io.stderr(`awc: integration error: ${error.message}`);
      return EXIT.integration;
    }
    const reason = error instanceof Error ? (error.stack ?? error.message) : String(error);
    io.stderr(`awc: internal error\n${reason}`);
    return EXIT.integration;
  }

  return exitCode;
}