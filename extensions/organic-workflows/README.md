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

2. **Auto context injection for `/reflect` and `/respond`**
   - `before_agent_start` detects reflect/respond workflows via prompt markers
   - injects an `Auto Reflect Context` block containing:
     - session branch/tool-call snapshot
     - subagent/team/pipeline capability status
     - recent primitive-usage telemetry summary
     - memory freshness status (`scope=both`)
   - injects an `Auto PR Feedback Digest` block containing:
     - detected PR + source counts (issue/inline/review-summary)
     - severity/actionability triage summary
     - hard-blocker count (critical/high actionable)
     - ranked actionable findings with URLs

3. **Local-first memory (QMD-backed)**
   - tools:
     - `memory_ingest`
     - `memory_search`
     - `memory_context`
   - commands:
     - `/memory-ingest`
     - `/memory-search`
     - `/memory-context`
   - maintains two memory scopes:
     - `local`: repo-scoped corpus + collection
     - `global`: cross-repo corpus + collection
   - `scope=both` runs local-first with global fallback
   - exports Pi session/log excerpts to markdown corpus and indexes via QMD

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

Then prime memory:

```bash
/memory-ingest --scope both --force
```

## Example memory flows

```bash
/memory-search --scope local "onboarding fallback path"
/memory-search --scope both "reviewer concern around checkout docs"
/memory-context --scope both "current PR risks and prior fixes"
```

## Environment knobs

- `PI_MEMORY_GLOBAL_COLLECTION` (default: `pi-memory`)
- `PI_MEMORY_QMD_COLLECTION` (legacy alias for global collection)
- `PI_MEMORY_LOCAL_COLLECTION` (optional explicit local collection name/template)
- `PI_MEMORY_LOCAL_COLLECTION_TEMPLATE` (default: `pi-memory-local-{repo}`)
- `PI_MEMORY_CORPUS_DIR` (default: `~/.pi/agent/cache/memory-corpus`)
- `PI_MEMORY_SESSION_LIMIT` (default: `40`)
- `PI_MEMORY_LOCAL_SESSION_LIMIT` (default: `80`)
- `PI_MEMORY_MAX_CHARS_PER_SESSION` (default: `120000`)
- `PI_MEMORY_SYNC_TTL_MS` (default: `600000`)
- `PI_MEMORY_LOCAL_PRIORITY_BOOST` (default: `0.15`)
