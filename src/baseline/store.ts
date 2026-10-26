import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ZodError } from "zod";
import { ContractError } from "../contracts/load";
import type { ContractResult } from "../engine/run";
import {
  BASELINE_VERSION,
  baselineEntrySchema,
  baselineFileSchema,
  baselineKey,
  emptyBaseline,
  hashInstruction,
  type BaselineFile,
} from "./model";

export async function loadBaseline(path: string): Promise<BaselineFile> {
  const absolute = resolve(path);
  let text: string;
  try {
    text = await readFile(absolute, "utf8");
  } catch {
    return emptyBaseline();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ContractError(`cannot parse baseline ${path}: ${reason}`);
  }

  const parsed = baselineFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ContractError(`baseline ${path} has an unexpected shape\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

export async function saveBaseline(path: string, baseline: BaselineFile): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  return absolute;
}

/** Accepts the current verdict as the new baseline for every contract in the run. */
export function acceptResults(baseline: BaselineFile, results: ContractResult[]): BaselineFile {
  const entries = { ...baseline.entries };
  for (const result of results) {
    const entry = baselineEntrySchema.parse({
      contract: result.contract.name,
      workflow: result.contract.workflow,
      model: result.contract.model ?? "any",
      instructionHash: hashInstruction(result.contract.instruction),
      updatedAt: new Date().toISOString(),
      checks: Object.fromEntries(result.checks.map((check) => [check.id, check.status])),
    });
    entries[baselineKey(result.contract)] = entry;
  }
  return { version: BASELINE_VERSION, entries };
}

function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}