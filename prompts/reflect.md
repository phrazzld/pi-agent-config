---
description: Organic reflection workflow for continuous Pi/process improvement (global + repo)
---
# REFLECT

> Reflect from real work. Codify what repeats. Avoid bloat.

## Arguments

- Focus area (optional): `$1`
- Extra context (optional): `${@:2}`
- Raw arguments: `$@`

## Opinionated defaults

- Reflection scope is always **both**:
  - this repository (local patterns)
  - global Pi workflow/config patterns
- Prefer a **subagent swarm** for research/exploration when available.
- Swarms are recommended, not mandatory.

## Skill bootstrap

Before analysis, load these skills when available:
1. `/skill:organic-reflection`
2. `/skill:web-search`

If skill commands are disabled, manually read:
- `skills/organic-reflection/SKILL.md`
- `skills/web-search/SKILL.md`

## Objective

Run a structured reflection loop that:
1. Replays recent work
2. Extracts codification opportunities without command/catalog bloat
3. Proposes systemic improvements (process, prompts, skills, extensions, tools)
4. Evaluates tradeoffs and reversibility
5. Asks clarifying questions before recommending implementation

## Workflow

1. **Replay recent work**
   - Inspect recent commits, changed files, issue/PR activity, and relevant logs/sessions.
   - Capture repeated manual orchestration and decision bottlenecks.

2. **Memory lane (local-first)**
   - If `memory_ingest` / `memory_search` / `memory_context` tools are available, use them first.
   - Ingest/search with explicit local-first scope (`scope=both`, then prioritize local findings in synthesis).
   - Prefer raw transcript excerpts + derived summaries/metadata (not summaries only).

3. **Cross-config lane**
   - Compare patterns in:
     - `~/.claude/skills`
     - `~/.codex/commands`
     - `~/.codex/agents`
     - this repo’s `prompts/`, `skills/`, `extensions/`, `docs/`

4. **Pi capability lane**
   - Review Pi docs/examples for templates, skills, extensions, sessions, compaction, SDK, and subagents.
   - State what Pi already provides vs what we still need.

5. **External research lane (cited)**
   - Run web/doc searches for memory/orchestration best practices.
   - Include at least one local-first memory candidate evaluation (e.g., QMD).
   - Include URLs for factual claims.

6. **Swarm recommendation**
   - If `subagent` is available, propose a lane plan and ask whether to launch it:
     - suggest number of agents
     - suggest investigation lanes
     - let user decide final swarm shape
   - If no subagent support, run lanes sequentially.

7. **Idea generation + scoring**
   - Propose at least 6 candidates across codification classes:
     - process-only
     - global Pi config
     - repo-local config
     - external/internal tooling
   - Score and label: `now`, `next`, `later`.

8. **Clarifying questions + recommendation**
   - Ask 3-6 focused questions.
   - Refine into 1-2 smallest high-leverage experiments.

## Output format

```markdown
## Reflection Summary

## Repeated Patterns Observed

## Candidate Artifacts
| Idea | Type | Scope | Impact | Effort | Bloat Risk | Reversible? | Recommendation |

## Memory + Session Findings

## Clarifying Questions

## Recommended Next Experiments
1. ...
2. ...
```
