---
name: pr-feedback
description: Triage and address GitHub PR feedback directly from the current branch, then commit and post reviewer replies.
---

# PR Feedback Skill

Use this skill when asked to respond to review comments, "review input", or "address PR feedback".

## Required execution pattern

1. Detect the PR for the current branch (`gh pr status`).
2. Fetch feedback via GH CLI APIs:
   - `pulls/<pr>/comments`
   - `pulls/<pr>/reviews`
   - `issues/<pr>/comments`
3. For each actionable comment:
   - Classify: `bug | risk | style | question`
   - Decide: `fix now | defer | reject` with reason
4. Implement approved fixes.
5. Run verification relevant to the changed files (or note N/A).
6. Commit changes.
7. Post GitHub responses:
   - Inline reply for review comments when possible
   - PR-level comment for outside-diff/general feedback

## Reviewer response format

Use this exact structure in replies:

- `Classification: <bug|risk|style|question>`
- `Decision: <fix now|defer|reject>. <reason>`
- `Change: <what changed>`
- `Verification: <tests/checks run or N/A>`

## Guardrails

- Do not claim a fix without a real file change and commit.
- Do not wait for manually pasted comments when GH CLI can fetch them.
- Skip duplicate/thanks-only bot comments.
