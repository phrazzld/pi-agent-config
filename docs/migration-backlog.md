# Pi Migration Backlog

Built from `PLAN.md` to keep scope lean and reversible.

## Keep / Drop / Later Matrix

| Asset/Pattern | Decision | Why |
|---|---|---|
| `skills/web-search` retrieval core | Keep | Already aligned with retrieval-first model. |
| Web provider docs/config (`docs/provider-config.md`) | Keep | Single source of provider policy and hard rules. |
| Read-only research prompt (`prompts/research-mode.md`) | Keep | Useful mode primitive for investigation turns. |
| Ad-hoc one-off orchestration from Claude/Codex | Drop | Too much sprawl, weak repeatability. |
| Broad hook parity from legacy stack | Drop (for now) | High complexity; keep only high-value guardrails. |
| Full subagent/multi-agent parity | Later | Optional, only after daily-driver baseline stable. |
| Extra workflow commands beyond top 8 | Later | Keep command surface narrow until usage proves need. |

## Prioritized Backlog

1. P0 done: Web retrieval as first-class Pi extension tool (`web_search`) with provider routing, cache, logs, recency, and uncertainty metadata.
2. P0 done: Guardrails extension for destructive bash and protected-path edit/write blocks.
3. P0 done: Thin workflow parity via prompt templates (`execute`, `spec`, `architect`, `pr`, `respond`, `polish`, `fix-ci`, `groom`, `autopilot`).
4. P1 done: Profile modes extension (`ultrathink`, `execute`, `ship`, `fast`).
5. P1 done: Capability slicing control plane (`pictl`) + slice manifests (`slices/*.json`) for narrow runtime composition.
6. P1 in progress: Teams/pipelines as config data (`agents/teams.yaml`, `agents/pipelines.yaml`) with manual orchestration via `subagent`.
7. P1 pending: Add optional orchestrator extension that executes team/pipeline configs directly.
8. P1 pending: Add extension-level metrics rollup (counts, latency, cache hit rate) for weekly review.

## Exit Criteria

- Daily use can run with Pi-native commands/tooling for retrieval, guardrails, workflow prompts, and mode selection.
- No mandatory dependency on Claude/Codex-only hooks for normal execution.
- Backlog remains small; new additions require explicit usage signal.
