# Chrome Hot Perf: Bundle Size Hypothesis

Date: 2026-06-21 local time.

## Question

Could Chrome heat be caused by extension size or too much bundled information?

Do not assume yes. Treat it as one hypothesis.

## Current Build Evidence

Commands:

```sh
du -sh dist/chrome-mv3
find dist/chrome-mv3 -type f -maxdepth 5 -exec du -h {} + | sort -hr | head -30
find dist/chrome-mv3 -type f -name '*.map' -maxdepth 6 -print | wc -l
rg -n "pyodide|loadPyodide|python_stdlib|pyodide\\.asm" dist/chrome-mv3/background.js dist/chrome-mv3/content-scripts dist/chrome-mv3/chunks dist/chrome-mv3/*.html
```

Observed:

| File | Size |
| --- | ---: |
| `dist/chrome-mv3` | 18M |
| `dist/chrome-mv3/pyodide/pyodide.asm.wasm` | 9.2M |
| `dist/chrome-mv3/pyodide/python_stdlib.zip` | 2.4M |
| `dist/chrome-mv3/pyodide/pyodide.asm.mjs` | 1.2M |
| `dist/chrome-mv3/background.js` | 1.1M |
| `dist/chrome-mv3/logo.png` | 896K |
| `dist/chrome-mv3/pet/deepseek-whale-pet-states.png` | 640K |
| `dist/chrome-mv3/content-scripts/content.js` | 568K |
| `dist/chrome-mv3/chunks/sidepanel-C1hUkOG8.js` | 404K |
| `dist/chrome-mv3/content-scripts/main-world.js` | 380K |
| `dist/chrome-mv3/chunks/sandbox-runner-uggMEdFq.js` | 228K |
| `dist/chrome-mv3/chunks/CapabilitiesPage-JiHkqyTZ.js` | 192K |
| `dist/chrome-mv3/chunks/ChatPage-ku-hIR4v.js` | 136K |

No `.map` files are present in `dist/chrome-mv3`.

## Eager Load Findings

Facts:

- `manifest.json` loads `background.js` as the MV3 service worker.
- `manifest.json` loads `content-scripts/content.js` and `content-scripts/main-world.js` at `document_start` on `chat.deepseek.com`.
- Pyodide assets are bundled, but `rg` only found Pyodide runtime code in sandbox/offscreen chunks and `pyodide/` assets. It did not find Pyodide in `background.js`, `content.js`, or `main-world.js` as a normal entrypoint load.
- `core/sandbox/python-worker.ts` calls `loadPyodide(...)` only inside the sandbox worker path.
- `entrypoints/sandbox-offscreen/main.ts` passes `chrome.runtime.getURL('pyodide/')` only when browser sandbox execution runs.
- `core/i18n/index.ts` imports both full locale resources eagerly. Source resource size is about 186K across `core/i18n/resources/en.ts` and `core/i18n/resources/zh-CN.ts`.
- `dist/chrome-mv3/content-scripts/main-world.js` contains sidepanel/i18n strings, meaning prompt/i18n imports pull broad resource text into a document-start content script.
- `core/skill/officecli-library.ts` uses eager raw `import.meta.glob` for bundled OfficeCLI Skill docs. Source size under `core/skill/officecli-official` is about 746K.
- `background.ts` broadcasts full `skills` in `STATE_UPDATED`. `getAllSkills()` returns enabled skills by default, but bundled OfficeCLI docs are still in the background bundle because they are eager imports.

Inferences:

- Large extension size can plausibly cause slower extension startup, parse time, memory pressure, and one-time CPU spikes.
- Pyodide size mostly affects install/package size and sandbox Python startup. It is not proven to load on idle DeepSeek pages.
- Full i18n resources in content/main-world and eager OfficeCLI docs in background are real bundle-weight problems.
- Repeated full state broadcasts can become a sustained CPU problem only if something repeatedly triggers `STATE_UPDATED`, `GET_SKILLS`, or prompt/state rebuild paths.

