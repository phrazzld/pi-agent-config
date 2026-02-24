import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { SearchRequest, SearchResult, ProviderAdapter } from "./provider-adapter";
import type { QueryCache } from "./cache";

export interface OrchestratorOptions {
  cache?: QueryCache<SearchResult[]>;
  logPath?: string;
}

interface LogEvent {
  ts: string;
  event: string;
  query: string;
  command: SearchRequest["command"];
  provider?: ProviderAdapter["name"];
  count?: number;
  detail?: string;
}

export class WebSearchOrchestrator {
  private readonly providers: ProviderAdapter[];
  private readonly cache?: QueryCache<SearchResult[]>;
  private readonly logPath?: string;

  constructor(providers: ProviderAdapter[], options: OrchestratorOptions = {}) {
    if (providers.length === 0) {
      throw new Error("providers must not be empty");
    }
    this.providers = providers;
    this.cache = options.cache;
    this.logPath = options.logPath;
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    if (this.cache) {
      const cached = await this.cache.get(request);
      if (cached) {
        await this.log({ event: "cache_hit", request, count: cached.length });
        return cached;
      }
    }

    let lastError: unknown = null;

    for (const provider of this.providers) {
      try {
        const results = await provider.search(request);
        if (results.length === 0) {
          await this.log({ event: "provider_empty", request, provider });
          continue;
        }

        const deduped = dedupeByUrl(results);
        if (this.cache) {
          await this.cache.set(request, deduped);
        }

        await this.log({
          event: "provider_success",
          request,
          provider,
          count: deduped.length,
        });
        return deduped;
      } catch (error) {
        lastError = error;
        await this.log({
          event: "provider_error",
          request,
          provider,
          detail: String(error),
        });
      }
    }

    await this.log({
      event: "all_providers_failed",
      request,
      detail: lastError ? String(lastError) : "no results",
    });

    if (lastError) {
      throw lastError;
    }
    return [];
  }

  private async log(input: {
    event: string;
    request: SearchRequest;
    provider?: ProviderAdapter;
    count?: number;
    detail?: string;
  }): Promise<void> {
    if (!this.logPath) {
      return;
    }

    const payload: LogEvent = {
      ts: new Date().toISOString(),
      event: input.event,
      query: input.request.query,
      command: input.request.command,
      provider: input.provider?.name,
      count: input.count,
      detail: input.detail,
    };

    await mkdir(path.dirname(this.logPath), { recursive: true });
    await appendFile(this.logPath, `${JSON.stringify(payload)}\n`, "utf8");
  }
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    if (seen.has(result.url)) {
      continue;
    }
    seen.add(result.url);
    deduped.push(result);
  }

  return deduped;
}

