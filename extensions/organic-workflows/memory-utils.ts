export type MemoryScope = "global" | "local" | "both";
export type ConcreteMemoryScope = Exclude<MemoryScope, "both">;

export interface RankableMemoryResult {
  scope: ConcreteMemoryScope;
  score: number;
  adjustedScore: number;
  file: string;
  snippet: string;
}

export function normalizeMemoryScope(value: unknown): MemoryScope {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "local" || normalized === "global" || normalized === "both") {
    return normalized as MemoryScope;
  }
  return "both";
}

export function parseMemoryScopeFromArgs(rawArgs: string, fallback: MemoryScope): MemoryScope {
  const match = rawArgs.match(/--scope(?:=|\s+)(local|global|both)\b/i);
  if (!match) {
    return fallback;
  }
  return normalizeMemoryScope(match[1]);
}

export function stripMemoryScopeFlag(rawArgs: string): string {
  return rawArgs.replace(/--scope(?:=|\s+)(local|global|both)\b/gi, " ").replace(/\s+/g, " ").trim();
}

export function parseRepoSlugFromRemote(remote: string): string | null {
  const value = remote.trim().replace(/\.git$/i, "");
  if (!value) {
    return null;
  }

  const githubMatch = value.match(/github\.com[:/]([^\s]+)$/i);
  if (githubMatch) {
    const parts = githubMatch[1].split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
  }

  const parts = value.split(/[/:]/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }

  return null;
}

export function buildRepoMemoryKey(repoRoot: string, repoSlug: string): string {
  const base =
    sanitizeMemoryToken(repoSlug.replace("/", "-"), 48) ||
    sanitizeMemoryToken(repoRoot.split(/[\\/]/).filter(Boolean).pop() ?? "", 32) ||
    "repo";
  const hash = shortHash(repoRoot.toLowerCase());
  return sanitizeMemoryToken(`${base}-${hash}`, 64) || `repo-${hash}`;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function sanitizeMemoryToken(value: string, maxLength: number): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  if (!cleaned) {
    return "";
  }

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return cleaned.slice(0, maxLength).replace(/[-_]+$/g, "");
}

export function sanitizeCollectionName(value: string): string {
  const cleaned = sanitizeMemoryToken(value, 72);
  return cleaned || "pi-memory";
}

export function resolveCollectionTemplate(template: string, repoMemoryKey: string): string {
  return template.replace(/\{repo\}/gi, repoMemoryKey);
}

export function selectAndRankMemoryResults<T extends RankableMemoryResult>(
  results: T[],
  limit: number,
  localBoost: number,
): T[] {
  const deduped = new Map<string, T>();

  for (const result of results) {
    const adjustedScore = result.score + (result.scope === "local" ? localBoost : 0);
    const candidate = {
      ...result,
      adjustedScore,
    } as T;

    const key = buildMemoryResultKey(candidate.file, candidate.snippet);
    const existing = deduped.get(key);
    if (!existing || candidate.adjustedScore > existing.adjustedScore) {
      deduped.set(key, candidate);
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => {
      if (right.adjustedScore !== left.adjustedScore) {
        return right.adjustedScore - left.adjustedScore;
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.scope !== right.scope) {
        return left.scope === "local" ? -1 : 1;
      }
      return 0;
    })
    .slice(0, limit);
}

function buildMemoryResultKey(file: string, snippet: string): string {
  const normalizedSnippet = snippet.replace(/\s+/g, " ").trim().slice(0, 320);
  return `${file}::${normalizedSnippet}`;
}
