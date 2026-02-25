# Repository Bootstrap Workflow (Meta-first)

Use this when onboarding a new repo into Pi.

## Bootstrap primitives (plan vs repo)

- **`/bootstrap-plan`**: planning/recon prompt only. No files are written.
- **`/bootstrap-repo`**: code-backed bootstrap primitive that generates repo-local `.pi/` artifacts.

Use `bootstrap-plan` to think, then `bootstrap-repo` to apply.

## Recommended pattern

1. Launch meta control plane in the target repo:
   ```bash
   cd /path/to/repo
   pictl meta
   ```

2. Run a reconnaissance-first planning pass:
   - Start with `/bootstrap-plan`.
   - Explore local context broadly (`AGENTS.md`, `CLAUDE.md`, docs, scripts, `.claude/`, `.codex/`, existing `.pi/`).
   - Use subagents/parallel lanes when useful.
   - Synthesize adopt / bridge / ignore decisions before scaffolding.

3. Run intelligent bootstrap:
   ```text
   /bootstrap-repo --domain <repo-domain>
   ```
   - Generates repo-local `.pi` settings + agents + prompts + pipelines + workflow doc.

4. Prime local-first memory immediately:
   ```text
   /memory-ingest --scope both --force
   ```
   - Builds repo-local + global corpora and registers collections.

5. Optional deeper exploration mode:
   ```text
   /bootstrap-repo --domain <repo-domain> --max
   ```
   - Adds extra ideation + implementation-critique lanes before synthesis.

6. Optional fast path when cost/time constrained:
   ```text
   /bootstrap-repo --domain <repo-domain> --quick
   ```

7. Exit meta session, then relaunch with repo-focused slice:
   ```bash
   pictl build
   ```

## Success criteria for a good bootstrap

- Foundation is clearly repo-specific, not generic scaffolding.
- Local config is explicit and auditable (narrow opt-ins).
- Workflows support explore -> design -> implement -> review.
- Prompts/agents are goal-oriented, not brittle procedural scripts.
- Memory workflow is codified (`/memory-ingest`, `/memory-search`, `/memory-context`) rather than ad hoc.

## Rule of thumb

- **Global (`pi-agent-config`)**: reusable primitives and defaults.
- **Repo-local (`<repo>/.pi`)**: domain overlays and explicit opt-ins.
