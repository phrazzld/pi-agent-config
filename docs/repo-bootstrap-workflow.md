# Repository Bootstrap Workflow (Meta-first)

Use this when onboarding a new repo into Pi.

## Bootstrap primitive

- **`/bootstrap-repo`** is the single bootstrap primitive.
- It is intentionally opinionated: always plans, always runs ambition pass, then applies.

No separate plan-only command is required for normal workflow.

## Recommended pattern

1. Launch meta control plane in the target repo:
   ```bash
   cd /path/to/repo
   pictl meta
   ```

2. Run bootstrap:
   ```text
   /bootstrap-repo --domain <repo-domain>
   ```
   - Executes multi-lane reconnaissance
   - Runs a mandatory ambition checkpoint
   - Synthesizes + writes repo-local `.pi` settings/agents/prompts/pipelines/workflow docs

3. Prime local-first memory immediately:
   ```text
   /memory-ingest --scope both --force
   ```
   - Builds repo-local + global corpora and registers collections.

4. Exit meta session, then relaunch with repo-focused slice:
   ```bash
   pictl build
   ```

## Success criteria for a good bootstrap

- Foundation is clearly repo-specific, not generic scaffolding.
- Local config is explicit and auditable (narrow opt-ins).
- Workflows support explore -> design -> implement -> review.
- Prompts/agents are goal-oriented, not brittle procedural scripts.
- Ambition checkpoint yields one accretive high-leverage addition with explicit validation.
- Memory workflow is codified (`/memory-ingest`, `/memory-search`, `/memory-context`) rather than ad hoc.

## Rule of thumb

- **Global (`pi-agent-config`)**: reusable primitives and defaults.
- **Repo-local (`<repo>/.pi`)**: domain overlays and explicit opt-ins.
