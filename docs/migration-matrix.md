# Claude/Codex → Pi Migration Matrix

_Last updated: 2026-02-24_

## 1) Source Inventory

| Source | Inventory target | Count | Notes |
|---|---|---:|---|
| `~/.claude/skills` | skill directories + symlinked skills | 234 (225 dirs + 9 symlinks) | Large catalog; high duplication (`check-*`, `fix-*`, `log-*`) and many domain-specific packs |
| `~/.codex/commands` | markdown command files | 14 | Strong overlap with existing `prompts/` |
| `~/.codex/agents` | markdown agent definitions | 28 | Specialist reviewers + persona set for review swarms |

### `~/.codex/commands` inventory (14)

`autopilot.md`, `build.md`, `check-quality.md`, `commit.md`, `design-sprint.md`, `fix.md`, `implement.md`, `incident-response.md`, `pr.md`, `review-and-fix.md`, `review-branch.md`, `thinktank.md`, `update-docs.md`, `README.md`

### `~/.codex/agents` inventory (28)

`agent-updater.md`, `api-design-specialist.md`, `architecture-guardian.md`, `beck.md`, `carmack.md`, `complexity-archaeologist.md`, `data-integrity-guardian.md`, `dependency-health-monitor.md`, `design-systems-architect.md`, `documentation-quality-reviewer.md`, `error-handling-specialist.md`, `fowler.md`, `grug.md`, `helper.md`, `infrastructure-guardian.md`, `jobs.md`, `learning-codifier.md`, `maintainability-maven.md`, `ousterhout.md`, `pattern-extractor.md`, `performance-pathfinder.md`, `product-visionary.md`, `security-sentinel.md`, `skill-builder.md`, `state-management-analyst.md`, `test-strategy-architect.md`, `torvalds.md`, `user-experience-advocate.md`

### `~/.claude/skills` clustering snapshot (top duplicated prefixes)

- `check-*`: 15
- `fix-*`: 13
- `log-*`: 12
- `stripe-*`: 10
- `brand-*`: 7
- `design-*`: 6

## 2) Migration Matrix

