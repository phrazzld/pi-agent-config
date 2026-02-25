# Orchestration resilience options (2026-02-25)

Status: proposed design analysis  
Decision companion: `docs/adr/ADR-0001-orchestration-admission-control.md`

## Problem statement

Current orchestration can admit work faster than the host can safely execute it:
- repeated `team_run` calls
- per-agent `spawn("pi", ...)` execution
- no host-global orchestration admission cap
- no orchestration-level fail-closed circuit breaker

Observed blast pattern on 2026-02-25:
- `team_run` calls: `157` with only `8` results in a 10-minute window
- `session_start`: `440`, `agent_start`: `435`, `agent_end`: `6`
- `node` process count peaked at `600+` and triggered host instability/reboot

## Design constraints

- Robust: prevent process storms by construction
- Simple: low operator burden on a single-host local runtime
- Maintainable: minimal hidden control paths
- Extensible: support future quotas (cost/tokens/priority)
- Pi-native: build on existing extension, slice, and control-plane patterns

## Option 1: Global admission control + fail-closed circuit breaker

### Architecture

Add a host-global orchestration admission controller in `extensions/orchestration`:
- gate `team_run`, `pipeline_run`, and orchestration-use of `subagent`
- enforce global in-flight token budget
- enforce recursion-depth guard (`PI_ORCH_DEPTH`)
- fail closed when `ops-watchdog` is `critical`

### Why this is Pi-native

- Extends existing orchestration and watchdog extensions.
- Uses existing telemetry streams and policy knobs.
- Avoids introducing an external daemon/queue as a first step.

### Pros

- Strong immediate risk reduction
- Lowest migration complexity
- Preserves current developer workflow and command surface

### Cons

- Still uses per-task process spawning
- Requires careful token release and error-path handling
- Less robust than a true worker-pool architecture at very high scale

## Option 2: Fixed worker pool + queue supervisor

### Architecture

Replace spawn-per-task with a bounded worker pool managed by control plane:
- orchestration tools enqueue tasks
- fixed number of long-lived workers execute tasks
- backpressure via queue depth limits

### Why this is compelling

- Makes process storms mathematically impossible beyond worker cap.
- Separates scheduling from execution.
- Best long-term shape for large multi-agent workloads.

### Pros

- Maximum robustness
- Clear backpressure semantics
- Strong extensibility (priority queues, retries, dead-letter paths)

### Cons

- Highest migration cost
- New lifecycle/IPC complexity
- More moving pieces to operate and debug

## Option 3: Observability-driven adaptive degradation

### Architecture

Drive dynamic orchestration behavior from watchdog telemetry:
- normal mode: current behavior
- warn mode: reduce team concurrency and fan-out
- critical mode: reject new orchestration work and ask for synthesis-only output

### Why this is compelling

- Fast to add on top of existing telemetry.
- Improves behavior under pressure without full re-architecture.

### Pros

- Low-to-medium implementation effort
- Good operator visibility
- Useful companion to either Option 1 or Option 2

### Cons

- Reactive by nature
- Susceptible to detection lag and oscillation
- Does not fully eliminate spawn-amplification risk by itself

## Comparison matrix

| Dimension | Option 1: Admission + breaker | Option 2: Worker pool + queue | Option 3: Adaptive degradation |
|---|---|---|---|
| Robustness | High | Very high | Medium |
| Simplicity | High | Low | Medium-high |
| Maintainability | High | Medium | High |
| Extensibility | High | Very high | High |
| Operational risk | Low | Medium | Low-medium |
| Migration cost | Low-medium | High | Low-medium |
| Pi-native fit (current stack) | Very high | Medium | High |

## Multi-model investigation summary

Source: thinktank run in `jovial-sliding-butter/`.

- `gpt-5.2`, `grok-4.1-fast`, `moonshotai-kimi-k2.5`: favor Option 1
- `gemini-3.1-pro`, `minimax-m2.5`: favor Option 2
- `deepseek-v3.2`: favors a circuit-breaker-first adaptive pattern
- `gemini-3.1-pro-synthesis`: favors Option 2 long-term, Option 1 immediate

Interpretation:
- consensus on root cause and required controls
- split on sequencing vs destination
- no model advocated leaving current architecture unchanged

## Recommendation

Best option for this repo now: **Option 1 (global admission control + fail-closed circuit breaker)**.

Why:
- Strongest robustness/simplicity balance for a local Pi runtime.
- Minimal change surface to deliver immediate safety.
- Aligns with Pi-native extension architecture and current tooling.
- Keeps a clean migration path to Option 2 if load characteristics justify it.

Recommended sequence:
1. Ship Option 1 immediately (P0 reliability guardrail).
2. Add targeted Option 3 degradation behavior as a policy layer.
3. Build Option 2 only if empirical triggers are met (see ADR).

## Research grounding

External best-practice references consulted on 2026-02-25:

- OpenAI: practical guide to building agents  
  https://openai.com/business/guides-and-resources/a-practical-guide-to-building-agents
- OpenAI Agents JS docs (multi-agent patterns)  
  https://openai.github.io/openai-agents-js/guides/multi-agent/
- Anthropic: building effective agents  
  https://www.anthropic.com/engineering/building-effective-agents
- Anthropic: multi-agent research system  
  https://www.anthropic.com/engineering/multi-agent-research-system
- Anthropic Claude Code subagents docs  
  https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Kubernetes API Priority and Fairness  
  https://kubernetes.io/docs/concepts/cluster-administration/flow-control/
- Temporal docs (task queues and workers)  
  https://docs.temporal.io/workers

Local Pi sources:
- `docs/control-plane.md`
- `docs/orchestration-playbook.md`
- `docs/adaptive-orchestration-governor-v1.md`
- `docs/incidents/2026-02-25-memory-runaway.md`
- `extensions/orchestration/index.ts`
- `extensions/ops-watchdog/index.ts`
- `extensions/guardrails/policy.ts`
