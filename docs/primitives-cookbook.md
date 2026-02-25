# Primitives Cookbook (Examples by Composition)

Purpose: provide at least one concrete, reusable example for each major Pi primitive in this config.

## Slices

- **Meta slice**: `slices/pi-dev.json`
  - max visibility + orchestration + subagent + web research
- **Software slice**: `slices/software.json`
  - generic product engineering default for app repos
- **Daybook slice**: `slices/daybook.json`
  - charisma-first one-on-one journaling

## Agents

- Core delivery specialists: `agents/scout.md`, `agents/planner.md`, `agents/worker.md`, `agents/reviewer.md`
- Meta council specialists: `agents/meta-*.md`

## Teams (declarative)

- `agents/teams.yaml`
  - `core`, `delivery`, `autopilot`, `meta-council`

Run example:
```bash
/team meta-council "Improve Pi extension architecture and observability"
```

## Pipelines (declarative)

- `agents/pipelines.yaml`
  - `plan-build-review`
  - `software-delivery-v1`
  - `meta-council-v1`
  - `autopilot-v1`

Run example:
```bash
/pipeline software-delivery-v1 "Implement feature X"
```

## Orchestration UI

- Extension: `extensions/orchestration/index.ts`
- Shows team cards + pipeline graph in a live widget
- Includes adaptive governor controls (`observe|warn|enforce`) for long-running subagent safety

## Primitive visibility instrumentation

- Extension: `extensions/visibility/index.ts`
- Commands:
  - `/visibility`
  - `/visibility-reset`
- End-of-run summary support is available (disabled by default)
- Logs: `~/.pi/agent/logs/primitive-usage.ndjson`

## Daybook posture

- Extension: `extensions/daybook/index.ts`
- Prompt template: `prompts/daybook.md`
- Commands:
  - `/daybook-tone`
  - `/daybook-kickoff`

## Bootstrap pattern (meta -> repo-local)

- Doc: `docs/repo-bootstrap-workflow.md`
- Use sequence:
  1. `/bootstrap-repo --domain <repo-domain>` (opinionated plan + ambition + apply)
  2. `/memory-ingest --scope both --force` (prime local-first memory)
  3. switch to repo execution profile (`pictl build`)

## Bootstrap primitive

- Extension command: `/bootstrap-repo` (from `extensions/bootstrap`)
- Tool: `bootstrap_repo`
- Default mode is opinionated: always multi-lane exploration + ambition pass + synthesis
- Legacy `--quick` / `--max` toggles are ignored for simplicity

## Memory primitives

- Extension: `extensions/organic-workflows/index.ts`
- Tools:
  - `memory_ingest`
  - `memory_search`
  - `memory_context`
- Commands:
  - `/memory-ingest`
  - `/memory-search`
  - `/memory-context`
- Scope model:
  - `local` = repo-scoped memory
  - `global` = cross-repo memory
  - `both` = local-first + global fallback
