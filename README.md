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
- `extensions/guardrails`: irreversible-command blocks + post-edit checks
- `extensions/profiles`: `/profile` modes (`ultrathink`, `execute`, `ship`, `fast`)

## Included Workflow Prompts
- `/execute`
- `/spec`
- `/architect`
- `/pr`
- `/respond`
- `/fix-ci`
- `/groom`
- `/autopilot`

## Setup
```bash
./scripts/bootstrap.sh
```

## Required Env
See `.env.example` and `docs/provider-config.md`.

Core retrieval keys:
- `CONTEXT7_API_KEY` (docs)
- `EXA_API_KEY` (primary retrieval)
- `BRAVE_API_KEY` (fallback retrieval)
- `PERPLEXITY_API_KEY` (optional synthesis)

## Settings Sync
```bash
./scripts/sync-settings.sh pull   # runtime -> repo
./scripts/sync-settings.sh push   # repo -> runtime
```
