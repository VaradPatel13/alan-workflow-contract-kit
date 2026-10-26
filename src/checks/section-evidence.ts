import { absoluteLine, evidenceItems, findArtifact, findSection } from "../trace/normalize";
import { artifactEvidence, countMatches, executionEvidence } from "./helpers";
import { result, type CheckRegistry } from "./types";

/**
 * The check that separates a real review from a confident one: every finding
 * must point at something verifiable (path:line by default).
 */
export const sectionEvidence: CheckRegistry["section.evidence"] = (check, ctx) => {
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

  const pattern = new RegExp(check.pattern, "gi");
  const items = evidenceItems(section).filter((item) => item.text.length > 0);

  if (items.length < check.min_items) {
    return result(
      check,
      "fail",
      `"${section.heading}" has ${items.length} item(s), expected at least ${check.min_items}`,
      [artifactEvidence(artifact, section.heading)],
    );
  }

  const offenders = items.filter(
    (item) => countMatches(item.text, pattern) < check.min_per_item,
  );

  if (offenders.length > 0) {
    return result(
      check,
      "fail",
      `${offenders.length}/${items.length} item(s) in "${section.heading}" lack evidence matching ${check.pattern}`,
      offenders
        .slice(0, 3)
        .map((item) =>
          artifactEvidence(
            artifact,
            section.heading,
            absoluteLine(artifact, section, item.line),
          ),
        ),
    );
  }

  return result(
    check,
    "pass",
    `all ${items.length} item(s) in "${section.heading}" cite evidence`,
    [artifactEvidence(artifact, section.heading)],
  );
};