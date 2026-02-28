# Web Search Extension

Adds:
- `web_search` tool for retrieval with citations
- `/web`, `/web-deep`, `/web-news`, `/web-docs` command wrappers

Provider chain:
1. Context7 for docs/library lookups
2. Exa primary general retrieval
3. Brave fallback
4. Perplexity optional synthesis for `web-deep` only

Nested orchestration sessions (`PI_ORCH_DEPTH>0`) disable web-search telemetry logging by default.

Env:
- `CONTEXT7_API_KEY`
- `EXA_API_KEY`
- `BRAVE_API_KEY`
- `PERPLEXITY_API_KEY`
- `WEB_SEARCH_MAX_RESULTS` (default `5`)
- `WEB_SEARCH_TTL_MS` (default `1800000`)
- `PI_WEB_SEARCH_LOG_MAX_BYTES` (default `10485760`)
- `PI_WEB_SEARCH_LOG_MAX_BACKUPS` (default `5`)
- `PI_WEB_SEARCH_LOG_ROTATE_CHECK_MS` (default `30000`)
- `PI_WEB_SEARCH_ENABLE_NESTED_LOG` (default `false`)
- `PI_WEB_SEARCH_ENABLE_NESTED_WARN` (default `false`)
