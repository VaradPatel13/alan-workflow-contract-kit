import { toolCallCount } from "../trace/normalize";
import { result, type CheckRegistry } from "./types";

/**
 * Counter-level only: get_session_context exposes tool names and counts, not
 * arguments. "Called the right tool N times" is assertable today; "called it
 * with these arguments" is not, and is deliberately out of v0 scope.
 */
export const toolUsed: CheckRegistry["trace.tool_used"] = (check, ctx) => {
  if (ctx.trace.capabilities?.transcript === false) {
    return result(check, "skipped", "run exposes no transcript (transport cannot resolve the session)");
  }
  if (ctx.trace.capabilities?.toolCounters === false) {
    return result(check, "skipped", "transcript carries no per-message tool counters");
  }

  const count = toolCallCount(ctx.trace, check.tool);

  if (count < check.min_calls) {
    return result(check, "fail", `${check.tool} called ${count} time(s), expected ≥${check.min_calls}`, [
      { label: `session ${ctx.trace.executionId} · transcript` },
    ]);
  }
  if (check.max_calls !== undefined && count > check.max_calls) {
    return result(check, "fail", `${check.tool} called ${count} time(s), expected ≤${check.max_calls}`, [
      { label: `session ${ctx.trace.executionId} · transcript` },
    ]);
  }

  return result(check, "pass", `${check.tool} called ${count} time(s)`, [
    { label: `session ${ctx.trace.executionId} · transcript` },
  ]);
};