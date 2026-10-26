import { z } from "zod";
import { contractSchema } from "../contracts/schema";
import type { AggregatedCheck } from "../engine/aggregate";
import type { ContractResult } from "../engine/run";

/**
 * What `awc run` leaves behind for `awc report`. Traces are dropped: the
 * report only needs verdicts, evidence pointers, and the contract itself.
 */
export const savedCheckSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(["pass", "fail", "flaky", "skipped"]),
  message: z.string(),
  evidence: z.array(z.object({ label: z.string(), url: z.string().optional() })),
  perRun: z.array(z.enum(["pass", "fail", "skipped"])),
});

export const savedResultSchema = z.object({
  contract: contractSchema,
  checks: z.array(savedCheckSchema),
  totals: z.object({
    runs: z.number().int().min(0),
    passingRuns: z.number().int().min(0),
    passRatio: z.number(),
    pass: z.number().int().min(0),
    fail: z.number().int().min(0),
    flaky: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  ok: z.boolean(),
});

export const savedRunSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  adapter: z.string(),
  results: z.array(savedResultSchema),
});

export type SavedRun = z.infer<typeof savedRunSchema>;

export function toSavedRun(results: ContractResult[], adapter: string): SavedRun {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    adapter,
    results: results.map((result) => ({
      contract: result.contract,
      checks: result.checks,
      totals: result.totals,
      ok: result.ok,
    })),
  };
}

export function fromSavedRun(saved: SavedRun): ContractResult[] {
  return saved.results.map((result) => ({
    contract: result.contract,
    runs: [],
    // Saved checks carry the same fields as AggregatedCheck; the only widening
    // is `type: string`, which is re-validated by contractSchema on read.
    checks: result.checks as AggregatedCheck[],
    totals: result.totals,
    ok: result.ok,
  }));
}