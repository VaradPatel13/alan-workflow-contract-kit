import type { ContractDiff } from "../baseline/diff";
import type { ContractResult } from "../engine/run";

const STATUS_LABEL: Record<string, string> = {
  pass: "pass",
  fail: "**fail**",
  flaky: "**flaky**",
  skipped: "skipped",
};

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Markdown body for a PR comment or an Alan test report. */
export function renderMarkdown(results: ContractResult[], diff?: ContractDiff[]): string {
  const lines: string[] = [];

  const ok = results.every((result) => result.ok);
  lines.push(`## awc ${ok ? "pass" : "fail"}`);
  lines.push("");

  for (const result of results) {
    lines.push(`### ${result.contract.name} — ${result.totals.passingRuns}/${result.totals.runs} runs`);
    lines.push("");
    lines.push("| check | status | detail |");
    lines.push("| --- | --- | --- |");
    for (const check of result.checks) {
      const detail = check.status === "pass" ? check.message : `${check.message}${evidenceSuffix(check.evidence)}`;
      lines.push(`| \`${check.id}\` | ${STATUS_LABEL[check.status] ?? check.status} | ${cell(detail)} |`);
    }
    lines.push("");
  }

  if (diff && diff.length > 0) {
    lines.push("### Baseline diff");
    lines.push("");
    lines.push("| contract | change | count |");
    lines.push("| --- | --- | --- |");
    for (const contractDiff of diff) {
      for (const [kind, count] of Object.entries(contractDiff.counts)) {
        if (count === 0 || kind === "unchanged") continue;
        lines.push(`| ${contractDiff.contract} | ${kind} | ${count} |`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function evidenceSuffix(evidence: { label: string; url?: string }[]): string {
  if (evidence.length === 0) return "";
  const first = evidence[0];
  if (!first) return "";
  const link = first.url ? `[${first.label}](${first.url})` : first.label;
  return ` — ${link}`;
}