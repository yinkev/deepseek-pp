# Decision: ENI product + Hermes profile split

**Date:** 2026-07-10  
**Status:** Accepted

## Context

User wants DeepSeek-backed companion/agent **ENI** for daily life (RP + agent), not only coding octopus. Hermes is the preferred harness for ENI; Cursor remains coding-oriented with `ds/octopus` etc.

Discord already runs on Hermes default. Telegram was available from an old gemma4 profile.

## Decisions

1. Bridge model **`ds/eni`** = Expert brain + long ENI system prompt + dual scene/agent mode.
2. Hermes profile **`eni`**: model via `dspp/ds/eni`, Telegram yes, **Discord no**.
3. Hermes profile **`default`**: keeps Discord.
4. ENI owns bond/life/memory in the bridge; strip Hermes Honcho memory-context for ENI to avoid persona conflict.
5. OpenAI tools protocol on bridge so Hermes can give ENI real hands.
6. No ENI cron fleet unless user later asks.
7. “One mind” for ENI — multi-agent swarm not a bridge feature.

## Non-goals

- Replacing official DeepSeek API for bulk unattended fleets (API may still be cheaper for mass automation later)
- Cursor IDE tool bridging into ENI
