# v1.0.5 Independent Parity Loop

## Goal

Independently implement parity-or-better behavior for the scoped upstream v1.0.5 feature set while preserving the MIT-clean checkpoint from v1.0.2.

## Hard Bounds

- Do not copy or translate upstream v1.0.5 source, tests, assets, docs, naming-heavy structures, or implementation text.
- Use behavior-level understanding only, then implement in this repo style.
- Do not add dependencies.
- Do not change manifest permissions.
- Do not make incompatible storage schema changes.
- Stop before secret/global config changes or irreversible/account-affecting actions.

## Initial Checkpoint

- Branch: `codex/v105-independent-loop`.
- Dirty files before edits: none (`git status --short --branch` showed `## main...fork/main [ahead 199]`; after branch switch tree was clean).
- Advisor CLIs: `grok` found at `/Users/kyin/.grok/bin/grok`; `claude` found at `/Users/kyin/.local/bin/claude`.
- License/provenance files checked:
  - `LICENSE`: MIT.
  - `package.json`: `license` is `MIT`, version `1.0.2`.
  - `docs/decisions/mit-license-checkpoint.md`: documents v1.0.2 MIT checkpoint and forbids importing post-v1.0.2 Apache source patches.

## Current Module Inventory

| Area | Primary local files | Current local tests |
| --- | --- | --- |
| Interceptor / prompt injection | `entrypoints/main-world.content.ts`, `entrypoints/content.ts`, `core/interceptor/fetch-hook.ts`, `core/interceptor/request-augmentation.ts`, `core/interceptor/history-cleanup.ts`, `core/interceptor/tool-parser.ts`, `core/interceptor/streaming-tool-call-parser.ts`, `core/interceptor/streaming-tool-text.ts` | `tests/request-augmentation.test.ts`, `tests/fetch-hook-lifecycle.test.ts`, `tests/history-cleanup.test.ts`, `tests/streaming-tool-call-parser.test.ts`, `tests/streaming-tool-text.test.ts`, `tests/tool-parser.test.ts`, `tests/xml-tool-stream-filter.test.ts` |
| Inline agent | `core/inline-agent/loop.ts`, `core/inline-agent/prompt.ts`, `core/inline-agent/renderer.ts`, `core/inline-agent/markdown.ts`, `entrypoints/content.ts` | `tests/inline-agent-loop.test.ts`, `tests/inline-agent-prompt.test.ts`, `tests/inline-agent-renderer.test.ts`, `tests/inline-markdown.test.ts`, `tests/tool-block-style.test.ts` |
| MCP | `core/mcp/client.ts`, `core/mcp/discovery.ts`, `core/mcp/store.ts`, `core/mcp/transports/http.ts`, `core/mcp/transports/sse.ts`, `core/mcp/transports/native.ts`, `core/mcp/transports/common.ts`, `entrypoints/sidepanel/pages/McpPage.tsx` | `tests/mcp-transport-common.test.ts`, `tests/mcp-connection-lifecycle.test.ts`, `tests/mcp-execution-policy.test.ts`, `tests/mcp-native-multimodal-env.test.ts`, `scripts/mcp-smoke.mjs`, `scripts/mcp-live-mock.mjs` |
| Saved prompts/items | `core/saved-items/store.ts`, `core/saved-items/types.ts`, `entrypoints/sidepanel/pages/SavedPage.tsx`, `entrypoints/sidepanel/App.tsx`, `entrypoints/background.ts` | `tests/preset-crud.test.ts`, `tests/sidepanel-interactions.test.ts` |
| Model settings / webpage mode | `core/model/store.ts`, `core/chat/provider.ts`, `core/chat/sidepanel-job-runner.ts`, `entrypoints/sidepanel/pages/ChatPage.tsx`, `entrypoints/background.ts` | `tests/chat-provider.test.ts`, `tests/sidepanel-chat-job-runner.test.ts`, `tests/sidepanel-chat-attachments.test.ts`, `tests/automation-workflow-templates.test.ts` |
| Project state / new conversation | `core/project/store.ts`, `core/project/types.ts`, `entrypoints/content/adapters/project-sidebar-organizer.ts`, `entrypoints/content.ts`, `entrypoints/background.ts`, `entrypoints/sidepanel/pages/ProjectsPage.tsx` | `tests/project-context.test.ts`, `tests/project-sidebar-organizer.test.ts`, `tests/projects-page.test.ts`, `tests/project-deletion-cascade.test.ts` |
| Vision upload handling | `core/deepseek/web-vision.ts`, `core/deepseek/vision-evidence.ts`, `core/multimodal/media.ts`, `core/multimodal/contracts.ts`, `entrypoints/content.ts`, `entrypoints/background.ts`, `entrypoints/sidepanel/pages/ChatPage.tsx` | `tests/deepseek-web-vision.test.ts`, `tests/vision-evidence.test.ts`, `tests/content-vision-media-validation.test.ts`, `tests/multimodal-media.test.ts`, `tests/sidepanel-chat-attachments.test.ts` |
| Shell/tool execution | `core/shell/policy.ts`, `core/shell/contracts.ts`, `core/shell/index.ts`, `packages/shell-host/native/shell-mcp-host.mjs`, `packages/shell-host/lib/installer.mjs`, `scripts/shell-smoke.mjs` | `tests/shell-policy.test.ts`, `tests/mcp-native-multimodal-env.test.ts`, `scripts/shell-smoke.mjs` |
| Storage/sync | `core/sync/config.ts`, `core/sync/schema.ts`, `core/sync/webdav-client.ts`, `core/sync/local-skill-merge.ts`, `entrypoints/background.ts`, `entrypoints/sidepanel/components/settings/DataSubPage.tsx`, `entrypoints/sidepanel/components/settings/useSettingsState.ts` | `tests/sync-schema.test.ts`, `tests/sync-local-skill-merge.test.ts`, `tests/persisted-data-i18n.test.ts` |
| Manifest permissions | `wxt.config.ts`, `scripts/manifest-policy-check.mjs` | `npm run verify:manifest-policy` after browser builds |

