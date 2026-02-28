# Autopilot Pipelines (v1 + v2)

## Objective

Ship one issue from intake to merge readiness with explicit checkpoints, bounded loops, and clear escalation paths.

## Pipeline routing

- `autopilot-v1` (existing): general bounded issue-to-PR flow using core agents.
- `autopilot-issue-v2` (new): distinct phase agents/models with a built-in verifier fix loop before PR composition.

Use v2 when you want stronger phase separation and deterministic handoffs.

## v2 phase map (`autopilot-issue-v2`)

1. **Intake (autopilot-intake / gemini flash)**
   - Select one issue and produce intake packet.
2. **Spec contract (autopilot-spec / claude sonnet)**
   - Convert intake into scoped acceptance/test/rollback contract.
3. **Design critic (autopilot-design-critic / gemini pro)**
   - Pressure-test sequencing and hidden coupling.
   - **Checkpoint:** after-intake-spec / before-build.
4. **Implementation pass (autopilot-implementer / gpt-5.3-codex)**
   - Execute minimal diffs and run relevant checks.
5. **Verifier gate (autopilot-verifier / claude sonnet)**
   - Severity-classified PASS/FAIL.
6. **Fix loop (bounded, one built-in iteration)**
   - implementer fixes critical/high blockers only.
   - verifier re-checks final gate.
7. **PR composition (autopilot-pr-composer / gpt-5.3-codex)**
   - Create/update PR via `--body-file`, verify formatting, include concise evidence.
   - **Checkpoint:** before-pr.
8. **Merge gate (human authorization)**
   - **Checkpoint:** before-merge.

## Circuit breakers (applies to v1 and v2)

- max fix/review loops
- max wall-clock budget
- max token/cost budget
- auto-escalate to human when breaker trips

## Why v2 is a skeleton

`autopilot-issue-v2` is intentionally minimal and reversible:
- codifies phase boundaries now
- keeps loops bounded
- allows model/agent tuning without rewriting the flow
