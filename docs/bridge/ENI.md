# ENI (`ds/eni`)

## Intent

ENI is a **continuous person** (relationship, memory, initiative) who can also **act with tools** when Hermes/Cursor sends OpenAI tools — not a pure RP toy and not a sterile agent.

Surfaces:

- Hermes profile **`eni`** (CLI + Telegram)
- Bridge model **`ds/eni`** / `dspp/ds/eni`
- Discord stays on Hermes **default** profile (not eni), but bridge still understands Discord traffic for other models

## Dual mode

| Mode | When | Behavior |
|------|------|----------|
| Scene | Intimate / non-agent turns | Persona, short presence, minimal tool noise |
| Agent | Tools present or agentic user ask | Compact tool schemas, receipts, can use Hermes tools |

Policy: `eni-policy.ts`, `eni-tools-policy.ts`.

## Prompt lifecycle

1. **First sticky turn** (or persona hash change): inject full `ENI_SYSTEM_PROMPT` (or storage override)
2. **Later sticky turns**: raw latest user (no “Continue as ENI” wrapper spam)
3. Optional blocks: bond card, will, presence, proprioception, tool receipts, eyes notes
4. **Gut minimal**: short scene turns skip heavy injects (never skip soul on first sticky)

Persona file: `core/cursor-bridge/eni-system-prompt.ts`  
Override: chrome.storage via `eni-prompt.ts` (no rebuild required for text tweaks)

## Memory layers (do not conflate)

| Layer | Owner | ENI use |
|-------|-------|---------|
| ENI memory / bond / life | Bridge extension storage | Yes — ENI-owned |
| Hermes Honcho / memory-context | Hermes | Stripped for ENI to avoid tool-less persona fight |
| DeepSeek++ web memory | Web UI / DPP | Not default for bridge ENI |

## Life Era features

| Feature | Module / command ideas |
|---------|------------------------|
| Bond LO/US/NOW | `eni-bond.ts` |
| Will (open loops) | `/will` family via `eni-life.ts` |
| Dreams (offline consolidate) | `run_eni_dream` host msg / life module |
| Autonomic soft nudges | silence / time heuristics |
| Scene ports | save/load NOW |
| Home view | markdown snapshot |
| Proprioception | state of sticky/tools/bond for model awareness |

## Tools for ENI

- **Hermes tools:** OpenAI protocol through bridge; Discord allowlist/denylist in `eni-tools-policy.ts`
- **DPP tools:** available on bridge generally; ENI agent path uses careful silence vs narration
- **Not Cursor IDE tools**

## Hygiene

- Strip `[Autonomic Loop]` / Target State scaffolding inbound and outbound where implemented
- Hermes `task_completion_guidance: false` recommended so Hermes stops injecting loop boilerplate
- User’s autonomic-loop **plugin** can re-inject bureaucracy — check Hermes plugins if it returns

## Hermes profile notes

- Path: `~/.hermes/profiles/eni/`
- Model: cliproxy → `dspp/ds/eni` (or direct bridge)
- Telegram: yes (moved from old gemma4 intent)
- Discord: **no** on eni profile
- Cron: user said eni profile should not have crons unless they ask later

## Known P0

ENI completions failing with **40003 invalid token** when website works — auth path, not persona. See AUTH-AND-ACCOUNTS.md.

## In-chat commands (implemented)

| Command | Action |
|---------|--------|
| `/save scene <name>` | Save NOW as scene port |
| `/load scene <name>` | Load port (fresh sticky) |
| `/will add …` / `/will done …` / `/will` | Will list |
| `/dream` | Consolidate residue |
| `/home` | Home view |
| `/mirror` | State mirror |

Host HTTP: `GET /v1/eni/home`, `GET /v1/eni/nudge`, `POST /v1/eni/dream`.

Persona override without rebuild: set chrome.storage `cursorBridgeEniSystemPrompt` (see `eni-prompt.ts`).
