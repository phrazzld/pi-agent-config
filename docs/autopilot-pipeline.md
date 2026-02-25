# Autopilot Pipeline (v1, bounded)

## Objective

Ship one issue from intake to merge readiness with explicit human checkpoints and bounded automation loops.

## Phase map

1. **Issue intake (cheap model, scout/planner)**
   - Select highest-priority issue.
   - Produce acceptance criteria + constraints packet.
   - **Checkpoint:** human GO before implementation.

2. **Implementation (workhorse model, worker)**
   - Execute spec with focused scope.
   - Run verification.

3. **Blocking review (reviewer council, bounded)**
   - Correctness pass
   - Safety/risk pass
   - Test adequacy pass
   - Consolidate must-fix findings.

4. **PR prep (cheap/workhorse model)**
   - Title/body via `--body-file` path.
   - `Closes #N`, verification summary, residual risk.
   - `/pr-lint` pass.
   - **Checkpoint:** human GO before publishing/finalizing PR state.

5. **CI + review response loop (bounded)**
   - Address CI failures and meaningful review comments.
   - Stop when required checks are green and blocking findings resolved.
   - Hard cap retries; escalate when exceeded.

6. **Polish (conditional, not always-on)**
   - Refactor/docs/quality-gate improvements when low-risk and high-value.
   - Re-run required checks after any polish changes.

7. **Merge gate**
   - Fresh required checks green after final commit.
   - No unresolved critical/high findings unless explicitly deferred with rationale + follow-up issue.
   - `/squash-merge` path only.
   - **Checkpoint:** explicit human authorization before merge.

## Circuit breakers

- Max CI/review fix loops per PR
- Max wall-clock budget
- Max token/cost budget
- Auto-escalate to human when any breaker trips

## Why this is v1

This keeps the strategic shape (specialization + phased orchestration) while limiting complexity and runaway cost.
