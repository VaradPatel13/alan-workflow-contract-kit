import { describe, expect, it } from "vitest";
import { AlanAdapter } from "../src/adapters/alan-mcp";
import {
  createAlanMcpTransport,
  type AlanMcpClient,
  type AlanTool,
} from "../src/adapters/alan-mcp-transport";
import { IntegrationError } from "../src/adapters/types";
import { evaluateCheck } from "../src/checks/registry";
import { makeContract } from "./helpers";

const teamId = "team_test";

function client(handlers: Partial<Record<AlanTool, unknown>>): AlanMcpClient {
  return {
    async call(tool) {
      if (!(tool in handlers)) throw new Error(`unexpected tool ${tool}`);
      return handlers[tool];
    },
  };
}

const executionRow = {
  id: "exec_1",
  status: "succeeded",
  taskId: "task_9",
  startedAt: "2026-10-24T10:00:00.000Z",
  completedAt: "2026-10-24T10:04:00.000Z",
};

const contract = makeContract(
  [
    { id: "exists", type: "artifact.exists", artifact: "test-report", min: 1 },
    { id: "used", type: "trace.tool_used", tool: "create_test_report", min_calls: 1 },
  ],
  { workflow: "wf_test" },
);

describe("MCP transport mapping", () => {
  it("sends contract inputs as triggerPayload", async () => {
    const seen: Record<string, unknown>[] = [];
    const transport = createAlanMcpTransport({
      teamId,
      client: {
        async call(tool, input) {
          if (tool === "execute_workflow") {
            seen.push(input);
            return JSON.stringify({ executionId: "exec_1" });
          }
          throw new Error(`unexpected ${tool}`);
        },
      },
    });

    const { executionId } = await transport.executeWorkflow({
      workflowId: "wf_test",
      inputs: { pr: 1842 },
    });
    expect(executionId).toBe("exec_1");
    expect(seen[0]).toEqual({ workflowId: "wf_test", triggerPayload: { pr: 1842 } });
  });

  it("unwraps rows envelopes and maps errorKind", async () => {
    const transport = createAlanMcpTransport({
      client: client({
        workflow_execution: JSON.stringify({
          rows: [{ ...executionRow, status: "timed_out", error: "sandbox stopped", errorKind: "timeout" }],
        }),
      }),
    });

    const snapshot = await transport.getExecution("exec_1");
    expect(snapshot.status).toBe("timed_out");
    expect(snapshot.error).toEqual({ kind: "timeout", message: "sandbox stopped" });
    expect(snapshot.taskId).toBe("task_9");
  });

  it("fails clearly when the execution id is missing from the response", async () => {
    const transport = createAlanMcpTransport({
      client: client({ execute_workflow: { ok: true } }),
    });
    await expect(transport.executeWorkflow({ workflowId: "wf_test", inputs: {} })).rejects.toBeInstanceOf(
      IntegrationError,
    );
  });

  it("resolves the session through taskId, since list_sessions has no execution filter", async () => {
    const transport = createAlanMcpTransport({
      teamId,
      client: client({
        workflow_execution: { id: "exec_1", status: "succeeded", taskId: "task_9" },
        list_sessions: {
          sessions: [
            { id: "sess_other", taskId: "task_1" },
            { id: "sess_9", taskId: "task_9" },
          ],
        },
        get_session_context: {
          sessionId: "sess_9",
          messages: [
            { id: "m1", role: "assistant", content: "done", turnOrdinal: 1 },
            { id: "m2", role: "user", content: "go", turnOrdinal: 0 },
          ],
        },
        list_artifacts: { rows: [{ id: "art_1", type: "test-report", title: "Report" }] },
        get_artifact: { id: "art_1", type: "test-report", title: "Report", content: "# Report\n\n## Summary\nok" },
      }),
    });

    await transport.getExecution("exec_1");
    const messages = await transport.getSessionMessages("exec_1");
    expect(messages).toHaveLength(2);
    // Observed live payloads carry no counter fields; the transport must say so.
    expect(messages[0]?.hasToolCounters).toBe(false);
  });

  it("reads counters when a deployment does expose them", async () => {
    const transport = createAlanMcpTransport({
      teamId,
      client: client({
        workflow_execution: { id: "exec_1", status: "succeeded", sessionId: "sess_9" },
        get_session_context: {
          messages: [
            {
              role: "assistant",
              content: "filed",
              toolActivity: [{ tool: "create_subtask", count: 2 }, { tool: "read_file", count: 1 }],
              failedToolCalls: {},
            },
          ],
        },
      }),
    });

    await transport.getExecution("exec_1");
    const [message] = await transport.getSessionMessages("exec_1");
    expect(message?.toolCalls).toEqual({ create_subtask: 2, read_file: 1 });
    expect(message?.hasToolCounters).toBe(true);
  });

  it("end to end: a live run with no counters skips counter checks instead of failing them", async () => {
    const transport = createAlanMcpTransport({
      teamId,
      client: client({
        execute_workflow: { executionId: "exec_1" },
        workflow_execution: { id: "exec_1", status: "succeeded", taskId: "task_9" },
        list_sessions: { sessions: [{ id: "sess_9", taskId: "task_9" }] },
        get_session_context: { messages: [{ role: "assistant", content: "done" }] },
        list_artifacts: [{ id: "art_1", type: "test-report", title: "Report" }],
        get_artifact: { id: "art_1", type: "test-report", title: "Report", content: "# Report\n\n## Summary\nok" },
      }),
    });

    const trace = await new AlanAdapter({ transport }).run({ contract, runIndex: 0 });
    expect(trace.capabilities).toEqual({ transcript: true, toolCounters: false, records: false });

    const counters = evaluateCheck(
      { id: "used", type: "trace.tool_used", tool: "create_test_report", min_calls: 1, max_calls: undefined },
      { contract, trace, runIndex: 0 },
    );
    expect(counters.status).toBe("skipped");

    const artifacts = evaluateCheck(
      { id: "exists", type: "artifact.exists", artifact: "test-report", min: 1 },
      { contract, trace, runIndex: 0 },
    );
    expect(artifacts.status).toBe("pass");
  });
});