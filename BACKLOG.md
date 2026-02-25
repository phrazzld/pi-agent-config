# BACKLOG.md

Canonical backlog for `pi-agent-config`.

> As of 2026-02-24, GitHub Issues are being retired for this repository and work tracking is centralized here.

## North Star

Build a world-class, explicit Pi configuration system with:

1. maximum primitive visibility (status/TUI + logs),
2. explicit orchestration (skills/agents/teams/pipelines/extensions),
3. workflow-first control plane (`meta`, `build`, `autopilot`, `research`, `daybook`),
4. intelligent repo bootstrap that synthesizes repo-local `.pi` foundations.

## Session Snapshot (2026-02-24)

### Landed

- [x] External cwd-scope confirmation guard removed.
- [x] Discovery hygiene tightened (home `CLAUDE.md` retired, `~/.agents/skills` opt-in).
- [x] Visibility extension added (`/visibility`, telemetry log).
- [x] Orchestration extension added (`/teams`, `/pipelines`, `/team`, `/pipeline`, dashboard UI).
- [x] Daybook extension + slice added (charisma-first posture).
- [x] Intelligent bootstrap extension upgraded (`/bootstrap-repo` multi-lane synthesis + report).
- [x] Control plane simplified to 5 targets (`meta/build/autopilot/research/daybook`).
- [x] Orchestration now resolves repo-local `.pi/agents/{teams,pipelines}.yaml` first.

### Still Open

- [ ] Weekly rollup/aggregation over visibility telemetry NDJSON.
- [ ] Pipeline execution budgets/circuit breakers in orchestration runtime.
- [ ] Daybook model bakeoff automation (currently documented only).
- [ ] Consolidated commit pass for current large working tree.

## Restart Checklist (next session)

1. `pictl list` (confirm 5 workflow targets)
2. `pictl meta`
3. `/bootstrap-repo --domain <repo>` in each active product repository
4. Exit, relaunch per repo with `pictl build`
5. Validate local orchestration source via `/pipelines` and `/teams`

## Active Queue

### Now

- [ ] Add weekly telemetry rollup command for `~/.pi/agent/logs/primitive-usage.ndjson`.
- [ ] Add orchestration execution guards: `maxTurns`, `maxRuntimeSeconds`, retries, failure policy.
- [ ] Extend bootstrap `--max` mode with a final consensus/scoring round.
- [ ] Run bootstrap across active repos and capture deltas in per-repo notes.

### Next

- [ ] Build autonomous autopilot flywheel runner (nightly bounded backlog chewing).
- [ ] Add reflection/codification phase between every autopilot run.
- [ ] Introduce issue eligibility labels (`autopilot/ready`, `autopilot/safe`, `size/s`, `risk/low`).
- [ ] Create run ledger artifacts for each flywheel pass (inputs, outputs, learnings, config updates).

### Later

- [ ] Prospecting + outreach flywheel for SMB website/software opportunities.
- [ ] Automated business dossier + branded outreach artifact generation pipeline.
- [ ] Optional multi-tenant artifact hosting (e.g. `<target>.mistystep.io`) for demos.

## Workflow Seed A — Autonomous Autopilot Flywheel

Goal: run unattended overnight in selected repos, safely shipping eligible backlog items.

### Proposed loop

1. Select next eligible issue(s) by label + risk policy.
2. Run bounded autopilot pipeline for one issue.
3. Complete PR/review/merge workflow per policy.
4. **Mandatory reflection gate** (high-intelligence model):
   - what changed,
   - what was learned,
   - what to codify in repo-local `.pi`, global `pi-agent-config`, and backlog,
   - whether priorities should shift.
5. Apply low-risk codifications automatically; queue high-risk ones for explicit review.
6. Continue until batch/time/cost budget is exhausted.

### Rollout plan

- Stage 0: only `autopilot/safe` + `size/xs` issues, single repo, single issue/night.
- Stage 1: expand to `size/s`, two issues/night, same repo.
- Stage 2: multi-repo scheduling with per-repo budget envelopes.
- Stage 3: controlled expansion to medium complexity work.

### Hard safety rails

- max issues/night
- max runtime/night
- max cost/night
- max retries/issue
- mandatory reflection between issues
- immediate halt on repeated CI/review failures

See: `docs/autopilot-flywheel.md`

## Workflow Seed B — SMB Prospecting + Outreach Flywheel

Goal: systematically discover SMB opportunities, build high-signal tailored artifacts, and support warm outreach.

