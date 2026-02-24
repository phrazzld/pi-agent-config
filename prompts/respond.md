---
description: Pull PR feedback from GitHub, implement fixes, and post clear, accessible reviewer responses
---
# RESPOND

> Close the PR feedback loop with strong engineering execution and excellent written communication.

## Non-negotiable communication bar

Every GitHub comment/reply must be:
1. **Skimmable**: short paragraphs, bullets, clear sectioning
2. **Direct**: lead with the decision/result in line one
3. **Accessible**: plain language, minimal jargon, explicit scope
4. **Evidence-based**: include file paths + verification outcomes
5. **Clean**: no raw logs/stdout dumps or noisy stack traces
6. **Professional**: respectful, accountable, and specific

## Workflow

1. **Discover PR context**
   - `gh pr status` to find the PR for the current branch
   - if none, ask for PR number/repo

2. **Fetch feedback from GitHub (don’t wait for pasted comments)**
   - Review comments: `gh api repos/<owner>/<repo>/pulls/<pr>/comments --paginate`
   - Review summaries: `gh api repos/<owner>/<repo>/pulls/<pr>/reviews --paginate`
   - PR/issue comments: `gh api repos/<owner>/<repo>/issues/<pr>/comments --paginate`

3. **Triage actionable items**
   - classify: `bug | risk | style | question`
   - severity: `critical | high | medium | low`
   - decision: `fix now | defer | reject` + reason
   - ignore acknowledgements/duplicates unless they request action

4. **Apply policy**
   - `critical/high`: fix now by default
   - `medium`: fix now or defer with rationale + follow-up issue
   - `low`: optional unless cheap/high-signal

5. **Implement + verify**
   - apply precise changes
   - run relevant checks
   - stage only intended files
   - commit before posting replies

6. **Reply on GitHub with high-quality formatting**
   - inline reply for line comments where possible
   - PR-level comment for outside-diff feedback
   - use this exact structure:
     - `Classification: <bug|risk|style|question>`
     - `Severity: <critical|high|medium|low>`
     - `Decision: <fix now|defer|reject>. <reason>`
     - `Change: <specific files/behavior changed>`
     - `Verification: <commands + concise outcome | N/A>`

7. **Final quality check before sending**
   - no empty bullets
   - no escaped `\n` artifacts
   - no pasted runtime/test logs
   - concise and readable on first pass

8. **Return summary**
   - files changed
   - commit hash(es)
   - comment disposition (fixed/deferred/rejected)
   - exact text posted
