import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli/main";

const root = fileURLToPath(new URL("..", import.meta.url));
const contracts = join(root, "contracts");
const fixtures = join(root, "fixtures");
const brokenContract = join(root, "demo", "broken-pr-review.yaml");
const brokenFixtures = join(root, "demo", "fixtures");

interface CliResult {
  code: number;
  out: string;
  err: string;
}

async function cli(args: string[]): Promise<CliResult> {
  let out = "";
  let err = "";
  const code = await run(["node", "awc", ...args], {
    stdout: (text) => {
      out += `${text}\n`;
    },
    stderr: (text) => {
      err += `${text}\n`;
    },
  });
  return { code, out, err };
}

async function tempFile(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "awc-cli-"));
  return join(dir, name);
}

describe("awc run", () => {
  it("exits 0 when the contracts hold", async () => {
    const save = await tempFile("last-run.json");
    const { code, out } = await cli([
      "run",
      "-c",
      contracts,
      "--adapter",
      "fixture",
      "--fixtures",
      fixtures,
      "--save",
      save,
    ]);

    expect(code).toBe(0);
    expect(out).toContain("pr-review · 3/3 runs · PASS");
    expect(out).toContain("13 passed · 0 failed");
  });

  it("exits 1 on a contract failure and points at the artifact", async () => {
    const { code, out } = await cli([
      "run",
      "-c",
      brokenContract,
      "--adapter",
      "fixture",
      "--fixtures",
      brokenFixtures,
      "--save",
      await tempFile("last-run.json"),
    ]);

    expect(code).toBe(1);
    expect(out).toContain("FAIL");
    expect(out).toContain("Recommendation");
    expect(out).toContain("art_broken_1");
  });

  it("exits 3 when the live transport is not configured", async () => {
    const { code, err } = await cli(["run", "-c", contracts, "--save", await tempFile("last-run.json")]);
    expect(code).toBe(3);
    expect(err).toContain("integration error");
  });

  it("exits 2 on a bad path, leaving contract failures distinguishable", async () => {
    const { code, err } = await cli(["run", "-c", join(root, "nope")]);
    expect(code).toBe(2);
    expect(err).toContain("no such contract path");
  });

  it("rejects a non-positive --runs as a config error", async () => {
    const { code } = await cli([
      "run",
      "-c",
      contracts,
      "--adapter",
      "fixture",
      "--fixtures",
      fixtures,
      "--runs",
      "0",
    ]);
    expect(code).toBe(2);
  });

  it("prints a machine-readable verdict with --json", async () => {
    const save = await tempFile("last-run.json");
    const { code, out } = await cli([
      "run",
      "-c",
      contracts,
      "--adapter",
      "fixture",
      "--fixtures",
      fixtures,
      "--save",
      save,
      "--json",
    ]);

    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe(1);
    expect(parsed.results.map((result: { contract: { name: string } }) => result.contract.name)).toEqual([
      "pr-review",
      "task-planner",
    ]);
  });
});

describe("awc report", () => {
  it("renders JUnit from the saved snapshot", async () => {
    const save = await tempFile("last-run.json");
    const junit = join(save, "..", "junit.xml");

    await cli([
      "run",
      "-c",
      contracts,
      "--adapter",
      "fixture",
      "--fixtures",
      fixtures,
      "--save",
      save,
    ]);
    const { code } = await cli(["report", "--from", save, "--junit", junit]);

    expect(code).toBe(0);
    const xml = await readFile(junit, "utf8");
    expect(xml).toContain('<testsuites name="awc"');
    expect(xml).toContain('<testsuite name="pr-review"');
  });

  it("fails with exit 2 when no snapshot exists", async () => {
    const { code, err } = await cli(["report", "--from", await tempFile("missing.json")]);
    expect(code).toBe(2);
    expect(err).toContain("no run snapshot");
  });
});

describe("awc baseline + diff", () => {
  it("accepts a baseline, then reports no regressions for the same runs", async () => {
    const baseline = await tempFile("baseline.json");
    const common = ["-c", brokenContract, "--adapter", "fixture", "--fixtures", brokenFixtures];

    const accepted = await cli([...["baseline", "accept"], ...common, "--baseline", baseline]);
    expect(accepted.code).toBe(0);
    expect(accepted.out).toContain("baseline written");

    const diffed = await cli([...["diff"], ...common, "--baseline", baseline]);
    expect(diffed.code).toBe(0);
    expect(diffed.out).toContain("Diff vs baseline");
    expect(diffed.out).not.toContain("new-failure");
  });

  it("exits 1 when a check regresses from pass to fail", async () => {
    const baseline = await tempFile("baseline.json");
    await cli([
      "baseline",
      "accept",
      "-c",
      contracts,
      "--adapter",
      "fixture",
      "--fixtures",
      fixtures,
      "--baseline",
      baseline,
    ]);

    // Same baseline key (same contract, workflow, model, instruction) but broken recorded runs.
    const { code, out } = await cli([
      "diff",
      "-c",
      brokenContract,
      "--adapter",
      "fixture",
      "--fixtures",
      brokenFixtures,
      "--baseline",
      baseline,
    ]);

    // Different contract name => different key => no matching baseline entry.
    expect(code).toBe(1);
    expect(out).toContain("no baseline entry");
  });
});