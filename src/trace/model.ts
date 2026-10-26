import { z } from "zod";

/**
 * Normalized view of one Alan workflow execution.
 *
 * The live adapter fills this from execute_workflow -> workflow_execution ->
 * list_artifacts -> get_artifact -> get_session_context. Fixtures use the same
 * shape, which is what makes the whole check layer testable offline.
 */

export const artifactSectionSchema = z.object({
  heading: z.string(),
  anchor: z.string(),
  level: z.number().int().min(1).max(6).default(2),
  content: z.string().default(""),
});

export const artifactSchema = z.object({
  id: z.string(),
  /** Alan artifact type: plan, test-report, markdown-document, ... */
  type: z.string(),
  title: z.string(),
  url: z.string().optional(),
  /** Raw body, when the transport returns one. */
  content: z.string().optional(),
  sections: z.array(artifactSectionSchema).default([]),
});

export const messageSchema = z.object({
  role: z.string(),
  content: z.string().default(""),
  /** Counter-level only: get_session_context exposes names and counts, not args. */
  toolCalls: z.record(z.number().int().min(0)).default({}),
  failedToolCalls: z.record(z.number().int().min(0)).default({}),
});

export const subtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string().optional(),
});

export const traceSchema = z.object({
  executionId: z.string(),
  workflowId: z.string(),
  status: z.string(),
  error: z
    .object({
      kind: z.string().optional(),
      message: z.string(),
    })
    .optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  artifacts: z.array(artifactSchema).default([]),
  messages: z.array(messageSchema).default([]),
  records: z
    .object({
      subtasks: z.array(subtaskSchema).default([]),
      taskComments: z.array(z.object({ body: z.string() })).default([]),
    })
    .optional(),
  limits: z
    .object({
      toolCalls: z.number().int().min(0),
      failedToolCalls: z.number().int().min(0).default(0),
    })
    .optional(),
  model: z.string().optional(),
});

export type RunTrace = z.infer<typeof traceSchema>;
export type TraceArtifact = z.infer<typeof artifactSchema>;
export type ArtifactSection = z.infer<typeof artifactSectionSchema>;
export type TraceMessage = z.infer<typeof messageSchema>;