# 2026-07-09 — Browser-origin Cursor API (not ds2api)

## Context

Need Cursor → DeepSeek web without official API and without headless token reverse after ds2api-class risk.

## Decision

Build Cursor access by adding a **local OpenAI-compatible bridge** that dispatches into **DeepSeek++**, keeping completions **browser-origin** on a logged-in Chrome tab.

Reject headless ds2api-class reverse proxies and official API as the product path.

## Consequences

- Feature work lives on `local/browser-origin-api` under `/Users/kyin/Projects/deepseek-pp` only.
- Isolate implementation in `packages/cursor-bridge-host` and `core/cursor-bridge`; thin hooks elsewhere.
- Merge `origin/main` into the feature branch after each upstream pull; verify with tests.
- Agents may advance implementation phases autonomously unless stop conditions in the goal doc fire.

## Related

- Goal: `docs/goals/browser-origin-cursor-api.md`
