# pi-agent-config

Versioned config for PI agent runtime (`~/.pi/agent`).

> Source-of-truth policy: this repository is the active runtime authority. Legacy configs in `~/.codex` and `~/.claude` are reference material only.

## Layout
- `settings.json`: versioned runtime settings
- `skills/`: local skills (symlinked into runtime)
- `extensions/`: local extensions (symlinked into runtime)
- `agents/`: subagent definitions + team/pipeline config data
- `prompts/`: prompt templates (symlinked into runtime)
- `themes/`: themes (symlinked into runtime)
- `slices/`: capability slice manifests for narrow runtime composition
- `docs/`: provider docs and policy
- `scripts/`: bootstrap/sync scripts and test helpers

## Included Runtime Extensions
- `extensions/web-search`: `web_search` tool + `/web*` commands
- `extensions/guardrails`: irreversible-command blocks + post-edit checks + PR metadata lint/fix + governance trend logging
- `extensions/profiles`: `/profile` modes (`meta/ultrathink`, `execute`, `ship`, `fast`)
- `extensions/organic-workflows`: code-enforced `/squash-merge` + high/critical review finding merge gate + local-first QMD memory ingest/search
- `extensions/subagent`: `subagent` delegation tool (single, parallel, chain) with user/project agent scopes

## Included Skills
- `skills/web-search`: retrieval-first web research workflow and output contract
- `skills/organic-reflection`: usage-driven codification and tradeoff-scored improvement planning
- `skills/pr-feedback`: GH CLI-first PR feedback triage, fix/commit loop, and reviewer reply templates
- `skills/github-cli-hygiene`: safe GitHub CLI write patterns (`--body-file/-F`) + post-write lint checklist
- `skills/pr-polish`: final post-review polish pass (refactor, quality gates, docs, reliability) before merge

## Included Workflow Prompts
- `/execute`
- `/spec`
- `/architect`
- `/pr`
- `/respond`
- `/polish`
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
- default agent profiles in `agents/` (`scout`, `planner`, `plan-reviewer`, `worker`, `reviewer`, `red-team`, `documenter`)
- team and pipeline data in `agents/teams.yaml` + `agents/pipelines.yaml`

## Setup
```bash
./scripts/bootstrap.sh
```

## Control Plane (avoid agent zoo)

Install the Go control-plane binary (no bash wrapper):

```bash
go install ./cmd/pictl
```

If your Go bin dir is not on PATH, add it (zsh example):

```bash
export PATH="$(go env GOPATH)/bin:$PATH"
```

Primary workflow launcher:

```bash
pictl
pictl list
pictl meta
pictl delivery
pictl autopilot
```

Slice launcher (low-level):

```bash
pictl slices
pictl slice pi-dev --profile meta
pictl slice research --profile meta
pictl slice --strict research --profile meta
```

One-off without install:

```bash
go run ./cmd/pictl meta
```

See:
- `docs/control-plane.md`
- `docs/capability-slicing.md`
- `docs/orchestration-playbook.md`
- `docs/autopilot-pipeline.md`

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