### Proposed system

1. **Prospector lane**: discover businesses with weak/no web presence.
2. **Qualification lane**: score by measurable upside and feasibility.
3. **Dossier lane**: collect public brand/offer/location/service context.
4. **Artifact lane**: generate polished on-brand demo website/software concept.
5. **Outreach lane**: draft concise personalized outreach with artifact link.
6. **CRM lane**: log outcomes, iterate heuristics.

### Suggested home

- Dedicated repo (likely `misty-step`) with:
  - prospect registry
  - reproducible scoring rubric
  - generated artifacts
  - outreach templates and logs

See: `docs/prospecting-flywheel.md`

## GitHub Issue Archive (migrated)

| GH Issue | Title | Original state @ migration | Labels | URL |
|---|---|---|---|---|
| #1 | Codify AGENTS.md cascading policy and directory-level context strategy | CLOSED | priority/p0, horizon/now, status/ready, type/foundation, type/docs, area/context, effort/s | https://github.com/phrazzld/pi-agent-config/issues/1 |
| #2 | Build Claude/Codex → Pi migration matrix and curated import shortlist | OPEN | priority/p0, horizon/now, status/ready, type/migration, type/docs, area/workflows, effort/m | https://github.com/phrazzld/pi-agent-config/issues/2 |
| #3 | Implement selective resource loading policy to prevent context bloat | OPEN | priority/p0, horizon/now, status/ready, type/foundation, type/docs, area/context, effort/m | https://github.com/phrazzld/pi-agent-config/issues/3 |
| #4 | Enable subagent extension baseline with tiered agents and safety gates | OPEN | priority/p0, horizon/now, status/ready, type/extension, area/subagents, effort/l | https://github.com/phrazzld/pi-agent-config/issues/4 |
| #5 | Define multi-provider model routing policy and bootstrap models.json | OPEN | priority/p0, horizon/now, status/ready, type/foundation, area/subagents, effort/m | https://github.com/phrazzld/pi-agent-config/issues/5 |
| #6 | Implement /autopilot as extension workflow with explicit phase state machine | OPEN | priority/p1, horizon/next, status/ready, type/extension, type/orchestrator, area/workflows, effort/l | https://github.com/phrazzld/pi-agent-config/issues/6 |
| #7 | Implement /groom as extension workflow with research swarm and issue synthesis | OPEN | priority/p1, horizon/next, status/ready, type/extension, type/orchestrator, area/workflows, effort/l | https://github.com/phrazzld/pi-agent-config/issues/7 |
| #8 | Build SDK/RPC backlog runner for bounded issue batches | OPEN | priority/p1, horizon/next, status/ready, type/orchestrator, area/workflows, effort/l | https://github.com/phrazzld/pi-agent-config/issues/8 |
| #9 | Implement usage telemetry extension and periodic keep/drop report | OPEN | priority/p1, horizon/next, status/ready, type/extension, area/telemetry, effort/m | https://github.com/phrazzld/pi-agent-config/issues/9 |
| #10 | Generate dynamic topology visualization for Pi primitives and workflows | OPEN | priority/p2, horizon/next, status/ready, type/docs, area/telemetry, effort/m | https://github.com/phrazzld/pi-agent-config/issues/10 |
| #11 | Build statusline/footer v1 and theme polish pack | OPEN | priority/p2, horizon/next, status/ready, type/ui, area/workflows, effort/m | https://github.com/phrazzld/pi-agent-config/issues/11 |
| #12 | Implement design-evolution workflow for iterative UI/UX exploration | OPEN | priority/p2, horizon/next, status/ready, type/extension, area/design, effort/l | https://github.com/phrazzld/pi-agent-config/issues/12 |
| #13 | Pilot one project-specific Pi overlay and measure impact | OPEN | priority/p2, horizon/next, status/ready, type/foundation, area/context, effort/m | https://github.com/phrazzld/pi-agent-config/issues/13 |
| #14 | Pi platform roadmap: power without chaos (structured layering + orchestration) | OPEN | priority/p0, horizon/now, status/ready, type/foundation, type/docs, area/workflows, effort/m | https://github.com/phrazzld/pi-agent-config/issues/14 |

Notes:
- Original issue descriptions remain in GitHub history.
- New planning happens in this file going forward.
- If needed later, selected backlog items can be re-opened as GitHub issues for external collaboration.
- All formerly open issues (#2-#14) were closed during migration to this file.
