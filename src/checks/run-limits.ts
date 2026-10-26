import { deriveLimits } from "../trace/normalize";
import { result, type CheckRegistry } from "./types";

/** Cost guardrail: a workflow that suddenly burns 3x the tool calls is a regression. */
export const runLimits: CheckRegistry["run.limits"] = (check, ctx) => {
  const limits = deriveLimits(ctx.trace);
  const failures: string[] = [];

  if (check.max_tool_calls !== undefined && limits.toolCalls > check.max_tool_calls) {
    failures.push(`${limits.toolCalls} tool calls > ${check.max_tool_calls}`);
  }
  if (check.max_failed_calls !== undefined && limits.failedToolCalls > check.max_failed_calls) {
    failures.push(`${limits.failedToolCalls} failed tool calls > ${check.max_failed_calls}`);
  }

  const summary = `${limits.toolCalls} tool calls, ${limits.failedToolCalls} failed`;

  if (failures.length > 0) {
    return result(check, "fail", failures.join("; "), []);
  }
  return result(check, "pass", summary, []);
};