# QMD Fit Check (Local-First Memory)

Source: <https://github.com/tobi/qmd>

## Why QMD is relevant

QMD is a local hybrid retrieval engine for markdown-like corpora with:
- BM25 keyword search
- vector semantic search
- optional LLM reranking
- JSON/files-oriented outputs suitable for agent workflows

For our use case, this can index exported session-derived markdown + logs + docs and support reflection retrieval without external SaaS dependencies.

## Potential fit in this repo

### Candidate ingestion set
- Session excerpts (from `~/.pi/agent/sessions/*.jsonl`, transformed into markdown chunks)
- Operational logs (e.g., extension logs)
- Repository docs and design notes

### Candidate retrieval commands
- memory keyword search (fast)
- memory semantic search (fuzzy concept recall)
- hybrid query for reflection runs

## Risks / caveats

- Requires a local indexing pipeline from JSONL session files to Markdown docs
- Needs ongoing ingestion/refresh automation
- Additional local model/runtime dependencies

## Current prototype status

Implemented in `extensions/organic-workflows`:
- `memory_ingest` tool + `/memory-ingest` command
- `memory_search` tool + `/memory-search` command
- Session/log excerpt export to markdown corpus
- QMD collection bootstrap + update flow

## Proposed next steps

1. **Toe-dip**: install QMD locally and validate retrieval quality on recent sessions.
2. **Pilot**: run `/reflect` with memory tools enabled and compare recommendation quality.
3. **Scale**: refine ingestion schema + retention rules and optionally add embeddings cadence.
