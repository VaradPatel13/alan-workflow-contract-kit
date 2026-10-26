import type { CheckEvidence, CheckResult, CheckStatus } from "../checks/types";
import type { CheckType, Contract } from "../contracts/schema";

export type AggregatedStatus = CheckStatus | "flaky";

export interface AggregatedCheck {
  id: string;
  type: CheckType;
  status: AggregatedStatus;
  message: string;
  evidence: CheckEvidence[];
  perRun: CheckStatus[];
}

function dedupeEvidence(evidence: CheckEvidence[]): CheckEvidence[] {
  const seen = new Set<string>();
  const unique: CheckEvidence[] = [];
  for (const item of evidence) {
    const key = `${item.label}\u0000${item.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.slice(0, 4);
}

/**
 * Collapses N runs into one verdict per check.
 *
 * Mixed pass/fail across runs is "flaky", never "pass": best-of-n is exactly
 * the mistake a stability gate is supposed to catch.
 */
export function aggregate(contract: Contract, perRun: CheckResult[][]): AggregatedCheck[] {
  const grouped = new Map<string, CheckResult[]>();
  for (const run of perRun) {
    for (const check of run) {
      const bucket = grouped.get(check.id);
      if (bucket) bucket.push(check);
      else grouped.set(check.id, [check]);
    }
  }

  return contract.checks.map((definition) => {
    const results = grouped.get(definition.id) ?? [];
    const total = Math.max(perRun.length, results.length);
    const perRunStatuses: CheckStatus[] = Array.from({ length: total }, (_, index) => {
      return results[index]?.status ?? "skipped";
    });

    const passes = results.filter((item) => item.status === "pass");
    const failures = results.filter((item) => item.status === "fail");
    const skips = results.filter((item) => item.status === "skipped");

    if (failures.length === 0) {
      const status: AggregatedStatus = passes.length === 0 ? "skipped" : "pass";
      return {
        id: definition.id,
        type: definition.type,
        status,
        message: passes[0]?.message ?? skips[0]?.message ?? "no result",
        evidence: dedupeEvidence(passes[0]?.evidence ?? skips[0]?.evidence ?? []),
        perRun: perRunStatuses,
      };
    }

    if (passes.length > 0) {
      return {
        id: definition.id,
        type: definition.type,
        status: "flaky",
        message: `passed ${passes.length}/${total} runs · ${failures[0]?.message ?? "failed"}`,
        evidence: dedupeEvidence(failures.flatMap((item) => item.evidence)),
        perRun: perRunStatuses,
      };
    }

    return {
      id: definition.id,
      type: definition.type,
      status: "fail",
      message: failures[0]?.message ?? "failed",
      evidence: dedupeEvidence(failures.flatMap((item) => item.evidence)),
      perRun: perRunStatuses,
    };
  });
}

/** A run passes when no check failed. Skipped checks never count as a pass claim. */
export function runPassed(checks: CheckResult[]): boolean {
  return checks.every((check) => check.status !== "fail");
}