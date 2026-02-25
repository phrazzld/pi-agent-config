# QMD Fit Check (Local-First Memory)

Source: <https://github.com/tobi/qmd>

## Why QMD is relevant

QMD is a local hybrid retrieval engine for markdown-like corpora with:
- BM25 keyword search
- vector semantic search
- optional LLM reranking
- JSON/files-oriented outputs suitable for agent workflows

For our use case, this indexes session-derived markdown + logs and supports reflection/planning retrieval without external SaaS dependencies.

## Current implementation status

Implemented in `extensions/organic-workflows`:

- `memory_ingest` tool + `/memory-ingest` command
- `memory_search` tool + `/memory-search` command
- `memory_context` tool + `/memory-context` command
- dual-scope corpus model:
  - **global**: cross-repo memory collection
  - **local**: repo-scoped memory collection
- local-first search/ranking when `scope=both`
- session/log excerpt export to markdown corpus
- QMD collection bootstrap + update flow

## Scope model

- `scope=local`: bias hard toward current repository memory
- `scope=global`: use only cross-repo memory
- `scope=both`: search local first and blend global fallback hits

## Risks / caveats

- Local scope quality depends on session `cwd` metadata quality.
- Some logs are not repo-attributed; local log inclusion is best-effort.
- Hybrid search quality improves when embeddings are generated (`qmd embed`).

## Operational guidance

1. Bootstrap memory in a repo:
   - `/memory-ingest --scope both --force`
2. During planning/review:
   - `/memory-search --scope local "<topic>"`
3. Before complex implementation/review responses:
   - `/memory-context --scope both "<goal>"`

## Proposed next steps

1. Add periodic ingest cadence in bootstrap/local workflow docs.
2. Validate retrieval quality on real issue-to-PR loops.
3. Tune local/global weighting (`PI_MEMORY_LOCAL_PRIORITY_BOOST`) based on false-positive rate.
