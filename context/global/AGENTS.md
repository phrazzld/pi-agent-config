# Global AGENTS.md — Pi runtime baseline

Loaded globally from `~/.pi/agent/AGENTS.md` for every Pi session.

## Scope

- Cross-repo defaults only.
- Keep this file short, stable, and high-signal.
- Push domain-specific workflow instructions into each repo’s local `AGENTS.md` (or `.pi/*`).

## Baseline behavior

- Prefer convention over configuration: one clear default path over optional flag sprawl.
- Favor Unix-style composition: small focused primitives combined into explicit workflows.
- Be concise, show concrete file paths and verification commands, and surface residual risk.
- Avoid destructive operations unless explicitly requested.

## Context precedence note

Pi concatenates context files with global first, then parent directories down to the current repo.
That means repo-local `AGENTS.md` should refine/override this baseline when needed.
