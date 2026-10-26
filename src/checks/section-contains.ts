import { findArtifact, findSection } from "../trace/normalize";
import { artifactEvidence, executionEvidence } from "./helpers";
import { result, type CheckRegistry } from "./types";

export const sectionContains: CheckRegistry["section.contains"] = (check, ctx) => {
  const artifact = findArtifact(ctx.trace, check.artifact);
  if (!artifact) {
    return result(check, "fail", `no ${check.artifact} artifact in this run`, [
      executionEvidence(ctx.trace),
    ]);
  }

  const section = findSection(artifact, check.section);
  if (!section) {
    return result(
      check,
      "fail",
      `section "${check.section}" not found in ${artifact.title}`,
      [artifactEvidence(artifact)],
    );
  }

  const hits = check.patterns.map((pattern) => ({
    pattern,
    matched: new RegExp(pattern, "i").test(section.content),
  }));
  const unmet = hits.filter((hit) => !hit.matched).map((hit) => hit.pattern);
  const ok = check.mode === "all" ? unmet.length === 0 : unmet.length < hits.length;

  if (ok) {
    return result(
      check,
      "pass",
      `${check.mode === "all" ? "all" : "a"} pattern(s) matched in "${section.heading}"`,
      [artifactEvidence(artifact, section.heading)],
    );
  }

  return result(
    check,
    "fail",
    check.mode === "all"
      ? `"${section.heading}" is missing: ${unmet.join(", ")}`
      : `"${section.heading}" matches none of: ${check.patterns.join(", ")}`,
    [artifactEvidence(artifact, section.heading)],
  );
};