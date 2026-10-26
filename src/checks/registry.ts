import type { ContractCheck } from "../contracts/schema";
import { artifactExists } from "./artifact-exists";
import { artifactSections } from "./artifact-sections";
import { recordsSubtasks } from "./records-subtasks";
import { runLimits } from "./run-limits";
import { runStatus } from "./run-status";
import { sectionContains } from "./section-contains";
import { sectionEvidence } from "./section-evidence";
import { textForbidden } from "./text-forbidden";
import { toolUsed } from "./tool-used";
import type { CheckContext, CheckRegistry, CheckResult } from "./types";

export const registry: CheckRegistry = {
  "artifact.exists": artifactExists,
  "artifact.sections": artifactSections,
  "section.contains": sectionContains,
  "section.evidence": sectionEvidence,
  "text.forbidden": textForbidden,
  "records.subtasks": recordsSubtasks,
  "run.status": runStatus,
  "run.limits": runLimits,
  "trace.tool_used": toolUsed,
};

export function evaluateCheck(check: ContractCheck, ctx: CheckContext): CheckResult {
  const evaluate = registry[check.type] as (c: ContractCheck, x: CheckContext) => CheckResult;
  return evaluate(check, ctx);
}

export type { CheckContext, CheckResult } from "./types";