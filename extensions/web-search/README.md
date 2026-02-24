# Web Search Extension

Adds:
- `web_search` tool for retrieval with citations
- `/web`, `/web-deep`, `/web-news`, `/web-docs` command wrappers

Provider chain:
1. Context7 for docs/library lookups
2. Exa primary general retrieval
3. Brave fallback
4. Perplexity optional synthesis for `web-deep` only

Env:
- `CONTEXT7_API_KEY`
- `EXA_API_KEY`
- `BRAVE_API_KEY`
- `PERPLEXITY_API_KEY`
- `WEB_SEARCH_MAX_RESULTS` (default `5`)
- `WEB_SEARCH_TTL_MS` (default `1800000`)
