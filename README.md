# Alan Workflow Contract Kit

`awc` runs a declared contract against a real Alan workflow execution and fails CI when the
workflow stops producing what it promised. Checks are deterministic — no LLM judge, no rubric —
and every failure carries a pointer you can click.

```bash
awc run -c contracts --adapter fixture --fixtures fixtures
```

## 60-second quickstart

Requires Node 20+.

```bash
npm install
npm run build

# Replay recorded runs: no network, no credentials.
npx awc run -c contracts --adapter fixture --fixtures fixtures
```

Expected: `13 passed · 0 failed · 0 flaky · 0 skipped across 2 contract(s)` and exit `0`.

Now break it on purpose:

```bash
npx awc run -c demo/broken-pr-review.yaml --adapter fixture --fixtures demo/fixtures
echo $?   # 1
```

The gate fails on three distinct defects — a missing `Recommendation` section, `LGTM` in the
transcript, and findings with no `path:line` — each with an evidence pointer.

## The contract

```yaml
name: pr-review
workflow: wf_pr_review_01
model: claude-sonnet-4-5
instruction: Review pull request #1842 against the retry hardening checklist.
runs: 3                  # independent runs for flake detection, not retries
require_pass_ratio: 0.67 # 2 of 3 runs must pass; the gate snaps to a run count

checks:
  - id: report-exists
    type: artifact.exists
    artifact: test-report

  - id: required-sections
    type: artifact.sections
    artifact: test-report
    require: [Summary, Findings, Risk, Recommendation]

  - id: findings-cite-evidence
    type: section.evidence
    artifact: test-report
    section: Findings
    min_per_item: 1
    pattern: '[\w./-]+\.\w+:\d+'

  - id: no-unqualified-approval
    type: text.forbidden
    patterns: ['\bLGTM\b', 'nothing to flag']
    scope: all

  - id: run-succeeded
    type: run.status
    in: [succeeded, completed]
```

`artifact` matches an artifact id first, then its type (`test-report`, `plan`, ...).

## Checks

| type | asserts | evidence |
| --- | --- | --- |
| `artifact.exists` | the run produced the artifact | artifact id + url |
| `artifact.sections` | required headings exist (case-insensitive) | artifact |
| `section.contains` | a section matches patterns (`all` / `any`) | section anchor |
| `section.evidence` | every item cites something verifiable | section + line |
| `text.forbidden` | no forbidden phrase in artifacts and/or transcript | artifact section / message |
| `records.subtasks` | promised subtasks exist, count and status | execution records |
| `run.status` | the execution reached an allowed status | execution + error kind |
| `run.limits` | tool-call budget respected | derived counters |
| `trace.tool_used` | a tool was called N times | session transcript |

If the evidence a check needs is unavailable — for example a transport that cannot read records —
the check reports **skipped**, never pass. A skip is visible in every reporter.

## Exit codes

| code | meaning |
| --- | --- |
| `0` | contract passed |
| `1` | contract failed (verdict, not a tooling problem) |
| `2` | usage or contract config error |
| `3` | integration, transport or auth error |

`3` exists so CI can never mistake a broken transport for a green build.

## Two modes

**Mode B — in-session (works today, no auth).** Run the kit inside an Alan session as a
Skill/agent, execute the workflow, assert, then file the verdict with `create_test_report`.
The same engine and checks are used in both modes.

**Mode A — standalone CLI in CI.** `awc --adapter alan` drives `execute_workflow`, polls
`workflow_execution`, reads the run's artifacts and transcript. The mapping onto Alan's own tools
is implemented; the only unbuilt piece is a client that can reach and authenticate to that surface
from a non-Alan process (**P0 gate**):

```bash
AWC_TRANSPORT_MODULE=./my-transport.js awc run -c contracts --adapter alan
```

```ts
// my-transport.ts — the missing piece is only client.call(...).
import { createAlanMcpTransport } from "alan-workflow-contract-kit";

export default createAlanMcpTransport({
  teamId: process.env.ALAN_TEAM_ID,
  client: { call: (tool, input) => myAuthenticatedMcpClient[tool](input) },
});
```

`createAlanMcpTransport` already sends contract inputs as `triggerPayload`, unwraps `rows`
envelopes, maps `errorKind`, reads `list_artifacts` + `get_artifact`, and resolves a run to its
session before calling `get_session_context`. Nothing else in the kit changes when the client lands.

## Baseline and flake

```bash
awc baseline accept -c contracts --adapter fixture --fixtures fixtures
awc diff -c contracts --adapter fixture --fixtures fixtures
```

The baseline is committed at `.awc/baseline.json`, so it reviews like code. Its key is
`contract::workflow::model::instructionHash` — swapping the model or the instruction invalidates
the entry on purpose instead of hiding a regression.

`diff` classifies each check as `new`, `new-failure`, `fixed`, `still-failing`, `flaky`,
`newly-skipped`, `removed`, or `unchanged`, and exits `1` on new failures or newly unstable checks.

A check that passes in some runs and fails in others is **flaky**, never "pass". Runs are
evaluated as pass^k, not best-of-n.

## Reports

```bash
awc run ... --junit awc-junit.xml --markdown awc-report.md --json
awc report --from .awc/last-run.json --junit awc-junit.xml
```

JUnit renders in GitHub Actions, GitLab and Buildkite; flaky checks are reported as failures.
`--json` prints the same verdict for scripts, and `awc run` always leaves a snapshot at
`.awc/last-run.json` for `awc report`.

## Library use

```ts
import { runContract, FixtureAdapter, renderTerminal } from "alan-workflow-contract-kit";

const result = await runContract(contract, new FixtureAdapter("fixtures"));
console.log(renderTerminal([result]));
```

Everything the CLI does is importable, which is how Mode B drives it from inside Alan.

## What v0 does not do

- No LLM judge. Presence, structure and evidence are deterministic; taste is out of scope.
- No argument-level tool assertions. `trace.tool_used` asserts "which tool, how many times";
  checks needing arguments do not exist yet rather than being guessed at.
- No generic eval framework, no promptfoo competitor. This owns Alan records, evidence pointers
  and the baseline format.

## Verified against the live surface

The transport mapping was written against the tool signatures, not against a plan:

| transport call | Alan tool | notes |
| --- | --- | --- |
| `executeWorkflow` | `execute_workflow` | `inputs` become `triggerPayload` |
| `getExecution` | `workflow_execution({ op: "get" })` | `status`, `output`, `error`, `errorKind`, `completedAt` |
| `listArtifacts` | `list_artifacts({ workflowExecutionId })` | returns rows in an envelope |
| `getArtifact` | `get_artifact` | full body; the outline is parsed locally to the same shape |
| `getSessionMessages` | `list_sessions` → `get_session_context` | resolution is by `taskId`/`sessionId` |

Two facts that changed the design:

1. `get_session_context` returned only `id`, `role`, `content`, `turnOrdinal`, `createdAt` on a
   live session that had used many tools — **no counter fields**. Counter checks therefore report
   `skipped` under the MCP transport until Alan exposes counts, instead of failing every run.
2. `list_sessions` has no execution filter, so a run is resolved to its session by `taskId` or an
   explicit `sessionId`. When neither exists, transcript checks skip.

Both are recorded as capability flags on the run (`transcript`, `toolCounters`, `records`) rather
than buried in adapter code.

## Development

```bash
npm test          # 66 tests, offline
npm run typecheck
npm run build
```

MIT licensed.
