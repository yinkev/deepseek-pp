# DeepSeek++ PC Runtime Hardening Wave 2 — Module Inventory

## Rating

本清单以 `450b5e2` 为基线，按顶层领域模块盘点；官方 Skill Markdown/资源不计入 TS LOC。评分格式为 `S/U/P/E/R`：Single Purpose、Unidirectional Flow、Ports over Implementation、Environment-Agnostic、Replaceable Parts；🟢 符合，🟡 部分符合，🔴 明确热点。

## Core Modules

| Module | Responsibility / public surface | Files / TS LOC | Complexity | S.U.P.E.R |
|:--|:--|--:|:--|:--|
| Root contracts (`types.ts`, `constants.ts`, `messaging.ts`, `version.ts`, `whats-new.ts`) | Shared types、legacy `MessageAction`、constants、compat exports | 5 / 852 | High | S🔴 U🟡 P🔴 E🟢 R🔴 |
| `artifact` | Artifact codec、IndexedDB、ZIP、tool execution | 6 / 908 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `automation` | Schedule、lease、runner、retry/cancellation | 10 / 2,821 | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `background` | Background image config/store | 2 / 43 | Low | S🟢 U🟢 P🟡 E🟡 R🟡 |
| `browser` | Safe WXT/browser API access | 1 / 68 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `browser-control` | CDP service、actions、tool provider | 8 / 2,023 | High | S🟡 U🟡 P🟢 E🔴 R🟡 |
| `chat` | Chat config、active loop、pending text | 6 / 260 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `deepseek` | Route/request/SSE codecs、active clients、PoW/export | 12 / 2,647 | High | S🟡 U🟢 P🟢 E🟡 R🟢 |
| `export` | Conversation schemas、normalize、render、attachments | 11 / 1,632 | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `floating-chat` | Enable store、four-state runtime model | 2 / 46 | Low | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `history-organizer` | History label storage contract | 1 / 58 | Low | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `i18n` | Typed keys、translator、resources、preference | 5 / 3,231 | Medium | S🟢 U🟢 P🟢 E🟢 R🟡 |
| `inline-agent` | Loop、prompt、trace、renderer | 8 / 1,423 | High | S🟡 U🟡 P🟢 E🔴 R🟡 |
| `interceptor` | Fetch/XHR hooks、stream/tool filtering、history cleanup | 7 / 2,843 | Critical | S🔴 U🟡 P🟡 E🔴 R🔴 |
| `mcp` | Protocol client、store、discovery、five transports | 15 / 2,702 | Critical | S🟡 U🟢 P🟡 E🟡 R🟡 |
| `memory` | Sole codec、Dexie migrations/repository、scope/tool | 8 / 833 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `messaging` | Runtime/bridge contracts、payload codecs、broadcast | 17 / 3,433 | High | S🟡 U🟢 P🟡 E🟢 R🟡 |
| `model` | Model identifier helpers | 1 / 20 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `multimodal` | Media policy、provider settings、runtime helper | 6 / 627 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `network` | Abort/deadline and request budgets | 2 / 333 | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `persistence` | Locks、serial/coalescing queues | 5 / 199 | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `pet` | Pet config/state helpers | 3 / 134 | Low | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `platform` | Capability detection and gating | 4 / 166 | High | S🟢 U🟢 P🔴 E🔴 R🟡 |
| `preset` | Versioned preset/active-ID state | 2 / 215 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `project` | Versioned project state/context/recovery | 5 / 669 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `prompt` | Prompt composition and settings | 4 / 427 | High-contract | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `sandbox` | Request/result contracts and worker policies | 6 / 695 | High | S🟡 U🟡 P🟡 E🔴 R🟡 |
| `saved-items` | Versioned saved item state and export | 4 / 244 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `scenario` | Scenario codec/store/application service | 3 / 212 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `shell` | Browser-side Shell catalog/policy/contract | 3 / 196 | High-contract | S🟢 U🟢 P🟡 E🟡 R🟡 |
| `skill` | Skill codecs、registry、GitHub/local import、bundled loader | 12 / 3,897 | Critical | S🔴 U🟡 P🔴 E🟡 R🔴 |
| `sync` | Backends、OAuth、generation/journal/CAS/apply | 19 / 2,620 | Critical | S🟡 U🟢 P🟢 E🟡 R🟢 |
| `theme` | Theme types | 1 / 16 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `token` | Token speed types | 1 / 13 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `tool` | Tool contracts、providers、runtime、history、XML | 24 / 3,841 | Critical | S🟡 U🟡 P🟡 E🟡 R🟡 |
| `tool-loop` | Injected pure execution loop | 1 / 111 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `ui` | Shared DOM/React rendering helpers | 5 / 1,413 | Medium | S🟡 U🟢 P🟡 E🔴 R🟡 |
| `usage` | Usage codecs、store、write coordinator | 7 / 785 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `voice` | Speech input helper | 1 / 58 | Low | S🟢 U🟢 P🟡 E🔴 R🟡 |

