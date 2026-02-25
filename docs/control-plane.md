# Pi Control Plane

## Goal

Prevent an "agent zoo" by exposing a small, stable set of workload entry points.

## Design

Use workload targets (control-plane names), not raw extension stacks.

- `meta`: work on Pi config, orchestration, extensions, skills
- `research`: deep docs + retrieval investigations
- `delivery`: implementation workflow
- `ship`: delivery with stronger finish posture
- `autopilot`: issue-to-PR flow
- `baseline`: minimal safe default
- `quick`: fastest unblock path

## Commands

Install the control-plane binary (no shell wrapper):

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
pictl delivery
pictl autopilot
```

Low-level launcher (slice-first):

```bash
pictl slices
pictl slice pi-dev --profile meta
pictl slice research --profile meta
pictl slice --strict research --profile meta
```

One-off execution without installing:

```bash
go run ./cmd/pictl meta
```

## Mapping

| Target | Slice | Default Profile |
|---|---|---|
| `meta` | `pi-dev` | `meta` (`ultrathink`) |
| `research` | `research` | `meta` (`ultrathink`) |
| `delivery` | `delivery` | `execute` |
| `ship` | `delivery` | `ship` |
| `autopilot` | `autopilot` | `ship` |
| `baseline` | `baseline` | `execute` |
| `quick` | `baseline` | `fast` |

## Profile naming guidance

Canonical profile IDs remain:
- `ultrathink`, `execute`, `ship`, `fast`

Friendly aliases improve readability:
- `meta`, `deep`, `think` → `ultrathink`
- `build`, `dev`, `workhorse` → `execute`
- `release`, `deliver` → `ship`
- `quick` → `fast`

Use `/profile list` in-session.

## Shell alias suggestions

```bash
alias i='pi'
alias io='pictl'
alias imeta='pictl meta'
alias iresearch='pictl research'
alias idelivery='pictl delivery'
alias iauto='pictl autopilot'
```

## Strategic rule

If a new workflow cannot be expressed as either:
1. a new target in `pictl`, or
2. a new slice manifest in `slices/*.json`,

it is probably adding accidental complexity.
