# Bridge model surface

All IDs are OpenAI-compatible `model` strings. CLIProxyAPI may prefix as `dspp/ds/...`.

| ID | DeepSeek web mode | Intent |
|----|-------------------|--------|
| `ds/octopus` | expert (bridge-enhanced) | Default strong brain; tools/search/eyes overpower web Expert limits |
| `ds/octopus-eyes` | vision | Native vision / eyes product surface |
| `ds/squid` | default / instant | Fast path (was flash) |
| `ds/eni` | expert + ENI persona | RP + agent dual-mode for Hermes ENI |

## Normalization

Aliases and prefixes (`dspp/ds/eni`, `/eni`, roleplay needles) normalize in `protocol.ts` / `thread-store.modelFamilyFromBridgeModel`.

## Context length

Advertised engineering budget: **890880** tokens (`BRIDGE_MODEL_CONTEXT_LENGTH`), from live DeepSeek web remote config research — not official API docs, not 128k.

See `docs/research/deepseek-web-client-findings.md`.

## Thinking / search

- Thinking: model-dependent + request flags
- Search: bridge can enable beyond pure web Expert product limits for octopus-class

## Sticky family isolation

Threads pin `modelFamily`. Switching octopus ↔ squid ↔ eyes does not reuse the wrong session type.