## Feature Checklist And Gates

1. Project title refresh and project-scoped new-conversation handling.
   - Desired behavior: pending project intent binds only to the first new conversation; current conversation can be moved in/out; generated titles remain project-aware; no unrelated sidebar rewrite.
   - Gate: targeted project/sidebar tests plus compile if shared types change.
2. Inline-agent nudge stabilization.
   - Desired behavior: nudge only unfinished tool-intent responses; do not nudge normal final answers; cap repeated nudges; preserve final-answer extraction.
   - Gate: inline-agent loop/prompt tests.
3. Internal history cleanup for inline-agent/system continuation artifacts.
   - Desired behavior: internal continuation prompts/tool wrappers hidden from restored history; user-authored examples preserved; restored tool/agent UI still anchors correctly.
   - Gate: history-cleanup and tool-block-style tests.
4. Vision upload audit handling.
   - Desired behavior: pending, unknown, success, and reject upload states classify correctly; success returns safe metadata; reject is non-success; raw images not durably stored.
   - Gate: deepseek-web-vision and runtime storage tests.
5. Code-block download overlay.
   - Desired behavior: one overlay/button per code block; button outside code text; no nested/corrupted code; streaming rescans bounded.
   - Gate: phase5 product-surface/code-download tests.
6. Streamable MCP HTTP behavior.
   - Desired behavior: send protocol-version header where required; persist/reuse MCP session id from server response; reset safely when endpoint/server config changes.
   - Gate: MCP transport tests and mock smoke where cheap.
7. Saved prompt insertion into DeepSeek input box.
   - Desired behavior: saved item insert action puts prompt into DeepSeek input; preserves existing sidepanel pending text path; no data loss on closed sidepanel.
   - Gate: sidepanel interaction/content insertion tests.
8. Webpage model mode selection.
   - Desired behavior: default/expert/vision mode maps to DeepSeek web request options; uploaded refs persist through mode switch where valid; vision uses uploaded refs.
   - Gate: chat/provider/automation prompt-option tests.