| Source path | Primitive mapping | Migration target | Keep / Drop / Later | Reason | Owner |
|---|---|---|---|---|---|
| `~/.codex/commands/autopilot.md` | prompt | `prompts/autopilot.md` | **keep (phase-1)** | Canonical orchestration entrypoint; already aligned to strict priority ordering | @phrazzld (workflows) |
| `~/.claude/skills/spec/SKILL.md` | prompt | `prompts/spec.md` | **keep (phase-1)** | Existing Pi prompt is intentionally thin; import richer issue-spec structure | @phrazzld (workflows) |
| `~/.claude/skills/architect/SKILL.md` | prompt | `prompts/architect.md` | **keep (phase-1)** | Needed for concrete technical design outputs and implementation sequencing | @phrazzld (workflows) |
| `~/.codex/commands/build.md` | prompt | `prompts/execute.md` (build semantics merged) | **keep (phase-1)** | Keep Pi command surface (`/execute`) but bring issue-driven build loop semantics | @phrazzld (workflows) |
| `~/.codex/commands/pr.md` + `~/.claude/skills/pr/SKILL.md` | prompt | `prompts/pr.md` | **keep (phase-1)** | PR discipline + `Closes #N` + verification evidence | @phrazzld (workflows) |
| `~/.claude/skills/fix-ci/SKILL.md` | prompt | `prompts/fix-ci.md` | **keep (phase-1)** | Upgrade current minimal CI prompt with bounded-log and classification workflow | @phrazzld (workflows) |
| `~/.claude/skills/respond/SKILL.md` | prompt | `prompts/respond.md` | **keep (phase-1)** | Explicit review-response transparency policy is high leverage for PR flow | @phrazzld (workflows) |
| `~/.claude/skills/groom/SKILL.md` | prompt | `prompts/groom.md` | **keep (phase-1)** | Core backlog generation/re-prioritization primitive for empty/low-quality queues | @phrazzld (workflows) |
| `~/.claude/skills/issue/SKILL.md` | prompt | `prompts/issue.md` (new) | **keep (phase-1)** | Readiness gate (`lint/enrich/decompose`) directly supports `/autopilot` quality | @phrazzld (workflows) |
| `~/.codex/commands/check-quality.md` + `~/.claude/skills/check-quality/SKILL.md` | prompt | `prompts/check-quality.md` (new) | **keep (phase-1)** | Adds reusable quality gate primitive currently missing from Pi prompt set | @phrazzld (workflows) |
| `~/.codex/commands/review-branch.md` | prompt | `prompts/review-branch.md` (new) | **keep (phase-1)** | Enables structured multi-reviewer pass before human review | @phrazzld (workflows) |
| `~/.codex/commands/review-and-fix.md` | prompt | `prompts/review-and-fix.md` (new) | **keep (phase-1)** | Thin orchestrator to standardize review remediation loop | @phrazzld (workflows) |
| `~/.codex/commands/thinktank.md` + `~/.claude/skills/thinktank/SKILL.md` | extension + prompt | `extensions/thinktank/index.ts`, `prompts/thinktank.md` | **keep (phase-1)** | Multi-model consensus primitive is referenced by several workflows | @phrazzld (extensions) |
| `~/.codex/agents/security-sentinel.md` | agent | `extensions/subagents/agents/security-sentinel.md` (new) | **keep (phase-1)** | First high-value specialist for safety-oriented review swarms | @phrazzld (subagents) |
| `~/.codex/agents/architecture-guardian.md` | agent | `extensions/subagents/agents/architecture-guardian.md` (new) | **keep (phase-1)** | High-leverage architecture guard for module depth/coupling checks | @phrazzld (subagents) |
| `~/.codex/commands/incident-response.md` | prompt | `prompts/incident-response.md` (new) | later | Useful, but lower priority than foundation workflow parity | @phrazzld (workflows) |
| `~/.claude/skills/investigate/SKILL.md` | prompt | `prompts/investigate.md` (new) | later | Valuable incident primitive; depends on observability integration maturity | @phrazzld (workflows) |
| `~/.claude/skills/triage/SKILL.md` | prompt | `prompts/triage.md` (new) | later | Requires live Sentry/Vercel/CI ops wiring not yet baseline in this repo | @phrazzld (workflows) |
| `~/.codex/commands/implement.md` | prompt | alias semantics in `prompts/execute.md` | later | Largely overlaps with existing `/execute`; keep as alias policy, not separate primitive | @phrazzld (workflows) |
| `~/.codex/commands/fix.md` | prompt | alias semantics in `prompts/fix-ci.md` + `/execute` | later | Redundant as standalone primitive for this repo scope | @phrazzld (workflows) |
| `~/.codex/commands/update-docs.md` | prompt | `prompts/update-docs.md` (new) | later | Helpful but not blocking for migration foundation | @phrazzld (workflows) |
| `~/.codex/commands/commit.md` | prompt | `prompts/commit.md` (new) | later | Nice-to-have hygiene primitive; lower leverage than issue/quality flow | @phrazzld (workflows) |
| `~/.codex/commands/design-sprint.md` | prompt | `prompts/design-sprint.md` (new) | later | Valuable for product repos, not immediate for config foundation | @phrazzld (workflows) |
| `~/.codex/agents/performance-pathfinder.md` | agent | `extensions/subagents/agents/performance-pathfinder.md` (new) | later | Good specialist; defer until subagent baseline is stable | @phrazzld (subagents) |
| `~/.codex/agents/data-integrity-guardian.md` | agent | `extensions/subagents/agents/data-integrity-guardian.md` (new) | later | Important for DB-heavy repos; not immediate for config-focused backlog | @phrazzld (subagents) |
| `~/.codex/agents/documentation-quality-reviewer.md` | agent | `extensions/subagents/agents/documentation-quality-reviewer.md` (new) | later | Useful QA reviewer; defer behind security + architecture specialists | @phrazzld (subagents) |
| `~/.claude/skills/_archived/**` | skill | _none_ | **drop** | Explicitly archived content; migration would import stale/noisy behavior | @phrazzld |
| `~/.claude/skills/check-*` | skill bundle | consolidated into `/audit` domain strategy | **drop** | High duplication pattern; keep one composable audit primitive instead of many narrow checks | @phrazzld |
| `~/.claude/skills/fix-*` | skill bundle | consolidated into `/execute` + `/fix-ci` | **drop** | Duplicative fix wrappers produce noisy command catalog | @phrazzld |
| `~/.claude/skills/log-*` + `~/.claude/skills/log-*-issues` | skill bundle | folded into issue creation pipeline (`/groom`, `/issue`) | **drop** | Logging-only wrappers duplicate core issue workflow | @phrazzld |
| `~/.claude/skills/brand-*` + `~/.claude/skills/marketing-*` + `~/.claude/skills/launch-*` | skill bundle | _none (repo-local only if needed)_ | **drop** | Product/marketing campaign content is out of scope for Pi foundation repo | @phrazzld |
| `~/.codex/commands/README.md` | docs | _none_ | **drop** | Reference-only file; not a runtime primitive | @phrazzld |
| `~/.codex/agents/helper.md` | agent | _none_ | **drop** | Generic helper overlaps base assistant behavior; weak signal as dedicated subagent | @phrazzld |

