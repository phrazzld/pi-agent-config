import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type PrGovernanceEventKind = "pr_metadata_lint" | "review_gate";
export type PrGovernanceStatus = "pass" | "fixed" | "warn" | "block" | "error";

export interface PrGovernanceEvent {
  ts: number;
  kind: PrGovernanceEventKind;
  status: PrGovernanceStatus;
  repo?: string;
  prNumber?: number;
  details?: Record<string, unknown>;
}

export async function appendPrGovernanceEvent(event: PrGovernanceEvent): Promise<void> {
  const logPath = getPrGovernanceLogPath();
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Logging is best-effort. Never fail primary workflow.
  }
}

export async function readPrGovernanceEvents(limit = 200): Promise<PrGovernanceEvent[]> {
  const boundedLimit = clamp(limit, 1, 5_000);
  const logPath = getPrGovernanceLogPath();
  if (!existsSync(logPath)) {
    return [];
  }

  let raw = "";
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch {
    return [];
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const out: PrGovernanceEvent[] = [];
  for (const line of lines.slice(-boundedLimit)) {
    try {
      const parsed = JSON.parse(line) as PrGovernanceEvent;
      if (typeof parsed.ts !== "number" || typeof parsed.kind !== "string") {
        continue;
      }
      out.push(parsed);
    } catch {
      // Ignore malformed lines.
    }
  }

  return out;
}

export function getPrGovernanceLogPath(): string {
  const configDir =
    process.env.PI_CONFIG_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    path.join(homedir(), ".pi", "agent");
  return path.join(configDir, "logs", "pr-governance.ndjson");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
