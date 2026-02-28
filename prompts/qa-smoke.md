---
description: Run a repeatable browser QA smoke pass with evidence artifacts (report + screenshots)
---
Target:
$@

Protocol:
1. Confirm target URL and scope (unauthenticated vs authenticated).
2. If local testing is requested, launch app stack in tmux and wait for HTTP readiness.
3. Prefer repo-native QA command first (example: `pnpm qa:dogfood:local` or `pnpm qa:dogfood`).
4. If no QA command exists, run a minimal `agent-browser` smoke flow (landing -> auth -> primary CTA).
5. Produce evidence artifacts:
   - markdown report path
   - screenshot directory path
6. Summarize findings by severity and include exact repro evidence paths.
7. Stop tmux session unless user asks to keep it alive.
