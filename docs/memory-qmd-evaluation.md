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

- Requires a local indexing pipeline from JSONL session files to markdown docs
- Needs ongoing ingestion/refresh automation
- Additional local model/runtime dependencies

## Proposed adoption path

1. **Toe-dip**: manually index a small synthetic memory corpus and test retrieval quality.
2. **Pilot**: build a thin extension wrapper that queries QMD for `/reflect`.
3. **Scale**: automate ingestion from sessions/logs and add retention rules.
