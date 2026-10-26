import type { CheckEvidence } from "./types";
import { result, type CheckRegistry } from "./types";

const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Did the workflow leave the records it promised? Needs a transport that can
 * read task records; when it cannot, the check is skipped, never passed.
 */
export const recordsSubtasks: CheckRegistry["records.subtasks"] = (check, ctx) => {
  const records = ctx.trace.records;
  if (!records) {
    return result(
      check,
      "skipped",
      "run exposes no records (transport lacks records.subtasks support)",
    );
  }

  if (records.subtasks.length === 0) {
    return result(check, "fail", "run created no subtasks", [
      { label: `execution ${ctx.trace.executionId} · records` },
    ]);
  }

  const scoped = check.status
    ? records.subtasks.filter((subtask) => normalize(subtask.status ?? "") === normalize(check.status!))
    : records.subtasks;
  const titles = new Set(scoped.map((subtask) => normalize(subtask.title)));
  const missing = (check.titles ?? []).filter((title) => !titles.has(normalize(title)));
  const evidence: CheckEvidence[] = [
    {
      label: `execution ${ctx.trace.executionId} · ${records.subtasks.length} subtask(s)`,
    },
  ];

  if (missing.length > 0) {
    return result(check, "fail", `missing subtask(s): ${missing.join(", ")}`, evidence);
  }
  if (scoped.length < check.min_count) {
    return result(
      check,
      "fail",
      `expected at least ${check.min_count} subtask(s), found ${scoped.length}`,
      evidence,
    );
  }

  return result(check, "pass", `${scoped.length} subtask(s) on record`, evidence);
};