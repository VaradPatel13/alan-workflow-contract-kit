import type { Contract, ContractCheck, CheckType } from "../contracts/schema";
import type { RunTrace } from "../trace/model";

export type CheckStatus = "pass" | "fail" | "skipped";

/** Where a human clicks to verify the verdict. */
export interface CheckEvidence {
  label: string;
  url?: string;
}

export interface CheckResult {
  id: string;
  type: CheckType;
  status: CheckStatus;
  message: string;
  evidence: CheckEvidence[];
}

export interface CheckContext {
  trace: RunTrace;
  contract: Contract;
  runIndex: number;
}

export type CheckRegistry = {
  [K in CheckType]: (
    check: Extract<ContractCheck, { type: K }>,
    ctx: CheckContext,
  ) => CheckResult;
};

export function result(
  check: { id: string; type: CheckType },
  status: CheckStatus,
  message: string,
  evidence: CheckEvidence[] = [],
): CheckResult {
  return { id: check.id, type: check.type, status, message, evidence };
}