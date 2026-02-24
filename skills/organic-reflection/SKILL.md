---
name: organic-reflection
description: Reflect on recent work and propose lean, high-leverage Pi improvements with tradeoff analysis. Use when evolving prompts/skills/extensions organically instead of bulk migration.
---

# Organic Reflection Skill

Use this skill when the user wants Pi config to evolve from real usage signals.

## Core principles

- No bulk migration.
- No command/catalog bloat.
- Prefer reversible changes.
- Codify only repeated, high-value behavior.

## Inputs to gather

1. **Recent execution evidence**
   - Git history (recent commits and changed files)
   - Recent issue/PR context
   - Notable friction points and repeated manual work

2. **Config source context**
   - Existing repo assets (`prompts/`, `skills/`, `extensions/`, `docs/`)
   - Legacy sources (`~/.claude/skills`, `~/.codex/commands`, `~/.codex/agents`)

3. **Pi capability constraints**
   - Prompt templates, skills, extensions, packages
   - Session storage/branching/compaction behavior
   - SDK and extension examples relevant to orchestration and memory

4. **External best practices**
   - Use web/doc search for current recommendations
   - Include citations for factual claims

## Optional parallel swarm (preferred when available)

If a `subagent` tool exists, run these lanes in parallel and synthesize.
Reference templates: `references/swarm-lanes.md`

1. **Work-memory lane**
   - Mine recent sessions/logs/commits for repeated pain
2. **Legacy-config lane**
   - Inspect Claude/Codex assets for reusable patterns
3. **Pi-capability lane**
   - Inspect Pi docs/examples for native extension points
4. **External research lane**
   - Gather current best practices + comparable memory/orchestration tools

If no subagent support is available, run lanes sequentially.

## Mandatory workflow

1. **Replay reality**
   - Describe what actually happened recently (not planned work).
   - Extract repeated tasks and decision bottlenecks.

2. **Identify codification targets**
   - Convert repeated patterns into candidate artifacts across these classes:
     - Process-only improvement (no new artifact)
     - Global Pi config update (prompt/skill/extension/package)
     - Repo-local config update
     - External tool adoption or internal tool build

3. **Run rubric scoring**
   - Load and apply: `references/evaluation-rubric.md`

4. **Memory strategy analysis**
   - Determine whether local-first memory is sufficient now.
   - Compare options (session-index only, local semantic index, external memory layer).

5. **Ask clarifying questions**
   - Ask focused questions before locking recommendations.
   - Prefer questions that resolve scope and maintenance tradeoffs.

6. **Recommend in phases**
   - Toe-dip: smallest experiment today
   - Pilot: short validation run
   - Scale: only after evidence

## Memory and session analysis checklist

When the user asks about memory/session durability:

- Verify what survives in session JSONL (`~/.pi/agent/sessions/...`)
- Explain compaction tradeoff (summary is lossy, full history remains in session file)
- Check what logs already exist and their retention
- Prefer local-first indexing initially
- Prefer storing raw transcript excerpts + derived summaries/metadata (not summaries only)
- Propose external memory integration only if clear value > maintenance cost

## Output contract

```markdown
## Reflection Findings

## Repeated Patterns Worth Codifying

## Candidate Artifacts (scored)
| Idea | Type | Scope | Score | Why now/next/later |

## Memory Strategy Notes

## Clarifying Questions

## Recommendation
- Now:
- Next:
- Later:
```
