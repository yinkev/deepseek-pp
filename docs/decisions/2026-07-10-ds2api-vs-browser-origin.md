# 2026-07-10 — ds2api vs browser-origin (ban risk)

**Status:** binding for this repo  
**Repo:** `/Users/kyin/Projects/deepseek-pp` only  
**Public README:** do not mirror this doc (no architecture / endpoint dumps for end users).

## Purpose

Explain why **ds2api-class headless reverse proxies** are rejected here, how they differ from DeepSeek++ cursor-bridge, and what agents must not reintroduce.

User report (2026-07-10): the GitHub **ds2api** approach has **instant ban** risk on real accounts. This doc preserves that finding as project memory.

## Scope

- Compared approach: public tooling in the **ds2api** family (e.g. `https://github.com/Activer007/ds2api` and related forks such as CJackHwang/ds2api). Code was reviewed from a temporary shallow clone for analysis only — **never a dependency of this repo**.
- Our approach: DeepSeek++ MV3 extension + local `cursor-bridge-host` OpenAI surface → **browser-origin** DeepSeek web.

Out of scope: official DeepSeek pay-as-you-go API as the primary product path (separate product choice; still not “use ds2api”).

## Decision

1. **Canonical path:** browser-origin completions only (logged-in Chrome + extension + host).
2. **Reject:** ds2api-class headless reverse of `chat.deepseek.com` (account pools, password login automation, fake mobile/Android client headers, spoofed TLS, public multi-tenant reverse proxies).
3. **Do not reintroduce** ds2api as a submodule, worktree, runtime dependency, or “temporary integration.”
4. Multi-account in *this* repo is optional and secondary; it must never re-break live-tab auth (see AUTH-AND-ACCOUNTS).

## What ds2api does (risk class)

```
Client (OpenAI / Claude / Gemini SDKs)
    → Go server (Docker / Vercel / binary / always-on gateway)
    → headless HTTP to chat.deepseek.com
    → multi-account pool + proxies + self-solved PoW
```

Observed implementation patterns (from source review, 2026-07-10):

| Layer | ds2api-class behavior |
|-------|------------------------|
| Auth | Email/mobile + password via `/api/v0/users/login` with fixed automation markers (e.g. `device_id: "deepseek_to_api"`, `os: "android"`) |
| Identity | Claims **Android** client (`User-Agent` like `DeepSeek/x.y.z Android/35`, `x-client-platform: android`) |
| TLS | Custom **utls** (e.g. Safari hello) + force **HTTP/1.1** — not real Chrome |
| Traffic | Server-side `http.Client` from VPS/home/datacenter IP, not the user’s browser process |
| Scale | Account pool, rotation, concurrent slots, SOCKS proxies, session create/delete churn |
| Deploy | Docker / Vercel / public OpenAI-compatible gateway |

Their own disclaimers typically call out account suspension risk. User experience: **instant ban** when run as a multi-account / high-volume gateway.

### Why bans are likely (signal stack)

Not “OpenAI format is banned.” Detection targets **non-human / non-browser web usage**:

1. **Login fingerprint** — shared automation `device_id` / scripted password login clusters.
2. **Platform mismatch** — Android UA + Safari-like TLS + HTTP/1.1 force is inconsistent with real clients.
3. **No real browser session** — missing normal web cookie / WAF pairing; pure headless Bearer traffic.
4. **Volume / pattern** — account farms, high concurrency, session thrash, multi-tenant cloud IP.
5. **Public tooling** — once a pattern is popular, defenses tighten for everyone on that stack.

## What DeepSeek++ bridge does

```
Hermes / Cursor / local tools
    → local host :8787 (OpenAI-shaped surface only)
    → Chrome extension (DeepSeek++)
    → real logged-in Chrome session
    → chat.deepseek.com with web Bearer + cookies + PoW + web client headers
```

