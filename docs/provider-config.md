# Web Provider Config

## Environment Variables
- `EXA_API_KEY`: primary provider for retrieval/extraction
- `BRAVE_API_KEY`: fallback provider for broad search
- `PERPLEXITY_API_KEY`: optional synthesis pass (never source of truth)

## Provider Order
1. Exa (`/web`, `/web-deep`, `/web-news`)
2. Brave fallback when Exa errors or times out
3. Perplexity optional synthesis after links are collected

## Cache and Cost Controls
- `WEB_SEARCH_MAX_RESULTS` limits provider result count (default `5`)
- `WEB_SEARCH_TTL_MS` caches identical queries to reduce repeated API calls
- Query normalization and URL dedupe reduce duplicate spend and noisy output

## Observability
- Pipeline logs append to `logs/web-search.ndjson`
- Events include provider success/failure and cache hits

## Hard Rules
- No factual claim without a URL in output
- Latest/today queries must set recency bias/filter
- Low-confidence answers must state uncertainty explicitly
- Synthesis must preserve source URLs from provider results

## Output Schema
Each result item should expose:
- `title`
- `url`
- `snippet`
- `published_at`
- `score`
- `source_provider`
