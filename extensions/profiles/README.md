# Profiles Extension

Adds profile modes for thinking + tool activation.

Profiles now preserve explicit **always-on base capabilities** when available:
- `subagent`
- `team_run`
- `pipeline_run`
- `memory_context`
- `memory_search`
- `memory_ingest`
- `web_search`

This keeps orchestration/memory primitives available across slices (`meta/build/ship/fast`) while still allowing profile-specific tool emphasis.


Operating philosophy baked into profile instructions:
- convention over configuration
- Unix-style composition (small focused primitives combined into workflows)

Canonical profile names:
- `ultrathink`
- `execute`
- `ship`
- `fast`

Friendly aliases:
- `meta`, `deep`, `think` → `ultrathink`
- `build`, `dev`, `workhorse` → `execute`
- `release`, `deliver` → `ship`
- `quick` → `fast`

Use:
- `/profile <name>`
- `/profile list`
- `pi --profile <name>`
- `PI_DEFAULT_PROFILE=<name>`
