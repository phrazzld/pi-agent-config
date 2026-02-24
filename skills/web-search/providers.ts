import type { ProviderAdapter, SearchRequest, SearchResult } from "./provider-adapter";

const DEFAULT_LIMIT = 5;

export class ExaProvider implements ProviderAdapter {
  readonly name = "exa" as const;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        query: request.query,
        numResults: request.limit ?? DEFAULT_LIMIT,
      }),
    });

    if (!response.ok) {
      throw new Error(`exa search failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        text?: string;
        publishedDate?: string;
        score?: number;
      }>;
    };

    return (payload.results ?? [])
      .filter((item) => Boolean(item.url))
      .map((item) => ({
        title: item.title ?? item.url ?? "Untitled",
        url: item.url!,
        snippet: item.text ?? "",
        published_at: item.publishedDate ?? null,
        score: item.score ?? 0,
        source_provider: "exa" as const,
      }));
  }
}

export class BraveProvider implements ProviderAdapter {
  readonly name = "brave" as const;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const query = new URLSearchParams({
      q: request.query,
      count: String(request.limit ?? DEFAULT_LIMIT),
    });

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${query}`, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`brave search failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          age?: string;
        }>;
      };
    };

    return (payload.web?.results ?? [])
      .filter((item) => Boolean(item.url))
      .map((item, index) => ({
        title: item.title ?? item.url ?? "Untitled",
        url: item.url!,
        snippet: item.description ?? "",
        published_at: item.age ?? null,
        score: scoreFromRank(index),
        source_provider: "brave" as const,
      }));
  }
}

export class PerplexitySynthesisProvider implements ProviderAdapter {
  readonly name = "perplexity" as const;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "Return links only. Never invent links. Keep output factual and concise.",
          },
          {
            role: "user",
            content: request.query,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`perplexity synthesis failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      citations?: string[];
    };

    return (payload.citations ?? []).map((url, index) => ({
      title: "Perplexity citation",
      url,
      snippet: "",
      published_at: null,
      score: scoreFromRank(index),
      source_provider: "perplexity" as const,
    }));
  }
}

function scoreFromRank(index: number): number {
  const value = 1 - index * 0.05;
  return value > 0 ? value : 0;
}

