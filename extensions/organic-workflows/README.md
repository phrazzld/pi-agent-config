# organic-workflows extension

Opinionated workflow automation for:

1. **`/squash-merge`** (code-enforced)
   - defaults to the pull request for the current branch (optional explicit PR number still supported)
   - validates strict PR readiness
     - PR open + not draft + merge-ready status
     - CI/CD checks all green (no pending/failing)
     - unresolved severe review threads block merge
     - **critical/high actionable bot findings block merge by default**
     - suspicious quality-gate weakening patterns block merge
   - performs squash merge
   - switches/pulls default branch
   - automatically triggers `/reflect ...`

2. **Local-first memory prototype (QMD-backed)**
   - `memory_ingest` tool + `/memory-ingest` command
   - `memory_search` tool + `/memory-search` command
   - exports Pi session/log excerpts to markdown corpus
   - indexes corpus with QMD collection (`pi-memory` by default)

## `/squash-merge` override flags

Use sparingly and only after explicit manual review:

- `--allow-unresolved-nits`
- `--allow-quality-gate-changes`
- `--allow-critical-bot-findings`

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
