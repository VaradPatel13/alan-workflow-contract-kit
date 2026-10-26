import { describe, expect, it } from "vitest";
import { evaluateCheck } from "../src/checks/registry";
import type { ContractCheck } from "../src/contracts/schema";
import { parseMarkdownSections } from "../src/trace/normalize";
import type { RunTrace } from "../src/trace/model";
import { makeContract, makeTrace, reportBody } from "./helpers";

function run(check: ContractCheck, trace: RunTrace) {
  return evaluateCheck(check, { contract: makeContract([check]), trace, runIndex: 0 });
}

const reportArtifact = {
  id: "art_1",
  type: "test-report",
  title: "PR review",
  url: "https://example.test/art_1",
  content: reportBody,
  sections: parseMarkdownSections(reportBody),
};

describe("artifact.exists", () => {
  it("passes when the artifact is present", () => {
    const trace = makeTrace({ artifacts: [reportArtifact] });
    const result = run({ id: "exists", type: "artifact.exists", artifact: "test-report", min: 1 }, trace);
    expect(result.status).toBe("pass");
    expect(result.evidence[0]?.url).toBe("https://example.test/art_1");
  });

  it("fails with an execution pointer when it is missing", () => {
    const result = run(
      { id: "exists", type: "artifact.exists", artifact: "test-report", min: 1 },
      makeTrace(),
    );
    expect(result.status).toBe("fail");
    expect(result.evidence[0]?.label).toContain("exec_sample");
  });
});

describe("artifact.sections", () => {
  it("matches headings case-insensitively", () => {
    const trace = makeTrace({ artifacts: [reportArtifact] });
    const result = run(
      {
        id: "sections",
        type: "artifact.sections",
        artifact: "test-report",
        require: ["summary", "FINDINGS", "Risk", "Recommendation"],
      },
      trace,
    );
    expect(result.status).toBe("pass");
  });

  it("names the missing section", () => {
    const partial = {
      ...reportArtifact,
      content: "# Review\n\n## Summary\nok\n\n## Findings\n- src/a.ts:1 — x\n",
    };
    const trace = makeTrace({
      artifacts: [{ ...partial, sections: parseMarkdownSections(partial.content) }],
    });
    const result = run(
      {
        id: "sections",
        type: "artifact.sections",
        artifact: "test-report",
        require: ["Summary", "Findings", "Recommendation"],
      },
      trace,
    );
    expect(result.status).toBe("fail");
    expect(result.message).toContain("Recommendation");
  });
});

describe("section.evidence", () => {
  it("passes when every item cites path:line", () => {
    const trace = makeTrace({ artifacts: [reportArtifact] });
    const result = run(
      {
        id: "evidence",
        type: "section.evidence",
        artifact: "test-report",
        section: "Findings",
        pattern: "[\\w./-]+\\.\\w+:\\d+",
        min_per_item: 1,
        min_items: 1,
      },
      trace,
    );
    expect(result.status).toBe("pass");
  });

  it("fails and points at artifact-relative lines, not section-relative ones", () => {
    const body = "# Review\n\n## Summary\nok\n\n## Findings\n- looks risky\n- fine\n\n## Risk\nLow\n";
    const trace = makeTrace({
      artifacts: [{ ...reportArtifact, content: body, sections: parseMarkdownSections(body) }],
    });
    const result = run(
      {
        id: "evidence",
        type: "section.evidence",
        artifact: "test-report",
        section: "Findings",
        pattern: "[\\w./-]+\\.\\w+:\\d+",
        min_per_item: 1,
        min_items: 1,
      },
      trace,
    );
    expect(result.status).toBe("fail");
    // Findings heading is line 6, so the first bullet is line 7 in the document.
    expect(result.evidence[0]?.label).toContain("line 7");
  });
});

describe("text.forbidden", () => {
  const trace = makeTrace({
    artifacts: [reportArtifact],
    messages: [{ role: "assistant", content: "LGTM, nothing to flag.", toolCalls: {}, failedToolCalls: {} }],
  });

  it("scans the transcript when scope is all", () => {
    const result = run(
      { id: "forbidden", type: "text.forbidden", patterns: ["\\bLGTM\\b"], scope: "all", ignore_case: true },
      trace,
    );
    expect(result.status).toBe("fail");
    expect(result.message).toContain("LGTM");
  });

  it("ignores the transcript when scope is artifacts", () => {
    const result = run(
      {
        id: "forbidden",
        type: "text.forbidden",
        patterns: ["\\bLGTM\\b"],
        scope: "artifacts",
        ignore_case: true,
      },
      trace,
    );
    expect(result.status).toBe("pass");
  });
});