## 3) Curated Top-15 Initial Migrations (`phase-1`)

> Selection basis: unblock core issue-to-PR loop, quality gates, and first specialist-review capability.

### Atomic follow-up tasks

- [ ] **[phase-1] M01** — Merge `/autopilot` canonical semantics into `prompts/autopilot.md`.
- [ ] **[phase-1] M02** — Expand `/spec` scaffold in `prompts/spec.md`.
- [ ] **[phase-1] M03** — Expand `/architect` scaffold in `prompts/architect.md`.
- [ ] **[phase-1] M04** — Merge `/build` loop semantics into `prompts/execute.md`.
- [ ] **[phase-1] M05** — Normalize PR requirements in `prompts/pr.md`.
- [ ] **[phase-1] M06** — Upgrade CI triage workflow in `prompts/fix-ci.md`.
- [ ] **[phase-1] M07** — Enforce transparent review-response flow in `prompts/respond.md`.
- [ ] **[phase-1] M08** — Bring richer backlog orchestration into `prompts/groom.md`.
- [ ] **[phase-1] M09** — Add `prompts/issue.md` for lint/enrich/decompose.
- [ ] **[phase-1] M10** — Add `prompts/check-quality.md` as a reusable quality primitive.
- [ ] **[phase-1] M11** — Add `prompts/review-branch.md`.
- [ ] **[phase-1] M12** — Add `prompts/review-and-fix.md`.
- [ ] **[phase-1] M13** — Add Thinktank extension and prompt (`extensions/thinktank/index.ts`, `prompts/thinktank.md`).
- [ ] **[phase-1] M14** — Add `security-sentinel` agent at `extensions/subagents/agents/security-sentinel.md`.
- [ ] **[phase-1] M15** — Add `architecture-guardian` agent at `extensions/subagents/agents/architecture-guardian.md`.

## 4) Slash Command Naming / Collision Policy

1. **Single canonical command name in Pi runtime.**
   - One command name maps to one canonical implementation path.
2. **When multiple sources define the same command name (`/autopilot`, `/pr`, etc.):**
   - Prefer the richer/stricter definition as base.
   - Merge useful deltas from secondary source.
   - Keep only one published command name.
3. **If semantics materially conflict and both are needed temporarily:**
   - Keep canonical at `/name`.
   - Put alternate under a temporary namespaced alias (`/legacy-name`) for one migration phase max.
4. **New commands must use explicit domain-action naming when ambiguity is likely** (e.g., `/quality-check`, `/issue-lint`) instead of overloaded generic verbs.
5. **No command ships without target path ownership** in this matrix (prevents orphan aliases and silent collisions).

## 5) Notes

- This issue intentionally plans migration only; it does **not** implement the imported assets.
- Existing minimal Pi prompts remain valid baseline behavior until phase-1 tasks are executed.
