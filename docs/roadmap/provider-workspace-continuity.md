# Roadmap — provider modules and workspace continuity

**Status:** deferred until the approved Qwen provider parity slice is complete  
**Date:** 2026-07-12  
**Intent:** Keep model providers replaceable without duplicating the user's DeepSeek++ identity or runtime.

## Durable boundary

- A **provider module** owns authentication, transport, model metadata, upload constraints, and response/tool encoding.
- A **DeepSeek++ workspace** owns ENI/LIME, memories, Skills, presets, tools/hands, eyes, and user-visible conversation state.
- Providers consume workspace context through the provider-neutral chat contract. They do not own or duplicate workspace databases.

## Future control

Add a setting named **Share continuity across providers**, defaulting to on.

- **On:** bounded visible conversation context follows DeepSeek ↔ Qwen switches while the same workspace identity, memories, Skills, and tools remain active.
- **Off:** each provider retains its own conversation session and no transcript is transferred during a switch.
- Tools and installed Skills remain workspace capabilities in both modes.
- Do not create separate per-provider memory databases or automatic memory merging. If fully separate identities are needed later, model them as named workspaces/profiles rather than provider-owned state.

## Explicitly deferred

- No continuity toggle during the current Qwen parity slice.
- No memory schema migration.
- No provider-specific copies of ENI, Skills, tools, receipts, or continuation logic.
- No change to the approved default: one shared ENI/LIME workspace across DeepSeek and Qwen.

## Completion criteria for a future slice

1. Switching with continuity on preserves bounded DeepSeek → Qwen → DeepSeek context.
2. Switching with continuity off does not transfer transcript content.
3. ENI, memory, Skill, hands, and eyes behavior remains deterministic and documented in both modes.
4. Existing conversations migrate without data loss.

