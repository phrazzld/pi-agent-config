import { describe, expect, test } from "bun:test";

import { parseTeamsYaml, parsePipelinesYaml } from "../config";

describe("orchestration config parsing", () => {
  test("parses teams yaml", () => {
    const raw = [
      "core:",
      "  - planner",
      "  - worker",
      "",
      "meta-council:",
      "  - meta-config-expert",
      "  - meta-extension-expert",
    ].join("\n");

    const parsed = parseTeamsYaml(raw);
    expect(parsed.core).toEqual(["planner", "worker"]);
    expect(parsed["meta-council"]).toEqual([
      "meta-config-expert",
      "meta-extension-expert",
    ]);
  });

  test("parses pipelines yaml with escaped newlines and checkpoints", () => {
    const raw = [
      "plan-build-review:",
      '  description: "Plan then build then review"',
      "  checkpoints:",
      "    - before-build",
      "    - before-merge",
      "  steps:",
      "    - agent: planner",
      '      prompt: "Create a plan for: $INPUT"',
      "    - agent: worker",
      '      prompt: "Implement this plan:\\n\\n$INPUT"',
      "    - agent: reviewer",
      '      prompt: "Review implementation:\\n\\n$INPUT"',
    ].join("\n");

    const parsed = parsePipelinesYaml(raw);
    const spec = parsed["plan-build-review"];

    expect(spec).toBeDefined();
    expect(spec.description).toBe("Plan then build then review");
    expect(spec.checkpoints).toEqual(["before-build", "before-merge"]);
    expect(spec.steps.length).toBe(3);
    expect(spec.steps[1].prompt).toContain("Implement this plan:\n\n$INPUT");
  });

  test("parses repository orchestration files", async () => {
    const teamsRaw = await Bun.file("agents/teams.yaml").text();
    const pipelinesRaw = await Bun.file("agents/pipelines.yaml").text();

    const teams = parseTeamsYaml(teamsRaw);
    const pipelines = parsePipelinesYaml(pipelinesRaw);

    expect(teams["meta-council"].length).toBeGreaterThanOrEqual(8);
    expect(pipelines["software-delivery-v1"].steps.length).toBe(5);
    expect(pipelines["meta-council-v1"].steps.length).toBe(6);
    expect(pipelines["autopilot-v1"].steps.length).toBe(8);
  });

});
