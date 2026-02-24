---
name: pr-polish
description: Run a final post-review polish pass to improve code quality, docs, test confidence, and merge readiness before squash merge.
---

# PR Polish Skill

Use this skill after CI is green and PR feedback is addressed, but before merge.

## Why this exists

Passing CI and resolved comments are necessary, but not always sufficient for shippable quality. This skill adds a final quality pass focused on long-term maintainability and confidence.

## Core principles

1. **Ratchet quality upward** on each merge where practical
2. **Prefer small, reversible improvements** over broad rewrites
3. **Do not silently weaken quality gates** (tests/lint/types)
4. **Always leave a clearer trail** (docs + rationale)

## Preconditions

Before executing polish work, verify:
1. PR exists for current branch
2. CI/checks are passing
3. review findings are resolved or explicitly deferred with rationale

If not true, stop and resolve those first.

## Workflow

### 1) Baseline snapshot
- Capture:
  - current PR summary and changed files
  - existing verification commands/results
  - known risks and deferred review items

### 2) Run four polish lanes

#### Lane A — Refactor & clarity
- reduce local complexity in touched code paths
- improve naming and abstraction boundaries
- remove obvious dead code / duplication introduced by PR work

#### Lane B — Quality-gate ratchet
- add or strengthen targeted tests for touched behavior
- tighten lint/type settings only when low-risk and justified
- if strictness cannot be raised now, open a concrete follow-up issue

#### Lane C — Documentation
- update README/docs/inline comments where behavior changed
- ensure operational steps are explicit (commands, env vars, pitfalls)
- keep docs concise and discoverable

#### Lane D — Reliability & confidence
- improve error handling and failure visibility where cheap/high-value
- validate rollback path and blast-radius awareness
- verify invariants relevant to the change

### 3) Delegation strategy (optional but recommended)

If `subagent` is available, use it for parallel lanes:
- `reviewer` for quality-gate/doc critiques
- `worker` for implementation spikes
- `planner` for refactor tradeoff checks

Keep integration decisions in the parent session.

### 4) Apply improvements
- choose highest-impact, lowest-risk changes first
- avoid out-of-scope architecture rewrites unless clearly warranted

### 5) Verification
- run focused checks first, then broader checks
- report command + concise result only
- no raw log dumps in PR text/comments

### 6) PR update communication
Post a short PR update comment with:
- what polish improvements landed
- what was deferred (with issue links)
- why merge confidence improved

## Defer/reject policy

- **Defer** when blocked by external dependency, product decision, or unacceptable risk
- **Reject** only with explicit rationale tied to scope or acceptance criteria
- Any deferred quality-gap should become a follow-up issue

## Output contract

```markdown
## Polish Pass Summary

## Improvements Shipped
- Refactor:
- Quality gates:
- Docs:
- Reliability:

## Verification
- `<command>` — pass/fail summary

## Deferred Follow-ups
- #<issue>: <reason>

## Merge Readiness
- Status: ready / not ready
- Remaining risks:
```
