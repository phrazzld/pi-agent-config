---
name: agentic-bootstrap
description: Design repo-local Pi foundations using autonomous exploration lanes, model-job routing, synthesis-first artifact generation, and lean success criteria. Use when bootstrapping or overhauling `.pi/` in a repository.
---

# Agentic Bootstrap Engineering

Use this skill when creating or redesigning a repository's local Pi foundation.

## Core posture

- Treat models as capable collaborators, not scripts.
- Maximize exploration quality, then synthesize.
- Keep output focused and auditable.
- Bias toward repo-specific fit over generic templates.

## Workflow

1. **Explore broadly**
   - Inspect local policy/context (`AGENTS.md`, `CLAUDE.md`, README/docs, scripts).
   - Mine existing automation/context layers (`.claude/`, `.codex/`, existing `.pi/`).
   - Run parallel lanes when useful (scout, docs, critic, context-bridge).

2. **Route models by job**
   - Scout/context/synthesis lanes: deeper reasoning models.
   - Research lanes: retrieval-strong models.
   - Critic lanes: adversarial/review-strong models.

3. **Synthesize with strict output contract**
   - Emit concrete artifacts (settings, overlays, prompts, pipelines, local workflow doc).
   - Require explicit opt-ins in settings.
   - Keep role overlays goal-oriented (role + objective + success criteria + output contract).

4. **Pressure test before finalize**
   - Surface failure modes and maintenance burden.
   - Remove brittle over-prescriptive instructions.
   - Keep only high-leverage local artifacts.

## Success criteria

- Foundation is clearly repo-specific.
- Local config is explicit and narrow.
- Workflow supports explore -> design -> implement -> review.
- Instructions are high-signal and not procedurally bloated.
- Artifacts are understandable by a new operator in one read.

## Output contract

```markdown
## Repo Signals
## Adopt / Bridge / Ignore Decisions
## Proposed Local Pi Foundation
## Risks and Safeguards
## Why this is the minimal high-leverage setup
```

## References

- `references/best-practices.md`
