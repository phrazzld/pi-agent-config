# AGENTS.md — pi-agent-config

Repository-specific guidance when working **inside** `pi-agent-config`.

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
3. Global machine context only as fallback.
