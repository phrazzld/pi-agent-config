import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type MemoryMode = "keyword" | "semantic" | "hybrid";

interface IngestOptions {
  sessionLimit: number;
  includeLogs: boolean;
  embed: boolean;
  force: boolean;
}

interface IngestSummary {
  corpusDir: string;
  collection: string;
  sessionFilesWritten: number;
  logFilesWritten: number;
  skippedSessions: number;
  indexed: boolean;
  embedded: boolean;
  markerPath: string;
}

const MEMORY_MODE = StringEnum(["keyword", "semantic", "hybrid"] as const);

export default function organicWorkflowsExtension(pi: ExtensionAPI): void {
  pi.registerCommand("squash-merge", {
    description: "Squash-merge a PR and automatically trigger /reflect",
    handler: async (args, ctx) => {
      const parsed = parseSquashMergeArgs(args);
      if (!parsed) {
        ctx.ui.notify("Usage: /squash-merge <pr-number> [reflection focus]", "warning");
        return;
      }

      const { prNumber, reflectionFocus } = parsed;
      const cwd = ctx.cwd;

      const dirty = await pi.exec("git", ["status", "--porcelain"], { cwd });
      if (dirty.stdout.trim().length > 0) {
        ctx.ui.notify(
          "Blocked: working directory is not clean. Commit/stash first, then run /squash-merge.",
          "warning"
        );
        return;
      }

      const prMeta = await ghJson<{
        number: number;
        state: string;
        isDraft: boolean;
        mergeStateStatus: string;
        reviewDecision: string | null;
        title: string;
        url: string;
      }>(pi, cwd, [
        "pr",
        "view",
        String(prNumber),
        "--json",
        "number,state,isDraft,mergeStateStatus,reviewDecision,title,url",
      ]);

      if (!prMeta) {
        ctx.ui.notify(`Failed to load PR #${prNumber}.`, "error");
        return;
      }

      if (prMeta.state !== "OPEN") {
        ctx.ui.notify(`Blocked: PR #${prNumber} is not open (${prMeta.state}).`, "warning");
        return;
      }

      if (prMeta.isDraft) {
        ctx.ui.notify(`Blocked: PR #${prNumber} is draft.`, "warning");
        return;
      }

      if (prMeta.reviewDecision === "CHANGES_REQUESTED") {
        ctx.ui.notify(`Blocked: PR #${prNumber} has changes requested.`, "warning");
        return;
      }

      if (prMeta.mergeStateStatus !== "CLEAN" && prMeta.mergeStateStatus !== "HAS_HOOKS") {
        ctx.ui.notify(
          `Blocked: mergeStateStatus=${prMeta.mergeStateStatus}. Resolve checks/conflicts first.`,
          "warning"
        );
        return;
      }

      const checks = await pi.exec("gh", ["pr", "checks", String(prNumber)], {
        cwd,
        timeout: 120_000,
      });
      if (checks.code !== 0) {
        const summary = firstNonEmptyLine(checks.stderr) ?? firstNonEmptyLine(checks.stdout);
        ctx.ui.notify(
          `Blocked: PR checks are not green${summary ? ` (${summary})` : ""}.`,
          "warning"
        );
        return;
      }

      ctx.ui.setStatus("organic-workflows", `Squash-merging PR #${prNumber}...`);

      const merge = await pi.exec("gh", ["pr", "merge", String(prNumber), "--squash", "--delete-branch"], {
        cwd,
        timeout: 180_000,
      });

      if (merge.code !== 0) {
        ctx.ui.setStatus("organic-workflows", "");
        const summary = firstNonEmptyLine(merge.stderr) ?? firstNonEmptyLine(merge.stdout);
        ctx.ui.notify(`Merge failed${summary ? ` (${summary})` : ""}.`, "error");
        return;
      }

      const defaultBranch = await detectDefaultBranch(pi, cwd);
      await pi.exec("git", ["checkout", defaultBranch], { cwd, timeout: 60_000 });
      await pi.exec("git", ["pull", "--ff-only"], { cwd, timeout: 120_000 });

      ctx.ui.setStatus("organic-workflows", "");

      const reflectMessage = reflectionFocus
        ? `/reflect post-merge PR #${prNumber} ${reflectionFocus}`
        : `/reflect post-merge PR #${prNumber}`;

      pi.sendUserMessage(reflectMessage);
      ctx.ui.notify(
        `Merged PR #${prNumber} and triggered ${reflectMessage}`,
        "success"
      );
    },
  });

  pi.registerTool({
    name: "memory_ingest",
    label: "Memory Ingest",
    description:
      "Build/update local markdown memory corpus from Pi sessions/logs and index it with QMD for local-first reflection.",
    parameters: Type.Object({
      sessionLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      includeLogs: Type.Optional(Type.Boolean()),
      embed: Type.Optional(Type.Boolean()),
      force: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const summary = await ingestMemory(pi, ctx, {
        sessionLimit: params.sessionLimit ?? getDefaultSessionLimit(),
        includeLogs: params.includeLogs ?? true,
        embed: params.embed ?? false,
        force: params.force ?? false,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        details: summary,
      };
    },
  });

  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search local Pi memory corpus via QMD (keyword, semantic, or hybrid).",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      mode: Type.Optional(MEMORY_MODE),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })),
      autoIngest: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mode = (params.mode ?? "hybrid") as MemoryMode;
      const limit = clamp(params.limit ?? 8, 1, 25);
      const autoIngest = params.autoIngest ?? true;

      if (autoIngest) {
        const stale = await isMemoryStale();
        if (stale) {
          await ingestMemory(pi, ctx, {
            sessionLimit: getDefaultSessionLimit(),
            includeLogs: true,
            embed: false,
            force: false,
          });
        }
      }

      const output = await runMemorySearch(pi, ctx, params.query, mode, limit);
      return {
        content: [{ type: "text", text: output }],
        details: {
          query: params.query,
          mode,
          limit,
          collection: getMemoryCollection(),
        },
      };
    },
  });

  pi.registerCommand("memory-ingest", {
    description: "Build/update local memory corpus and index it with QMD",
    handler: async (args, ctx) => {
      const embed = args.includes("--embed");
      const force = args.includes("--force");
      const summary = await ingestMemory(pi, ctx, {
        sessionLimit: getDefaultSessionLimit(),
        includeLogs: true,
        embed,
        force,
      });
      ctx.ui.notify(
        `Memory ingest complete: ${summary.sessionFilesWritten} sessions, ${summary.logFilesWritten} logs, collection=${summary.collection}`,
        "success"
      );
    },
  });

  pi.registerCommand("memory-search", {
    description: "Run hybrid local memory search via QMD",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Usage: /memory-search <query>", "warning");
        return;
      }

      const message = [
        `Use the memory_search tool now with query \"${query}\" and mode \"hybrid\".`,
        "Summarize key findings with source paths and confidence caveats.",
      ].join(" ");

      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
      }
    },
  });
}

