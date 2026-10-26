import type { Contract } from "../contracts/schema";
import type { RunTrace } from "../trace/model";

/** Transport, auth, or platform failure. Never a contract verdict. Maps to exit 3. */
export class IntegrationError extends Error {
  override readonly name = "IntegrationError";
  readonly exitCode = 3;
}

export interface RunRequest {
  contract: Contract;
  runIndex: number;
}

export interface Adapter {
  readonly name: string;
  run(request: RunRequest): Promise<RunTrace>;
}