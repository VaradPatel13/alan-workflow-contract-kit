import type { ContractResult } from "../engine/run";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * JUnit XML so the verdict renders in GitHub Actions, GitLab, and Buildkite.
 * Flaky is reported as a failure: a check that only sometimes passes is not
 * green, and CI should not be told otherwise.
 */
export function renderJUnit(results: ContractResult[], options: { name?: string } = {}): string {
  const suites = results.map((result) => {
    const failures = result.checks.filter(
      (check) => check.status === "fail" || check.status === "flaky",
    );
    const skipped = result.checks.filter((check) => check.status === "skipped");

    const cases = result.checks.map((check) => {
      const attributes = `classname="awc.${escapeXml(result.contract.name)}" name="${escapeXml(check.id)}"`;
      const evidence = check.evidence
        .map((item) => `  ${item.label}${item.url ? ` ${item.url}` : ""}`)
        .join("\n");
      const body = evidence ? `\n${escapeXml(evidence)}\n` : "";

      if (check.status === "pass") {
        return `    <testcase ${attributes}/>`;
      }
      if (check.status === "skipped") {
        return `    <testcase ${attributes}>\n      <skipped message="${escapeXml(check.message)}"/>\n    </testcase>`;
      }
      const type = check.status === "flaky" ? "flaky" : "contract";
      return `    <testcase ${attributes}>\n      <failure type="${type}" message="${escapeXml(check.message)}">${body}</failure>\n    </testcase>`;
    });

    return [
      `  <testsuite name="${escapeXml(result.contract.name)}" tests="${result.checks.length}" failures="${failures.length}" skipped="${skipped.length}">`,
      ...cases,
      "  </testsuite>",
    ].join("\n");
  });

  const totalTests = results.reduce((sum, result) => sum + result.checks.length, 0);
  const totalFailures = results.reduce(
    (sum, result) => sum + result.totals.fail + result.totals.flaky,
    0,
  );
  const totalSkipped = results.reduce((sum, result) => sum + result.totals.skipped, 0);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${escapeXml(options.name ?? "awc")}" tests="${totalTests}" failures="${totalFailures}" skipped="${totalSkipped}">`,
    ...suites,
    "</testsuites>",
    "",
  ].join("\n");
}