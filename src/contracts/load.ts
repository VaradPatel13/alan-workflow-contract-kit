import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { contractSchema, regexPatternsOf, type Contract } from "./schema";

/** Configuration or usage problem: maps to exit code 2. */
export class ContractError extends Error {
  override readonly name = "ContractError";
}

const CONTRACT_EXTENSIONS = new Set([".yml", ".yaml", ".json"]);

export function formatZodError(error: ZodError, source: string): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  ${path}: ${issue.message}`;
  });
  return `invalid contract ${source}\n${lines.join("\n")}`;
}

function compilePatterns(contract: Contract, source: string): void {
  for (const check of contract.checks) {
    for (const pattern of regexPatternsOf(check)) {
      try {
        new RegExp(pattern, "i");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new ContractError(
          `invalid contract ${source}\n  ${check.id}: unusable regex ${JSON.stringify(pattern)} (${reason})`,
        );
      }
    }
  }
}

export function parseContract(raw: unknown, source: string): Contract {
  const parsed = contractSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ContractError(formatZodError(parsed.error, source));
  }
  compilePatterns(parsed.data, source);
  return parsed.data;
}

export async function loadContractFile(path: string): Promise<Contract> {
  const absolute = resolve(path);
  let text: string;
  try {
    text = await readFile(absolute, "utf8");
  } catch {
    throw new ContractError(`cannot read contract ${path}`);
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ContractError(`cannot parse contract ${path}: ${reason}`);
  }

  return parseContract(raw, path);
}

async function expand(target: string): Promise<string[]> {
  const absolute = resolve(target);
  const info = await stat(absolute).catch(() => undefined);
  if (!info) {
    throw new ContractError(`no such contract path: ${target}`);
  }
  if (!info.isDirectory()) {
    return [absolute];
  }

  const entries = await readdir(absolute, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && CONTRACT_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(absolute, entry.name))
    .sort();
}

/** Loads every contract in the given files/directories, rejecting duplicate names. */
export async function loadContracts(targets: string[]): Promise<Contract[]> {
  const files: string[] = [];
  for (const target of targets) {
    files.push(...(await expand(target)));
  }
  if (files.length === 0) {
    throw new ContractError(`no contracts found in ${targets.join(", ")}`);
  }

  const contracts: Contract[] = [];
  const names = new Map<string, string>();
  for (const file of files) {
    const contract = await loadContractFile(file);
    const previous = names.get(contract.name);
    if (previous) {
      throw new ContractError(
        `duplicate contract name "${contract.name}" in ${previous} and ${file}`,
      );
    }
    names.set(contract.name, file);
    contracts.push(contract);
  }
  return contracts;
}