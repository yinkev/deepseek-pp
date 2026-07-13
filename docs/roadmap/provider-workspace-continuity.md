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

## Qwen account behavior and native capabilities

**Status:** discovery only; defer until after the approved Qwen parity slice.

Qwen Web currently exposes provider-owned account behavior that may be applied server-side in addition to DeepSeek++ prompt context:

- Saved memory with a 50-item limit; the oldest item is removed when the limit is exceeded.
- Separate controls for referencing saved memories and chat history.
- Customize Qwen fields for nickname, user background, response style (`Default`, `Concise`, `Socratic`, `Formal`), custom instructions, and enablement in new chats.
- Turn-level reasoning choices: `Auto`, `Thinking`, and `Fast`.

Qwen Web also exposes native capabilities and modes:

- Advanced tools: web scraping, image search, web search, image generation, Code Interpreter, historical-memory retrieval, image editing, memory update, and local image enlargement.
- Product modes: Deep Research, Create Image, Create Video, Web Dev, Slides, Artifacts, Learn, and Travel Planner.

A local capability audit on Qwen Web build `0.2.72` identified these relevant contracts without preserving credentials:

- `GET /api/v2/configs/`
- `POST /api/v2/users/user/settings/update`
- Chat and file surfaces including `/api/v2/chat/completions`, `/api/v2/chats`, `/api/v2/files/getstsToken`, `/api/v2/files/getfilelink`, `/api/v2/files/parse`, and `/api/v2/files/parse/status`.
- Bundle modes/capabilities for Deep Research, image/video creation, Web Dev, Slides, Artifacts, Learn, Travel Planner, web search, TTS, and task suggestions.

### Future integration rules

1. DeepSeek++ remains canonical for ENI/LIME, shared memories, Skills, presets, local tools, receipts, and continuation.
2. Do not mirror ENI or the shared memory database into Qwen Customize or Qwen's 50-item memory store.
3. Map account-level customization and memory injection before enabling them, so Qwen does not double-inject identity or context.
4. Keep overlapping Qwen-native search and code execution disabled by default while DeepSeek++ owns those actions.
5. Add genuinely provider-native features—image/video generation, image editing, Deep Research, Slides, Web Dev, and similar output modes—as explicit Qwen-only capabilities behind the provider boundary.
6. Map `Auto` / `Thinking` / `Fast` to verified Qwen request fields before exposing a selector.
7. Capture and test each native mode's request payload, output phases, generated artifact identifiers, cancellation behavior, and rate-limit errors before implementation.
8. Never commit raw capability-audit exports containing cookies, authorization values, account data, or conversation content; store only the sanitized contract.

## Completion criteria for a future slice

1. Switching with continuity on preserves bounded DeepSeek → Qwen → DeepSeek context.
2. Switching with continuity off does not transfer transcript content.
3. ENI, memory, Skill, hands, and eyes behavior remains deterministic and documented in both modes.
4. Existing conversations migrate without data loss.
