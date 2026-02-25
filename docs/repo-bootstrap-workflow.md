# Repository Bootstrap Workflow (Meta-first)

Use this when onboarding a new repo into Pi.

## Recommended pattern

1. Launch meta control plane in the target repo (temporary bootstrap mode):
   ```bash
   cd /path/to/repo
   pictl meta
   ```
2. Run intelligent bootstrap (recommended): `/bootstrap-repo --domain <repo-domain>`
   - this launches multi-model reconnaissance + synthesis and then scaffolds local `.pi/` artifacts:
   - `.pi/settings.json`
   - `.pi/agents/*.md` (domain-specific overlays)
   - optional `.pi/prompts/*.md`, `.pi/skills/*`, `.pi/extensions/*`
3. Optional fast path when cost/time constrained: `/bootstrap-repo --domain <repo-domain> --quick`
4. Exit meta session.
5. Relaunch with the repo-focused slice (typically `build`, later domain-specific):
   ```bash
   pictl build
   ```

## Why this works

- Meta remains the global architect and bootstrapper.
- Day-to-day coding uses the repo-focused runtime, not meta.
- Global library stays rich; per-repo runtime stays intentional.

## Rule of thumb

- **Global (`pi-agent-config`)**: reusable primitives and defaults.
- **Repo-local (`<repo>/.pi`)**: domain overlays and explicit opt-ins.
