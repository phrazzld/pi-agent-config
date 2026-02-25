# Daybook Model Evaluation (Charisma-first)

Goal: pick a default model for daybook that is engaging, coherent, and inexpensive enough for daily use.

## Candidate starter pool

Use OpenRouter model catalog + rankings as source of truth when selecting concrete IDs:
- https://openrouter.ai/models
- https://openrouter.ai/rankings
- https://openrouter.ai/collections/roleplay
- https://openrouter.ai/pricing

Initial practical shortlist to benchmark in-session:
1. `openrouter/anthropic/claude-3.5-haiku` (or latest Haiku-equivalent available)
2. `openrouter/openai/gpt-4.1-mini` (or latest mini writing-capable equivalent)
3. `openrouter/google/gemini-2.0-flash` (or latest Flash equivalent)
4. One premium control model (for comparison only), e.g. Sonnet-class

## Evaluation rubric (daybook-specific)

Score each model 1-5 on:
- charisma / voice warmth
- conversational flow (natural follow-ups)
- reflection depth without rambling
- factual restraint / uncertainty honesty
- cost per 1k tokens (input + output)
- latency responsiveness

## Procedure

1. Run the same 10 daybook prompts through each model.
2. Blind-rank transcripts for charisma + usefulness.
3. Compare cost/latency from session footer + provider pricing.
4. Pick:
   - default model (daily)
   - premium fallback model (deep reflection days)

## Acceptance criteria

- Default model must be clearly engaging while materially cheaper than premium fallback.
- No hallucination-prone behavior in factual/tool-assisted turns.
- Stable quality across at least 3 separate sessions.
