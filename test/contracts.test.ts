import { describe, expect, it } from "vitest";
import { ContractError, loadContractFile, parseContract } from "../src/contracts/load";

const valid = {
  name: "sample",
  workflow: "wf_1",
  checks: [{ id: "exists", type: "artifact.exists", artifact: "plan" }],
};

describe("contract schema", () => {
  it("applies defaults for runs, ratio and inputs", () => {
    const contract = parseContract(valid, "inline");
    expect(contract.runs).toBe(1);
    expect(contract.require_pass_ratio).toBe(1);
    expect(contract.inputs).toEqual({});
  });

  it("defaults check-level knobs (min, mode, flags)", () => {
    const contract = parseContract(
      {
        name: "sample",
        workflow: "wf_1",
        checks: [
          { id: "a", type: "artifact.exists", artifact: "plan" },
          { id: "b", type: "section.contains", artifact: "plan", section: "Summary", patterns: ["ok"] },
        ],
      },
      "inline",
    );
    expect(contract.checks[0]).toMatchObject({ min: 1 });
    expect(contract.checks[1]).toMatchObject({ mode: "all" });
  });

  it("rejects duplicate check ids", () => {
    expect(() =>
      parseContract(
        {
          ...valid,
          checks: [
            { id: "dup", type: "artifact.exists", artifact: "plan" },
            { id: "dup", type: "run.status", in: ["succeeded"] },
          ],
        },
        "inline",
      ),
    ).toThrow(/duplicate check id/);
  });

  it("rejects an unusable regex before any run starts", () => {
    expect(() =>
      parseContract(
        {
          name: "sample",
          workflow: "wf_1",
          checks: [
            {
              id: "bad",
              type: "section.evidence",
              artifact: "plan",
              section: "Findings",
              pattern: "([a-z",
            },
          ],
        },
        "inline",
      ),
    ).toThrow(/unusable regex/);
  });

  it("rejects unknown check types", () => {
    expect(() =>
      parseContract(
        { ...valid, checks: [{ id: "x", type: "llm.judge", rubric: "nice" }] },
        "inline",
      ),
    ).toThrow(ContractError);
  });

  it("loads the shipped examples", async () => {
    const pr = await loadContractFile("contracts/pr-review.yaml");
    expect(pr.name).toBe("pr-review");
    expect(pr.runs).toBe(3);
    expect(pr.require_pass_ratio).toBeCloseTo(0.67);
    expect(pr.checks).toHaveLength(6);

    const planner = await loadContractFile("contracts/task-planner.yaml");
    expect(planner.checks.map((check) => check.type)).toContain("records.subtasks");
  });
});