import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  applyQualityGateToReport,
  evaluateConsensusQuality,
  evaluateBootstrapQualityGate,
  formatBootstrapSummary,
  inferRecommendedTarget,
  normalizePlan,
  parseBootstrapPlan,
  resolveOutputPath,
  scoreAmbitionCheckpoint,
  type BootstrapPlan,
  type BootstrapResult,
  type LaneResult,
  type RepoFacts,
} from "../engine";

function baseFacts(overrides: Partial<RepoFacts> = {}): RepoFacts {
  return {
    domain: "acme",
    repoRoot: "/tmp/acme",
    topLevelFiles: [],
    topLevelDirs: [],
    packageManager: "unknown",
    scripts: [],
    dependencies: [],
    devDependencies: [],
    workflowFiles: [],
    stackHints: [],
    readmeSnippet: "",
    localContextSummary: "",
    ...overrides,
  };
}

function lane(name: string, output: string, ok = true): LaneResult {
  return {
    name,
    model: "model/x",
    thinking: "high",
    ok,
    elapsedMs: 1_000,
    output,
  };
}

const LONG_PROMPT = [
  "---",
  "description: focused workflow",
  "---",
  "Role: local specialist",
  "Objective: execute with clarity and verification.",
  "Success criteria: pass all required checks and report residual risk.",
].join("\n");

function basePlan(overrides: Record<string, string> = {}): BootstrapPlan {
  return {
    files: {
      ".pi/settings.json": "{}\n",
      ".pi/persona.md": "# Local Persona\n\nName: acme-operator",
      ".pi/agents/planner.md": "planner",
      ".pi/agents/worker.md": "worker",
      ".pi/agents/reviewer.md": "reviewer",
      ".pi/agents/teams.yaml": ["foundation:", "  - planner", "  - worker", "  - reviewer"].join("\n"),
      ".pi/agents/pipelines.yaml": [
        "repo-delivery-v1:",
        "  steps:",
        "    - agent: planner",
        "    - agent: worker",
        "    - agent: reviewer",
      ].join("\n"),
      ".pi/prompts/discover.md": LONG_PROMPT,
      ".pi/prompts/design.md": LONG_PROMPT,
      ".pi/prompts/deliver.md": LONG_PROMPT,
      ".pi/prompts/review.md": LONG_PROMPT,
      "AGENTS.md": "# AGENTS\n\nRepo-local operating context.",
      "docs/pi-local-workflow.md": "workflow",
      ".pi/bootstrap-report.md": [
        "# Pi Bootstrap Report",
        "",
        "## Single Highest-Leverage Addition",
        "- Idea: Build an automated repo-convention drift detector that posts concise guardrail suggestions.",
        "- Source lane: ambition-pass",
        "- Why now: Current onboarding throughput is bottlenecked by repeated context reconstruction.",
        "- 72h validation experiment: Run detector on two active repos and compare setup time + review churn.",
        "- Kill criteria: If setup latency rises >15% or findings are mostly false positives, disable and remove.",
        "",
        "## Lane Evidence",
        "## ambition-pass",
        "reference: https://example.com/bootstrap-guidance",
      ].join("\n"),
      ...overrides,
    },
  };
}

function strongLanes(): LaneResult[] {
  const rich = "x".repeat(180);
  return [
    lane("repo-scout", rich),
    lane("context-bridge", rich),
    lane("docs-research", rich),
    lane("workflow-critic", rich),
    lane("ambition-pass", `${rich} innovative flywheel leverage`),
    lane("implementation-critic", rich),
  ];
}

