---
name: qa-smoke
description: Run repeatable browser QA smoke checks (dogfood + agent-browser), including local tmux dev-server orchestration and evidence capture.
---

# QA Smoke Skill

Use this skill when asked to:
- run QA/UAT smoke checks
- test a local or deployed web app quickly
- verify browser automation workflow setup
- collect reproducible QA artifacts (report + screenshots)

## Objective

Produce a deterministic smoke run with evidence artifacts and a concise issue summary.

## Execution pattern

1. **Pick target URL**
   - local: `http://localhost:<port>`
   - prod/staging: explicit URL from user or repo docs

2. **Start local server in tmux when needed**
   - Create dedicated session (e.g. `qa-local`)
   - Start app stack (framework dev server + backend process as required)
   - Wait for HTTP readiness with retries

3. **Run repo-native QA command first**
   - Prefer project-provided command (e.g. `pnpm qa:dogfood:local`, `pnpm qa:dogfood`)
   - If unavailable, run direct `agent-browser` smoke actions

4. **Capture artifacts**
   - Required: markdown report path
   - Required: screenshot directory path
   - Optional: video path for interactive regressions

5. **Summarize findings**
   - Severity counts
   - Key failures with reproducible evidence references
   - Residual risk and next fixes

6. **Cleanup**
   - Stop tmux session unless user asks to keep it running

## Required output contract

- Target URL tested
- Commands executed
- Artifact locations
- Findings table (critical/high/medium/low)
- Top 1-3 recommended follow-ups

## Guardrails

- Do not claim pass/fail without command evidence.
- Prefer repo-native QA scripts over bespoke ad hoc flows.
- Keep run scope explicit (unauthenticated smoke vs authenticated journey).
- For GitHub writes (issues/PR comments), use `--body-file/-F` and verify posted content.
