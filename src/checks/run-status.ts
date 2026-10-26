import { executionEvidence } from "./helpers";
import { result, type CheckRegistry } from "./types";

/** Terminal status of the execution, straight from workflow_execution. */
export const runStatus: CheckRegistry["run.status"] = (check, ctx) => {
  const { status } = ctx.trace;
  if (check.in.includes(status)) {
    return result(check, "pass", `execution status "${status}"`, [executionEvidence(ctx.trace)]);
  }
  return result(check, "fail", `execution status "${status}", expected one of ${check.in.join(", ")}`, [
    executionEvidence(ctx.trace),
  ]);
};