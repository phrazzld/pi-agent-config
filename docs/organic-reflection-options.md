# Organic Reflection Workflow Options

## Goal

Evolve Pi config/process/tooling from real work signals while preventing command/catalog bloat.

## Option A — `/reflect` + skill only (toe-dip)

**Artifacts**
- `prompts/reflect.md`
- `skills/organic-reflection/`

**How it works**
- Manual `/reflect` runs replay recent work, scan configs, research best practices, and propose scored candidates.
- Scope is always both (repo + global).

**Pros**
- Minimal implementation cost
- Fully reversible

**Cons**
- Research lanes run sequentially unless manually orchestrated

## Option B — Swarm inside `/reflect` (next)

**Artifacts**
- Subagent extension (local package or imported sample)
- Agent definitions for reflection lanes (memory, legacy-config, pi-capability, external-research)

**How it works**
- `/reflect` recommends a swarm when subagents are available.
- User chooses whether to launch, how many agents to run, and which lanes to cover.

**Pros**
- Better context isolation
- Faster exploration with parallel lanes

**Cons**
- Higher runtime complexity
- Requires maintaining subagent prompts

## Option C — Local-first memory index (now/next)

**Artifacts**
- Memory ingestion/search extension
- Local index + retrieval tools
- Reflection wired to query memory first

**Current prototype direction**
- QMD-backed local retrieval over session/log markdown corpus
- Raw transcript excerpts + derived metadata/summaries

**Pros**
- Cross-session recall
- Stronger reflection signal quality
- No external SaaS dependency required

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

1. Keep Option A as baseline.
2. Add Option B inside `/reflect` when parallel research pressure appears.
3. Continue Option C local-first memory prototype and validate retrieval quality.
4. Evaluate Option D only if local-first memory is insufficient.
