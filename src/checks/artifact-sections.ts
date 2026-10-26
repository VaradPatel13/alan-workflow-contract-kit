import { findArtifact, normalizeHeading } from "../trace/normalize";
import { artifactEvidence, executionEvidence } from "./helpers";
import { result, type CheckRegistry } from "./types";

export const artifactSections: CheckRegistry["artifact.sections"] = (check, ctx) => {
  const artifact = findArtifact(ctx.trace, check.artifact);
  if (!artifact) {
    return result(check, "fail", `no ${check.artifact} artifact in this run`, [
      executionEvidence(ctx.trace),
    ]);
  }

  const present = new Set(artifact.sections.map((section) => normalizeHeading(section.heading)));
  const missing = check.require.filter((heading) => !present.has(normalizeHeading(heading)));

  if (missing.length === 0) {
    return result(
      check,
      "pass",
      `${check.require.length}/${check.require.length} required sections present`,
      [artifactEvidence(artifact)],
    );
  }

  return result(
    check,
    "fail",
    `missing section(s): ${missing.join(", ")}`,
    [artifactEvidence(artifact)],
  );
};