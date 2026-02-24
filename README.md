# pi-agent-config

Versioned config for PI agent runtime (`~/.pi/agent`).

> Source-of-truth policy: this repository is the active runtime authority. Legacy configs in `~/.codex` and `~/.claude` are reference material only.

## Layout
- `settings.json`: versioned runtime settings
- `skills/`: local skills (symlinked into runtime)
- `extensions/`: local extensions (symlinked into runtime)
- `agents/`: subagent definitions (symlinked into runtime)
- `prompts/`: prompt templates (symlinked into runtime)
- `themes/`: themes (symlinked into runtime)
- `docs/`: provider docs and policy
- `scripts/`: bootstrap/sync scripts and test helpers

## Included Runtime Extensions
- `extensions/web-search`: `web_search` tool + `/web*` commands
- `extensions/guardrails`: irreversible-command blocks + post-edit checks + PR metadata lint/fix + governance trend logging
- `extensions/profiles`: `/profile` modes (`ultrathink`, `execute`, `ship`, `fast`)
- `extensions/organic-workflows`: code-enforced `/squash-merge` + high/critical review finding merge gate + local-first QMD memory ingest/search
- `extensions/subagent`: `subagent` delegation tool (single, parallel, chain) with user/project agent scopes

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

## Included Delegation Tooling
- `subagent` tool (from `extensions/subagent`)
- default agent profiles in `agents/` (`scout`, `planner`, `worker`, `reviewer`)

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

## Extension Tests (lightweight harness)
```bash
./scripts/test-extensions.sh
```

See `docs/pi-extension-testing.md` for testing guidelines.

## Settings Sync
```bash
./scripts/sync-settings.sh pull   # runtime -> repo
./scripts/sync-settings.sh push   # repo -> runtime
```