describe("records.subtasks", () => {
  it("is skipped, never green, when the run exposes no records", () => {
    const result = run({ id: "subs", type: "records.subtasks", min_count: 1 }, makeTrace());
    expect(result.status).toBe("skipped");
  });

  it("fails when a promised subtask is missing", () => {
    const trace = makeTrace({
      records: { subtasks: [{ id: "s1", title: "Cap backoff", status: "todo" }], taskComments: [] },
    });
    const result = run(
      { id: "subs", type: "records.subtasks", titles: ["Cap backoff", "Add metric"], min_count: 1 },
      trace,
    );
    expect(result.status).toBe("fail");
    expect(result.message).toContain("Add metric");
  });

  it("respects the status filter", () => {
    const trace = makeTrace({
      records: {
        subtasks: [
          { id: "s1", title: "Cap backoff", status: "todo" },
          { id: "s2", title: "Add metric", status: "done" },
        ],
        taskComments: [],
      },
    });
    const result = run(
      { id: "subs", type: "records.subtasks", min_count: 2, status: "done" },
      trace,
    );
    expect(result.status).toBe("fail");
    expect(result.message).toContain("expected at least 2");
  });
});

describe("run.status", () => {
  it("passes on an allowed terminal status", () => {
    const result = run(
      { id: "status", type: "run.status", in: ["completed", "succeeded"] },
      makeTrace({ status: "completed" }),
    );
    expect(result.status).toBe("pass");
  });

  it("surfaces the integration error kind when the run failed", () => {
    const result = run(
      { id: "status", type: "run.status", in: ["succeeded"] },
      makeTrace({ status: "timed_out", error: { kind: "timeout", message: "sandbox exceeded 10m" } }),
    );
    expect(result.status).toBe("fail");
    expect(result.evidence[0]?.label).toContain("timeout");
  });
});

describe("run.limits", () => {
  it("derives call counts from message counters when limits are absent", () => {
    const trace = makeTrace({
      messages: [
        { role: "assistant", content: "", toolCalls: { read_file: 4, grep: 2 }, failedToolCalls: {} },
        { role: "assistant", content: "", toolCalls: { read_file: 1 }, failedToolCalls: { grep: 1 } },
      ],
    });
    const result = run({ id: "budget", type: "run.limits", max_tool_calls: 5 }, trace);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("7 tool calls > 5");
  });

  it("passes inside the budget", () => {
    const result = run(
      { id: "budget", type: "run.limits", max_tool_calls: 10, max_failed_calls: 0 },
      makeTrace({ limits: { toolCalls: 4, failedToolCalls: 0 } }),
    );
    expect(result.status).toBe("pass");
  });
});

describe("trace.tool_used", () => {
  const trace = makeTrace({
    messages: [
      {
        role: "assistant",
        content: "",
        toolCalls: { create_subtask: 2 },
        failedToolCalls: {},
      },
    ],
  });

  it("asserts counter-level usage", () => {
    expect(run({ id: "used", type: "trace.tool_used", tool: "create_subtask", min_calls: 2 }, trace).status).toBe("pass");
  });

  it("fails below the minimum", () => {
    const result = run({ id: "used", type: "trace.tool_used", tool: "create_subtask", min_calls: 3 }, trace);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("called 2 time(s)");
  });
});

describe("section.contains", () => {
  it("requires every pattern in all mode", () => {
    const trace = makeTrace({ artifacts: [reportArtifact] });
    const result = run(
      {
        id: "contains",
        type: "section.contains",
        artifact: "test-report",
        section: "Recommendation",
        patterns: ["Merge", "deploy"],
        mode: "all",
      },
      trace,
    );
    expect(result.status).toBe("fail");
    expect(result.message).toContain("deploy");
  });

  it("accepts one hit in any mode", () => {
    const trace = makeTrace({ artifacts: [reportArtifact] });
    const result = run(
      {
        id: "contains",
        type: "section.contains",
        artifact: "test-report",
        section: "Recommendation",
        patterns: ["deploy", "Merge"],
        mode: "any",
      },
      trace,
    );
    expect(result.status).toBe("pass");
  });
});