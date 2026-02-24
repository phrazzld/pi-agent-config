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

## Agent discovery

- **User agents:** `~/.pi/agent/agents/*.md`
- **Project agents:** nearest `.pi/agents/*.md` in cwd ancestor chain

When `agentScope` includes project agents, interactive confirmation is required by default.

## Default source-of-truth setup in this repo

This repo versions agent definitions under `agents/` and `scripts/bootstrap.sh` symlinks it to `~/.pi/agent/agents`.

## Agent file format

```md
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash
model: gpt-5.3-codex
---

System prompt for the agent...
```
