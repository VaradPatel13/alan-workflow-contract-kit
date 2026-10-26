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
`workflow_execution`, reads the run's artifacts and transcript. It needs a transport that can
authenticate outside Alan; that is still an open question (**P0 gate**). Until it returns, the
adapter boundary is wired but unplugged:

```bash
AWC_TRANSPORT_MODULE=./my-transport.js awc run -c contracts --adapter alan
```

The module default-exports an `AlanTransport` (see `src/adapters/alan-mcp.ts`). Nothing else in
the kit changes when the transport lands.

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
- No argument-level tool assertions. `get_session_context` exposes per-message tool **counters**,
  so `trace.tool_used` asserts "which tool, how many times". Checks needing arguments do not
  exist yet rather than being guessed at.
- No generic eval framework, no promptfoo competitor. This owns Alan records, evidence pointers
  and the baseline format.

## Development

```bash
npm test          # 56 tests, offline
npm run typecheck
npm run build
```

MIT licensed.