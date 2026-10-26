import {
  type AlanTransport,
  type ArtifactSnapshot,
  type ExecutionSnapshot,
  type SessionMessageSnapshot,
} from "./alan-mcp";
import { IntegrationError } from "./types";

/**
 * Implementation of AlanTransport over Alan's own tool surface.
 *
 * The only thing it needs is a client that can invoke a tool by name, which is
 * exactly the Mode A open question (transport + external auth). Everything
 * below is the mapping: no endpoint, no credential, no guess about hosts.
 */

export type AlanTool =
  | "execute_workflow"
  | "workflow_execution"
  | "list_artifacts"
  | "get_artifact"
  | "list_sessions"
  | "get_session_context";

export interface AlanMcpClient {
  call(tool: AlanTool, input: Record<string, unknown>): Promise<unknown>;
}

export interface AlanMcpTransportOptions {
  client: AlanMcpClient;
  teamId?: string;
  /** Override execution -> session resolution when a deployment exposes a direct link. */
  resolveSessionId?: (execution: ExecutionSnapshot) => string | undefined | Promise<string | undefined>;
}

type Json = Record<string, unknown>;

function decode(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Json | undefined {
  const decoded = decode(value);
  return decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? (decoded as Json)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  const decoded = decode(value);
  return Array.isArray(decoded) ? decoded : [];
}

/** Unwraps the collection envelopes Alan uses (`rows`, `data`, `artifacts`, `sessions`). */
function collection(value: unknown, keys: string[]): Json[] {
  const decoded = decode(value);
  if (Array.isArray(decoded)) return decoded.filter(isJson);
  const record = asRecord(decoded);
  if (!record) return [];
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate.filter(isJson);
  }
  return [];
}

