# Web Search Skill

Provides retrieval-first web research with citations and recency controls.

## Commands
- `/web <query>`: fast top links
- `/web-deep <query>`: fetch and summarize with citations
- `/web-news <query>`: recency-biased search results

## Behavior Contract
- Return structured result objects (see schema below)
- Include citation URL for every claim
- Prefer Exa as primary provider
- Fallback to Brave on provider failure
- Optional Perplexity pass allowed only for synthesis

## Output Schema
```json
{
  "title": "string",
  "url": "string",
  "snippet": "string",
  "published_at": "ISO-8601 or null",
  "score": 0.0,
  "source_provider": "exa|brave|perplexity"
}
```

## Safety and Quality
- Never fabricate URLs
- Mark uncertain facts as uncertain
- Apply recency filters for time-sensitive queries

## Runtime Notes
- CLI entrypoint: `skills/web-search/cli.ts`
- Cache: `cache/web-search-cache.json` (TTL via `WEB_SEARCH_TTL_MS`)
- Logs: `logs/web-search.ndjson`
- Cost controls:
- `WEB_SEARCH_MAX_RESULTS` caps results per query
- Cache dedupe prevents repeated provider calls for same normalized query
