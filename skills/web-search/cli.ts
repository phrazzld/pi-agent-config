import path from "node:path";

import { QueryCache } from "./cache";
import { WebSearchOrchestrator } from "./orchestrator";
import {
  BraveProvider,
  ExaProvider,
  PerplexitySynthesisProvider,
} from "./providers";
import type { ProviderAdapter, WebCommand } from "./provider-adapter";

interface CliInput {
  command: WebCommand;
  query: string;
}

async function main(): Promise<void> {
  const input = parseArgs(process.argv.slice(2));
  const configDir = process.env.PI_CONFIG_DIR ?? path.resolve(process.cwd(), "..", "..");
  const cacheTtlMs = Number(process.env.WEB_SEARCH_TTL_MS ?? 30 * 60 * 1000);

  const providers: ProviderAdapter[] = [];
  if (process.env.EXA_API_KEY) {
    providers.push(new ExaProvider(process.env.EXA_API_KEY));
  }
  if (process.env.BRAVE_API_KEY) {
    providers.push(new BraveProvider(process.env.BRAVE_API_KEY));
  }
  if (input.command === "web-deep" && process.env.PERPLEXITY_API_KEY) {
    providers.push(new PerplexitySynthesisProvider(process.env.PERPLEXITY_API_KEY));
  }

  if (providers.length === 0) {
    throw new Error("no providers configured; set EXA_API_KEY or BRAVE_API_KEY");
  }

  const cache = new QueryCache({
    filePath: path.join(configDir, "cache", "web-search-cache.json"),
    ttlMs: cacheTtlMs,
  });

  const orchestrator = new WebSearchOrchestrator(providers, {
    cache,
    logPath: path.join(configDir, "logs", "web-search.ndjson"),
  });

  const results = await orchestrator.search({
    query: input.query,
    command: input.command,
    limit: Number(process.env.WEB_SEARCH_MAX_RESULTS ?? 5),
  });

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

function parseArgs(args: string[]): CliInput {
  if (args.length < 2) {
    throw new Error("usage: web-search <web|web-deep|web-news> <query>");
  }

  const [command, ...queryParts] = args;
  if (command !== "web" && command !== "web-deep" && command !== "web-news") {
    throw new Error("command must be one of: web, web-deep, web-news");
  }

  const query = queryParts.join(" ").trim();
  if (!query) {
    throw new Error("query must not be empty");
  }

  return {
    command,
    query,
  };
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});

