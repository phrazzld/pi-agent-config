# Discovery Hygiene

Goal: keep global Pi startup lean while allowing focused, explicit opt-ins per repository.

## Baseline policy

- Retire broad home-level context files (`~/CLAUDE.md`).
- Keep global skills/extensions minimal in `~/.pi/agent` (this repo is source of truth).
- Disable global `~/.agents/skills/*` auto-discovery by default via `settings.json`.

Current global setting in this repo (machine-specific home path):

```json
{
  "skills": [
    "!/Users/phaedrus/.agents/skills/**"
  ]
}
```


## Context file layering policy

- Global baseline context: `~/.pi/agent/AGENTS.md` (managed from `context/global/AGENTS.md` in this repo).
- Repo-specific guidance: `<repo>/AGENTS.md`.
- Keep these concerns separate:
  - global file = cross-repo defaults only
  - repo file = local workflow/conventions only

Pi loads global context first, then parent-directory context files down to the current repo.
So repo-local `AGENTS.md` should refine/override global defaults when needed.

## Repo-local opt-in (recommended)

When a specific repo needs one of those skills, opt in explicitly in that repo’s `.pi/settings.json`:

```json
{
  "skills": [
    "+/Users/phaedrus/.agents/skills/agent-browser",
    "+/Users/phaedrus/.agents/skills/beautiful-mermaid"
  ]
}
```

Use exact `+` includes for narrow, auditable access.

Alternative in this repo: create repo-local symlink bridges under `skills/` that point to selected `~/.agents/skills/*` packages.
This keeps discovery explicit (tracked in git) while avoiding broad global auto-discovery.

## Practical split of responsibility

- **Global (`pi-agent-config`)**: reusable primitives, default slices, guardrails, shared teams/pipelines.
- **Repo-local (`<repo>/.pi/`)**: domain-specific skills/agents/prompts and narrow model/workflow overrides.

Examples:
- Keep `speech-rewrite-prompting` in `vox/.pi/skills/` (domain specific).
- Keep `llm-communication` and `skill-builder` global (cross-repo utility).

This keeps the global system powerful but predictable, and each repo intentionally composed.
