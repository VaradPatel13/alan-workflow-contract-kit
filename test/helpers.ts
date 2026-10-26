import { contractSchema, type Contract, type ContractCheck } from "../src/contracts/schema";
import { traceSchema, type RunTrace } from "../src/trace/model";

export function makeContract(checks: ContractCheck[], overrides: Partial<Contract> = {}): Contract {
  return contractSchema.parse({
    name: "sample",
    workflow: "wf_sample",
    checks,
    ...overrides,
  });
}

export function makeTrace(overrides: Partial<RunTrace> = {}): RunTrace {
  return traceSchema.parse({
    executionId: "exec_sample",
    workflowId: "wf_sample",
    status: "succeeded",
    ...overrides,
  });
}

export const reportBody = [
  "# PR Review — #1842",
  "",
  "## Summary",
  "Retry hardening for the upload queue.",
  "",
  "## Findings",
  "- src/queue/retry.ts:42 — cap is applied after the multiplier.",
  "- src/queue/uploader.ts:118 — retry counter resets on re-enqueue.",
  "",
  "## Risk",
  "Medium.",
  "",
  "## Recommendation",
  "Merge after the cap fix.",
].join("\n");