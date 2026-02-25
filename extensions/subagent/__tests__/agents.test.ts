import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  discoverAgents,
  formatAgentList,
  parseAgentConfig,
  parseFrontmatter,
} from "../agents";

describe("subagent agent discovery", () => {
  let tempRoot = "";
  let previousHome = "";

  beforeEach(() => {
    previousHome = process.env.HOME ?? "";
    tempRoot = mkdtempSync(path.join(tmpdir(), "pi-subagent-agents-test-"));
    process.env.HOME = tempRoot;
  });

  afterEach(() => {
    process.env.HOME = previousHome;
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("parseFrontmatter extracts metadata and body", () => {
    const parsed = parseFrontmatter(`---\nname: scout\ndescription: \"Fast recon\"\n---\n\nHello`);

    expect(parsed.frontmatter.name).toBe("scout");
    expect(parsed.frontmatter.description).toBe("Fast recon");
    expect(parsed.body.trim()).toBe("Hello");
  });

  test("parseAgentConfig rejects invalid files", () => {
    const parsed = parseAgentConfig("---\nname: worker\n---\n", "worker.md", "user");
    expect(parsed).toBeNull();
  });

  test("parseAgentConfig parses optional model and guardrail frontmatter", () => {
    const parsed = parseAgentConfig(
      `---\nname: scout\ndescription: quick scout\nmodel: google/gemini-3-flash-preview\nmaxTurns: 25\nmaxRuntimeSeconds: 180\n---\n\nPrompt`,
      "scout.md",
      "user"
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.model).toBe("google/gemini-3-flash-preview");
    expect(parsed?.maxTurns).toBe(25);
    expect(parsed?.maxRuntimeSeconds).toBe(180);
  });

  test("discoverAgents merges by scope and project overrides user in both mode", () => {
    const userAgentsDir = path.join(tempRoot, ".pi", "agent", "agents");
    mkdirSync(userAgentsDir, { recursive: true });

    writeFileSync(
      path.join(userAgentsDir, "scout.md"),
      `---\nname: scout\ndescription: user scout\n---\n\nUser scout prompt`
    );

    const projectRoot = path.join(tempRoot, "project");
    const projectAgentsDir = path.join(projectRoot, ".pi", "agents");
    mkdirSync(projectAgentsDir, { recursive: true });

    writeFileSync(
      path.join(projectAgentsDir, "scout.md"),
      `---\nname: scout\ndescription: project scout\n---\n\nProject scout prompt`
    );
    writeFileSync(
      path.join(projectAgentsDir, "planner.md"),
      `---\nname: planner\ndescription: project planner\n---\n\nProject planner prompt`
    );

    const nestedCwd = path.join(projectRoot, "src", "feature");
    mkdirSync(nestedCwd, { recursive: true });

    const userOnly = discoverAgents(nestedCwd, "user");
    expect(userOnly.agents.length).toBe(1);
    expect(userOnly.agents[0].name).toBe("scout");
    expect(userOnly.agents[0].source).toBe("user");

    const projectOnly = discoverAgents(nestedCwd, "project");
    expect(projectOnly.agents.map((agent) => agent.name).sort()).toEqual(["planner", "scout"]);
    expect(projectOnly.agents.find((agent) => agent.name === "scout")?.source).toBe("project");

    const both = discoverAgents(nestedCwd, "both");
    expect(both.agents.map((agent) => agent.name).sort()).toEqual(["planner", "scout"]);
    expect(both.agents.find((agent) => agent.name === "scout")?.source).toBe("project");
  });

  test("formatAgentList returns visible and remaining counts", () => {
    const formatted = formatAgentList(
      [
        {
          name: "scout",
          description: "",
          systemPrompt: "",
          source: "user",
          filePath: "a",
        },
        {
          name: "planner",
          description: "",
          systemPrompt: "",
          source: "user",
          filePath: "b",
        },
      ],
      1
    );

    expect(formatted.text).toContain("scout");
    expect(formatted.remaining).toBe(1);
  });
});