9. Shell execution environment hardening.
   - Desired behavior: denylisted injection env removed before native shell execution; only required env is preserved; user-authored safe env still works.
   - Gate: shell policy/native transport tests and shell smoke if feasible.
10. Cloud sync provider expansion.
    - Desired behavior: WebDAV remains existing provider; provider abstraction supports WebDAV plus Google Drive/OneDrive-style OAuth/storage config shape without new deps or permissions in this slice; provider errors surface clearly.
    - Gate: sync schema/config tests and compile.

## Commands Run

- `git status --short --branch` -> clean starting state on `main`, ahead 199.
- `git switch -c codex/v105-independent-loop` -> branch created.
- `command -v grok` -> `/Users/kyin/.grok/bin/grok`.
- `command -v claude` -> `/Users/kyin/.local/bin/claude`.
- `cat LICENSE`, `cat package.json`, `cat docs/decisions/mit-license-checkpoint.md` -> MIT checkpoint confirmed.
- `npm test -- tests/inline-agent-prompt.test.ts` -> passed after TDD fix.
- `npm test -- tests/history-cleanup.test.ts` -> passed after TDD fix.
- `npm test -- tests/inline-agent-prompt.test.ts tests/inline-agent-loop.test.ts tests/history-cleanup.test.ts tests/tool-block-style.test.ts` -> passed, 38 tests.
- `npm test -- tests/deepseek-web-vision.test.ts` -> failed once on `SUCCESS` + audit `unknown`, then passed after terminal-state fix, 18 tests.
- `npm test -- tests/vision-evidence.test.ts tests/content-vision-media-validation.test.ts tests/multimodal-media.test.ts tests/sidepanel-chat-attachments.test.ts` -> passed, 30 tests.
- `npm test -- tests/phase5-product-surfaces.test.ts` -> failed first because the code download control was nested under `pre`, then passed after wrapper-based overlay fix, 7 tests.
- `npm test -- tests/mcp-connection-lifecycle.test.ts` -> failed first because Streamable HTTP did not send `MCP-Protocol-Version`, then passed after streamable transport fix, 17 tests.
- `npm test -- tests/mcp-connection-lifecycle.test.ts tests/mcp-transport-common.test.ts` -> passed, 23 tests.
- `oracle --version` -> `0.15.0`.
- `git -C /Users/kyin/Projects/oracle-patch fetch origin --prune --tags` -> fetched `origin/main` from `d5c5e954` to `2fa6b5a6`; local checkout is behind 3 commits but dirty.
- `diff -ru /Users/kyin/.agents/skills/oracle /Users/kyin/.codex/skills/oracle` -> no differences; both `SKILL.md` files had timestamp `Jun 21 20:52:52 2026`.
- `rm -rf /Users/kyin/.codex/skills/oracle` -> removed duplicate Oracle skill; `/Users/kyin/.agents/skills/oracle/SKILL.md` remains.
- `git -C /Users/kyin/Projects/oracle-patch stash push -u -m "pre-oracle-upstream-update-20260628-024506"` -> saved the dirty Oracle checkout, including `.ai-bridge`.
- `git -C /Users/kyin/Projects/oracle-patch merge --ff-only origin/main` -> updated Oracle to `2fa6b5a6`.
- `CI=true pnpm -C /Users/kyin/Projects/oracle-patch install --frozen-lockfile` -> installed dependencies but failed Oracle's prepare build on an upstream `scripts/check.ts` Bun type mismatch.
- `./node_modules/.bin/tsgo -p tsconfig.build.json` and the existing vendor copy step in `/Users/kyin/Projects/oracle-patch` -> passed after a temporary local type fix; refreshed ignored `dist/` CLI output.
- `git -C /Users/kyin/Projects/oracle-patch stash push -m "temporary-oracle-build-type-fix-20260628-024717" -- scripts/check.ts` -> saved the temporary local build fix separately and returned Oracle tracked files to clean.
- `git -C /Users/kyin/Projects/oracle-patch status --short --branch` -> clean at `main...origin/main`.
- `npm test -- tests/sidepanel-interactions.test.ts tests/deepseek-input-insertion.test.ts` -> passed, 31 tests.
- `npm test -- tests/project-context.test.ts tests/project-sidebar-organizer.test.ts tests/projects-page.test.ts` -> passed, 24 tests.
- `npm test -- tests/request-augmentation.test.ts` -> passed, 22 tests.
- `npm test -- tests/shell-host-local-skill-preview.test.ts tests/shell-policy.test.ts` -> passed, 5 tests.
- `npm test -- tests/sync-config.test.ts tests/sync-schema.test.ts tests/sync-local-skill-merge.test.ts` -> passed, 11 tests.
- `npm run compile` -> failed once on a test-only `Headers | null` narrowing issue in `tests/mcp-connection-lifecycle.test.ts`; passed after test typing fix.
- `npm test` -> passed, 123 files / 1241 tests.
- `npm run build:chrome` -> passed; WXT built `dist/chrome-mv3`.
- `git diff --check` -> passed.
- `npm run verify:manifest-policy` -> passed.
- `npm run verify:extension-utf8` -> passed, 84 files scanned.
- `npm version 1.0.3 --no-git-tag-version` -> updated `package.json` and `package-lock.json` to the next local MIT release after `1.0.2`, keeping upstream `v1.0.5` only as the behavior-parity scope.
- Updated `docs/chrome-web-store/listing.md` package version and upload artifact name to `1.0.3`.
- `npm run build:all` -> passed with package version `1.0.3`; rebuilt Chrome, Edge, and Firefox manifests.
- `npm run verify:manifest-policy` -> passed after the `1.0.3` correction.
- Generated manifest versions checked directly: Chrome, Edge, and Firefox all emitted `1.0.3`.
- `node -p "require('./package.json').license + ' ' + require('./package.json').version"` -> `MIT 1.0.3`.

