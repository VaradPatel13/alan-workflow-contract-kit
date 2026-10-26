import type { ContractDiff } from "../baseline/diff";
import type { ContractResult } from "../engine/run";

const SYMBOLS = { pass: "✔", fail: "✖", flaky: "~", skipped: "⊘" } as const;

export interface TerminalOptions {
  color?: boolean;
  evidence?: boolean;
  diff?: ContractDiff[];
}

function painter(enabled: boolean) {
  return (code: number) => (text: string) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : text);
}

export function renderTerminal(results: ContractResult[], options: TerminalOptions = {}): string {
  const color = options.color ?? Boolean(process.stdout.isTTY);
  const paint = painter(color);
  const green = paint(32);
  const red = paint(31);
  const yellow = paint(33);
  const dim = paint(2);
  const bold = paint(1);

  const lines: string[] = [];

  for (const result of results) {
    const verdict = result.ok ? green("PASS") : red("FAIL");
    const ratio = `${result.totals.passingRuns}/${result.totals.runs} runs`;
    lines.push("");
    lines.push(`${bold(result.contract.name)} ${dim("·")} ${ratio} ${dim("·")} ${verdict}`);

    const width = Math.max(...result.checks.map((check) => check.id.length), 12);
    for (const check of result.checks) {
      const symbol =
        check.status === "pass"
          ? green(SYMBOLS.pass)
          : check.status === "fail"
            ? red(SYMBOLS.fail)
            : check.status === "flaky"
              ? yellow(SYMBOLS.flaky)
              : dim(SYMBOLS.skipped);
      const label = check.id.padEnd(width);
      const text = check.status === "pass" ? check.message : check.status === "skipped" ? dim(check.message) : check.message;
      lines.push(`  ${symbol} ${label}  ${text}`);

      if (options.evidence !== false && check.status !== "pass") {
        for (const item of check.evidence) {
          const link = item.url ? ` ${dim(item.url)}` : "";
          lines.push(`      ${dim("→")} ${dim(item.label)}${link}`);
        }
      }
    }
  }

  const totals = results.reduce(
    (acc, result) => {
      acc.pass += result.totals.pass;
      acc.fail += result.totals.fail;
      acc.flaky += result.totals.flaky;
      acc.skipped += result.totals.skipped;
      return acc;
    },
    { pass: 0, fail: 0, flaky: 0, skipped: 0 },
  );

  lines.push("");
  const failedContracts = results.filter((result) => !result.ok);
  const summary = [
    green(`${totals.pass} passed`),
    totals.fail > 0 ? red(`${totals.fail} failed`) : `${totals.fail} failed`,
    totals.flaky > 0 ? yellow(`${totals.flaky} flaky`) : `${totals.flaky} flaky`,
    `${totals.skipped} skipped`,
  ].join(dim(" · "));
  lines.push(`${summary} ${dim("across")} ${results.length} contract(s)`);

  if (failedContracts.length > 0) {
    const detail = failedContracts
      .map(
        (result) =>
          `${result.contract.name} ${result.totals.passRatio.toFixed(2)} < ${result.contract.require_pass_ratio}`,
      )
      .join(", ");
    lines.push(red(`gate failed: ${detail}`));
  }

  if (options.diff && options.diff.length > 0) {
    lines.push("");
    lines.push(...renderDiff(options.diff, { color }));
  }

  return lines.join("\n");
}

/** Baseline diff, reusable by `awc run --diff` and `awc diff`. */
export function renderDiff(
  diffs: ContractDiff[],
  options: { color?: boolean } = {},
): string[] {
  const color = options.color ?? Boolean(process.stdout.isTTY);
  const paint = painter(color);
  const green = paint(32);
  const red = paint(31);
  const yellow = paint(33);
  const dim = paint(2);
  const bold = paint(1);
  const lines: string[] = [bold("Diff vs baseline")];

  for (const diff of diffs) {
    const parts = Object.entries(diff.counts)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${count} ${kind}`);
    const scope = diff.baselineFound ? "" : " (no baseline entry)";
    lines.push(`  ${diff.contract}${scope}: ${parts.join(dim(" · "))}`);

    for (const check of diff.checks) {
      if (check.change === "unchanged" || check.change === "new") continue;
      const marker =
        check.change === "fixed"
          ? green("+")
          : check.change === "new-failure" || check.change === "still-failing"
            ? red("!")
            : yellow("~");
      lines.push(
        `    ${marker} ${check.id} ${dim(`${check.change}: ${check.before ?? "∅"} → ${check.after ?? "∅"}`)}`,
      );
    }
  }

  return lines;
}