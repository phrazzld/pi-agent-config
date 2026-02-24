# pi-agent-config

Versioned config for PI agent runtime (`~/.pi/agent`).

## Layout
- `settings.json`: versioned runtime settings
- `skills/`: local skills (symlinked into runtime)
- `extensions/`: local extensions (symlinked into runtime)
- `prompts/`: prompt templates (symlinked into runtime)
- `themes/`: themes (symlinked into runtime)
- `docs/`: provider docs and policy
- `scripts/`: bootstrap/sync scripts

## Included Runtime Extensions
- `extensions/web-search`: `web_search` tool + `/web*` commands
- `extensions/guardrails`: irreversible-command blocks + post-edit checks + PR metadata lint/fix + governance trend logging
- `extensions/profiles`: `/profile` modes (`ultrathink`, `execute`, `ship`, `fast`)
- `extensions/organic-workflows`: code-enforced `/squash-merge` + high/critical review finding merge gate + local-first QMD memory ingest/search

## Included Skills
- `skills/web-search`: retrieval-first web research workflow and output contract
- `skills/organic-reflection`: usage-driven codification and tradeoff-scored improvement planning
- `skills/pr-feedback`: GH CLI-first PR feedback triage, fix/commit loop, and reviewer reply templates

## Included Workflow Prompts
- `/execute`
- `/spec`
- `/architect`
- `/pr`
- `/respond`
- `/fix-ci`
- `/groom`
- `/autopilot`
- `/reflect`

## Included Workflow Commands (extension-backed)
- `/squash-merge`
- `/memory-ingest`
- `/memory-search`
- `/pr-lint`
- `/pr-trends`
- `/review-policy`

## Setup
```bash
./scripts/bootstrap.sh
```

Optional (QMD local-memory prototype):
```bash
./scripts/setup-qmd.sh
/memory-ingest --force
```

## Required Env
See `.env.example`, `docs/provider-config.md`, `docs/pr-governance.md`, and `docs/reviewer-policy-matrix.md`.

Core retrieval keys:
- `CONTEXT7_API_KEY` (docs)
- `EXA_API_KEY` (primary retrieval)
- `BRAVE_API_KEY` (fallback retrieval)
- `PERPLEXITY_API_KEY` (optional synthesis)

Optional local-memory knobs (QMD prototype):
- `PI_MEMORY_QMD_COLLECTION` (default: `pi-memory`)
- `PI_MEMORY_CORPUS_DIR` (default: `~/.pi/agent/cache/memory-corpus`)
- `PI_MEMORY_SESSION_LIMIT`
- `PI_MEMORY_MAX_CHARS_PER_SESSION`
- `PI_MEMORY_SYNC_TTL_MS`

## Settings Sync
```bash
./scripts/sync-settings.sh pull   # runtime -> repo
./scripts/sync-settings.sh push   # repo -> runtime
```
