import { describe, expect, it } from "vitest";
import type { AggregatedCheck, AggregatedStatus } from "../src/engine/aggregate";
import { computeTotals, type ContractResult } from "../src/engine/run";
import { renderJUnit } from "../src/report/junit";
import { renderMarkdown } from "../src/report/markdown";
import { renderTerminal } from "../src/report/terminal";
import { makeContract } from "./helpers";

function resultOf(statuses: Record<string, AggregatedStatus>): ContractResult {
  const contract = makeContract(
    [
      { id: "report-exists", type: "artifact.exists", artifact: "test-report", min: 1 },
      { id: "sections", type: "artifact.sections", artifact: "test-report", require: ["Summary"] },
      { id: "subtasks", type: "records.subtasks", min_count: 1 },
    ],
    { name: "demo" },
  );

  const checks: AggregatedCheck[] = contract.checks.map((check) => ({
    id: check.id,
    type: check.type,
    status: statuses[check.id] ?? "pass",
    message: check.id === "report-exists" ? "no test-report artifact in this run (a & b < c)" : "detail",
    evidence: check.id === "report-exists" ? [{ label: "execution exec_1 · failed" }] : [],
    perRun: [],
  }));

  return { contract, runs: [], checks, totals: computeTotals(checks, 1, 1), ok: true };
}

describe("junit", () => {
  it("renders testsuites with failures, flaky and skipped cases", () => {
    const xml = renderJUnit([resultOf({ "report-exists": "fail", subtasks: "flaky" /* sections pass */ })]);
    expect(xml).toContain('<testsuite name="demo" tests="3" failures="2" skipped="0">');
    expect(xml).toContain('type="contract"');
    expect(xml).toContain('type="flaky"');
    expect(xml).toContain('classname="awc.demo" name="report-exists"');
    expect(xml).toContain("execution exec_1");
  });

  it("marks skipped checks and escapes XML metacharacters", () => {
    const xml = renderJUnit([resultOf({ subtasks: "skipped", "report-exists": "fail" })]);
    expect(xml).toContain('<skipped message="detail"/>');
    expect(xml).toContain("a &amp; b &lt; c");
  });
});

describe("terminal", () => {
  it("marks a failed gate and prints an evidence pointer", () => {
    const text = renderTerminal([{ ...resultOf({ "report-exists": "fail" }), ok: false }], {
      color: false,
    });
    expect(text).toContain("FAIL");
    expect(text).toContain("✖");
    expect(text).toContain("→ execution exec_1 · failed");
    expect(text).toContain("gate failed");
  });
});

describe("markdown", () => {
  it("renders a table and a baseline section", () => {
    const results = [resultOf({ subtasks: "flaky" })];
    const md = renderMarkdown(results, [
      {
        contract: "demo",
        key: "k",
        baselineFound: true,
        checks: [{ id: "subtasks", before: "pass", after: "flaky", change: "flaky" }],
        counts: {
          new: 0,
          "new-failure": 0,
          fixed: 0,
          "still-failing": 0,
          flaky: 1,
          "newly-skipped": 0,
          removed: 0,
          unchanged: 2,
        },
      },
    ]);
    expect(md).toContain("### demo — 1/1 runs");
    expect(md).toContain("| `subtasks` | **flaky** |");
    expect(md).toContain("### Baseline diff");
  });
});