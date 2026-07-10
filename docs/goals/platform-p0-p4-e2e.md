# Goal: Platform P0–P4 E2E (long-horizon, autonomous)

**Status:** done in code (live reload pending operator)  
**Date:** 2026-07-09  
**Working tree:** `/Users/kyin/Projects/deepseek-pp-platform`  
**Branch:** `local/platform-p0-p4`  
**Stop only for:** account risk, DeepSeek hard blocks, or true product forks

## Objective

Ship the browser-origin DeepSeek++ OpenAI bridge through **P0–P4** end-to-end so that: three models work (`ds/octopus`, `ds/octopus-eyes`, `ds/squid`), auto-eyes is domain-agnostic, sticky main sessions continue multi-turn DeepSeek chats, delta prompts apply on sticky hits, minimal bridge status is available, and eyes-cache + richer health land — verified by unit tests, production build, and live `/v1` smokes when the host is ready.

## Evidence of done

1. `npx vitest run tests/cursor-bridge-*.test.ts` passes  
2. `npm run build:chrome` succeeds  
3. `/v1/models` lists octopus, octopus-eyes, squid (after host reload)  
4. Unit proof: sticky binder reuses session ids across turns; delta path omits full history dump  
5. Docs updated to match shipped state  

## In scope

P0 models/quality · P1 thread runtime · P2 delta prompts · P3 minimal status · P4 cache/health/docs  

## Out of scope

Multi-agent orchestration · jshandler completions · official API · per-harness model ids  

## Phases

| Phase | Deliverable | Status |
|---|---|---|
| P0 | squid + agnostic eyes + stream/history repair + host/CPA/docs/tests | done |
| P1 | Bridge thread store + sticky main + eyes ephemeral | done |
| P2 | Delta prompts when sticky | done |
| P3 | Sidepanel About bridge status + GET_CURSOR_BRIDGE_STATUS | done |
| P4 | Eyes image-hash cache + richer /health + docs | done |