function isJson(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Reads `{ tool: count }` or `[{ tool|name, count|calls }]` counter shapes. */
function counters(value: unknown): Record<string, number> | undefined {
  if (Array.isArray(value)) {
    const out: Record<string, number> = {};
    for (const entry of value) {
      if (typeof entry === "string") {
        out[entry] = (out[entry] ?? 0) + 1;
        continue;
      }
      const record = asRecord(entry);
      if (!record) continue;
      const name = str(record.tool) ?? str(record.name);
      const count = num(record.count) ?? num(record.calls) ?? 1;
      if (name) out[name] = (out[name] ?? 0) + count;
    }
    return out;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const out: Record<string, number> = {};
  for (const [name, count] of Object.entries(record)) {
    const parsed = num(count);
    if (parsed !== undefined) out[name] = parsed;
  }
  return out;
}

/** The MCP-backed transport always provides the transcript reader, even if it resolves nothing. */
export type McpTransport = AlanTransport & {
  getSessionMessages(executionId: string): Promise<SessionMessageSnapshot[]>;
};

export function createAlanMcpTransport(options: AlanMcpTransportOptions): McpTransport {
  const { client, teamId } = options;
  const snapshots = new Map<string, ExecutionSnapshot>();

  async function call(tool: AlanTool, input: Json, operation: string): Promise<unknown> {
    try {
      return await client.call(tool, input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new IntegrationError(`${operation} failed: ${reason}`);
    }
  }

  async function findSessionId(execution: ExecutionSnapshot): Promise<string | undefined> {
    if (execution.sessionId) return execution.sessionId;
    if (options.resolveSessionId) {
      const resolved = await options.resolveSessionId(execution);
      if (resolved) return resolved;
    }
    if (!execution.taskId) return undefined;

    const listed = await call(
      "list_sessions",
      { ...(teamId ? { teamId } : {}), limit: 50 },
      "list_sessions",
    );
    const match = collection(listed, ["sessions", "data", "rows"]).find(
      (session) => str(session.taskId) === execution.taskId,
    );
    return match ? str(match.id) : undefined;
  }

  return {
    async executeWorkflow({ workflowId, inputs }) {
      const result = asRecord(
        await call(
          "execute_workflow",
          { workflowId, triggerPayload: inputs },
          `execute_workflow ${workflowId}`,
        ),
      );
      const nested = asRecord(result?.execution) ?? asRecord(result?.run) ?? result;
      const executionId =
        str(nested?.executionId) ?? str(nested?.id) ?? str(result?.executionId) ?? str(result?.id);

      if (!executionId) {
        throw new IntegrationError(
          `execute_workflow ${workflowId} returned no execution id (keys: ${Object.keys(result ?? {}).join(", ") || "none"})`,
        );
      }
      return { executionId };
    },

    async getExecution(executionId) {
      const result = await call(
        "workflow_execution",
        { op: "get", executionId },
        `workflow_execution get ${executionId}`,
      );
      const row =
        collection(result, ["rows", "data"])[0] ??
        asRecord(asRecord(result)?.execution) ??
        asRecord(result);

      const status = str(row?.status);
      if (!status) {
        throw new IntegrationError(`workflow_execution get ${executionId} returned no status`);
      }

      const errorMessage = str(row?.error);
      const errorKind = str(row?.errorKind);
      const snapshot: ExecutionSnapshot = {
        executionId,
        status,
        ...(errorMessage
          ? { error: { ...(errorKind ? { kind: errorKind } : {}), message: errorMessage } }
          : errorKind
            ? { error: { kind: errorKind, message: errorKind } }
            : {}),
        ...(str(row?.startedAt) ? { startedAt: str(row?.startedAt)! } : {}),
        ...(str(row?.completedAt) ? { completedAt: str(row?.completedAt)! } : {}),
        ...(str(row?.model) ? { model: str(row?.model)! } : {}),
        ...(str(row?.taskId) ? { taskId: str(row?.taskId)! } : {}),
        ...(str(row?.sessionId) ? { sessionId: str(row?.sessionId)! } : {}),
      };

      snapshots.set(executionId, snapshot);
      return snapshot;
    },

    async listArtifacts(executionId) {
      const result = await call(
        "list_artifacts",
        { workflowExecutionId: executionId },
        `list_artifacts ${executionId}`,
      );
      return collection(result, ["artifacts", "rows", "data"]).flatMap<ArtifactSnapshot>(
        (artifact) => {
          const id = str(artifact.id);
          if (!id) return [];
          return [
            {
              id,
              type: str(artifact.type) ?? "unknown",
              title: str(artifact.title) ?? id,
              ...(str(artifact.url) ? { url: str(artifact.url)! } : {}),
            },
          ];
        },
      );
    },

    async getArtifact(artifactId) {
      const result = await call("get_artifact", { artifactId }, `get_artifact ${artifactId}`);
      const artifact = asRecord(result);
      if (!artifact) {
        throw new IntegrationError(`get_artifact ${artifactId} returned no artifact`);
      }
      const content = str(artifact.content) ?? str(artifact.body) ?? str(artifact.markdown);
      return {
        id: str(artifact.id) ?? artifactId,
        type: str(artifact.type) ?? "unknown",
        title: str(artifact.title) ?? artifactId,
        ...(str(artifact.url) ? { url: str(artifact.url)! } : {}),
        ...(content ? { content } : {}),
      };
    },

    async getSessionMessages(executionId) {
      const execution = snapshots.get(executionId);
      const sessionId = execution ? await findSessionId(execution) : undefined;
      if (!sessionId) return [];

      const result = await call(
        "get_session_context",
        { sessionId },
        `get_session_context ${sessionId}`,
      );
      const messages =
        collection(result, ["messages", "data"]).length > 0
          ? collection(result, ["messages", "data"])
          : collection(asRecord(result)?.session ?? {}, ["messages"]);

      return messages.map<SessionMessageSnapshot>((message) => {
        const toolCounterField = ["toolCalls", "toolActivity", "tools", "toolCounts"].find(
          (key) => key in message,
        );
        const failedField = ["failedToolCalls", "failedTools", "toolFailures"].find(
          (key) => key in message,
        );
        const toolCalls = counters(toolCounterField ? message[toolCounterField] : undefined) ?? {};
        const failedToolCalls =
          counters(failedField ? message[failedField] : undefined) ?? {};

        return {
          role: str(message.role) ?? str(message.author) ?? "unknown",
          content: str(message.content) ?? str(message.text) ?? "",
          toolCalls,
          failedToolCalls,
          hasToolCounters: Boolean(toolCounterField || failedField),
        };
      });
    },
  };
}