import type { TraceArtifact, RunTrace } from "../trace/model";
import type { CheckEvidence } from "./types";

export function artifactEvidence(
  artifact: TraceArtifact,
  section?: string,
  line?: number,
): CheckEvidence {
  const parts = [artifact.title];
  if (section) parts.push(section);
  if (line !== undefined) parts.push(`line ${line}`);
  return {
    label: `${parts.join(" › ")} (${artifact.id})`,
    ...(artifact.url ? { url: artifact.url } : {}),
  };
}

export function executionEvidence(trace: RunTrace): CheckEvidence {
  const detail = trace.error ? ` · ${trace.error.kind ?? "error"}: ${trace.error.message}` : "";
  return { label: `execution ${trace.executionId} · ${trace.status}${detail}` };
}

export function messageEvidence(trace: RunTrace, index: number): CheckEvidence {
  return { label: `session ${trace.executionId} · message ${index + 1}` };
}

export function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  return [...text.matchAll(global)].length;
}