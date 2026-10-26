/** Library surface: everything the CLI uses is importable for Skills and tests. */
export { contractSchema, checkSchema, regexPatternsOf } from "./contracts/schema";
export type { Contract, ContractCheck, CheckType } from "./contracts/schema";
export { loadContractFile, loadContracts, parseContract, ContractError } from "./contracts/load";

export { traceSchema, artifactSchema, messageSchema } from "./trace/model";
export type { RunTrace, TraceArtifact, ArtifactSection } from "./trace/model";
export {
  artifactText,
  deriveLimits,
  findArtifact,
  findSection,
  parseMarkdownSections,
  toolCallCount,
} from "./trace/normalize";

export { FixtureAdapter } from "./adapters/fixture";
export { AlanAdapter, createUnavailableTransport } from "./adapters/alan-mcp";
export type { AlanTransport, AlanAdapterOptions } from "./adapters/alan-mcp";
export { IntegrationError } from "./adapters/types";
export type { Adapter, RunRequest } from "./adapters/types";

export { registry, evaluateCheck } from "./checks/registry";
export type { CheckResult, CheckStatus, CheckEvidence, CheckContext } from "./checks/types";

export { aggregate, runPassed } from "./engine/aggregate";
export type { AggregatedCheck, AggregatedStatus } from "./engine/aggregate";
export { runContract, evaluateTrace } from "./engine/run";
export type { ContractResult, ContractTotals } from "./engine/run";

export {
  BASELINE_VERSION,
  DEFAULT_BASELINE_PATH,
  baselineKey,
  emptyBaseline,
  hashInstruction,
} from "./baseline/model";
export type { BaselineFile, BaselineEntry, BaselineStatus } from "./baseline/model";
export { acceptResults, loadBaseline, saveBaseline } from "./baseline/store";
export { diffResult } from "./baseline/diff";
export type { ContractDiff, CheckDiff, ChangeKind } from "./baseline/diff";

export { renderTerminal, renderDiff } from "./report/terminal";
export { renderJUnit } from "./report/junit";
export { renderMarkdown } from "./report/markdown";

export { run as cli, EXIT } from "./cli/main";