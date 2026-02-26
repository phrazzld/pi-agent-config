# AGENTS.md — pi-agent-config

Repository-specific guidance when working **inside** `pi-agent-config`.

## Scope guardrail

This file is **repo-local only**.
Do not use it as the global baseline for all Pi sessions.

Global cross-repo context belongs in:
- `context/global/AGENTS.md` (synced to `~/.pi/agent/AGENTS.md` by `scripts/bootstrap.sh`)


## Prompt layers in this repo

Global/runtime prompt artifacts are versioned here:
- `context/global/AGENTS.md` → `~/.pi/agent/AGENTS.md` (cross-repo context contract)
- `context/global/APPEND_SYSTEM.md` → `~/.pi/agent/APPEND_SYSTEM.md` (system prompt addendum)

Note: `SYSTEM.md` would replace Pi's built-in system prompt entirely.
Default policy: use `APPEND_SYSTEM.md` for additive global behavior unless a full replacement is explicitly intended.

## Purpose

This repo is the source-of-truth for global Pi runtime config (`~/.pi/agent`).
Changes here affect behavior across many repositories.

## Local vs Global policy

- Keep **global** config focused on cross-repo, high-frequency capabilities.
- Keep **domain-specific** logic in repo-local `.pi/` folders of the target project.
- If uncertain, default to local first; promote global only after repeated reuse.

## Expected working-tree state

A partially dirty tree is normal here.
Multiple agents and sessions may be codifying improvements concurrently.

When editing:
- Do **not** reset/discard unrelated changes.
- Scope work to explicit paths.
- Use path-scoped diffs/commits.
- Clearly separate unrelated concerns in commit history.

## Safe contribution pattern

1. Inspect `git status` and identify unrelated churn.
2. Edit only target files.
3. Validate with focused checks.
4. Commit only the intended paths.
5. Document why a change belongs global vs local.

## Preference order for context

1. This file (`AGENTS.md`) for repo-specific behavior.
2. `README.md` + `docs/discovery-hygiene.md` for composition policy.
3. Global machine context as fallback (`~/.pi/agent/AGENTS.md`).