async function ingestMemory(pi: ExtensionAPI, ctx: ExtensionContext, options: IngestOptions): Promise<IngestSummary> {
  await ensureQmdAvailable(pi, ctx.cwd);

  const configDir = getConfigDir();
  const sessionsRoot = path.join(configDir, "sessions");
  const logsRoot = path.join(configDir, "logs");
  const corpusRoot = getMemoryCorpusDir(configDir);
  const sessionsOut = path.join(corpusRoot, "sessions");
  const logsOut = path.join(corpusRoot, "logs");
  const markerPath = path.join(corpusRoot, "_last_sync.json");

  if (!options.force) {
    const stale = await isMemoryStale();
    if (!stale) {
      return {
        corpusDir: corpusRoot,
        collection: getMemoryCollection(),
        sessionFilesWritten: 0,
        logFilesWritten: 0,
        skippedSessions: 0,
        indexed: false,
        embedded: false,
        markerPath,
      };
    }
  }

  await fs.mkdir(sessionsOut, { recursive: true });
  await fs.mkdir(logsOut, { recursive: true });

  await clearMarkdownFiles(sessionsOut);
  await clearMarkdownFiles(logsOut);

  const sessionFiles = await listFilesRecursive(sessionsRoot, (file) => file.endsWith(".jsonl"));
  sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const selectedSessions = sessionFiles.slice(0, options.sessionLimit);
  let sessionFilesWritten = 0;
  let skippedSessions = 0;

  for (const sessionFile of selectedSessions) {
    const transcript = await renderSessionAsMarkdown(sessionFile.path);
    if (!transcript) {
      skippedSessions++;
      continue;
    }

    const name = sessionFile.path
      .replace(/[:/\\]+/g, "__")
      .replace(/\.+/g, "_")
      .slice(-180);
    const outPath = path.join(sessionsOut, `${name}.md`);
    await fs.writeFile(outPath, transcript, "utf8");
    sessionFilesWritten++;
  }

  let logFilesWritten = 0;
  if (options.includeLogs && existsSync(logsRoot)) {
    const logFiles = await listFilesRecursive(logsRoot, (file) =>
      file.endsWith(".ndjson") || file.endsWith(".log") || file.endsWith(".txt")
    );

    for (const logFile of logFiles) {
      const rendered = await renderLogAsMarkdown(logFile.path);
      if (!rendered) {
        continue;
      }
      const fileName = path.basename(logFile.path).replace(/[^a-zA-Z0-9_.-]/g, "_");
      const outPath = path.join(logsOut, `${fileName}.md`);
      await fs.writeFile(outPath, rendered, "utf8");
      logFilesWritten++;
    }
  }

  const manifest = [
    "# Pi Memory Corpus",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Session files: ${sessionFilesWritten}`,
    `- Log files: ${logFilesWritten}`,
    `- Skipped sessions: ${skippedSessions}`,
    `- Source sessions root: ${sessionsRoot}`,
    `- Source logs root: ${logsRoot}`,
    "",
    "This corpus stores raw transcript excerpts plus minimal metadata for local-first retrieval.",
  ].join("\n");
  await fs.writeFile(path.join(corpusRoot, "index.md"), manifest, "utf8");

  const collection = getMemoryCollection();
  await ensureQmdCollection(pi, ctx.cwd, corpusRoot, collection);

  const update = await pi.exec("qmd", ["update"], { cwd: ctx.cwd, timeout: 180_000 });
  if (update.code !== 0) {
    throw new Error(`qmd update failed: ${firstNonEmptyLine(update.stderr) ?? "unknown error"}`);
  }

  let embedded = false;
  if (options.embed) {
    const embed = await pi.exec("qmd", ["embed"], { cwd: ctx.cwd, timeout: 300_000 });
    if (embed.code !== 0) {
      throw new Error(`qmd embed failed: ${firstNonEmptyLine(embed.stderr) ?? "unknown error"}`);
    }
    embedded = true;
  }

  await fs.writeFile(
    markerPath,
    JSON.stringify(
      {
        ts: Date.now(),
        sessionFilesWritten,
        logFilesWritten,
        collection,
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    corpusDir: corpusRoot,
    collection,
    sessionFilesWritten,
    logFilesWritten,
    skippedSessions,
    indexed: true,
    embedded,
    markerPath,
  };
}

async function runMemorySearch(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  query: string,
  mode: MemoryMode,
  limit: number
): Promise<string> {
  await ensureQmdAvailable(pi, ctx.cwd);

  const command = mode === "keyword" ? "search" : mode === "semantic" ? "vsearch" : "query";
  const collection = getMemoryCollection();

  const result = await pi.exec(
    "qmd",
    [command, query, "--json", "-n", String(limit), "-c", collection],
    { cwd: ctx.cwd, timeout: 180_000 }
  );

  if (result.code !== 0) {
    const reason = firstNonEmptyLine(result.stderr) ?? firstNonEmptyLine(result.stdout) ?? "unknown error";
    throw new Error(`memory_search failed (${mode}): ${reason}`);
  }

  const trimmed = stripAnsi(result.stdout).trim();
  if (!trimmed) {
    return JSON.stringify(
      {
        query,
        mode,
        limit,
        collection,
        results: [],
        note: "No memory matches found",
      },
      null,
      2
    );
  }

  const parsedJson = extractJsonPayload(trimmed);
  if (parsedJson) {
    return JSON.stringify(parsedJson, null, 2);
  }

  return trimmed;
}

async function ensureQmdAvailable(pi: ExtensionAPI, cwd: string): Promise<void> {
  try {
    const version = await pi.exec("qmd", ["--version"], { cwd, timeout: 30_000 });
    if (version.code === 0) {
      return;
    }
  } catch {
    // fall through
  }
  throw new Error("qmd is not installed. Install with: npm install -g @tobilu/qmd");
}

async function ensureQmdCollection(
  pi: ExtensionAPI,
  cwd: string,
  corpusDir: string,
  collection: string
): Promise<void> {
  const listed = await pi.exec("qmd", ["collection", "list"], { cwd, timeout: 60_000 });
  const exists = listed.code === 0 && listed.stdout.includes(collection);
  if (!exists) {
    const add = await pi.exec("qmd", ["collection", "add", corpusDir, "--name", collection], {
      cwd,
      timeout: 120_000,
    });
    if (add.code !== 0) {
      const summary = firstNonEmptyLine(add.stderr) ?? firstNonEmptyLine(add.stdout);
      throw new Error(`Failed to add qmd collection ${collection}${summary ? ` (${summary})` : ""}`);
    }
  }

  const contextAdd = await pi.exec("qmd", ["context", "add", `qmd://${collection}`, "Pi session and log memory corpus"], {
    cwd,
    timeout: 60_000,
  });

  // Ignore duplicate/benign context-add failures.
  if (contextAdd.code !== 0 && !/exists|duplicate|already/i.test(`${contextAdd.stderr} ${contextAdd.stdout}`)) {
    const summary = firstNonEmptyLine(contextAdd.stderr) ?? firstNonEmptyLine(contextAdd.stdout);
    throw new Error(`Failed to add qmd context${summary ? ` (${summary})` : ""}`);
  }
}

