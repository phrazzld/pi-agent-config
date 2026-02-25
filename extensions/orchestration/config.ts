import { existsSync, readFileSync } from "node:fs";

export interface TeamMap {
  [teamName: string]: string[];
}

export interface PipelineStep {
  agent: string;
  prompt: string;
  cwd?: string;
}

export interface PipelineSpec {
  description?: string;
  checkpoints?: string[];
  steps: PipelineStep[];
}

export interface PipelineMap {
  [pipelineName: string]: PipelineSpec;
}

export interface OrchestrationConfig {
  teams: TeamMap;
  pipelines: PipelineMap;
  warnings: string[];
}

export function loadOrchestrationConfig(paths: {
  teamsPath: string;
  pipelinesPath: string;
}): OrchestrationConfig {
  const warnings: string[] = [];

  const teams = existsSync(paths.teamsPath)
    ? parseTeamsYaml(readFileSync(paths.teamsPath, "utf8"))
    : {};
  if (!existsSync(paths.teamsPath)) {
    warnings.push(`teams file not found: ${paths.teamsPath}`);
  }

  const pipelines = existsSync(paths.pipelinesPath)
    ? parsePipelinesYaml(readFileSync(paths.pipelinesPath, "utf8"))
    : {};
  if (!existsSync(paths.pipelinesPath)) {
    warnings.push(`pipelines file not found: ${paths.pipelinesPath}`);
  }

  return { teams, pipelines, warnings };
}

export function parseTeamsYaml(raw: string): TeamMap {
  const teams: TeamMap = {};
  let currentTeam: string | null = null;

  for (const line of raw.split("\n")) {
    const cleaned = stripInlineComment(line);
    if (!cleaned.trim()) {
      continue;
    }

    const teamMatch = cleaned.match(/^([a-zA-Z0-9_-]+):\s*$/);
    if (teamMatch) {
      currentTeam = teamMatch[1];
      teams[currentTeam] = [];
      continue;
    }

    const itemMatch = cleaned.match(/^\s*-\s*([a-zA-Z0-9_-]+)\s*$/);
    if (itemMatch && currentTeam) {
      teams[currentTeam].push(itemMatch[1]);
    }
  }

  return teams;
}

export function parsePipelinesYaml(raw: string): PipelineMap {
  const pipelines: PipelineMap = {};
  const lines = raw.split("\n");

  let currentPipeline: string | null = null;
  let section: "none" | "checkpoints" | "steps" = "none";

  for (const sourceLine of lines) {
    const line = stripInlineComment(sourceLine);
    if (!line.trim()) {
      continue;
    }

    const topLevel = line.match(/^([a-zA-Z0-9_-]+):\s*$/);
    if (topLevel && indentLevel(sourceLine) === 0) {
      currentPipeline = topLevel[1];
      pipelines[currentPipeline] = { steps: [] };
      section = "none";
      continue;
    }

    if (!currentPipeline) {
      continue;
    }

    const pipeline = pipelines[currentPipeline];

    const descriptionMatch = line.match(/^\s{2}description:\s*(.+)$/);
    if (descriptionMatch) {
      pipeline.description = parseScalar(descriptionMatch[1]);
      section = "none";
      continue;
    }

    if (/^\s{2}checkpoints:\s*$/.test(line)) {
      if (!pipeline.checkpoints) {
        pipeline.checkpoints = [];
      }
      section = "checkpoints";
      continue;
    }

    if (/^\s{2}steps:\s*$/.test(line)) {
      section = "steps";
      continue;
    }

    if (section === "checkpoints") {
      const checkpointMatch = line.match(/^\s{4}-\s*(.+)$/);
      if (checkpointMatch) {
        if (!pipeline.checkpoints) {
          pipeline.checkpoints = [];
        }
        pipeline.checkpoints.push(parseScalar(checkpointMatch[1]));
      }
      continue;
    }

    if (section === "steps") {
      const stepMatch = line.match(/^\s{4}-\s*agent:\s*([a-zA-Z0-9_-]+)\s*$/);
      if (stepMatch) {
        pipeline.steps.push({ agent: stepMatch[1], prompt: "" });
        continue;
      }

      const promptMatch = line.match(/^\s{6}prompt:\s*(.+)$/);
      if (promptMatch) {
        const last = pipeline.steps[pipeline.steps.length - 1];
        if (last) {
          last.prompt = parseScalar(promptMatch[1]);
        }
        continue;
      }

      const cwdMatch = line.match(/^\s{6}cwd:\s*(.+)$/);
      if (cwdMatch) {
        const last = pipeline.steps[pipeline.steps.length - 1];
        if (last) {
          last.cwd = parseScalar(cwdMatch[1]);
        }
      }
    }
  }

  return finalizePipelines(pipelines);
}

function finalizePipelines(pipelines: PipelineMap): PipelineMap {
  const out: PipelineMap = {};
  for (const [name, spec] of Object.entries(pipelines)) {
    const steps = spec.steps
      .map((step) => ({
        ...step,
        prompt: step.prompt || "",
      }))
      .filter((step) => step.agent && step.prompt);

    out[name] = {
      description: spec.description,
      checkpoints: spec.checkpoints,
      steps,
    };
  }
  return out;
}

function parseScalar(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return unescapeYamlString(trimmed.slice(1, -1));
  }

  return unescapeYamlString(trimmed);
}

function unescapeYamlString(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function stripInlineComment(line: string): string {
  const hashIndex = line.indexOf("#");
  if (hashIndex < 0) {
    return line;
  }

  const before = line.slice(0, hashIndex);
  const quotes = countQuotes(before);
  if (quotes.double % 2 === 1 || quotes.single % 2 === 1) {
    return line;
  }

  return before;
}

function countQuotes(text: string): { single: number; double: number } {
  let single = 0;
  let double = 0;

  for (const char of text) {
    if (char === "'") {
      single += 1;
    }
    if (char === '"') {
      double += 1;
    }
  }

  return { single, double };
}

function indentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}