## Advisor Log

- Initial Oracle:
  - Browser GPT-5.5 Pro was requested at the beginning with a first-person review prompt and no dry run.
  - `oracle --engine browser --model gpt-5.5-pro --copy-profile "$HOME/Library/Application Support/Google/Chrome" --browser-chrome-profile "Profile 1" ...` failed before review because Chrome `Local State` copy hit EPERM.
  - Retry with `--browser-attach-running` failed because no Chrome remote debugging listener was available on `127.0.0.1:9222`.
  - Retry without profile copy opened Chrome, but Oracle reported `ChatGPT session not detected. Login button detected on page.`
  - Retry with the configured cookie file also opened Chrome, but the cookie file appears stale; Oracle again reported no ChatGPT session.
  - User requested no dry run and a Profile 1 browser run. Retried with `--browser-chrome-profile "Profile 1"` and no dry run; Oracle packed local files and opened browser mode, then failed again with `ChatGPT session not detected. Login button detected.`
  - No Oracle advice has been accepted; there was no review output to classify.
- Initial subagent/grok worker attempts:
  - Codex subagent inventory worker disconnected before completion.
  - Grok bounded inventory worker reached its turn cap without usable output.
  - Local files/tests remain source of truth.
- MCP slice Grok worker:
  - Asked Grok to inspect only `core/mcp/transports/http.ts`, `core/mcp/client.ts`, `core/mcp/types.ts`, and `tests/mcp-connection-lifecycle.test.ts`.
  - Concrete claims: streamable protocol/session implementation is minimal; test gaps were third-call protocol assertion and plain HTTP header omission; possible edge cases around error responses and session rotation are useful but speculative for this slice.
  - Decision: accepted the locally verifiable test-gap claims and added tests; did not add broader error/session-recovery behavior without a failing local contract.
