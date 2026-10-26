import { parseMarkdownSections } from "../trace/normalize";
import { traceSchema, type RunTrace, type TraceArtifact } from "../trace/model";
import { IntegrationError, type Adapter, type RunRequest } from "./types";

/**
 * Boundary for Mode A (standalone CLI in CI). The rest of the kit is written
 * against this interface, so the engine does not care whether mode A is
 * available yet, or whether a Skill in Mode B is driving it.
 */

export interface ExecutionSnapshot {
  executionId: string;
  status: string;
  error?: { kind?: string; message: string };
  startedAt?: string;
  completedAt?: string;
  model?: string;
}

export interface ArtifactSnapshot {
  id: string;
  type: string;
  title: string;
  url?: string;
  content?: string;
}

export interface SessionMessageSnapshot {
  role: string;
  content: string;
  toolCalls?: Record<string, number>;
  failedToolCalls?: Record<string, number>;
}

export interface SubtaskSnapshot {
  id: string;
  title: string;
  status?: string;
}

export interface AlanTransport {
  /**
   * Maps to `execute_workflow({ workflowId, triggerPayload })`: `inputs` is sent
   * as `triggerPayload`, which also carries task/PR context when relevant.
   */
  executeWorkflow(input: {
    workflowId: string;
    inputs: Record<string, unknown>;
  }): Promise<{ executionId: string }>;
  getExecution(executionId: string): Promise<ExecutionSnapshot>;
  listArtifacts(executionId: string): Promise<ArtifactSnapshot[]>;
  getArtifact(artifactId: string): Promise<ArtifactSnapshot>;
  /**
   * Resolve the execution's session (list_sessions) and read it with
   * get_session_context. Optional: transports that cannot resolve the session
   * leave transcript checks skipped instead of failing them.
   */
  getSessionMessages?(executionId: string): Promise<SessionMessageSnapshot[]>;
  /** Optional: transports that cannot read records leave records.subtasks skipped. */
  getRecords?(executionId: string): Promise<{ subtasks: SubtaskSnapshot[] }>;
}

/**
 * Statuses from `workflow_execution` that end a poll. `pending`, `running` and
 * `awaiting_local` are not terminal: waiting on a local machine may still move,
 * and if it never does the timeout turns it into an integration error.
 */
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "canceled",
  "timed_out",
  "skipped",
  "missing_variables",
  "sandbox_died",
]);

export interface AlanAdapterOptions {
  transport: AlanTransport;
  /** Poll interval for workflow_execution. */
  pollIntervalMs?: number;
  /** Wall-clock budget for one execution. */
  timeoutMs?: number;
  /** Injectable clock/sleep so the polling loop is testable. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class AlanAdapter implements Adapter {
  readonly name = "alan";
  private readonly transport: AlanTransport;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: AlanAdapterOptions) {
    this.transport = options.transport;
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.timeoutMs = options.timeoutMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run({ contract, runIndex }: RunRequest): Promise<RunTrace> {
    const started = this.now();
    const { executionId } = await this.transport
      .executeWorkflow({ workflowId: contract.workflow, inputs: contract.inputs })
      .catch((error: unknown) => {
        throw this.wrap(error, `execute_workflow ${contract.workflow} (run ${runIndex + 1})`);
      });

    const snapshot = await this.poll(executionId, started);

    const [artifacts, transcript, records] = await Promise.all([
      this.collectArtifacts(executionId),
      this.collectMessages(executionId),
      this.collectRecords(executionId),
    ]);

    return traceSchema.parse({
      executionId,
      workflowId: contract.workflow,
      status: snapshot.status,
      ...(snapshot.error ? { error: snapshot.error } : {}),
      ...(snapshot.startedAt ? { startedAt: snapshot.startedAt } : {}),
      ...(snapshot.completedAt ? { completedAt: snapshot.completedAt } : {}),
      ...(snapshot.model ?? contract.model ? { model: snapshot.model ?? contract.model } : {}),
      artifacts,
      messages: transcript.messages,
      capabilities: { transcript: transcript.available, records: records !== undefined },
      ...(records ? { records } : {}),
    });
  }

  private async poll(executionId: string, started: number): Promise<ExecutionSnapshot> {
    for (;;) {
      const snapshot = await this.transport
        .getExecution(executionId)
        .catch((error: unknown) => {
          throw this.wrap(error, `workflow_execution get ${executionId}`);
        });

      if (TERMINAL_STATUSES.has(snapshot.status)) {
        return snapshot;
      }
      if (this.now() - started > this.timeoutMs) {
        throw new IntegrationError(
          `execution ${executionId} did not finish within ${this.timeoutMs}ms ` +
            `(last status "${snapshot.status}")`,
        );
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async collectArtifacts(executionId: string): Promise<TraceArtifact[]> {
    const listed = await this.transport
      .listArtifacts(executionId)
      .catch((error: unknown) => {
        throw this.wrap(error, `list_artifacts ${executionId}`);
      });

    return Promise.all(
      listed.map(async (summary) => {
        const full = await this.transport.getArtifact(summary.id).catch(() => summary);
        const content = full.content;
        return {
          id: full.id,
          type: full.type,
          title: full.title,
          ...(full.url ? { url: full.url } : {}),
          ...(content ? { content } : {}),
          sections: content ? parseMarkdownSections(content) : [],
        };
      }),
    );
  }

  private async collectMessages(
    executionId: string,
  ): Promise<{
    available: boolean;
    messages: { role: string; content: string; toolCalls: Record<string, number>; failedToolCalls: Record<string, number> }[];
  }> {
    if (!this.transport.getSessionMessages) {
      return { available: false, messages: [] };
    }

    const messages = await this.transport
      .getSessionMessages(executionId)
      .catch((error: unknown) => {
        throw this.wrap(error, `get_session_context ${executionId}`);
      });

    return {
      available: true,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls ?? {},
        failedToolCalls: message.failedToolCalls ?? {},
      })),
    };
  }

  private async collectRecords(
    executionId: string,
  ): Promise<{ subtasks: SubtaskSnapshot[]; taskComments: { body: string }[] } | undefined> {
    if (!this.transport.getRecords) return undefined;
    const records = await this.transport.getRecords(executionId).catch((error: unknown) => {
      throw this.wrap(error, `records ${executionId}`);
    });
    return { subtasks: records.subtasks, taskComments: [] };
  }

  private wrap(error: unknown, operation: string): IntegrationError {
    if (error instanceof IntegrationError) return error;
    const reason = error instanceof Error ? error.message : String(error);
    return new IntegrationError(`${operation} failed: ${reason}`);
  }
}

/**
 * Mode A gate. Until P0 confirms a third-party transport and scopes, the live
 * adapter is wired to a transport that fails loudly instead of pretending.
 */
export function createUnavailableTransport(reason: string): AlanTransport {
  const fail = (): never => {
    throw new IntegrationError(`live Alan transport is not configured: ${reason}`);
  };
  return {
    executeWorkflow: fail,
    getExecution: fail,
    listArtifacts: fail,
    getArtifact: fail,
    getSessionMessages: fail,
  };
}