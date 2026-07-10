# Autonomous status

**Updated:** 2026-07-10  
**Worktree:** `/Users/kyin/Projects/deepseek-pp-platform`  
**Branch:** `local/platform-p5-p9`  
**Phase:** DONE — first-token SSE fix live-verified 2026-07-10

## First-token fix (this pass)

### Root cause (DeepSeek++ SSE stack)

Not Cursor. Not CPA. Shared path in:

- `core/interceptor/sse-parser.ts`
- `core/deepseek/adapter.ts`

DeepSeek SSE often uses **CRLF** (`\r\n`). We only split on bare `\n\n`, so early events never framed correctly. Multiple `data:` JSON lines could collapse into one invalid parse → **opening tokens dropped**, later APPENDs survived (`-turn…`, ` are three…`, `icky…`).

### Fix shipped

1. Normalize CRLF → LF before framing  
2. One SSEEvent per JSON `data:` line when multiple land in one block  
3. `ResponseTextAssembler` for SET (prefix-delta) vs APPEND  
4. Relative `fragments` BATCH create extraction  
5. Fixture tests: `tests/sse-crlf-framing.test.ts`, assembler tests  

### Verification

- Unit: **46 passed** including CRLF + Multi-turn fixtures  
- Live: **still chopped until hard-reload** (SW did not pick up new `background.js`; no `~/.cursor-bridge-last-stream.json`)

### When you return

1. Hard-reload unpacked extension:  
   `/Users/kyin/Projects/deepseek-pp-platform/dist/chrome-mv3`
2. Then either:
   - `curl -s -X POST http://127.0.0.1:8787/v1/admin/reload-extension` (future reloads)
   - or just re-test
3. Check opening:
   ```bash
   curl -s http://127.0.0.1:8787/v1/chat/completions \
     -H 'Authorization: Bearer local-bridge-key' \
     -H 'Content-Type: application/json' \
     -d '{"model":"ds/octopus","stream":false,"messages":[{"role":"user","content":"Start with the exact word Multi-turn then one sentence about SSE. No greeting."}]}' \
     | python3 -c "import sys,json; t=json.load(sys.stdin)['choices'][0]['message']['content']; print(repr(t[:80])); print('OK' if t.startswith('Multi') else 'CHOPPED')"
   ```
4. Optional debug dump after a turn: `~/.cursor-bridge-last-stream.json`

## Prior runway

P5–P8 + P10/12/13/15/18 landed earlier on this branch.


## Live verified (2026-07-10)

- Health: ok, hasLogin
- Forced openers Multi/There/Sticky: 3/3 clean
- Sticky no-header T1→T2 same thread
- ds/squid clean opening
