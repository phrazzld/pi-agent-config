# subagent extension

Delegates tasks to isolated `pi` subprocesses via a `subagent` tool.

## Why

- Keeps the parent session cleaner by offloading deep investigation/execution
- Enables parallel and chained delegation patterns
- Improves reflection/swarm workflows without adding many new commands

## Tool

### `subagent`

Modes (exactly one per call):

1. **single**
   - params: `agent`, `task`, optional `cwd`
2. **parallel**
   - params: `tasks: [{ agent, task, cwd? }, ...]`
   - max tasks: 8
   - max concurrency: 4
3. **chain**
   - params: `chain: [{ agent, task, cwd? }, ...]`
   - supports `{previous}` placeholder in later step tasks

Common params:
- `agentScope`: `user | project | both` (default `user`)
- `confirmProjectAgents`: boolean (default `true`)
- `maxTurns`: global turn budget override (default `80`)
- `maxRuntimeSeconds`: global runtime budget override (default `600`)

Per-task overrides:
- `tasks[].maxTurns`, `tasks[].maxRuntimeSeconds`
- `chain[].maxTurns`, `chain[].maxRuntimeSeconds`

Agent frontmatter can also set defaults:
- `maxTurns: <int>`
- `maxRuntimeSeconds: <int>`

## Agent discovery

- **User agents:** `~/.pi/agent/agents/*.md`
- **Project agents:** nearest `.pi/agents/*.md` in cwd ancestor chain

When `agentScope` includes project agents, interactive confirmation is required by default.

## Default source-of-truth setup in this repo

This repo versions agent definitions under `agents/` and `scripts/bootstrap.sh` symlinks it to `~/.pi/agent/agents`.

## Runtime visibility

The subagent card now surfaces live state while runs are in progress:
- runtime elapsed vs configured budget
- turns consumed vs configured budget
- tool call count
- context/token usage (input/output/cache/context)
- model used and last observed action

When a budget is exceeded, the subprocess is terminated and returns `aborted` with an explicit reason.

## Agent file format

```md
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash
model: openai-codex/gpt-5.3-codex
maxTurns: 40
maxRuntimeSeconds: 300
---

System prompt for the agent...
```
