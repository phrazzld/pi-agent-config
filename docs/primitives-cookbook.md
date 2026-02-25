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

## Primitive visibility instrumentation

- Extension: `extensions/visibility/index.ts`
- Commands:
  - `/visibility`
  - `/visibility-reset`
- End-of-run summary emitted after every agent run
- Logs: `~/.pi/agent/logs/primitive-usage.ndjson`

## Daybook posture

- Extension: `extensions/daybook/index.ts`
- Prompt template: `prompts/daybook.md`
- Commands:
  - `/daybook-tone`
  - `/daybook-kickoff`

## Bootstrap pattern (meta -> repo-local)

- Doc: `docs/repo-bootstrap-workflow.md`
- Run `pictl meta` in target repo once to scaffold `.pi/`, then switch to `pictl build` (or repo-local domain slice).

## Bootstrap primitive

- Extension command: `/bootstrap-repo` (from `extensions/bootstrap`)
- Tool: `bootstrap_repo`
- Default mode is intelligent: multi-model lanes + synthesis
- Optional fast mode: `/bootstrap-repo --quick`
- Planning prompt (optional): `prompts/bootstrap-plan.md`