## Passive Runtime Evidence

Commands:

```sh
ps -axo pid,ppid,pcpu,pmem,etime,command | rg 'Google Chrome|Chrome Helper' | rg -v 'rg |exec_command' | sort -k3 -nr | head -40
sleep 30
ps -axo pid,ppid,pcpu,pmem,etime,command | rg 'Google Chrome|Chrome Helper' | rg -v 'rg |exec_command' | sort -k3 -nr | head -40
ps -axo pid,ppid,pcpu,pmem,rss,time,etime,command | rg 'Google Chrome|Chrome Helper' | rg -v 'rg |exec_command' | sort -k3 -nr | head -25
sample 8917 5 1 -file /tmp/deepseekpp-hot-renderer-8917.sample.txt
```

Observed:

- Hot process: PID `8917`, child of Chrome main PID `23997`.
- PID `8917` command line has `--type=renderer`; it does not have `--extension-process`.
- PID `8917` stayed around `100%` CPU across passive snapshots:
  - `2026-06-22T04:23:47Z`: `100.0%`, elapsed `04:38:35`
  - `2026-06-22T04:24:17Z`: `100.1%`, elapsed `04:39:05`
  - later snapshot: `100.1%`, CPU time `181:52.87`, RSS `3060752 KB`
- Extension-process renderers in the same snapshots were idle or near-idle:
  - PID `24014`: `0.0%`, CPU time `0:01.74`, elapsed `07:07:41`
  - PID `1744`: `0.0%`, CPU time `0:00.19`, elapsed `02:40`
  - PID `29209`: `0.0%` in the later snapshot, CPU time `0:00.18`
- `sample` of PID `8917` showed 2.6G physical footprint and main-thread activity mostly inside Chrome/V8/JIT frames. It did not identify extension source.

Inference:

- Current heat is sustained idle/runtime CPU, not a one-time bundle parse spike.
- The hottest process is a page renderer, not an extension-process renderer. This does not rule out DeepSeek++ content-script work, because content scripts execute inside page renderers.
- Live Chrome attachment/automation should be avoided while this hot state persists because it would perturb evidence.

## Interpretation

Bundle size is not the leading explanation for sustained 50-100% Chrome CPU after idle.

Bundle size remains a valid secondary hypothesis for:

- slow startup
- parse/compile spikes after extension reload
- memory pressure
- duplicated content-script payload in every DeepSeek tab
- repeated serialization if full Skill/memory/state payloads are broadcast in a loop

For the observed hot state, prioritize:

1. page renderer loops
2. content-script observers and route watchers
3. token-speed/render timers
4. inline-agent/tool continuation loops
5. repeated prompt/context construction
6. repeated `STATE_UPDATED` / `GET_SKILLS` / `TOOL_DESCRIPTORS_UPDATED` message storms
7. repeated full memory/Skill serialization through runtime messages

## Next Instrumentation Targets

Add counters before optimizing bundle size:

- runtime message count by type and approximate payload bytes
- `syncToMainWorld(...)` call count and payload summary
- `augmentRequestBody(...)` count, duration, original prompt length, augmented prompt length
- observer callback count for content-script observers
- inline-agent/tool-loop stop reasons and continuation depth
- state broadcast source, especially `broadcastStateUpdate(...)` callers

If CPU remains hot after those counters show no message/observer/prompt loop, then investigate the page itself or Chrome-side renderer behavior.

## Bundle Cleanup Candidates

Only after loop evidence is handled:

- Split content/main-world i18n so document-start scripts do not import full sidepanel copy.
- Lazy-load OfficeCLI third-party Skill instructions instead of eager raw imports in the background bundle.
- Keep disabled bundled Skill instructions out of routine `GET_SKILLS` / `STATE_UPDATED` payloads unless the Skill page or prompt injector needs them.
- Keep Pyodide assets packaged for sandbox support, but verify they are fetched only on sandbox Python execution.
