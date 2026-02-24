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

Deliver issue `$1` (or the highest-priority open issue when omitted) as a draft PR with verification evidence and `Closes #N`.

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

## Workflow

1. **Find issue**
   - If `$1` provided: `gh issue view $1 --json number,title,body,labels`
   - Else: `gh issue list --state open --limit 50`
   - Select by priority rules above
2. **Load context**
   - Read issue + comments
   - Read `project.md` when present
   - If repo uses ownership signaling, assign/comment before implementation
3. **Spec**
   - If missing or weak, run `/spec $1` (or selected issue number)
4. **Design**
   - If missing or weak, run `/architect $1` (or selected issue number)
5. **Build**
   - Run `/execute` in small, verified steps
6. **Refine + verify**
   - Simplify/refactor risky code paths
   - Update docs where behavior changed
   - Run tests/lint/build; if failing, iterate with `/fix-ci`
7. **Ship**
   - Run `/pr`
   - Ensure PR body includes `Closes #N`
   - Post PR link/status back to issue
8. **Retro note**
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
- PR URL and any follow-ups
