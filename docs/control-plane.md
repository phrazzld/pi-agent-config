# Pi Control Plane

## Goal

Expose a **small, workflow-first launcher surface** so starting Pi is obvious and repeatable.

## Core targets (first principles)

These are the only interactive picker targets:

- `meta` — evolve Pi platform config, slices, extensions, agents, prompts
- `build` — daily software engineering in product repositories
- `daybook` — charisma-first journaling and brainstorming workflow
- `ops` — system reliability, incident forensics, and watchdog workflows

Legacy names still resolve as aliases (`delivery`, `software`, `ship`, `autopilot`, `research`, `sysadmin`, `argus`, etc.).

Capability posture is layered inside these kernels:
- **autopilot** is a build capability (pipeline/agent workflow), not a top-level target
- **research** is done inside meta/build/daybook context, not as a separate target

## Commands

Install the control-plane binary:

```bash
go install ./cmd/pictl
```

If needed, add Go bin dir to PATH:

```bash
export PATH="$(go env GOPATH)/bin:$PATH"
```

Primary launcher:

```bash
pictl
pictl list
pictl meta
pictl build
pictl daybook
pictl ops
```

Low-level slice launcher:

```bash
pictl slices
pictl slice meta --profile meta
pictl slice software --profile execute
pictl slice daybook --profile fast
pictl slice sysadmin --profile execute
```

One-off execution without install:

```bash
go run ./cmd/pictl meta
```

## Default policy

- In `pi-agent-config`: start with `pictl meta`.
- In product repos: run `pictl meta` once to bootstrap local `.pi/`, then switch to `pictl build`.

## Mapping

| Target | Slice | Default Profile |
|---|---|---|
| `meta` | `meta` | `meta` (`ultrathink`) |
| `build` | `software` | `execute` |
| `daybook` | `daybook` | `fast` |
| `ops` | `sysadmin` | `execute` |

## Profile naming guidance

Canonical profile IDs:
- `ultrathink`, `execute`, `ship`, `fast`

Friendly aliases:
- `meta`, `deep`, `think` → `ultrathink`
- `build`, `dev`, `workhorse` → `execute`
- `release`, `deliver` → `ship`
- `quick` → `fast`

Use `/profile list` in-session.

## Shell aliases

```bash
alias i='pi'
alias io='pictl'
alias imeta='pictl meta'
alias ibuild='pictl build'
alias idaybook='pictl daybook'
alias iops='pictl ops'
```

## Strategic rule

If a new workflow cannot be expressed as either:
1. a control-plane target, or
2. a slice manifest in `slices/*.json`,

it is probably accidental complexity.

## Validation

Run `docs/control-plane-smoke-check.md` after control-plane changes.
