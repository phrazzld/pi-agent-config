# Reviewer Policy Matrix

Default policy used by Pi guardrails and merge readiness checks.

## Matrix

| Source | Severity | Default decision | Required action |
|---|---|---|---|
| bot or human | critical | **block** | Fix in current branch before merge |
| bot or human | high | **block** | Fix in current branch before merge |
| bot or human | medium | address-or-track | Fix now, or file follow-up issue with rationale |
| bot or human | low | informational | Optional improvement |
| bot or human | none | informational | No action required |

## Notes

- Severity alone is not enough: findings also need to be **actionable** to block.
- Positive praise comments (even with severity badges) are ignored by blockers.
- Actionable critical/high findings from bots are hard-blocking by default.
- Exceptional overrides should be rare and explicit (e.g. `/squash-merge --allow-critical-bot-findings`).

## What counts as actionable

Typical actionable signals:
- breaking change / regression
- vulnerability / bypass / security risk
- blocked / failing / must fix
- explicit suggestion tied to a defect

Typical non-actionable signals:
- purely positive summaries
- acknowledgements/praise without a defect claim