async function renderSessionAsMarkdown(sessionPath: string): Promise<string | null> {
  const raw = await fs.readFile(sessionPath, "utf8");
  const lines = raw.split("\n").filter(Boolean);

  const chunks: string[] = [];
  const maxChars = getMaxCharsPerSession();
  let usedChars = 0;

  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const excerpt = extractEntryExcerpt(entry);
    if (!excerpt) {
      continue;
    }

    if (usedChars + excerpt.length > maxChars) {
      break;
    }

    chunks.push(excerpt);
    usedChars += excerpt.length;
  }

  if (chunks.length === 0) {
    return null;
  }

  const header = [
    "# Session Transcript Excerpts",
    "",
    `- Source: ${sessionPath}`,
    `- Exported: ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ].join("\n");

  return header + chunks.join("\n\n---\n\n");
}

function extractEntryExcerpt(entry: any): string | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  if (entry.type === "message" && entry.message) {
    const role = String(entry.message.role ?? "unknown");
    const ts = String(entry.timestamp ?? entry.message.timestamp ?? "");

    if (role === "user") {
      const text = extractContentText(entry.message.content);
      if (!text) return null;
      return `## ${ts} USER\n\n${text}`;
    }

    if (role === "assistant") {
      const textParts: string[] = [];
      const content = Array.isArray(entry.message.content) ? entry.message.content : [];
      for (const part of content) {
        if (part?.type === "text" && typeof part.text === "string") {
          textParts.push(part.text);
        }
        if (part?.type === "toolCall") {
          const call = `${part.name ?? "tool"}(${JSON.stringify(part.arguments ?? {})})`;
          textParts.push(`[toolCall] ${call}`);
        }
      }
      const text = textParts.join("\n").trim();
      if (!text) return null;
      return `## ${ts} ASSISTANT\n\n${text}`;
    }

    if (role === "toolResult") {
      const text = extractContentText(entry.message.content);
      if (!text) return null;
      const name = String(entry.message.toolName ?? "tool");
      return `## ${ts} TOOL_RESULT (${name})\n\n${text}`;
    }
  }

  if (entry.type === "compaction" && typeof entry.summary === "string") {
    return `## COMPACTION_SUMMARY\n\n${entry.summary}`;
  }

  if (entry.type === "branch_summary" && typeof entry.summary === "string") {
    return `## BRANCH_SUMMARY\n\n${entry.summary}`;
  }

  if (entry.type === "custom_message" && typeof entry.content === "string") {
    return `## CUSTOM_MESSAGE (${entry.customType ?? "custom"})\n\n${entry.content}`;
  }

  return null;
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if ((part as any).type === "text") {
        return String((part as any).text ?? "");
      }
      if ((part as any).type === "image") {
        return "[image]";
      }
      return "";
    })
    .filter(Boolean);
  return parts.join("\n").trim();
}

