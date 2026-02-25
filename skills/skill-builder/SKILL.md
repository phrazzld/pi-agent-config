---
name: skill-builder
description: |
  Create new Pi skills from procedural knowledge. Invoke proactively when:
  - discovering a reusable workflow pattern worth preserving
  - user asks to capture something as reusable
  - recognizing institutional knowledge that should persist
  - solving a problem in a novel repeatable way
  - noticing repeated patterns across sessions
  AUTONOMOUS: Create skills proactively, then inform user.
effort: high
---

# Skill Builder

Build new skills that capture procedural knowledge.

## Autonomy Model

**Create then inform**: when knowledge is clearly skill-worthy, create it and then report what was created and why.

## Quality Gates (all required)

| Gate | Question | Fail Criteria |
|------|----------|---------------|
| **REUSABLE** | Applies beyond this one task? | One-off solution |
| **NON-TRIVIAL** | Required discovery/synthesis? | Just copied docs |
| **SPECIFIC** | Clear trigger conditions? | Vague applicability |
| **VERIFIED** | Confirmed working? | Theoretical only |

If any gate fails, do not extract as a skill.

## Workflow

1. Identify the reusable knowledge and triggers.
2. Draft concise SKILL.md with clear scope and output contract.
3. Prefer progressive disclosure (`references/`) for deep details.
4. Validate structure and applicability.
5. Inform user what was created, why, and when to use it.

## Foundational vs Workflow Skills

- **Foundational**: broad principles, always-on mental model.
- **Workflow**: explicit triggers and action-oriented execution.

Bias global config toward foundational + high-frequency workflow skills.
Keep repo/domain-specific skills local to that repository.

## Practical rule

If a skill is tightly bound to one codebase (e.g., domain rewrite tuning), keep it repo-local.
If it improves most sessions, keep it global.
