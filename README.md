# pi-agent-config

Versioned config for PI agent runtime (`~/.pi/agent`).

Backlog of record: [`BACKLOG.md`](./BACKLOG.md) (GitHub Issues retired for this repo).

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
- `extensions/orchestration`: `/team` + `/pipeline` execution over declarative `agents/teams.yaml` and `agents/pipelines.yaml` with live dashboard UI + adaptive governor guardrails
- `extensions/visibility`: runtime visibility instrumentation (single-row footer + optional widget + NDJSON logs)
- `extensions/daybook`: charisma-first one-on-one journaling posture with tone controls
- `extensions/bootstrap`: intelligent `/bootstrap-repo` primitive (autonomous multi-lane exploration + synthesis) for repo-local `.pi/` foundations

## Included Skills
- `skills/web-search`: retrieval-first web research workflow and output contract
- `skills/organic-reflection`: usage-driven codification and tradeoff-scored improvement planning
- `skills/pr-feedback`: GH CLI-first PR feedback triage, fix/commit loop, and reviewer reply templates
- `skills/github-cli-hygiene`: safe GitHub CLI write patterns (`--body-file/-F`) + post-write lint checklist
- `skills/pr-polish`: final post-review polish pass (refactor, quality gates, docs, reliability) before merge
- `skills/prompt-context-engineering`: latency-first prompt/context design patterns for production agents
- `skills/llm-communication`: goal-oriented prompt/agent instruction patterns
- `skills/skill-builder`: proactive extraction of reusable workflows into skills
- `skills/agentic-bootstrap`: synthesis-first repository bootstrap design patterns (model routing + success-criteria-driven artifacts)

## Included Workflow Prompts
- `/execute`
- `/spec`
- `/architect`
- `/pr`
- `/respond`
- `/ship-branch`
- `/polish`
- `/fix-ci`
- `/groom`
- `/autopilot`
- `/reflect`
- `/daybook`
- `/bootstrap-plan`

## Included Workflow Commands (extension-backed)
- `/squash-merge`
- `/memory-ingest`
- `/memory-search`
- `/memory-context`
- `/pr-lint`
- `/pr-trends`
- `/review-policy`
- `/teams`, `/team`
- `/pipelines`, `/pipeline`
- `/visibility`, `/visibility-reset`
- `/daybook-tone`, `/daybook-kickoff`
- `/bootstrap-repo`

## Included Delegation Tooling
- `subagent` tool (from `extensions/subagent`)
- orchestration commands/tools: `/team`, `/pipeline`, `team_run`, `pipeline_run`
- default agent profiles in `agents/` (`scout`, `planner`, `plan-reviewer`, `worker`, `reviewer`, `red-team`, `documenter`, plus meta-domain experts)
- team and pipeline data in `agents/teams.yaml` + `agents/pipelines.yaml`

## Setup
```bash
./scripts/bootstrap.sh
```

## Discovery Hygiene Defaults
- Home-level `CLAUDE.md` is retired (avoid broad machine context bleed into every repo).
- Global `~/.agents/skills/*` auto-discovery is disabled by default via `settings.json`.
- Keep global runtime focused; opt into extra skills per repository via `.pi/settings.json`.

Example opt-in for a repo that needs home `.agents` skills (adjust paths for your machine):
```json
{
  "skills": [
    "+/Users/phaedrus/.agents/skills/agent-browser",
    "+/Users/phaedrus/.agents/skills/beautiful-mermaid"
  ]
}
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
pictl build
pictl autopilot
pictl research
pictl daybook
```

Default policy:
- In `pi-agent-config`, start with `pictl meta`.
- Switch targets only when task intent is explicit.

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
- `docs/discovery-hygiene.md`
- `docs/control-plane-smoke-check.md`
- `docs/capability-slicing.md`
- `docs/repo-bootstrap-workflow.md`
- `docs/orchestration-playbook.md`
- `docs/adaptive-orchestration-governor-v1.md`
- `docs/primitives-cookbook.md`
- `docs/daybook-model-evaluation.md`
- `docs/workflow-first-slice-design.md`
- `docs/autopilot-pipeline.md`
- `docs/autopilot-flywheel.md`
- `docs/prospecting-flywheel.md`
- `docs/session-handoff-2026-02-24.md`

Optional (QMD local-memory workflow):
```bash
./scripts/setup-qmd.sh
/memory-ingest --scope both --force
/memory-search --scope local "current repo conventions"
/memory-context --scope both "active task + likely failure modes"
```

## Required Env
See `.env.example`, `docs/provider-config.md`, `docs/pr-governance.md`, and `docs/reviewer-policy-matrix.md`.

Core retrieval keys:
- `CONTEXT7_API_KEY` (docs)
- `EXA_API_KEY` (primary retrieval)
- `BRAVE_API_KEY` (fallback retrieval)
- `PERPLEXITY_API_KEY` (optional synthesis)

Optional local-memory knobs (QMD):
- `PI_MEMORY_GLOBAL_COLLECTION` (default: `pi-memory`)
- `PI_MEMORY_QMD_COLLECTION` (legacy alias for global collection)
- `PI_MEMORY_LOCAL_COLLECTION` (optional explicit local collection name/template)
- `PI_MEMORY_LOCAL_COLLECTION_TEMPLATE` (default: `pi-memory-local-{repo}`)
- `PI_MEMORY_CORPUS_DIR` (default: `~/.pi/agent/cache/memory-corpus`)
- `PI_MEMORY_SESSION_LIMIT` (default: `40`)
- `PI_MEMORY_LOCAL_SESSION_LIMIT` (default: `80`)
- `PI_MEMORY_MAX_CHARS_PER_SESSION`
- `PI_MEMORY_SYNC_TTL_MS`
- `PI_MEMORY_LOCAL_PRIORITY_BOOST` (default: `0.15`)

Optional orchestration governor knobs:
- `PI_ORCH_GOV_MODE` (`observe|warn|enforce`, default: `warn`)
- `PI_ORCH_GOV_CHECK_SECONDS` (default: `75`)
- `PI_ORCH_GOV_WINDOW_SECONDS` (default: `180`)
- `PI_ORCH_GOV_EMERGENCY_FUSE_SECONDS` (default: `14400`)
- `PI_ORCH_GOV_MAX_COST_USD` (optional)
- `PI_ORCH_GOV_MAX_TOKENS` (optional)

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