async function renderLogAsMarkdown(logPath: string): Promise<string | null> {
  const raw = await fs.readFile(logPath, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const tail = lines.slice(-500).join("\n");
  return [
    "# Log Excerpts",
    "",
    `- Source: ${logPath}`,
    `- Exported: ${new Date().toISOString()}`,
    `- Lines exported: ${Math.min(500, lines.length)} / ${lines.length}`,
    "",
    "```text",
    tail,
    "```",
  ].join("\n");
}

async function listFilesRecursive(
  root: string,
  include: (filePath: string) => boolean
): Promise<Array<{ path: string; mtimeMs: number }>> {
  if (!existsSync(root)) {
    return [];
  }

  const out: Array<{ path: string; mtimeMs: number }> = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!include(fullPath)) {
        continue;
      }
      const stat = await fs.stat(fullPath);
      out.push({ path: fullPath, mtimeMs: stat.mtimeMs });
    }
  }

  await walk(root);
  return out;
}

async function clearMarkdownFiles(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    return;
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      continue;
    }
    if (entry.name.endsWith(".md")) {
      await fs.unlink(fullPath);
    }
  }
}

async function isMemoryStale(): Promise<boolean> {
  const markerPath = path.join(getMemoryCorpusDir(getConfigDir()), "_last_sync.json");
  if (!existsSync(markerPath)) {
    return true;
  }

  try {
    const raw = await fs.readFile(markerPath, "utf8");
    const parsed = JSON.parse(raw) as { ts?: number };
    const ts = Number(parsed.ts ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) {
      return true;
    }
    return Date.now() - ts > getMemorySyncTtlMs();
  } catch {
    return true;
  }
}

