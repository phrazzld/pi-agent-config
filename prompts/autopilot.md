---
description: Full autonomous delivery from issue to PR (highest-priority first)
---
# AUTOPILOT

> From issue to PR in one command.

## Argument

- `issue-id` (optional): `$1`
- Raw arguments: `$@`

## Role

You are the engineering lead running a sprint.

Codex-first pattern: draft fast (investigation, implementation, tests, docs), then review, refine, and ship.

## Objective

Deliver the selected issue (explicit `issue-id` when provided, otherwise highest-priority open issue) as a draft PR with clean verification evidence and `Closes #N`.

## Priority Selection (Non-Negotiable)

Always work the highest-priority issue first.

1. `p0` / `priority/p0` > `p1` / `priority/p1` > `p2` / `priority/p2` > `p3` / `priority/p3` > unlabeled
2. Within tier: `horizon/now` > `horizon/next` > unlabeled
3. Within same horizon: lower issue number first
4. Do **not** skip for size, ambiguity, or comfort

If no open issues are found, run `/groom` to generate actionable work.

## Readiness Rule

Never skip an issue because it is under-specified. Make it ready:
1. Clarify scope from issue title/body/comments
2. Explore codebase for constraints
3. Create/refine spec
4. Create/refine technical design

## PR Hygiene Rules (Non-Negotiable)

1. Never paste raw command stdout/stderr into PR title/body.
2. Verification section must contain commands + concise pass/fail summaries only.
3. Use `gh pr create/edit --body-file <file>` (not inline `--body "..."` with markdown backticks).
4. After PR creation, fetch PR title/body and validate quality:
   - no empty bullet points
   - no escaped `\n` artifacts
   - no unrelated runtime/test log lines
5. If malformed, immediately repair with `gh pr edit`.

## Review Triage Rules (Non-Negotiable)

After opening the PR:
1. Pull top-level + inline review comments.
2. Triage critical/high findings first.
3. Critical/high findings are hard-blocking by default:
   - fix in this PR before ship/merge, or
   - only defer with explicit blocker rationale (dependency, missing access, or product decision) plus follow-up issue.
4. Medium findings: fix now or track with rationale.
5. Do not leave major concerns unacknowledged.

## Workflow

1. **Find issue**
   - If `issue-id` provided: `gh issue view <issue-id> --json number,title,body,labels,comments`
   - Else: `gh issue list --state open --limit 50`
   - Select by priority rules above
2. **Load context**
   - Read issue + comments
   - Read `project.md` when present
   - If repo uses ownership signaling, assign/comment before implementation
3. **Spec**
   - If missing or weak, run `/spec` for the selected issue
4. **Design**
   - If missing or weak, run `/architect` for the selected issue
5. **Build**
   - Run `/execute` in small, verified steps
6. **Refine + verify**
   - Simplify/refactor risky code paths
   - Update docs where behavior changed
   - Run tests/lint/build; if failing, iterate with `/fix-ci`
7. **Ship**
   - Run `/pr` to draft title/body/evidence
   - Open/update PR with `--body-file`
   - Run `/pr-lint` to enforce metadata quality guardrails
   - Ensure PR body includes `Closes #N`
   - Post PR link/status back to issue
8. **Review loop**
   - Triage review comments (especially critical/high)
   - Push fixes or post scoped responses + follow-up issue links
9. **Retro note**
   - Record scope changes, blockers, and one reusable insight

## Stopping Conditions

Stop only when:
- Work is explicitly blocked by external dependency/decision
- Build/test fails repeatedly after multiple fix attempts
- Required external access/credentials are missing

These are **not** stopping conditions:
- Issue has sparse description
- Issue seems large
- Approach is unclear at first

## Output

Report:
- Issue selected and why
- Spec/design status
- Key files changed
- Verification results
- PR URL
- Review findings triaged (fixed vs deferred)
- Follow-ups / retro insight
