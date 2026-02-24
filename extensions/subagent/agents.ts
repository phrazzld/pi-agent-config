import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}

interface ParsedFrontmatter {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }

  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) {
    return { frontmatter: {}, body: normalized };
  }

  const block = normalized.slice(4, closing);
  const body = normalized.slice(closing + 5);
  const frontmatter: Record<string, string> = {};

  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const sep = line.indexOf(":");
    if (sep <= 0) {
      continue;
    }

    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!key) {
      continue;
    }

    frontmatter[key] = stripOptionalQuotes(value);
  }

  return { frontmatter, body };
}

export function parseAgentConfig(
  content: string,
  filePath: string,
  source: "user" | "project"
): AgentConfig | null {
  const { frontmatter, body } = parseFrontmatter(content);
  const name = frontmatter.name?.trim();
  const description = frontmatter.description?.trim();
  if (!name || !description) {
    return null;
  }

  const tools = frontmatter.tools
    ?.split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  return {
    name,
    description,
    tools: tools && tools.length > 0 ? tools : undefined,
    model: frontmatter.model?.trim() || undefined,
    systemPrompt: body.trim(),
    source,
    filePath,
  };
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
  if (!existsSync(dir)) {
    return [];
  }

  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: AgentConfig[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) {
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }

    const filePath = path.join(dir, entry.name);
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = parseAgentConfig(raw, filePath, source);
      if (parsed) {
        out.push(parsed);
      }
    } catch {
      // Ignore unreadable or malformed files.
    }
  }

  return out;
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let current = cwd;
  while (true) {
    const candidate = path.join(current, ".pi", "agents");
    if (isDirectory(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
  const userAgentsDir = path.join(resolveHomeDir(), ".pi", "agent", "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userAgentsDir, "user");
  const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

  const merged = new Map<string, AgentConfig>();

  if (scope === "both") {
    for (const agent of userAgents) {
      merged.set(agent.name, agent);
    }
    for (const agent of projectAgents) {
      merged.set(agent.name, agent);
    }
  } else if (scope === "user") {
    for (const agent of userAgents) {
      merged.set(agent.name, agent);
    }
  } else {
    for (const agent of projectAgents) {
      merged.set(agent.name, agent);
    }
  }

  return {
    agents: Array.from(merged.values()),
    projectAgentsDir,
  };
}

export function formatAgentList(agents: AgentConfig[], maxItems = 6): { text: string; remaining: number } {
  if (agents.length === 0) {
    return { text: "none", remaining: 0 };
  }

  const shown = agents.slice(0, maxItems);
  const remaining = agents.length - shown.length;
  return {
    text: shown.map((agent) => `${agent.name} (${agent.source})`).join(", "),
    remaining,
  };
}

function resolveHomeDir(): string {
  return process.env.HOME?.trim() || homedir();
}

function stripOptionalQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
