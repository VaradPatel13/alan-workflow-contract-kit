import type { ContractResult } from "../engine/run";
import { baselineKey, type BaselineFile, type BaselineStatus } from "./model";

export type ChangeKind =
  | "new"
  | "new-failure"
  | "fixed"
  | "still-failing"
  | "flaky"
  | "newly-skipped"
  | "removed"
  | "unchanged";

export interface CheckDiff {
  id: string;
  before?: BaselineStatus;
  after?: BaselineStatus;
  change: ChangeKind;
}

export interface ContractDiff {
  contract: string;
  key: string;
  baselineFound: boolean;
  checks: CheckDiff[];
  counts: Record<ChangeKind, number>;
}

const EMPTY_COUNTS: Record<ChangeKind, number> = {
  new: 0,
  "new-failure": 0,
  fixed: 0,
  "still-failing": 0,
  flaky: 0,
  "newly-skipped": 0,
  removed: 0,
  unchanged: 0,
};

function classify(before: BaselineStatus | undefined, after: BaselineStatus | undefined): ChangeKind {
  if (after === undefined) return "removed";
  if (before === undefined) {
    if (after === "fail") return "new-failure";
    if (after === "flaky") return "flaky";
    if (after === "skipped") return "newly-skipped";
    return "new";
  }
  if (after === "skipped") return before === "skipped" ? "unchanged" : "newly-skipped";
  if (after === "flaky") return before === "flaky" ? "unchanged" : "flaky";
  if (after === "fail") return before === "fail" ? "still-failing" : "new-failure";
  // after === "pass"
  return before === "pass" ? "unchanged" : "fixed";
}

/**
 * Diffs the current aggregate against the committed baseline. A new failure and
 * a still-failing check read very differently in a PR, so they stay separate.
 */
export function diffResult(baseline: BaselineFile, result: ContractResult): ContractDiff {
  const key = baselineKey(result.contract);
  const entry = baseline.entries[key];
  const before = entry?.checks ?? {};
  const after = Object.fromEntries(result.checks.map((check) => [check.id, check.status]));

  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const checks: CheckDiff[] = [...ids].sort().map((id) => {
    const previous = before[id];
    const current = after[id];
    return {
      id,
      ...(previous ? { before: previous } : {}),
      ...(current ? { after: current } : {}),
      change: classify(previous, current),
    };
  });

  const counts = { ...EMPTY_COUNTS };
  for (const check of checks) {
    counts[check.change] += 1;
  }

  return {
    contract: result.contract.name,
    key,
    baselineFound: entry !== undefined,
    checks,
    counts,
  };
}