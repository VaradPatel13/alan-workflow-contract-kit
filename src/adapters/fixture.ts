import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { parseMarkdownSections } from "../trace/normalize";
import { traceSchema, type RunTrace } from "../trace/model";
import { IntegrationError, type Adapter, type RunRequest } from "./types";

const fixtureFileSchema = z.union([
  z.array(traceSchema).min(1),
  z.object({ runs: z.array(traceSchema).min(1) }),
]);

/**
 * Replays recorded RunTraces. This is what lets the entire check layer, the
 * aggregation, and the baseline diff run in CI with no network and no auth.
 */
export class FixtureAdapter implements Adapter {
  readonly name = "fixture";
  private readonly dir: string;

  constructor(directory: string) {
    this.dir = resolve(directory);
  }

  async run({ contract, runIndex }: RunRequest): Promise<RunTrace> {
    const file = join(this.dir, `${contract.name}.json`);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      throw new IntegrationError(
        `no fixture for contract "${contract.name}" at ${file}\n` +
          `record one with --adapter alan, or pin the fixture set with --fixtures`,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new IntegrationError(`cannot parse fixture ${file}: ${reason}`);
    }

    const parsed = fixtureFileSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first?.path.join(".") ?? "(root)";
      throw new IntegrationError(
        `fixture ${file} is not a RunTrace set\n  ${path}: ${first?.message ?? "invalid"}`,
      );
    }

    const runs = Array.isArray(parsed.data) ? parsed.data : parsed.data.runs;
    const trace = runs[Math.min(runIndex, runs.length - 1)];
    if (!trace) {
      throw new IntegrationError(`fixture ${file} has no runs`);
    }
    return withSections(trace);
  }
}

/** Recorded fixtures may carry only a body; derive the outline the same way the live adapter does. */
function withSections(trace: RunTrace): RunTrace {
  return {
    ...trace,
    artifacts: trace.artifacts.map((artifact) =>
      artifact.sections.length === 0 && artifact.content
        ? { ...artifact, sections: parseMarkdownSections(artifact.content) }
        : artifact,
    ),
  };
}