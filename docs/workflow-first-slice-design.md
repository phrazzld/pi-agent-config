# Workflow-First Slice Design

This defines slices from first principles (real workflows), not from extension availability.

## Principle

Start with **what you are trying to do now**, then load the smallest capability set that reliably supports that workflow.

## Core workflows

| Workflow | Trigger question | Target | Slice | Required primitives |
|---|---|---|---|---|
| Platform evolution | "Am I changing Pi config/architecture itself?" | `meta` | `pi-dev` | visibility, orchestration, subagent, web retrieval, bootstrap primitive |
| Daily product engineering | "Am I implementing features/fixes in an app repo?" | `build` | `software` | planner/worker/reviewer pipelines, guardrails, visibility, retrieval |
| Autonomous issue-to-PR | "Do I want bounded automation through PR readiness?" | `autopilot` | `autopilot` | checkpoints, governance, orchestration, visibility |
| Deep investigation | "Am I mostly researching docs/APIs/options?" | `research` | `research` | retrieval, subagent, visibility |
| Journaling/daybook | "Am I doing reflective one-on-one writing?" | `daybook` | `daybook` | daybook tone layer, selective retrieval, memory search, visibility |

## Usage decision tree

1. Are you modifying `pi-agent-config` or `.pi` architecture? → `pictl meta`
2. Else, are you journaling/reflection-first? → `pictl daybook`
3. Else, are you running issue-to-PR automation with checkpoints? → `pictl autopilot`
4. Else, are you doing primarily research? → `pictl research`
5. Else (default coding work) → `pictl build`

## Why only these targets

- Keeps startup choice cognitively small.
- Maps directly to day-to-day intentions.
- Leaves advanced composition to declarative pipelines/teams inside each slice.

## Relationship between team and pipeline

- **Team** = available specialists for parallel/delegated work.
- **Pipeline** = explicit phase ordering and handoffs.

A slice can expose both:
- default team for ad-hoc delegation (`/team ...`)
- multiple pipelines for structured workflows (`/pipeline ...`)

## Bootstrap pattern

In a new repo:

```bash
pictl meta
/bootstrap-repo --domain <repo-domain>
# exit and relaunch
pictl build
```

This keeps meta as architect/bootstrap and build as day-to-day runtime.
