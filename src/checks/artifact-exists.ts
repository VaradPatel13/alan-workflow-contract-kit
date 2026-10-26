import { matchingArtifacts } from "../trace/normalize";
import { artifactEvidence, executionEvidence } from "./helpers";
import { result, type CheckRegistry } from "./types";

export const artifactExists: CheckRegistry["artifact.exists"] = (check, ctx) => {
  const matches = matchingArtifacts(ctx.trace, check.artifact);

  if (matches.length >= check.min) {
    return result(
      check,
      "pass",
      `${matches.length} ${check.artifact} artifact(s) found`,
      matches.map((artifact) => artifactEvidence(artifact)),
    );
  }

  return result(
    check,
    "fail",
    `expected at least ${check.min} ${check.artifact} artifact, found ${matches.length}`,
    [executionEvidence(ctx.trace)],
  );
};