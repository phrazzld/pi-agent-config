---
description: Organic reflection workflow to turn real work into lean Pi improvements (with optional subagent swarm)
---
# REFLECT

> Evolve Pi from lived usage, not upfront migration.

## Arguments

- Focus area (optional): `$1`
- Scope (optional): `$2` (`repo` | `global` | `both`, default: `both`)
- Extra context (optional): `${@:3}`
- Raw arguments: `$@`

## Skill bootstrap

Before analysis, load these skills when available:
1. `/skill:organic-reflection`
2. `/skill:web-search`

If skill commands are disabled, manually read:
- `skills/organic-reflection/SKILL.md`
- `skills/web-search/SKILL.md`

## Objective

Run a structured reflection loop that:
1. Replays real recent work
2. Extracts codification opportunities without bloat
3. Proposes global and/or repo-local improvements
4. Evaluates tradeoffs and reversibility
5. Asks clarifying questions before recommendation

## Optional swarm mode (if `subagent` tool is available)

Run parallel research lanes, then synthesize:
- **Lane A (work memory):** mine recent sessions/logs/commits for repeated friction
- **Lane B (legacy configs):** scan `~/.claude` + `~/.codex` for reusable patterns
- **Lane C (Pi capabilities):** check docs/examples for native extension points
- **Lane D (external research):** web/docs best practices + citations

If `subagent` is unavailable, execute these lanes sequentially.

## Workflow

1. **Replay recent work**
   - Inspect recent commits, changed files, issue/PR activity, and repo context.
   - Capture repeated manual orchestration and decision bottlenecks.

2. **Cross-config scan**
   - Compare patterns in:
     - `~/.claude/skills`
     - `~/.codex/commands`
     - `~/.codex/agents`
     - this repo’s `prompts/`, `skills/`, `extensions/`, `docs/`

3. **Pi capability + memory reality check**
   - Review Pi docs for templates, skills, extensions, packages, sessions, compaction, and SDK.
   - Explicitly state:
     - what Pi already provides
     - what is missing for long-horizon memory + semantic search
     - minimum viable local-first memory path
     - what to store first (raw excerpts vs summaries/metadata)

4. **External research (cited)**
   - Run web/doc searches on relevant memory/orchestration options.
   - Include at least one local-first memory candidate evaluation (e.g., QMD).
   - Include URLs for factual claims.

5. **Idea generation (creative + technical)**
   - Propose at least 6 candidates across:
     - prompt templates
     - skills
     - extensions
     - optional package-level add-ons
   - Include at least one candidate for each codification class:
     - process-only
     - global Pi config
     - repo-local config
     - external/internal tooling

6. **Tradeoff evaluation**
   - For each candidate: impact, effort, maintenance cost, bloat risk, reversibility, dependencies.
   - Mark as: `now`, `next`, `later`.

7. **Clarifying questions**
   - Ask 3-6 focused questions to resolve strategy uncertainty.
   - Refine recommendations after answers.

8. **Recommendation + toe-dip plan**
   - Recommend 1-2 smallest high-leverage experiments.
   - Provide phased path:
     - toe-dip (today)
     - pilot (this week)
     - scale (if proven)

## Output format

```markdown
## Reflection Summary

## Repeated Patterns Observed

## Candidate Artifacts
| Idea | Type | Impact | Effort | Bloat Risk | Reversible? | Scope (repo/global) | Recommendation |

## Memory + Session Findings

## Clarifying Questions

## Recommended Next Experiments
1. ...
2. ...
```
