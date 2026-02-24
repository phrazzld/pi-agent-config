---
description: Run reflection with parallel subagent lanes, then synthesize into a lean recommendation
---
# REFLECT-SWARM

Use this when subagent orchestration is available.

## Arguments

- Focus area (optional): `$1`
- Scope (optional): `$2` (`repo` | `global` | `both`, default: `both`)
- Extra context (optional): `${@:3}`

## Plan

1. If a `subagent` tool is available, launch 4 parallel lanes:
   - work-memory lane
   - legacy-config lane
   - pi-capability lane
   - external-research lane
2. Synthesize the four outputs into one recommendation.
3. If `subagent` is not available, fall back to `/reflect "$@"`.

## Suggested lane prompts

### Lane A — work-memory
Find repeated friction and wins from recent sessions/logs/commits/PRs related to: `$@`.
Return top recurring patterns and candidate codifications.

### Lane B — legacy-config
Scan `~/.claude/skills`, `~/.codex/commands`, `~/.codex/agents` for patterns relevant to `$@`.
Return keep/drop/later recommendations with rationale.

### Lane C — pi-capability
Inspect Pi docs/examples for native implementation paths for `$@`.
Prioritize low-bloat, reversible approaches.

### Lane D — external-research
Run cited web/doc research for `$@`, including local-first memory options (e.g., QMD).
Return concise findings with URLs.

## Output format

```markdown
## Swarm Reflection Summary

## Lane Findings
- A:
- B:
- C:
- D:

## Candidate Artifacts
| Idea | Type | Scope | Impact | Effort | Bloat Risk | Recommendation |

## Clarifying Questions

## Recommended Next Experiments
1. ...
2. ...
```
