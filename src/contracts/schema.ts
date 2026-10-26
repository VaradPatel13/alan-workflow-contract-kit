import { z } from "zod";

/**
 * Contract schema v1.
 *
 * Every check is deterministic: it declares the evidence it consumes and is
 * evaluated against a normalized RunTrace, never against a model judgment.
 */

const idField = z
  .string()
  .min(1, "check id is required")
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, "check id must be alphanumeric with . _ -");

/** Reference to an artifact: matches an artifact id first, then its type. */
const artifactRef = z.string().min(1);

export const checkSchema = z.discriminatedUnion("type", [
  z.object({
    id: idField,
    type: z.literal("artifact.exists"),
    artifact: artifactRef,
    min: z.number().int().min(1).default(1),
  }),
  z.object({
    id: idField,
    type: z.literal("artifact.sections"),
    artifact: artifactRef,
    require: z.array(z.string().min(1)).min(1, "declare at least one required section"),
  }),
  z.object({
    id: idField,
    type: z.literal("section.contains"),
    artifact: artifactRef,
    section: z.string().min(1),
    patterns: z.array(z.string().min(1)).min(1, "declare at least one pattern"),
    mode: z.enum(["all", "any"]).default("all"),
  }),
  z.object({
    id: idField,
    type: z.literal("section.evidence"),
    artifact: artifactRef,
    section: z.string().min(1),
    pattern: z.string().min(1),
    min_per_item: z.number().int().min(0).default(1),
    min_items: z.number().int().min(1).default(1),
  }),
  z.object({
    id: idField,
    type: z.literal("text.forbidden"),
    patterns: z.array(z.string().min(1)).min(1, "declare at least one pattern"),
    scope: z.enum(["artifacts", "session", "all"]).default("artifacts"),
    ignore_case: z.boolean().default(true),
  }),
  z.object({
    id: idField,
    type: z.literal("records.subtasks"),
    titles: z.array(z.string().min(1)).optional(),
    min_count: z.number().int().min(0).default(0),
    status: z.string().optional(),
  }),
  z.object({
    id: idField,
    type: z.literal("run.status"),
    in: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    id: idField,
    type: z.literal("run.limits"),
    max_tool_calls: z.number().int().min(0).optional(),
    max_failed_calls: z.number().int().min(0).optional(),
  }),
  z.object({
    id: idField,
    type: z.literal("trace.tool_used"),
    tool: z.string().min(1),
    min_calls: z.number().int().min(0).default(1),
    max_calls: z.number().int().min(0).optional(),
  }),
]);

export type ContractCheck = z.infer<typeof checkSchema>;
export type CheckType = ContractCheck["type"];

export const contractSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9._-]*$/i, "contract name must be alphanumeric with . _ -"),
    description: z.string().optional(),
    workflow: z.string().min(1, "workflow id is required"),
    /** Payload passed to execute_workflow. */
    inputs: z.record(z.unknown()).default({}),
    /** Number of independent executions. Not retries: flake detection. */
    runs: z.number().int().min(1).max(20).default(1),
    /** Fraction of runs that must pass (pass^k, not best-of-n). */
    require_pass_ratio: z.number().min(0).max(1).default(1),
    /** Model the workflow is pinned to; part of the baseline key. */
    model: z.string().optional(),
    /** Instruction text the workflow runs; hashed into the baseline key. */
    instruction: z.string().optional(),
    checks: z.array(checkSchema).min(1, "declare at least one check"),
  })
  .superRefine((contract, ctx) => {
    const seen = new Set<string>();
    contract.checks.forEach((check, index) => {
      if (seen.has(check.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checks", index, "id"],
          message: `duplicate check id "${check.id}"`,
        });
      }
      seen.add(check.id);
    });
  });

export type Contract = z.infer<typeof contractSchema>;

/** Regex-bearing fields, used to reject invalid contracts before any run starts. */
export function regexPatternsOf(check: ContractCheck): string[] {
  switch (check.type) {
    case "section.contains":
      return check.patterns;
    case "section.evidence":
      return [check.pattern];
    case "text.forbidden":
      return check.patterns;
    default:
      return [];
  }
}