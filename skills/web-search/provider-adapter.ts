export type WebCommand = "web" | "web-deep" | "web-news";

export interface SearchRequest {
  query: string;
  command: WebCommand;
  limit?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published_at: string | null;
  score: number;
  source_provider: "exa" | "brave" | "perplexity";
}

export interface ProviderAdapter {
  readonly name: "exa" | "brave" | "perplexity";
  search(request: SearchRequest): Promise<SearchResult[]>;
}

export interface SearchPipeline {
  primary: ProviderAdapter;
  fallback?: ProviderAdapter;
  synthesis?: ProviderAdapter;
}

/**
 * Run retrieval-first search with optional fallback and synthesis.
 * Synthesis is never source-of-truth; keep provider URLs in final output.
 */
export async function runSearch(
  pipeline: SearchPipeline,
  request: SearchRequest
): Promise<SearchResult[]> {
  try {
    const primaryResults = await pipeline.primary.search(request);
    if (primaryResults.length > 0) {
      return primaryResults;
    }
  } catch {
    // fallback path below
  }

  if (pipeline.fallback) {
    return pipeline.fallback.search(request);
  }

  return [];
}

