import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AggregatedStatus, AggregatedCheck } from "../src/engine/aggregate";
import { computeTotals, type ContractResult } from "../src/engine/run";
import { diffResult } from "../src/baseline/diff";
import { baselineKey, emptyBaseline } from "../src/baseline/model";
import { acceptResults, loadBaseline, saveBaseline } from "../src/baseline/store";
import type { Contract } from "../src/contracts/schema";
import { makeContract } from "./helpers";

const contract = makeContract(
  [
    { id: "a", type: "artifact.exists", artifact: "test-report", min: 1 },
    { id: "b", type: "run.status", in: ["succeeded"] },
    { id: "c", type: "records.subtasks", min_count: 1 },
  ],
  { model: "claude-sonnet-4-5", instruction: "Review the PR." },
);

function resultOf(target: Contract, statuses: Record<string, AggregatedStatus>): ContractResult {
  const checks: AggregatedCheck[] = target.checks.map((check) => ({
    id: check.id,
    type: check.type,
    status: statuses[check.id] ?? "pass",
    message: "",
    evidence: [],
    perRun: [],
  }));
  return {
    contract: target,
    runs: [],
    checks,
    totals: computeTotals(checks, 1, 1),
    ok: true,
  };
}

describe("baseline", () => {
  it("keys on contract + workflow + model + instruction hash", () => {
    const base = baselineKey(contract);
    expect(baselineKey({ ...contract, model: "claude-opus-4-1" })).not.toBe(base);
    expect(baselineKey({ ...contract, instruction: "Review the PR differently." })).not.toBe(base);
    expect(base).toMatch(/^sample::wf_sample::claude-sonnet-4-5::[0-9a-f]{12}$/);
  });

  it("round-trips through disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "awc-baseline-"));
    const path = join(dir, ".awc", "baseline.json");
    const accepted = acceptResults(emptyBaseline(), [resultOf(contract, { b: "fail" })]);
    await saveBaseline(path, accepted);

    const loaded = await loadBaseline(path);
    expect(loaded.entries[baselineKey(contract)]?.checks).toEqual({ a: "pass", b: "fail", c: "pass" });
  });

  it("returns an empty baseline when the file does not exist", async () => {
    const loaded = await loadBaseline(join(tmpdir(), "awc-missing", "baseline.json"));
    expect(loaded.entries).toEqual({});
  });

  it("classifies new failures, fixes, still-failing checks and skips", () => {
    const baseline = acceptResults(emptyBaseline(), [
      resultOf(contract, { a: "pass", b: "fail", c: "pass" }),
    ]);

    const diff = diffResult(
      baseline,
      resultOf(contract, { a: "fail", b: "pass", c: "skipped" }),
    );

    const byId = Object.fromEntries(diff.checks.map((check) => [check.id, check.change]));
    expect(byId.a).toBe("new-failure");
    expect(byId.b).toBe("fixed");
    expect(byId.c).toBe("newly-skipped");
    expect(diff.baselineFound).toBe(true);
  });

  it("keeps a still-failing check distinct from a new failure", () => {
    const baseline = acceptResults(emptyBaseline(), [resultOf(contract, { a: "fail" })]);
    const diff = diffResult(baseline, resultOf(contract, { a: "fail" }));
    expect(diff.checks.find((check) => check.id === "a")?.change).toBe("still-failing");
  });

  it("marks the whole set as new when no baseline entry matches", () => {
    const other = { ...contract, model: "claude-opus-4-1" };
    const diff = diffResult(emptyBaseline(), resultOf(other, { a: "fail" }));
    expect(diff.baselineFound).toBe(false);
    expect(diff.counts["new-failure"]).toBe(1);
    expect(diff.counts.new).toBe(2);
  });
});