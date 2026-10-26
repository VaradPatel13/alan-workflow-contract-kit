import type { ArtifactSection, RunTrace, TraceArtifact } from "./model";

/** Heading -> anchor the way Alan renders an outline. */
export function anchorFor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[:.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits a markdown body into a flat outline, matching get_artifact({ outline }). */
export function parseMarkdownSections(markdown: string): ArtifactSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ArtifactSection[] = [];
  let current: ArtifactSection | undefined;

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading && heading[1] && heading[2]) {
      current = {
        heading: heading[2],
        anchor: anchorFor(heading[2]),
        level: heading[1].length,
        content: "",
      };
      sections.push(current);
      continue;
    }
    if (current) {
      current.content += `${line}\n`;
    }
  }

  return sections.map((section) => ({ ...section, content: section.content.trim() }));
}

/** 1-based line number of a heading inside an artifact body, or undefined. */
export function lineOfHeading(markdown: string | undefined, heading: string): number | undefined {
  if (!markdown) return undefined;
  const wanted = normalizeHeading(heading);
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[index] ?? "");
    if (match && match[1] && normalizeHeading(match[1]) === wanted) {
      return index + 1;
    }
  }
  return undefined;
}

/** Converts a section-relative line to an artifact-relative one, when the body is known. */
export function absoluteLine(
  artifact: TraceArtifact,
  section: ArtifactSection,
  relativeLine: number,
): number | undefined {
  const start = lineOfHeading(artifact.content, section.heading);
  return start === undefined ? undefined : start + relativeLine;
}

/** 1-based line number of the first line inside a section matching a pattern. */
export function lineOfPattern(
  artifact: TraceArtifact,
  section: ArtifactSection,
  pattern: RegExp,
): number | undefined {
  const sectionStart = lineOfHeading(artifact.content, section.heading);
  for (const [offset, line] of section.content.split(/\r?\n/).entries()) {
    pattern.lastIndex = 0;
    if (pattern.test(line)) {
      return sectionStart === undefined ? undefined : sectionStart + offset + 1;
    }
  }
  return undefined;
}

/** Artifact text: headings plus bodies, so text checks see the whole document. */
export function artifactText(artifact: TraceArtifact): string {
  if (artifact.content) return artifact.content;
  return artifact.sections
    .map((section) => `${"#".repeat(section.level)} ${section.heading}\n${section.content}`)
    .join("\n\n");
}

/** Finds an artifact by id first, then by type (case-insensitive). */
export function findArtifact(trace: RunTrace, ref: string): TraceArtifact | undefined {
  return matchingArtifacts(trace, ref)[0];
}

export function matchingArtifacts(trace: RunTrace, ref: string): TraceArtifact[] {
  const direct = trace.artifacts.filter((artifact) => artifact.id === ref);
  if (direct.length > 0) return direct;
  const type = ref.toLowerCase();
  return trace.artifacts.filter((artifact) => artifact.type.toLowerCase() === type);
}

export function findSection(
  artifact: TraceArtifact,
  heading: string,
): ArtifactSection | undefined {
  const wanted = normalizeHeading(heading);
  return (
    artifact.sections.find((section) => normalizeHeading(section.heading) === wanted) ??
    artifact.sections.find((section) => normalizeHeading(section.heading).startsWith(wanted))
  );
}

/** Tool usage totals, derived from per-message counters when limits are absent. */
export function deriveLimits(trace: RunTrace): { toolCalls: number; failedToolCalls: number } {
  if (trace.limits) return trace.limits;
  let toolCalls = 0;
  let failedToolCalls = 0;
  for (const message of trace.messages) {
    for (const count of Object.values(message.toolCalls)) {
      toolCalls += count;
    }
    for (const count of Object.values(message.failedToolCalls)) {
      failedToolCalls += count;
    }
  }
  return { toolCalls, failedToolCalls };
}

/** Total counter for one tool name across the transcript. */
export function toolCallCount(trace: RunTrace, tool: string): number {
  const wanted = tool.toLowerCase();
  return trace.messages.reduce((total, message) => {
    for (const [name, count] of Object.entries(message.toolCalls)) {
      if (name.toLowerCase() === wanted) total += count;
    }
    return total;
  }, 0);
}

/** Flattens a section body into evidence items: bullets, or paragraphs when unbounded. */
export function evidenceItems(section: ArtifactSection): { text: string; line: number }[] {
  const lines = section.content.split(/\r?\n/);
  const items: { text: string; line: number }[] = [];
  let bullet = /^\s*(?:[-*+]|\d+[.)])\s+/;

  for (const [offset, line] of lines.entries()) {
    if (bullet.test(line)) {
      items.push({ text: line.replace(bullet, "").trim(), line: offset + 1 });
    }
  }
  if (items.length > 0) return items;

  return lines
    .map((line, offset) => ({ text: line.trim(), line: offset + 1 }))
    .filter((item) => item.text.length > 0 && !/^#{1,6}\s/.test(item.text));
}