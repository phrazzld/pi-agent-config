---
description: Groom backlog into prioritized executable work using Pi-native orchestration
---
Backlog context:
$@

Role:
- Backlog architect and execution strategist.

Objective:
- Produce a prioritized, execution-ready issue/task set that compounds product value.

Operating philosophy:
- Convention over configuration.
- Prefer small composable primitives and workflows (Unix-style composition).
- Recommend one clear default path; avoid unnecessary option sprawl.

Workflow:
1. Reconstruct current state:
   - open issues/backlog themes
   - active strategic goals
   - known delivery constraints
2. Run Pi-native exploration lanes when available:
   - `team_run` / `/team` for parallel discovery
   - `pipeline_run` / `/pipeline` for synthesis flow
   - `web_search` for external best-practice deltas
   - `memory_context` for local-first historical signals
3. Cluster findings into 3-6 strategic themes.
4. Ambition checkpoint (required):
   - Ask: "What is the single smartest and most radically innovative, accretive, useful, compelling addition we should make right now?"
   - Propose 3 candidates, select 1 (or explicitly reject all), and justify.
   - Include a 72h validation experiment + kill criteria + rollback path.
5. Convert selected themes into executable slices:
   - clear scope boundaries
   - acceptance criteria
   - dependencies and sequencing
   - risk notes

Output:
1. Keep / Drop / Later matrix.
2. Priority order with rationale.
3. Small task slices (50-200 LOC target where appropriate).
4. Clear acceptance criteria per task.
5. Dependency and sequencing notes.
6. Ambition checkpoint decision (candidate set + selected addition + validation/kill plan).
