import { lineOfPattern } from "../trace/normalize";
import type { ArtifactSection, TraceArtifact } from "../trace/model";
import { artifactEvidence, countMatches, messageEvidence } from "./helpers";
import { result, type CheckRegistry, type CheckEvidence } from "./types";

interface Source {
  text: string;
  artifact?: TraceArtifact;
  section?: ArtifactSection;
  evidence: CheckEvidence;
}

/**
 * Catches the failure mode section checks miss: the document has the right
 * shape but the body says something the contract forbids ("LGTM", "nothing to
 * flag"). Scans artifacts and/or the transcript, never the output of a judge.
 */
export const textForbidden: CheckRegistry["text.forbidden"] = (check, ctx) => {
  const flags = check.ignore_case ? "gi" : "g";
  const sources: Source[] = [];

  if (check.scope !== "session") {
    for (const artifact of ctx.trace.artifacts) {
      if (artifact.sections.length > 0) {
        for (const section of artifact.sections) {
          sources.push({
            text: section.content,
            artifact,
            section,
            evidence: artifactEvidence(artifact, section.heading),
          });
        }
      } else {
        sources.push({
          text: artifact.content ?? "",
          artifact,
          evidence: artifactEvidence(artifact),
        });
      }
    }
  }

  if (check.scope !== "artifacts") {
    ctx.trace.messages.forEach((message, index) => {
      sources.push({
        text: message.content,
        evidence: messageEvidence(ctx.trace, index),
      });
    });
  }

  const hits: CheckEvidence[] = [];
  const phrases: string[] = [];

  for (const source of check.patterns) {
    const pattern = new RegExp(source, flags);
    let count = 0;

    for (const candidate of sources) {
      count += countMatches(candidate.text, pattern);
    }
    if (count === 0) continue;

    phrases.push(`"${source}" (${count})`);
    const offending = sources.find((candidate) => countMatches(candidate.text, pattern) > 0);
    if (offending) {
      if (offending.artifact && offending.section) {
        const line = lineOfPattern(offending.artifact, offending.section, pattern);
        hits.push(artifactEvidence(offending.artifact, offending.section.heading, line));
      } else {
        hits.push(offending.evidence);
      }
    }
  }

  if (hits.length > 0) {
    return result(check, "fail", `forbidden phrase(s) present: ${phrases.join(", ")}`, hits.slice(0, 3));
  }

  return result(check, "pass", `no forbidden phrases across ${sources.length} source(s)`);
};