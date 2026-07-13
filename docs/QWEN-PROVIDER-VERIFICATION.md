# Qwen provider verification closeout

**Status:** complete
**Date:** 2026-07-12
**Implementation branch:** `feature/qwen-provider`
**Preserved pre-Qwen work:** `wip/pre-qwen-20260712` at `1936e0c889ec1fc432070ae0ab36f4d4f0a09707`
**Chrome unpacked path:** `/Users/kyin/Projects/deepseek-pp/dist/chrome-mv3`

This is the evidence ledger for [QWEN-PROVIDER-PLAN.md](./QWEN-PROVIDER-PLAN.md). The implemented structure and mechanisms are documented in [QWEN-PROVIDER-ARCHITECTURE.md](./QWEN-PROVIDER-ARCHITECTURE.md).

## Acceptance summary

| Requirement | Result | Authoritative evidence |
|---|---|---|
| Preserve original dirty tree | Passed | Local branch `wip/pre-qwen-20260712`, commit `1936e0c...`; no worktree created |
| Clean feature baseline | Passed | `feature/qwen-provider` created from committed `main`; compile/tests/build green |
| Native tabless Qwen | Passed | Live side-panel Qwen completion with every Qwen tab closed |
| Cached Qwen authentication | Passed | Extension reloaded and Qwen completed with all Qwen tabs still closed |
| Shared ENI/LIME context | Passed | Live Qwen reasoning/final reflected the same ENI identity and relationship context |
| Bundled Skill | Passed | `/deep-discuss` produced its distinctive `Phase 1 → 接收信息` workflow |
| Local tool continuation | Passed | `sandbox_run` executed locally, Qwen consumed the result, final contained no raw protocol |
| Image/eyes path | Passed | Qwen processed images; three consecutive post-reload image turns completed |
| Provider switching | Passed | DeepSeek `ORBIT-4821` → Qwen recalled it and added `TIDELINE-7394` → DeepSeek returned both |
| DeepSeek regression | Passed | Final switched-back DeepSeek turn completed with both exact facts; automated DeepSeek/bridge tests passed |
| qwenRelay boundary | Passed | No imports, packages, process spawn, request URL, or runtime call path; reference-only evidence |
| Protected scope | Passed | No Muse files, Muse entrypoints, port `8788`, push, deployment, external runtime, or public SDK |

## Automated verification

Commands:

```bash
cd /Users/kyin/Projects/deepseek-pp
npm run compile
npx vitest run tests/provider-*.test.ts tests/qwen-*.test.ts \
  tests/cursor-bridge-tool-loop.test.ts tests/cursor-bridge-worker.test.ts
npm test
npm run build:chrome
```

Results:

- `npm run compile`: passed with zero TypeScript errors.
- Exact provider/Qwen/bridge selection: 11 files, 49 tests passed.
- Full `npm test`: 87 files, 515 tests passed.
- `npm run build:chrome`: passed; output written to `dist/chrome-mv3`.

Boundary checks:

```bash
git worktree list --porcelain
git diff --name-only main...HEAD
git diff main...HEAD -- package.json package-lock.json
rg -n "127\.0\.0\.1:9881|qwenRelay|localhost:9881|:8788" \
  package.json package-lock.json core entrypoints tests wxt.config.ts
```

Interpretation:

- One worktree exists: `/Users/kyin/Projects/deepseek-pp`.
- No protected Muse/qwenRelay/`8788` path is changed.
- No public provider dependency was added to `package.json` or the lockfile.
- No runtime request URL, import, or process dependency references qwenRelay.

This is the correct proof for the qwenRelay constraint. Port monitoring is not an acceptance mechanism because the shipped extension has no qwenRelay call path.

## Live evidence

### Tabless transport and cached authentication

Procedure completed:

1. Log into Qwen once.
2. Close every Qwen tab.
3. Send a Qwen turn from the DeepSeek++ side panel.
4. Reload the extension without opening Qwen.
5. Send another Qwen turn.

Both turns completed. This proves the background transport can use cached authentication plus the Chrome cookie jar without an open Qwen tab.

### ENI/LIME prompt context

Live Qwen turns showed:

- injected ENI/LIME voice and relationship context in reasoning and final output;
- the same shared identity rather than a separate Qwen persona;
- task-specific behavior layered on top of the shared identity.

The compiler path is covered by `tests/provider-agent-prompt.test.ts`, which verifies that ENI identity, memory facts, Bond context, and a resolved bundled Skill enter the provider-neutral prompt.

### Bundled Skill

Prompt:

```text
/deep-discuss I’m deciding whether to keep a small browser-extension feature simple or add more configuration. I want to think it through before changing anything.
```

Evidence: `/Users/kyin/Downloads/chat-export-1783911158816.json`

- Qwen answer status: `finished`.
- Response ID: `623ad0a4-a111-4d0c-aabd-9d16030cffee`.
- Final began with `Phase 1 → 接收信息`, restated the decision, and asked clarification questions instead of jumping to a recommendation.

