# Opinionated Pi Framework Roadmap (v0)

Status: draft proposal  
Owner: `pi-agent-config` maintainers

## Why

Pi core is intentionally bare-bones and highly composable. That flexibility is powerful but exposes sharp edges under heavy orchestration and multi-workspace load. This repo should evolve into a stable, opinionated framework layer on top of Pi core.

Analogy targets:
- `oh-my-zsh` for shell ergonomics
- `NvChad` for opinionated Neovim defaults

## Design principles

1. **Safety by default**: bounded orchestration, bounded logs, explicit fail-closed behavior.
2. **Small explicit primitives**: Unix-style composition with observable boundaries.
3. **Workflow-first UX**: stable launch targets (`pictl meta/build/autopilot/research/daybook/ops`).
4. **Composable packs**: capability slices as first-class bundles, not ad-hoc extension sprawl.
5. **Predictable upgrades**: versioned contracts and migration guides.

## Layered architecture

### Layer 0 — Pi core (upstream)
- model/runtime/tool primitives
- extension loading and event bus

### Layer 1 — Framework baseline (this repo)
- global guardrails + profile policy
- orchestration admission and telemetry
- default workflow slices and control-plane targets

### Layer 2 — Domain overlays (repo-local `.pi/`)
- product/repo-specific skills, prompts, agents
- targeted settings/model overrides

## v1 deliverables

1. **Framework manifest/versioning**
   - `framework.json` with semantic version and compatibility matrix
   - explicit minimum Pi runtime version

2. **Stability envelope**
   - admission caps and breaker policy defaults
   - watchdog thresholds + enforcement profile guidance
   - log-retention defaults for all high-volume logs

3. **Extension quality contract**
   - required knobs: timeout, concurrency bound, fail-mode, telemetry budget
   - test contract: happy path + failure path + bounded resource test

4. **Operational runbooks**
   - host incident playbook
   - orchestration failure triage playbook
   - launchd watchdog install/verify/uninstall runbook

5. **Bootstrap ergonomics**
   - one-command machine bootstrap (`scripts/bootstrap.sh` + checks)
   - one-command repo bootstrap (`/bootstrap-repo` with framework-aware presets)

## Success metrics

- Zero host crashes from orchestration fan-out in 30-day rolling window.
- P95 orchestration denial latency under critical pressure <200ms.
- NDJSON logs remain within configured retention bounds without manual cleanup.
- New extension PRs include stability contract + tests by default.

## Sequencing

### Phase 1 (now)
- ship admission + watchdog + handoff + bounded logs
- stabilize via soak tests and threshold tuning

### Phase 2 (next)
- add idempotency/dedup and stronger CI stress harnesses
- standardize extension contract checklist

### Phase 3 (later)
- evaluate worker-pool/queue runtime trigger points
- introduce framework versioning and compatibility checks