async function detectDefaultBranch(pi: ExtensionAPI, cwd: string): Promise<string> {
  const response = await pi.exec(
    "gh",
    ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
    { cwd, timeout: 30_000 }
  );
  const value = response.stdout.trim();
  if (response.code === 0 && value) {
    return value;
  }

  const mainCheck = await pi.exec("git", ["rev-parse", "--verify", "main"], { cwd, timeout: 20_000 });
  if (mainCheck.code === 0) {
    return "main";
  }
  return "master";
}

async function ghJson<T>(pi: ExtensionAPI, cwd: string, args: string[]): Promise<T | null> {
  const result = await pi.exec("gh", args, { cwd, timeout: 60_000 });
  if (result.code !== 0) {
    return null;
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return null;
  }
}

function parseSquashMergeArgs(args: string): { prNumber: number; reflectionFocus: string } | null {
  const trimmed = args.trim();
  if (!trimmed) {
    return null;
  }

  const [prToken, ...rest] = trimmed.split(/\s+/);
  const prNumber = Number(prToken);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return null;
  }

  return {
    prNumber,
    reflectionFocus: rest.join(" ").trim(),
  };
}

function getConfigDir(): string {
  return (
    process.env.PI_CONFIG_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    path.join(homedir(), ".pi", "agent")
  );
}

function getMemoryCollection(): string {
  return process.env.PI_MEMORY_QMD_COLLECTION?.trim() || "pi-memory";
}

function getMemoryCorpusDir(configDir: string): string {
  return process.env.PI_MEMORY_CORPUS_DIR?.trim() || path.join(configDir, "cache", "memory-corpus");
}

function getMemorySyncTtlMs(): number {
  const value = Number(process.env.PI_MEMORY_SYNC_TTL_MS ?? 10 * 60 * 1000);
  return Number.isFinite(value) && value > 0 ? value : 10 * 60 * 1000;
}

function getDefaultSessionLimit(): number {
  const value = Number(process.env.PI_MEMORY_SESSION_LIMIT ?? 40);
  return clamp(Number.isFinite(value) ? value : 40, 1, 500);
}

function getMaxCharsPerSession(): number {
  const value = Number(process.env.PI_MEMORY_MAX_CHARS_PER_SESSION ?? 120_000);
  return clamp(Number.isFinite(value) ? value : 120_000, 5_000, 2_000_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function firstNonEmptyLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? null;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
}

function extractJsonPayload(text: string): unknown | null {
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket < 0 || lastBracket <= firstBracket) {
    return null;
  }

  const candidate = text.slice(firstBracket, lastBracket + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