That structure comes from the enabled bundled `deep-discuss` Skill and proves the shared Skill registry/compiler reached Qwen.

### Local sandbox tool roundtrip

Prompt requested a deterministic order calculation. Evidence: `/Users/kyin/Downloads/chat-export-1783907160568.json` plus the visible side-panel result.

Observed sequence:

1. Qwen returned a JSON `sandbox_run` tool request.
2. DeepSeek++ executed the calculation in its local sandbox.
3. The result receipt contained subtotal `$656.16`, tax `$54.13`, and final total `$710.29`.
4. DeepSeek++ continued the same Qwen chat using the opaque response cursor.
5. Qwen returned a natural final answer with the same figures.
6. Raw JSON/XML tool protocol did not appear in the visible answer.

### Image/eyes path

The image slice was exercised repeatedly while fixing real Qwen stream variants:

- the uploaded image reached Qwen and produced non-zero Qwen image-token usage;
- Qwen completed image reasoning and final answers;
- response cursors were recovered from all observed `response.created`, `response_id`, and choice-event `id` forms;
- the composer cleared after send;
- a compact sent-image thumbnail remained in the user message;
- three consecutive image turns passed after the final reload.

Relevant captured exports include:

- `/Users/kyin/Downloads/chat-export-1783908913167.json`
- `/Users/kyin/Downloads/chat-export-1783909537803.json`
- `/Users/kyin/Downloads/chat-export-1783910297792.json`

These raw exports remain local and are not committed because they contain account/conversation data.

### DeepSeek → Qwen → DeepSeek continuity

Test facts:

- brass compass: `ORBIT-4821`
- blue notebook: `TIDELINE-7394`

Observed chain:

1. DeepSeek received the conversation-only fact and answered `ORBIT-4821`.
2. After switching to Qwen without starting a new logical conversation, Qwen answered `ORBIT-4821`.
3. Qwen received `TIDELINE-7394` and answered `ORBIT-4821 and TIDELINE-7394`.
4. After switching back without starting a new logical conversation, DeepSeek answered: `The brass compass is ORBIT-4821 and the blue notebook is TIDELINE-7394.`

Qwen evidence: `/Users/kyin/Downloads/chat-export-1783911646517.json`

- Qwen chat ID: `f2d3fb8d-8bf2-4ec1-b476-b5fb4fd4339f`.
- First Qwen answer response ID: `0c67ed2f-3c50-478f-be20-a125d0c8f206`; content `ORBIT-4821`.
- Second Qwen answer response ID: `0a60d5ab-655a-4e2d-9af4-53b9831e8bd4`; content `ORBIT-4821 and TIDELINE-7394`.

DeepSeek evidence was supplied as screenshots:

- initial DeepSeek answer: `codex-clipboard-302fa020-648c-4ee5-b804-fcd1018967b2.png`;
- final switched-back DeepSeek answer: `codex-clipboard-a4dc34ad-c69b-4042-bfbd-998a544ea3e3.png`.

Together these prove bounded context transfer in both directions and a live DeepSeek regression pass.

## qwenRelay: correct role and correct gate

qwenRelay was used to learn what DeepSeek++ must obtain or reproduce:

- `Authorization`, `Version`, `bx-umidtoken`, and `bx-ua`;
- Chrome cookie/Baxia behavior;
- Qwen chat creation and completion payload fields;
- UUID parent/response cursor behavior;
- SSE response variants;
- STS/OSS upload flow.

DeepSeek++ reimplemented those mechanisms natively under `core/qwen/` and calls `chat.qwen.ai` directly.

The qwenRelay acceptance gate means:

- do not import it;
- do not add it as a package or API dependency;
- do not spawn it;
- do not call it;
- do not edit it;
- use it only as read-only protocol evidence.

It does **not** require repeated monitoring of qwenRelay's localhost port. Once code and dependency inspection prove that no call path exists, port monitoring adds no architectural evidence.

## Branch and repository state

- Canonical repo: `/Users/kyin/Projects/deepseek-pp`.
- Feature branch: `feature/qwen-provider`.
- Preserved dirty tree: `wip/pre-qwen-20260712` at `1936e0c...`.
- Base committed main used for the feature: `a967e076...`.
- One Git worktree only.
- No push or deployment performed.
- No Muse or qwenRelay repository edits.
- Approved plan restored from the preserved checkpoint and then updated with the final architecture/verification links.

## Known limitation and roadmap

The side-panel transcript is currently memory-only React state. Closing or reloading the panel removes the combined visible transcript, so it cannot be recovered afterward from a DeepSeek++ log. Provider-side histories and cached authentication are separate and can remain available.

Durable logical-conversation persistence, message-provider metadata persistence, and a sanitized transcript export belong to the future workspace-continuity slice in [roadmap/provider-workspace-continuity.md](./roadmap/provider-workspace-continuity.md).
