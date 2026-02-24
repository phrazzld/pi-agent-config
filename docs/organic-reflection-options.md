# Organic Reflection Workflow Options

## Goal

Evolve Pi config from real work signals while preventing command/catalog bloat.

## Option A — Prompt + Skill only (toe-dip)

**Artifacts**
- `prompts/reflect.md`
- `skills/organic-reflection/`

**How it works**
- Manual `/reflect` runs replay recent work, scan configs, research best practices, and propose scored candidates.

**Pros**
- Minimal implementation cost
- Fully reversible

**Cons**
- Research lanes run sequentially unless manually orchestrated

## Option B — Reflection swarm (next)

**Artifacts**
- Subagent extension (local package or imported sample)
- Agent definitions for reflection lanes (memory, legacy-config, pi-capability, external-research)
- Optional `prompts/reflect-swarm.md`

**How it works**
- `/reflect` (or `/reflect-swarm`) launches parallel lanes and synthesizes findings.

**Pros**
- Better context isolation
- Faster exploration with parallel lanes

**Cons**
- Higher runtime complexity
- Requires maintaining subagent prompts

## Option C — Local-first memory index (next/later)

**Artifacts**
- Memory ingestion extension (sessions/logs/commits/issues/PRs)
- Local index + search tool
- Reflection prompt/skill updated to query memory index first

**Candidate engines**
- Session JSONL parser + lightweight index (custom)
- QMD (`https://github.com/tobi/qmd`) for local hybrid retrieval over markdown-derived artifacts

**Pros**
- Cross-session recall
- Stronger reflection signal quality

**Cons**
- Data modeling + ingestion maintenance
- Need clear retention/privacy policy

## Option D — External memory platform integration (later)

**Artifacts**
- Extension tool adapter to external memory API

**Examples to evaluate**
- Mem0 (`https://github.com/mem0ai/mem0`)
- Supermemory (`https://github.com/supermemoryai/supermemory`)

**Pros**
- Managed memory capabilities

**Cons**
- Vendor/dependency complexity
- Privacy and cost considerations

## Recommended rollout

1. Start with Option A (already in place).
2. Add Option B (subagent swarm) when parallel research overhead is felt repeatedly.
3. Add Option C local-first memory index once reflection quality is bottlenecked by recall.
4. Evaluate Option D only if local-first is insufficient.
