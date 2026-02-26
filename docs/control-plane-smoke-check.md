# Control Plane Smoke Check

Run this before relying on a new `pictl` update.

## 1) Build + discover

```bash
go install ./cmd/pictl
pictl doctor
pictl list
pictl slices
```

Expected:
- `doctor` shows this repo as root and reports targets/slices.
- `list` shows: `meta`, `build`, `daybook`, `ops`.

## 2) Meta default in this repo

```bash
pictl meta
```

Expected:
- Pi starts with `meta` slice.
- Profile defaults to `meta` (alias of `ultrathink`) unless overridden.

## 3) Build + daybook + ops launch paths

```bash
pictl build
pictl daybook
pictl ops
```

Expected:
- `build` starts with software-engineering orchestration + visibility stack.
- `daybook` starts with charisma journaling posture + visibility instrumentation.
- `ops` starts with watchdog + handoff + orchestration tooling.

## 4) Strict slice launch path

```bash
pictl slice --strict meta --profile meta
```

Expected:
- Pi launches in strict mode with only configured slice extensions.

## 5) Extension regression baseline

```bash
./scripts/test-extensions.sh
```

Expected:
- All extension tests pass.

## 6) Go unit tests

```bash
env -u PI_DEFAULT_PROFILE go test ./...
```

Expected:
- `internal/controlplane` tests pass.

## If anything fails

- Stop and fix before proceeding with workflow changes.
- Record systemic drift in `docs/migration-backlog.md`.