describe("bootstrap engine", () => {
  test("parseBootstrapPlan accepts strict JSON payload", () => {
    const parsed = parseBootstrapPlan('{"files": {".pi/settings.json": "{}"}}');
    expect(parsed).not.toBeNull();
    expect(parsed?.files[".pi/settings.json"]).toBe("{}");
  });

  test("parseBootstrapPlan accepts fenced JSON payload", () => {
    const parsed = parseBootstrapPlan('```json\n{"files": {"docs/pi-local-workflow.md": "ok"}}\n```');
    expect(parsed?.files["docs/pi-local-workflow.md"]).toBe("ok");
  });

  test("parseBootstrapPlan extracts JSON object from mixed text", () => {
    const parsed = parseBootstrapPlan('notes first\n{"files": {".pi/bootstrap-report.md": "report"}}\nmore');
    expect(parsed?.files[".pi/bootstrap-report.md"]).toBe("report");
  });

  test("parseBootstrapPlan returns null for invalid payload", () => {
    expect(parseBootstrapPlan("not json")).toBeNull();
  });


  test("parseBootstrapPlan ignores non-string file values", () => {
    const parsed = parseBootstrapPlan('{"files": {".pi/settings.json": "{}", "docs/raw.json": {"k":1}, "docs/null.txt": null}}');
    expect(parsed).not.toBeNull();
    expect(parsed?.files[".pi/settings.json"]).toBe("{}");
    expect(parsed?.files["docs/raw.json"]).toBeUndefined();
    expect(parsed?.files["docs/null.txt"]).toBeUndefined();
  });

  test("normalizePlan backfills required artifacts with concrete string content", () => {
    const normalized = normalizePlan(
      {
        files: {
          ".pi/settings.json": "{}\n",
        },
      },
      baseFacts(),
      strongLanes(),
    );

    expect(typeof normalized.files[".pi/persona.md"]).toBe("string");
    expect(normalized.files[".pi/persona.md"].length).toBeGreaterThan(0);
    expect(typeof normalized.files["AGENTS.md"]).toBe("string");
    expect(normalized.files["AGENTS.md"].length).toBeGreaterThan(0);
  });

  test("normalizePlan records invalid file content notes and strips non-string artifacts", () => {
    const normalized = normalizePlan(
      {
        files: {
          ".pi/settings.json": "{}\n",
          "docs/raw.json": { key: "value" } as unknown as string,
        } as unknown as Record<string, string>,
      },
      baseFacts(),
      strongLanes(),
    );

    expect(normalized.files["docs/raw.json"]).toBeUndefined();
    expect((normalized.notes ?? []).some((note) => note.startsWith("invalid-file-content:docs/raw.json"))).toBe(true);
  });

  test("resolveOutputPath keeps writes inside repo root", () => {
    const repoRoot = "/tmp/repo";

    expect(resolveOutputPath(repoRoot, ".pi/settings.json")).toBe(path.join(repoRoot, ".pi/settings.json"));
    expect(resolveOutputPath(repoRoot, "../escape.txt")).toBeNull();
    expect(resolveOutputPath(repoRoot, "/etc/passwd")).toBeNull();
  });

  test("inferRecommendedTarget uses lane signal and repo shape", () => {
    expect(inferRecommendedTarget(baseFacts(), [lane("ambition-pass", "great daybook reflection workflow")])).toBe("daybook");
    expect(inferRecommendedTarget(baseFacts(), [lane("ambition-pass", "issue-to-pr autopilot merge gate")])).toBe("autopilot");
    expect(inferRecommendedTarget(baseFacts(), [lane("repo-scout", "")])).toBe("research");
    expect(
      inferRecommendedTarget(
        baseFacts({ dependencies: ["react"], stackHints: ["react"] }),
        [lane("repo-scout", "")],
      ),
    ).toBe("build");
  });

  test("scoreAmbitionCheckpoint passes for structured substantive ambition section", () => {
    const score = scoreAmbitionCheckpoint(basePlan().files[".pi/bootstrap-report.md"], strongLanes());
    expect(score.pass).toBe(true);
    expect(score.total).toBeGreaterThanOrEqual(65);
    expect(score.missingElements.length).toBe(0);
  });

  test("evaluateConsensusQuality fails when generated teams reference unknown agents", () => {
    const plan = basePlan({
      ".pi/agents/teams.yaml": ["foundation:", "  - planner", "  - unknown-agent"].join("\n"),
    });

    const consensus = evaluateConsensusQuality(plan, strongLanes());
    expect(consensus.pass).toBe(false);
    expect(consensus.blockingIssues.some((issue) => issue.includes("teams-agent-integrity"))).toBe(true);
  });

  test("evaluateBootstrapQualityGate includes ambition and consensus notes", () => {
    const gate = evaluateBootstrapQualityGate(basePlan(), strongLanes());
    expect(gate.pass).toBe(true);
    expect(gate.notes.some((note) => note.startsWith("ambition-score:"))).toBe(true);
    expect(gate.notes.some((note) => note.startsWith("consensus-score:"))).toBe(true);
  });

  test("applyQualityGateToReport appends a scorecard section", () => {
    const gate = evaluateBootstrapQualityGate(basePlan(), strongLanes());
    const report = applyQualityGateToReport(basePlan().files[".pi/bootstrap-report.md"], gate);
    expect(report).toContain("## Quality Gate Scorecard");
    expect(report).toContain("- Ambition score:");
    expect(report).toContain("- Consensus score:");
  });

  test("formatBootstrapSummary includes quality gate scores", () => {
    const repoRoot = "/tmp/repo";
    const qualityGate = evaluateBootstrapQualityGate(basePlan(), strongLanes());

    const result: BootstrapResult = {
      repoRoot,
      domain: "acme",
      force: false,
      mode: "opinionated-max",
      lanes: [lane("repo-scout", "done")],
      synthesisModel: "model/x",
      recommendedTarget: "build",
      notes: ["fallback-plan"],
      changes: [
        { path: path.join(repoRoot, ".pi/settings.json"), action: "created" },
        { path: path.join(repoRoot, "docs/pi-local-workflow.md"), action: "skipped", reason: "already up to date" },
      ],
      qualityGate,
      elapsedMs: 65_000,
    };

    const summary = formatBootstrapSummary(result);
    expect(summary).toContain("mode: opinionated-max");
    expect(summary).toContain("duration: 1m 05s");
    expect(summary).toContain("recommended target: pictl build");
    expect(summary).toContain("quality gate:");
    expect(summary).toContain("- created: .pi/settings.json");
    expect(summary).toContain("- skipped: docs/pi-local-workflow.md (already up to date)");
  });
});