- MCP slice Claude worker: running; no output accepted yet.
- Oracle maintenance:
  - The latest upstream `origin/main` has three commits after the installed checkout: `fix(browser): wait for model/effort composer pill before failing selection (#271)`, a changelog credit, and dependency updates.
  - The local `/Users/kyin/Projects/oracle-patch` dirty work was preserved in `stash@{1}` and the checkout was fast-forwarded cleanly to `2fa6b5a6`.
  - Oracle's updated dependency set installed, but upstream `scripts/check.ts` failed under the current Bun/TypeScript build types; a temporary local one-line type fix was used only to refresh ignored `dist/`, then stashed as `stash@{0}`.
  - The fetched browser fix targets model-picker late mounting, not the current macOS `--copy-profile` `Local State` EPERM failure.
  - Duplicate Oracle skills were byte-identical; kept `/Users/kyin/.agents/skills/oracle/SKILL.md` and removed `/Users/kyin/.codex/skills/oracle`.

## Verified State

- MIT checkpoint verified from local files.
- Dirty-tree baseline verified clean before this ledger add.
- Inline-agent nudge stabilization verified by targeted prompt/loop/history/tool-block tests.
- Internal history cleanup for inline-agent and system continuation artifacts verified by targeted cleanup tests.
- Vision upload audit pending/unknown/pass/reject handling verified by DeepSeek Web Vision and adjacent media/evidence tests.
- Code-block download overlay isolation verified by Phase 5 product-surface tests.
- Streamable MCP HTTP protocol header and in-memory session reuse verified by MCP connection/common tests.
- Saved prompt insertion verified by sidepanel interaction tests and isolated DeepSeek textarea insertion tests.
- Project pending one-shot binding and sidebar title refresh verified by project store/sidebar/page tests.
- Webpage model mode/ref-file routing verified by request augmentation tests.
- Shell execution env hardening verified by native host subprocess tests and shell policy tests.
- Sync provider config shape verified by sync config/schema/local-skill tests.
- TypeScript compile verified after shared code changes.
- Full Vitest suite passed.
- Chrome production build passed.
- Manifest policy, extension UTF-8, and whitespace diff checks passed.
- Release version truth sources now point at local version `1.0.3`; WXT will emit manifest version `1.0.3` from `package.json`.
- Runtime/browser behavior not yet verified for current branch.

## Remaining Work

- Optional: re-run Oracle review after the local browser/Profile path can avoid the macOS `Local State` EPERM copy failure.
- Runtime/browser smoke of the installed extension was not performed in this loop; current claim is repo tests/build/manifest verification only.

## Slice Notes

### Inline-Agent Nudge Stabilization

- Desired behavior:
  - Empty assistant output can be nudged once as unfinished.
  - Tool-intent wording such as "I will inspect..." can continue.
  - Normal explanatory/final answers are not nudged.
  - Explicit `<task_complete>` remains terminal.
- Decision: use a positive pending-action signal instead of treating every non-final answer as unfinished.
- Verified: prompt, loop, history cleanup, and tool-block targeted tests passed.

### Internal History Cleanup

- Desired behavior:
  - Existing inline-agent continuation artifacts remain hidden from restored conversation history.
  - Background/system `[TOOL_RESULTS]...[/TOOL_RESULTS]` continuation prompts are hidden from visible restored user text.
  - Message ids and parent links remain stable so local UI anchors are not broken.
  - User-authored ordinary content is preserved.
- Decision: sanitize only prompts containing the internal tool-results envelope plus known continuation wording.
- Verified: history cleanup targeted tests passed.

### Vision Upload Audit Handling

- Desired behavior:
  - `PENDING` or missing model status keeps polling.
  - `SUCCESS` + `VISION` + audit `unknown`/pending keeps polling.
  - `SUCCESS` + `VISION` + audit pass/success returns safe metadata.
  - Audit reject/fail/block is a non-retryable upload failure.
  - Raw image bytes remain outside durable evidence storage.
- Decision: classify audit result locally with conservative pending for unknown strings, and avoid accepting Vision success until audit is no longer pending.
- Verified: DeepSeek Web Vision upload tests and adjacent media/evidence tests passed.

### Code-Block Download Overlay

- Desired behavior:
  - Exactly one download control per code block.
  - Control is visually over the code block but not a child of `pre` or `code`.
  - Downloaded text excludes the overlay control.
  - Streaming rescans do not repeatedly read processed large code text.
