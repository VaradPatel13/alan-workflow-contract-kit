import { evaluateCheck } from "../checks/registry";
import type { CheckResult } from "../checks/types";
import type { Contract } from "../contracts/schema";
import { IntegrationError, type Adapter } from "../adapters/types";
import type { RunTrace } from "../trace/model";
import { aggregate, runPassed, type AggregatedCheck } from "./aggregate";

export interface ContractTotals {
  runs: number;
  passingRuns: number;
  passRatio: number;
  pass: number;
  fail: number;
  flaky: number;
  skipped: number;
}

export interface ContractResult {
  contract: Contract;
  runs: RunTrace[];
  checks: AggregatedCheck[];
  totals: ContractTotals;
  ok: boolean;
}

export interface RunContractOptions {
  runs?: number;
  onRun?: (runIndex: number, trace: RunTrace, checks: CheckResult[]) => void;
}

export function evaluateTrace(
  contract: Contract,
  trace: RunTrace,
  runIndex: number,
): CheckResult[] {
  return contract.checks.map((check) => evaluateCheck(check, { contract, trace, runIndex }));
}

export function computeTotals(checks: AggregatedCheck[], runs: number, passingRuns: number): ContractTotals {
  return {
    runs,
    passingRuns,
    passRatio: runs === 0 ? 0 : passingRuns / runs,
    pass: checks.filter((check) => check.status === "pass").length,
    fail: checks.filter((check) => check.status === "fail").length,
    flaky: checks.filter((check) => check.status === "flaky").length,
    skipped: checks.filter((check) => check.status === "skipped").length,
  };
}

/**
 * Executes the contract N times and returns an aggregated verdict. Integration
 * failures abort the run: they are never downgraded to a contract failure.
 */
export async function runContract(
  contract: Contract,
  adapter: Adapter,
  options: RunContractOptions = {},
): Promise<ContractResult> {
  const runs = options.runs ?? contract.runs;
  const traces: RunTrace[] = [];
  const perRun: CheckResult[][] = [];

  for (let index = 0; index < runs; index += 1) {
    let trace: RunTrace;
    try {
      trace = await adapter.run({ contract, runIndex: index });
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new IntegrationError(`adapter "${adapter.name}" failed on run ${index + 1}: ${reason}`);
    }

    const checks = evaluateTrace(contract, trace, index);
    traces.push(trace);
    perRun.push(checks);
    options.onRun?.(index, trace, checks);
  }

  const checks = aggregate(contract, perRun);
  const passingRuns = perRun.filter((run) => runPassed(run)).length;
  const totals = computeTotals(checks, runs, passingRuns);

  // Quotes like "0.67" mean "2 of 3" in practice, so the threshold snaps to an
  // achievable run count instead of failing on float arithmetic.
  const requiredRuns = Math.round(contract.require_pass_ratio * runs);

  return {
    contract,
    runs: traces,
    checks,
    totals,
    ok: totals.passingRuns >= requiredRuns,
  };
}