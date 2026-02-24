---
description: Prepare clean, shell-safe PR title/body from current git diff
---
Use current branch diff to produce:

1. PR title (conventional, concise, <= 72 chars).
2. Problem + solution summary.
3. File-level change summary.
4. Verification evidence (commands and outcomes).
5. Risk / rollback notes.

## Quality bar

- Title must be human-readable and specific.
- Body must be structured markdown with clear sections.
- Never include raw test/runtime logs in the PR body.
- Keep verification concise: command + result summary.
- Include `Closes #N` when issue number is known.

## Shell-safety bar (non-negotiable)

- Do not pass markdown body inline through a quoted `--body "..."` string.
- Use `gh pr create/edit --body-file <path>`.
- Preserve markdown backticks literally (no command substitution side effects).

## Post-create sanity check

After creating/updating PR:
1. Fetch the PR title/body.
2. Confirm there are no empty bullets, `\\n` artifacts, or unrelated command output.
3. Run `/pr-lint` (guardrails extension) for code-enforced metadata lint/fix.
4. If malformed, immediately rewrite with `gh pr edit --body-file <path>`.