| Layer | DeepSeek++ bridge |
|-------|-------------------|
| Auth | Capture **live page** `userToken` / request headers after normal website use (not password-login automation) |
| Identity | Web client headers (`x-client-platform: web`, versions from page traffic) |
| TLS / cookies | Real Chrome stack (WAF/session cookies, real browser TLS fingerprint) |
| Scale | Human browser session; multi-account optional and must validate-before-use |
| Deploy | Local host + extension; not a public reverse-proxy farm |

Same *website endpoints* as research docs describe; **origin of the call** is the difference.

## Side-by-side

| | **ds2api-class** | **DeepSeek++ bridge** |
|--|------------------|------------------------|
| Goal | Public multi-protocol API gateway over web reverse | Personal harness → user’s web subscription |
| Client | Fake Android + spoofed TLS | Real Chrome web session |
| Login | Automated password / token pool | User logs in in browser |
| PoW | Solved in headless process | Extension / WASM path aligned with product |
| Multi-account | First-class farm | Secondary; stale vault caused 40003 (fixed 2026-07-10 live-tab capture) |
| Ban risk | High / “instant” for many operators | Lower if traffic looks like normal web use |
| This repo | **Forbidden** | **Canonical** |

## Is browser-origin “safe”?

**Safer class, not zero risk.**

Safer because: same class of traffic as typing in the web UI, real Chrome TLS/cookies, human-scale concurrency, no shared automation `device_id` password farm.

Still risky if operators:

- Blast agent harnesses at farm rates all day
- Rotate many accounts aggressively from one IP
- Create/delete sessions like a public API gateway
- Serve stale vault tokens (broken + abusive-looking)

Bridge still may issue some DeepSeek calls from the **extension service worker** with cached headers + `credentials: 'include'`. That is closer to the site than ds2api, but **not identical** to every tab fetch. Longer-term hardening (optional): **page-context fetch** for create session / PoW / completion while remaining browser-origin.

## Rejected options

| Option | Why rejected |
|--------|----------------|
| Depend on / embed ds2api | Instant-ban class; dual architecture; ToS / account risk |
| Headless token reverse “but with better UA” | Still not Chrome; still farmable; still wrong product |
| Official API as only path | Different product (keys/billing); user wants web subscription + agent harness |
| Dual worktree “platform + ds2api” | User-hated dual folders; already deleted; do not revive |

## Build consequences

- Keep work in `packages/cursor-bridge-host` + `core/cursor-bridge` + thin entrypoint hooks.
- Prefer live-tab token capture (MAIN-world / page headers) over vault round-robin.
- Never add Android UA, password-login automation, utls spoofing, or public multi-tenant reverse for DeepSeek web.
- Health `hasLogin: true` is **not** success — always verify with a real completion probe.
- Agents: if asked to “integrate ds2api,” refuse and point here.

## Verification (auth path, not ds2api)

```bash
curl -sS http://127.0.0.1:8787/v1/health
curl -sS -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'X-DPP-Client: hermes' \
  -d '{"model":"ds/eni","messages":[{"role":"user","content":"say only: hi"}],"stream":false,"reset_thread":true}'
```

Success: HTTP 200 + assistant content. Failure class `40003` = stale/invalid web token, not “need ds2api.”

## Related

- ADR: [2026-07-09-browser-origin-cursor-api.md](./2026-07-09-browser-origin-cursor-api.md)
- Auth ops: [../bridge/AUTH-AND-ACCOUNTS.md](../bridge/AUTH-AND-ACCOUNTS.md)
- Goal: [../goals/browser-origin-cursor-api.md](../goals/browser-origin-cursor-api.md)
- Handoff: [../HANDOFF-NEXT-AGENT.md](../HANDOFF-NEXT-AGENT.md)
- Research protocol (internal): [../research/deepseek-web-api-protocol.md](../research/deepseek-web-api-protocol.md)

## Handoff notes

- **Do not** clone ds2api into this workspace as a product path.
- **Do not** “fix ban risk” by copying ds2api TLS/login tricks into the extension.
- If account risk rises, reduce rate / multi-account first; do not pivot to headless reverse.
