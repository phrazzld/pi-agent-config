# organic-workflows extension

Opinionated workflow automation for:

1. **`/squash-merge`** (code-enforced)
   - validates PR readiness
   - performs squash merge
   - switches/pulls default branch
   - automatically triggers `/reflect ...`

2. **Local-first memory prototype (QMD-backed)**
   - `memory_ingest` tool + `/memory-ingest` command
   - `memory_search` tool + `/memory-search` command
   - exports Pi session/log excerpts to markdown corpus
   - indexes corpus with QMD collection (`pi-memory` by default)

## QMD prerequisite

Install QMD locally:

```bash
npm install -g @tobilu/qmd
# or
bun install -g @tobilu/qmd
```

Then run:

```bash
/memory-ingest --force
```

## Environment knobs

- `PI_MEMORY_QMD_COLLECTION` (default: `pi-memory`)
- `PI_MEMORY_CORPUS_DIR` (default: `~/.pi/agent/cache/memory-corpus`)
- `PI_MEMORY_SESSION_LIMIT` (default: `40`)
- `PI_MEMORY_MAX_CHARS_PER_SESSION` (default: `120000`)
- `PI_MEMORY_SYNC_TTL_MS` (default: `600000`)
