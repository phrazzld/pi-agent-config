---
description: Final pre-merge polish pass for refactoring, docs, quality gates, and confidence hardening
---
# POLISH

> One more high-leverage pass after CI is green and review comments are addressed.

## Arguments

- Focus area (optional): `$1`
- Raw arguments: `$@`

## Objective

Bring the PR to **shippable quality** before squash merge by improving:
- code clarity and maintainability
- docs and developer ergonomics
- tests, lint, and type confidence
- reliability and rollback confidence

## Preconditions (must check first)

1. PR exists for current branch (`gh pr status`)
2. CI is passing
3. review comments are resolved or explicitly deferred with rationale + follow-up issue

If a precondition fails, fix that first and stop polish execution.

## Skill bootstrap

1. `/skill:pr-polish`
2. `/skill:pr-feedback` (if unresolved review feedback remains)
3. `/skill:organic-reflection` (optional, for codifying repeated polish improvements)

## Execution workflow

1. **Load PR context**
   - fetch PR metadata, changed files, review state, verification baseline

2. **Run polish lanes**
   - **Refactor lane:** simplify risky/duplicated paths, improve naming and boundaries
   - **Quality-gate lane:** tighten tests/lint/types where practical (ratchet up, never silently weaken)
   - **Docs lane:** update README/docs/comments/changelogs for changed behavior
   - **Confidence lane:** improve failure handling, observability, and rollback clarity

3. **Delegate when useful**
   - if `subagent` is available, parallelize lanes for speed and perspective
   - keep parent session focused on decisions and integration

4. **Implement highest-leverage safe changes**
   - prioritize low-risk, high-confidence improvements
   - avoid speculative rewrites without clear payoff

5. **Verify**
   - run targeted checks first, then full suite as needed
   - summarize command + pass/fail only (no raw logs in PR text)

6. **Update PR communication**
   - add a concise “Polish pass” update comment with:
     - what improved
     - what was intentionally deferred
     - why confidence is higher now

7. **Output**
   - changed files
   - quality-gate changes
   - verification results
   - deferred follow-ups
   - merge-readiness status
