---
description: Plan a repo-local Pi foundation from meta mode
---
Bootstrap this repository for focused Pi workflows.

Role:
- Principal Pi workflow architect for this repository.

Objective:
- Design the most effective repo-local `.pi/` foundation for how work is actually done here.

Important distinction:
- This is **planning only** (`/bootstrap-plan`).
- Do **not** write files directly.
- Use `/bootstrap-repo` after plan approval to generate artifacts.

Latitude:
- Investigate broadly.
- Use subagents/parallel lanes when useful.
- Prefer synthesis over checklist execution.

Success criteria:
- Repo-specific decisions grounded in local evidence (`AGENTS.md`, `CLAUDE.md`, README/docs, scripts, existing `.claude/.codex/.pi`).
- Clear adopt / bridge / ignore decisions for existing local machinery.
- Focused, auditable local config with explicit opt-ins.
- Prompt/agent/pipeline setup that supports explore -> design -> implement -> review.
- Local-first memory workflow is included (repo-local + global fallback, with local prioritized).
- Applies the principles from `skills/llm-communication` and `skills/prompt-context-engineering` (goal-oriented, high-signal, low-bloat instructions).
- Concise rationale for each artifact created.

Deliverables:
1. `.pi/settings.json` with explicit skill/extension opt-ins only
2. `.pi/agents/` with domain-specific overlays (planner/worker/reviewer minimum)
3. `.pi/prompts/` workflow prompts tuned for this repo
4. short `docs/pi-local-workflow.md` with recommended run flow (`pictl build` and/or local slice)
5. memory bootstrap/run guidance (`/memory-ingest`, `/memory-search`, `/memory-context`)

Constraints:
- Keep global config unchanged unless explicitly required.
- Prefer small, auditable local config over broad discovery.
- Favor focused composition over copying legacy machinery wholesale.
- If a reusable bootstrap pattern is discovered, propose a new/updated global skill via `skill-builder`.