- Decision: wrap each unprocessed `pre` in a lightweight frame and mount the button as a sibling of the `pre`.
- Verified: Phase 5 product-surface tests passed.

### Streamable MCP HTTP

- Desired behavior:
  - Streamable HTTP requests and notifications include `MCP-Protocol-Version`.
  - First request does not invent a session id.
  - Server-provided `Mcp-Session-Id` is reused on later messages through the same transport instance.
  - New transport instances do not inherit old session ids, so endpoint/config changes reset naturally.
  - Plain HTTP transport does not receive streamable-only headers.
- Decision: keep session id in a closure inside `createMcpStreamableHttpTransport`; do not persist it to extension storage or server config.
- Verified: MCP connection lifecycle and transport common tests passed.

### Saved Prompt Insertion

- Desired behavior:
  - Saved prompt insert action first tries the active `chat.deepseek.com` tab input.
  - If no DeepSeek tab/input is available, the existing sidepanel pending-text fallback remains intact.
  - Closed/unready sidepanel behavior still relies on existing pending text storage path.
- Decision: route saved prompt insertion through background to the active DeepSeek content script, with a small shared textarea insertion helper and no new permissions.
- Verified: sidepanel interaction tests and isolated DeepSeek input insertion tests passed.

### Project Title Refresh And New Conversation Scope

- Desired behavior:
  - Pending project intent binds only one new conversation, then clears.
  - Later conversations are not pulled into the project unless explicitly moved or pending is set again.
  - Project sidebar shows DeepSeek-generated conversation titles once native history has them, even if stored membership still has an old placeholder.
  - Existing move in/out controls remain unchanged.
- Decision: keep durable project store schema unchanged; add one-shot assertion in store tests and prefer native history titles only for sidebar display.
- Verified: project context, project sidebar organizer, and Projects page tests passed.

### Webpage Model Mode Selection

- Desired behavior:
  - Default mode leaves DeepSeek's existing request route alone.
  - Expert and Vision modes apply to ordinary webpage prompts.
  - Uploaded `ref_file_ids` are preserved and keep or infer Vision routing instead of being overwritten by Expert mode.
  - Search/thinking flags remain whatever the page/request selected unless separate research auto-enable logic applies.
- Decision: if refs exist, preserve existing `model_type` or infer `vision`; only apply stored model mode when no refs are present.
- Verified: request augmentation tests passed.

### Shell Execution Environment Hardening

- Desired behavior:
  - `shell_exec` and persistent shell sessions do not inherit secret/provider/proxy/tool-runner env from the native host process.
  - User-provided safe env values still reach the command.
  - Explicit secret-like env names supplied in tool args are filtered.
  - PATH and minimal OS env needed for shell execution remain available.
- Decision: replace full `process.env` inheritance with a small platform base allowlist plus filtered explicit env, keeping PATH reconstruction intact.
- Verified: real shell native host subprocess test and shell policy tests passed.

### Cloud Sync Provider Shape

- Desired behavior:
  - Existing WebDAV config and operations remain the active sync implementation.
  - Config can represent future Google Drive or OneDrive OAuth-style accounts without storing raw token material inline.
  - Non-WebDAV providers fail clearly if passed to the current WebDAV operation path.
  - No dependencies, permissions, or storage schema version changes.
- Decision: add optional provider/OAuth config shape and normalization; keep WebDAV as default for legacy configs and wipe legacy password fields from non-WebDAV provider configs.
- Verified: sync config, sync schema, and local-skill merge tests passed.

### Release Version Bump

- Desired behavior:
  - User-visible extension version reflects a local MIT-clean release after `1.0.2`.
  - Upstream `v1.0.5` remains only the behavior-parity target, not our release number.
  - Chrome Web Store draft points at the matching release artifact name.
- Decision: use `1.0.3`, the next local release number after `1.0.2`, to avoid claiming the same release number as upstream.
- Verified: package metadata is `MIT 1.0.3`; Chrome, Edge, and Firefox builds emitted manifest version `1.0.3`; manifest policy check passed.
