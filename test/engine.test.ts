import { describe, expect, it } from "vitest";
import type { Adapter, RunRequest } from "../src/adapters/types";
import { aggregate, runPassed } from "../src/engine/aggregate";
import { runContract } from "../src/engine/run";
import { evaluateTrace } from "../src/engine/run";
import { makeContract, makeTrace } from "./helpers";

const contract = makeContract(
  [
    { id: "report-exists", type: "artifact.exists", artifact: "test-report", min: 1 },
    { id: "succeeded", type: "run.status", in: ["succeeded"] },
  ],
  { runs: 3, require_pass_ratio: 0.67 },
);

const goodRun = makeTrace({
  executionId: "exec_good",
  artifacts: [{ id: "a1", type: "test-report", title: "Report", sections: [] }],
});
const badRun = makeTrace({ executionId: "exec_bad", status: "failed" });

function adapter(...traces: ReturnType<typeof makeTrace>[]): Adapter {
  return {
    name: "fake",
    async run({ runIndex }: RunRequest) {
      const trace = traces[Math.min(runIndex, traces.length - 1)];
      if (!trace) throw new Error("no trace");
      return trace;
    },
  };
}

describe("aggregate", () => {
  it("marks a check flaky when it passes in some runs and fails in others", () => {
    const perRun = [
      evaluateTrace(contract, goodRun, 0),
      evaluateTrace(contract, goodRun, 1),
      evaluateTrace(contract, badRun, 2),
    ];
    const checks = aggregate(contract, perRun);
    expect(checks.find((check) => check.id === "report-exists")?.status).toBe("flaky");
    expect(checks.find((check) => check.id === "report-exists")?.message).toContain("2/3 runs");
  });

  it("marks a check fail when every run fails", () => {
    const perRun = [evaluateTrace(contract, badRun, 0), evaluateTrace(contract, badRun, 1)];
    const checks = aggregate(contract, perRun);
    expect(checks.every((check) => check.status === "fail")).toBe(true);
  });

  it("keeps skips visible instead of counting them as passes", () => {
    const skipContract = makeContract([{ id: "subs", type: "records.subtasks", min_count: 2 }]);
    const checks = aggregate(skipContract, [evaluateTrace(skipContract, goodRun, 0)]);
    expect(checks[0]?.status).toBe("skipped");
    expect(runPassed(evaluateTrace(skipContract, goodRun, 0))).toBe(true);
  });
});

describe("runContract", () => {
  it("uses pass^k semantics: 2 of 3 runs clears a 0.67 gate", async () => {
    const result = await runContract(contract, adapter(goodRun, goodRun, badRun));
    expect(result.totals.passingRuns).toBe(2);
    expect(result.totals.passRatio).toBeCloseTo(0.67);
    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.id === "report-exists")?.status).toBe("flaky");
  });

  it("fails the gate when the ratio is not met", async () => {
    const strict = { ...contract, require_pass_ratio: 1 };
    const result = await runContract(strict, adapter(goodRun, badRun, goodRun));
    expect(result.ok).toBe(false);
  });

  it("aborts on integration errors instead of turning them into a verdict", async () => {
    const broken: Adapter = {
      name: "broken",
      async run() {
        throw new Error("socket closed");
      },
    };
    await expect(runContract(contract, broken)).rejects.toThrow(/socket closed/);
  });

  it("reports progress per run", async () => {
    const seen: number[] = [];
    await runContract(contract, adapter(goodRun), {
      runs: 2,
      onRun: (index) => seen.push(index),
    });
    expect(seen).toEqual([0, 1]);
  });
});