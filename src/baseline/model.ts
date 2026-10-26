import { createHash } from "node:crypto";
import { z } from "zod";
import type { Contract } from "../contracts/schema";

export const BASELINE_VERSION = 1;
export const DEFAULT_BASELINE_PATH = ".awc/baseline.json";

export const baselineStatusSchema = z.enum(["pass", "fail", "skipped", "flaky"]);
export type BaselineStatus = z.infer<typeof baselineStatusSchema>;

export const baselineEntrySchema = z.object({
  contract: z.string(),
  workflow: z.string(),
  model: z.string(),
  instructionHash: z.string(),
  updatedAt: z.string(),
  checks: z.record(baselineStatusSchema),
});

export const baselineFileSchema = z.object({
  version: z.literal(BASELINE_VERSION),
  entries: z.record(baselineEntrySchema),
});

export type BaselineEntry = z.infer<typeof baselineEntrySchema>;
export type BaselineFile = z.infer<typeof baselineFileSchema>;

export function emptyBaseline(): BaselineFile {
  return { version: BASELINE_VERSION, entries: {} };
}

/** Instruction text the workflow runs. Swapping it invalidates the baseline on purpose. */
export function hashInstruction(instruction: string | undefined): string {
  return createHash("sha256").update(instruction ?? "").digest("hex");
}

/** Model swaps and workflow swaps invalidate the key, so they cannot hide a regression. */
export function baselineKey(contract: Contract): string {
  const model = contract.model ?? "any";
  const instruction = hashInstruction(contract.instruction).slice(0, 12);
  return `${contract.name}::${contract.workflow}::${model}::${instruction}`;
}