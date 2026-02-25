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

Deliver the selected work item (explicit `issue-id` when provided, otherwise highest-priority open issue or `BACKLOG.md` top-priority item) as a draft PR with clean verification evidence.

## Priority Selection (Non-Negotiable)

Always work the highest-priority work item first.

1. `p0` / `priority/p0` > `p1` / `priority/p1` > `p2` / `priority/p2` > `p3` / `priority/p3` > unlabeled
2. Within tier: `horizon/now` > `horizon/next` > unlabeled
3. Within same horizon: lower issue number first
4. Do **not** skip for size, ambiguity, or comfort

If no open issues are found and `BACKLOG.md` exists, select the highest-priority unchecked item there.
If no open issues and no actionable backlog item are found, run `/groom` to generate actionable work.

## Readiness Rule

Never skip a selected work item because it is under-specified. Make it ready:
1. Clarify scope from issue title/body/comments
2. Explore codebase for constraints
3. Create/refine spec
4. Create/refine technical design

## PR Hygiene Rules (Non-Negotiable)

1. Never paste raw command stdout/stderr into PR title/body.
2. Verification section must contain commands + concise pass/fail summaries only.
3. Use `gh pr create/edit --body-file <file>` (not inline `--body "..."` with markdown backticks).
4. For all GitHub writes (PR/issue/review comments), use file-based body input (`--body-file/-F`) and avoid inline `--body/-b`.
5. After PR creation, fetch PR title/body and validate quality:
   - no empty bullet points
   - no escaped `\n` artifacts
   - no unrelated runtime/test log lines
6. If malformed, immediately repair with `gh pr edit --body-file`.

## Review Triage Rules (Non-Negotiable)

After opening the PR:
1. Pull top-level + inline review comments.
2. Triage critical/high findings first.
3. Critical/high findings are hard-blocking by default:
   - fix in this PR before ship/merge, or
   - only defer with explicit blocker rationale (dependency, missing access, or product decision) plus follow-up issue.
4. Medium findings: fix now or track with rationale.
5. Do not leave major concerns unacknowledged.

## Execution Budget Rules (Non-Negotiable)

- Max CI/fix loops per run: **3**
- Max review-response loops per run: **3**
- Max autopilot wall-clock budget: **120 minutes**
- If any budget is exceeded, stop and escalate with a concise unblock plan.

## Human Checkpoints (Non-Negotiable)

1. **After intake/spec/design** (before implementation)
2. **Before PR publish/update finalization**
3. **Before merge** (explicit authorization required)
4. **Before next autonomous issue run**: review reflection/codification output

If running non-interactive, stop at draft PR + readiness report. Do not merge.

## Workflow

1. **Find work item**
   - If `issue-id` provided: `gh issue view <issue-id> --json number,title,body,labels,comments`
   - Else: `gh issue list --state open --limit 200`
   - If open issues exist: select by priority rules above
   - Else if `BACKLOG.md` exists: select highest-priority unchecked item
   - Else: run `/groom` to create actionable work
2. **Load context**
   - Read issue + comments
   - Read `project.md` when present
   - If repo uses ownership signaling, assign/comment before implementation
3. **Spec + design packet**
   - If missing or weak, run `/spec` then `/architect`
   - Produce a short execution packet: acceptance criteria, scope bounds, risks, test plan
4. **Checkpoint 1: approval to implement**
   - Present packet and ask for GO/NO-GO before coding
5. **Build**
   - Run `/execute` in small, verified steps
   - Any subagent delegation must include explicit success criteria and budgets (`maxTurns`, `maxRuntimeSeconds`)
6. **CI/fix loop (bounded)**
   - Run tests/lint/build and iterate with `/fix-ci` when needed
   - Stop after max loop budget and escalate if unresolved
7. **PR prep**
   - Run `/pr` to draft title/body/evidence
   - Apply `github-cli-hygiene` skill for all GitHub write commands
   - Open/update PR with `--body-file`
   - If issue-backed, run `/pr-lint` and ensure `Closes #N` is present
   - If issue-backed, post PR link/status back to issue
8. **Checkpoint 2: approval before final PR publish state**
   - Confirm the PR summary and verification evidence are acceptable
9. **Review loop (bounded)**
   - Triage review comments (critical/high first)
   - Push fixes or post scoped responses + follow-up issue links
   - Stop after max loop budget and escalate if unresolved
10. **Polish pass (conditional quality ratchet)**
   - Once CI is green and comments are resolved, run `/polish` when high-value and low-risk
   - Re-run required checks after polish changes
11. **Checkpoint 3: merge authorization**
   - Merge only through `/squash-merge` after explicit human authorization
12. **Retro note**
   - Record scope changes, blockers, and one reusable insight
13. **Reflection + codification gate (required for flywheel mode)**
   - Run a high-intelligence reflection pass on issue, diff, CI/review outcomes, and project north star.
   - Decide what to codify in:
     - project backlog
     - repo-local `.pi/*`
     - global `pi-agent-config`
   - Apply low-risk updates immediately; queue risky updates for explicit review.

## Stopping Conditions

Stop only when:
- Work is explicitly blocked by external dependency/decision
- Build/test fails repeatedly after multiple fix attempts
- Required external access/credentials are missing
- Any execution budget rule is exceeded (CI/fix loop, review loop, or wall-clock)

These are **not** stopping conditions:
- Issue has sparse description
- Issue seems large
- Approach is unclear at first

## Output

Report:
- Work item selected and why
- Spec/design status
- Key files changed
- Verification results
- PR URL
- Review findings triaged (fixed vs deferred)
- Checkpoint decisions (GO/NO-GO outcomes)
- Follow-ups / retro insight
- Reflection/codification updates proposed or applied
