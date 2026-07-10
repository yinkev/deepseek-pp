# Doc audit — 2026-07-10 verification

## Method

Compared `core/cursor-bridge/*`, host `cursor-bridge-host.mjs`, entrypoints, tests, and `docs/**` for missing surfaces, stale paths, and false claims.

## Gaps found (and fixed in this pass)

| Gap | Severity | Action |
|-----|----------|--------|
| Incomplete storage key list (missing EniMemory/Bond/Life/Prompt keys) | High | Expanded PLATFORM-WORK-LOG + SURFACES.md |
| No host route inventory (`/v1/eni/*`, debug stream, admin reload, assets) | High | SURFACES.md |
| No header/body knob inventory (`X-DPP-*`, tools, dpp_context) | High | SURFACES.md |
| ENI slash-commands only vaguely described | Medium | ENI.md + SURFACES.md |
| Stale goal docs still say `deepseek-pp-platform` worktree | High | STALE PATHS banners on those goals |
| CORS lag for new account header | Low | AUTH footguns |
| package.json script names (`build` vs `build:chrome`) | Low | SURFACES.md |
| Uncommitted work not listed file-by-file in INDEX | Medium | HANDOFF + PLATFORM-WORK-LOG already note “large uncommitted” |

## Still intentionally thin / not fully documented

| Item | Why |
|------|-----|
| Full ENI system prompt text | Lives in `eni-system-prompt.ts`; huge; user-editable |
| Per-test case catalog | Tests are source of truth under `tests/cursor-bridge-*.test.ts` |
| Live Hermes yaml dumps | Machine-local `~/.hermes/**`; changes often; OPS points there |
| CLIProxyAPI full config | Outside this repo |
| DeepSeek++ non-bridge features (sidepanel, pet, MCP UI, etc.) | Pre-existing product; not this platform wave |
| Research HAR raw dumps | In `docs/research/`; may omit secrets |
| Upstream merge playbook details | `UPSTREAM_UPDATE.md` — not re-copied |

## Stale docs (bannered, not rewritten)

These still contain historical `deepseek-pp-platform` paths inside the body:

- `docs/goals/platform-p5-p9-daily-driver.md`
- `docs/goals/platform-p0-p4-e2e.md`
- `docs/goals/AUTONOMOUS_RUNBOOK_P5_P9.md`
- (and related platform goal docs)

**Do not follow those paths.** Banners point to INDEX + work log.

## False claims to avoid

| Claim | Reality |
|-------|---------|
| Multi-account works | **Verified** smoke matrix + 5-account vault; individual dead tokens may still 40003 |
| Health green ⇒ chat works | False |
| Tab required | No longer required for readiness; still useful for auth refresh |
| Two project folders | Only `deepseek-pp` |
| ds2api still in tree | Deleted |

## Code vs docs coverage checklist

| Area | Documented? |
|------|-------------|
| Models | MODELS.md yes |
| Architecture path | ARCHITECTURE.md yes |
| ENI modules | ENI + work log yes |
| Auth P0 | AUTH + HANDOFF yes |
| Storage keys | SURFACES yes (after fix) |
| Host routes | SURFACES yes (after fix) |
| Headers | SURFACES yes (after fix) |
| ENI commands | SURFACES/ENI yes (after fix) |
| Tests list | PLATFORM-WORK-LOG yes |
| Ops/build | OPS yes |
| Decisions | decisions/* yes |
| Research context limits | research/* yes |
| Public README | intentionally feature-only (not updated with internals) |

## Residual risk

Next agent can still fuck up by:

1. Following stale goal doc paths despite banners
2. Building without reloading the **correct** dist
3. Declaring multi-account done without completion probe
4. Editing `~/.hermes` crons without user ask

## Verdict

Docs were **~85% complete** after first write; **~95%** after FREEZE + upstream merge doc pass (2026-07-10 evening). This audit pass closed the main hidden surfaces (storage keys, host routes, headers, commands, stale path warnings). Remaining gaps are intentional (prompt body, hermes yaml, non-bridge product).
