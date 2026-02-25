# Pi Control Plane

## Goal

Expose a **small, workflow-first launcher surface** so starting Pi is obvious and repeatable.

## Core targets (first principles)

These are the only interactive picker targets:

- `meta` — evolve Pi platform config, slices, extensions, agents, prompts
- `build` — daily software engineering in product repositories
- `autopilot` — bounded issue-to-PR execution workflow
- `research` — deep docs/retrieval investigations
- `daybook` — charisma-first one-on-one journaling

Legacy names still resolve as aliases (`delivery`, `software`, `ship`, etc.).

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
pictl autopilot
pictl research
pictl daybook
```

Low-level slice launcher:

```bash
pictl slices
pictl slice pi-dev --profile meta
pictl slice software --profile execute
pictl slice daybook --profile fast
pictl slice --strict research --profile meta
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
| `meta` | `pi-dev` | `meta` (`ultrathink`) |
| `build` | `software` | `execute` |
| `autopilot` | `autopilot` | `ship` |
| `research` | `research` | `meta` (`ultrathink`) |
| `daybook` | `daybook` | `fast` |

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
alias iauto='pictl autopilot'
alias iresearch='pictl research'
alias idaybook='pictl daybook'
```

## Strategic rule

If a new workflow cannot be expressed as either:
1. a control-plane target, or
2. a slice manifest in `slices/*.json`,

it is probably accidental complexity.

## Validation

Run `docs/control-plane-smoke-check.md` after control-plane changes.
