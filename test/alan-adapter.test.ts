import { describe, expect, it } from "vitest";
import {
  AlanAdapter,
  createUnavailableTransport,
  type AlanTransport,
} from "../src/adapters/alan-mcp";
import { IntegrationError } from "../src/adapters/types";
import { makeContract } from "./helpers";

const contract = makeContract([{ id: "status", type: "run.status", in: ["succeeded"] }]);

function transport(overrides: Partial<AlanTransport> = {}): AlanTransport {
  return {
    executeWorkflow: async () => ({ executionId: "exec_1" }),
    getExecution: async () => ({ executionId: "exec_1", status: "succeeded" }),
    listArtifacts: async () => [
      { id: "art_1", type: "test-report", title: "Report", content: "# Report\n\n## Summary\nok" },
    ],
    getArtifact: async (artifactId) => ({
      id: artifactId,
      type: "test-report",
      title: "Report",
      content: "# Report\n\n## Summary\nok",
    }),
    getSessionMessages: async () => [
      { role: "assistant", content: "done", toolCalls: { read_file: 2 } },
    ],
    ...overrides,
  };
}

describe("AlanAdapter", () => {
  it("polls until the execution is terminal and normalizes the outline", async () => {
    let clock = 0;
    let polls = 0;
    const adapter = new AlanAdapter({
      transport: transport({
        getExecution: async () => {
          polls += 1;
          return { executionId: "exec_1", status: polls < 3 ? "running" : "succeeded" };
        },
      }),
      pollIntervalMs: 10,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    const trace = await adapter.run({ contract, runIndex: 0 });
    expect(polls).toBe(3);
    expect(trace.status).toBe("succeeded");
    expect(trace.artifacts[0]?.sections.map((section) => section.heading)).toEqual(["Report", "Summary"]);
    expect(trace.messages[0]?.toolCalls.read_file).toBe(2);
  });

  it("gives up with an integration error instead of hanging", async () => {
    let clock = 0;
    const adapter = new AlanAdapter({
      transport: transport({
        getExecution: async () => ({ executionId: "exec_1", status: "running" }),
      }),
      pollIntervalMs: 50,
      timeoutMs: 120,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    const error = await adapter.run({ contract, runIndex: 0 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as Error).message).toMatch(/did not finish/);
  });

  it("leaves records undefined when the transport cannot read them", async () => {
    const adapter = new AlanAdapter({ transport: transport() });
    const trace = await adapter.run({ contract, runIndex: 0 });
    expect(trace.records).toBeUndefined();
  });

  it("flags a missing transcript instead of inventing zero tool calls", async () => {
    const { getSessionMessages, ...withoutTranscript } = transport();
    void getSessionMessages;
    const adapter = new AlanAdapter({ transport: withoutTranscript });

    const trace = await adapter.run({ contract, runIndex: 0 });
    expect(trace.capabilities).toEqual({ transcript: false, records: false });
    expect(trace.messages).toEqual([]);
  });

  it("stops polling on every terminal status Alan can return", async () => {
    for (const status of ["interrupted", "skipped", "cancelled", "timed_out"]) {
      const adapter = new AlanAdapter({
        transport: transport({ getExecution: async () => ({ executionId: "exec_1", status }) }),
        now: () => 0,
        sleep: async () => {
          throw new Error("should not sleep");
        },
      });
      const trace = await adapter.run({ contract, runIndex: 0 });
      expect(trace.status).toBe(status);
    }
  });

  it("fails loudly when no live transport is wired (Mode A gate)", async () => {
    const adapter = new AlanAdapter({
      transport: createUnavailableTransport("Mode A spike not passed"),
    });
    await expect(adapter.run({ contract, runIndex: 0 })).rejects.toThrow(/Mode A spike not passed/);
  });
});