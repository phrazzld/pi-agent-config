# BACKLOG.md

Canonical backlog for `pi-agent-config`.

> As of 2026-02-24, GitHub Issues are being retired for this repository and work tracking is centralized here.

## North Star

Build a world-class, explicit Pi configuration system with:

1. maximum primitive visibility (status/TUI + logs),
2. explicit orchestration (skills/agents/teams/pipelines/extensions),
3. workflow-first control plane kernels (`meta`, `build`, `daybook`, `ops`) with capability overlays (autopilot/research),
4. intelligent repo bootstrap that synthesizes repo-local `.pi` foundations.

## Session Snapshot (2026-02-25)

### Landed

- [x] External cwd-scope confirmation guard removed.
- [x] Discovery hygiene tightened (home `CLAUDE.md` retired, `~/.agents/skills` opt-in).
- [x] Visibility extension added (`/visibility`, telemetry log).
- [x] Orchestration extension added (`/teams`, `/pipelines`, `/team`, `/pipeline`, dashboard UI).
- [x] Daybook extension + slice added (charisma-first posture).
- [x] Intelligent bootstrap extension upgraded (`/bootstrap-repo` multi-lane synthesis + report).
- [x] Control plane simplified to 4 kernel targets (`meta/build/daybook/ops`) with capability overlays for autopilot/research.
- [x] Orchestration now resolves repo-local `.pi/agents/{teams,pipelines}.yaml` first.
- [x] Adaptive orchestration governor v1 shipped (progress scoring + observe/warn/enforce + loop/retry/budget/fuse tripwires).
- [x] Sysadmin reliability stack shipped: `handoff`, `ops-watchdog`, `sysadmin` slice, and `pictl ops` target.
- [x] Orchestration admission control shipped (run/slot/depth caps + fail-closed breaker + runtime status commands).
- [x] Nested non-interactive `pi` recursion blocked by guardrails by default.
- [x] Log-growth controls shipped: bounded NDJSON rotation for watchdog/handoff/admission/visibility/governance/web-search.
- [x] Host watchdog automation scripts landed (LaunchAgent installer + rotating log retention).

### Still Open

- [ ] Soak-test admission controller and tune rejection thresholds from real telemetry.
- [ ] Add orchestration idempotency/dedup guard for repeated identical requests.
- [ ] Tighten governor defaults (`enforce` where justified) with lower-latency checks for runaway detection.
- [ ] Add weekly telemetry rollup/aggregation over bounded NDJSON logs.
- [ ] Define and ship an opinionated Pi framework layer (stable defaults + extension contracts + upgrade lane).
- [x] Replace blunt delegated-agent kill switches with progress-health polling and stall-aware recovery (orchestration + bootstrap + subagent lanes).

## Restart Checklist (next session)

1. `pictl list` (confirm kernel targets: `meta`, `build`, `daybook`, `ops`)
2. `pictl meta`
3. `/bootstrap-repo --domain <repo>` in each active product repository
4. Exit, relaunch per repo with `pictl build`
5. Validate local orchestration source via `/pipelines` and `/teams`

## Active Queue

### Now

- [x] Complete execution-engine unification by extracting shared `extensions/shared/delegation-runner.ts` across subagent/orchestration/bootstrap (common spawn lifecycle + health envelope).
- [x] Add delegated-run recovery policy hooks (retry-once/quorum/degraded completion) on top of shared delegation-runner.
- [ ] Run 24h mixed-workload soak with admission state + breaker telemetry review.
- [x] Ship repeatable soak tooling (`scripts/soak/*`, analyzer, playbook) and validate via smoke run.
- [x] Add idempotency key + dedup in orchestration admission path.
- [x] Add CI stress scenario for recursive `team_run`/`pipeline_run` fan-out beyond unit harness.
- [x] Add top-level-only telemetry mode for heavy extensions during delegated depth (`PI_ORCH_DEPTH > 0`).
- [x] Tighten bootstrap ambition checkpoint scoring and add consensus-quality validation on generated artifacts.
- [x] Ship hardening visibility baseline: runtime topology docs, generated inventory, `/visibility config`, and refactor-loop codification.

### Next

- [ ] Design an observability hardening workflow agent (headless specialist orchestrator) for logging/error-instrumentation sweeps.
- [ ] Build autonomous autopilot flywheel runner (nightly bounded backlog chewing).
- [ ] Add reflection/codification phase between every autopilot run.
- [ ] Introduce issue eligibility labels (`autopilot/ready`, `autopilot/safe`, `size/s`, `risk/low`).
- [ ] Create run ledger artifacts for each flywheel pass (inputs, outputs, learnings, config updates).

### Later

- [ ] Prospecting + outreach flywheel for SMB website/software opportunities.
- [ ] Automated business dossier + branded outreach artifact generation pipeline.
- [ ] Optional multi-tenant artifact hosting (e.g. `<target>.mistystep.io`) for demos.

## Bootstrap Flow Improvements

- [ ] **Consolidate persona into AGENTS.md**: Current bootstrap creates separate `.pi/persona.md` file. Should instead embed persona identity + operational rules directly into unified `AGENTS.md` at repo root. Persona belongs front-and-center, not hidden in dot-directory. See scry repo discussion 2026-02-27.

## External Capability Intake (agent-stuff scan 2026-02-27)

- [ ] **Adopt** `frontend-design` skill into `skills/design-taste-frontend/SKILL.md` (port + align with repo conventions).
- [ ] **Adopt (optional theme)** `nightowl` theme under `themes/` and evaluate a `rose-pine` sibling for final default recommendation.
- [ ] **Pilot** `session-breakdown` extension in `meta`/`daybook` slices only (non-default baseline) and collect usability + perf feedback.
- [ ] **Borrow patterns** from `context.ts` into existing `visibility` extension (`/visibility context` / context-window + loaded-context signals) instead of adding a duplicate extension.
- [ ] **Design optional pack** for `review` + `todos` + `prompt-editor` + `whimsical` (explicitly non-baseline) with command namespacing and safety policy.
- [ ] **Gate before adoption**: command-collision audit (`/review`, `/mode`, `/context`) + branch mutation guardrails + todo lock/GC stress tests.

## Platform Direction — Opinionated Pi Framework (proposal)

Goal: evolve `pi-agent-config` from loose config pack into a stable, opinionated framework on top of bare Pi core.

### v1 framework pillars

1. **Stable defaults**: safety-first baseline extensions, bounded orchestration, bounded logging, and explicit profiles.
2. **Composable packs**: kernel slices (`meta/build/daybook/ops`) plus capability overlays (`autopilot`, `research`).
3. **Contracted extension APIs**: small, documented extension contracts with runtime invariants and smoke tests.
4. **Operational UX**: one-command launch (`pictl <target>`), clear status commands, and failure-mode playbooks.
5. **Upgrade lane**: predictable migration path for settings/slices/extensions across versions.

### Candidate deliverables

- framework manifest/version stamp (`framework.json`) with compatibility checks
- opinionated "distribution" docs and bootstrap command for new machines/repos
- stability test matrix (admission, watchdog, nested orchestration, log retention)
- extension quality bar checklist (timeouts, bounded concurrency, telemetry budget)

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
