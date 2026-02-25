---
description: Bootstrap repo-local Pi config from meta mode
---
Bootstrap this repository for focused Pi workflows.

Deliverables:
1. `.pi/settings.json` with explicit skill/extension opt-ins only
2. `.pi/agents/` with domain-specific overlays (planner/worker/reviewer minimum)
3. optional `.pi/prompts/` workflow prompts for this repo
4. short `docs/pi-local-workflow.md` describing how to run (`pictl build` or local slice)

Constraints:
- Keep global config unchanged unless explicitly required.
- Prefer small, auditable local config over broad discovery.
- Explain every local artifact added and why.
