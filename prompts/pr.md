---
description: Prepare and publish a PR from current branch diff (not draft-only)
---
Use current branch diff to produce and **publish** a PR update:

1. PR title (conventional, concise, <= 72 chars).
2. Problem + solution summary.
3. File-level change summary.
4. Verification evidence (commands and outcomes).
5. Risk / rollback notes.

## Execution contract (non-negotiable)

- When this prompt is invoked, do not stop at drafting text.
- You must perform the GitHub write:
  - If no PR exists for the branch: `gh pr create ... --body-file <path>`
  - If a PR already exists: `gh pr edit ... --body-file <path>`
- Only skip GitHub write if the user explicitly says "draft only" / "no write".

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

## GitHub CLI hygiene (non-negotiable)

For any GitHub write operation (PR create/edit/comment, issue comment, review reply):
1. Write markdown to a temp file.
2. Use `--body-file/-F` (never `--body/-b`).
3. Fetch back the posted content and confirm formatting quality.

## Definition of done

- A pull request exists for the current branch (created or updated during this run).
- The response includes: `PR URL: <url>`.
- If creation/edit fails, report exact blocker and stop as blocked (not done).

## Post-create sanity check

After creating/updating PR:
1. Fetch the PR title/body.
2. Confirm there are no empty bullets, `\\n` artifacts, or unrelated command output.
3. Run `/pr-lint` (guardrails extension) for code-enforced metadata lint/fix.
4. If malformed, immediately rewrite with `gh pr edit --body-file <path>`.
