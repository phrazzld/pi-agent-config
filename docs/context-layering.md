# AGENTS Context Layering in Pi

This repository defaults to `AGENTS.md` files for context policy.

## Canonical rules

1. In each directory, Pi checks `AGENTS.md` first, then `CLAUDE.md`.
2. Pi loads global `~/.pi/agent/AGENTS.md` (if present).
3. Pi walks parent directories from `cwd` upward and loads one context file per directory.
4. Effective order is outer → inner (closest directory last), so deeper path context can narrow behavior.

## What "cascading" means in practice

Yes, cascading works across subdirectories.

If you have:
- `/repo/AGENTS.md`
- `/repo/lib/AGENTS.md`
- `/repo/lib/components/AGENTS.md`

Then running Pi from `/repo/lib/components` includes all three (plus global context).

If you run Pi from `/repo`, only `/repo/AGENTS.md` is in scope from the repo tree. Subdirectory files are not loaded unless `cwd` is in that subtree.

## Directory strategy

- **Repo root `AGENTS.md`**: global repository conventions and non-negotiables.
- **Subdirectory `AGENTS.md`**: local constraints only (keep concise, only delta from parent).
- **Avoid policy duplication** across levels.

## Decision table

| Need | Use |
|---|---|
| Repo-wide engineering rules | Root `AGENTS.md` |
| Narrow guidance for one subtree (`lib/`, `components/`) | Subdir `AGENTS.md` |
| Reusable capability with scripts/docs/assets | Skill (`skills/.../SKILL.md`) |
| Repeatable one-shot workflow text | Prompt template (`prompts/*.md`) |
| Runtime logic/hooks/tools/UI/orchestration | Extension (`extensions/...`) |

## Conflict resolution policy

When parent and child guidance conflict:

1. Keep root file focused on invariants (safety, architecture, quality bars).
2. Use child files for local implementation constraints.
3. Child files should **narrow**, not contradict.
4. If contradiction is unavoidable, resolve by editing the parent to remove ambiguity.

## Anti-patterns

- Copying full root policy into every subdirectory.
- Using subdir files for broad repo policy.
- Defining contradictory style/process rules across levels.
- Creating many tiny subdir context files with low signal.

## Validation script

Run:

```bash
./scripts/validate-context-cascade.sh
```

Expected fixture output:

```text
=== Scenario: repo root ===
cwd: repo
1. global/AGENTS.md
2. repo/AGENTS.md

=== Scenario: lib subtree ===
cwd: repo/lib
1. global/AGENTS.md
2. repo/AGENTS.md
3. repo/lib/AGENTS.md

=== Scenario: components subtree ===
cwd: repo/lib/components
1. global/AGENTS.md
2. repo/AGENTS.md
3. repo/lib/AGENTS.md
4. repo/lib/components/AGENTS.md
```

Notes:
- The validation script uses a fixture tree in `docs/examples/context-cascade/` for deterministic output.
- Real Pi traversal continues to filesystem root, so external parent directories can contribute additional context files.
