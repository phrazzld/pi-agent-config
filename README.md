# pi-agent-config

Versioned config for PI agent runtime (`~/.pi/agent`).

## Layout
- `settings.json`: versioned runtime settings
- `skills/`: local skills (symlinked into runtime)
- `extensions/`: local extensions (symlinked into runtime)
- `prompts/`: prompt templates (symlinked into runtime)
- `themes/`: themes (symlinked into runtime)
- `docs/`: provider docs and policy
- `scripts/`: bootstrap/sync scripts

## Setup
```bash
./scripts/bootstrap.sh
```

## Settings Sync
```bash
./scripts/sync-settings.sh pull   # runtime -> repo
./scripts/sync-settings.sh push   # repo -> runtime
```