## Entrypoints and Native Package

| Module | Responsibility / public surface | Files / TS LOC | Complexity | S.U.P.E.R |
|:--|:--|--:|:--|:--|
| `entrypoints/background.ts` | Runtime listener、service-worker composition/lifecycle | 1 / 1,411 | Critical | S🟡 U🟢 P🟡 E🟡 R🟡 |
| `entrypoints/background/` | Typed handlers/services/adapters | 28 / 3,199 | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `entrypoints/content.ts` | DeepSeek DOM capability composition and state | 1 / 7,417 | Critical | S🔴 U🟡 P🟡 E🔴 R🔴 |
| `entrypoints/content/` | Lifecycle、bridge、DOM controllers/adapters | 14 / 4,164 | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `main-world.content.ts` | MAIN composition | 1 / 89 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `floating-chat.content.ts` | Global launcher composition | 1 / 22 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| Sandbox entrypoints | Offscreen relay and runner composition | 2 / 403 | High | S🟢 U🟡 P🟡 E🔴 R🟡 |
| `entrypoints/sidepanel/` | React pages、typed client、controllers | 60 / 13,390 | High | S🟡 U🟢 P🟢 E🟡 R🟡 |
| `packages/shell-host` | Native framing/router/providers/installer | ~2,878 JS/MJS LOC | High | S🟢 U🟢 P🟡 E🟡 R🟡 |

## Current Hotspots and Candidate Ownership

### MCP receiving boundary

- `core/mcp/transports/common.ts` owns response normalization, but currently rewrites malformed JSON-RPC rather than rejecting it.
- `core/mcp/client.ts` owns discovery and result normalization, but output and tool-count budgets are not exact.
- Candidate task should make this one strict receiving codec and byte/count authority; transports must not reimplement it.

### Platform capability boundary

- The 15-key serialized environment contract remains compatibility-sensitive.
- Do not add a broad platform facade or a capability with no production consumer.
- Candidate task should make loading/unsupported explicit, keep `downloads` false unless the manifest contract actually grants it, and give sync OAuth a narrow consumer-owned check.

### Shell contract

- Native router hardcodes its server version while npm metadata owns the released package version.
- Browser and Native catalogs must retain exact 12-tool names/order/schema/risk while reducing duplication.
- A shared serializable contract source is preferable to runtime cross-package imports with hidden build assumptions.

### Content and Background roots

- Both roots have clean lifecycle/handler foundations, so future extraction should move one coherent feature owner at a time and delete the old path immediately.
- These large roots should not be edited concurrently by multiple lanes.

### Skill importers

- GitHub and local importers separately own size limits、frontmatter parsing、name allocation and conflict policy.
- A future task may extract a pure shared import policy while leaving source adapters separate; it is not required for the first bounded wave-2 batch.

## Healthy References

- `core/export/`：transport port + schema + normalizer + renderer。
- `core/tool-loop/engine.ts`：pure engine with injected effects。
- `core/network/`：shared cancellation/deadline policies。
- `entrypoints/background/*-handlers.ts`：typed receiving boundaries with injected dependencies。
- `packages/shell-host/native/router.mjs` + provider groups：composition and registration direction is correct even though catalog/version truth still needs closure。
