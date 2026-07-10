/**
 * ENI persona resolution: bundled default + optional chrome.storage override.
 *
 * Callers: worker.ts (resolve + shouldInject), protocol messagesToPrompt (text),
 * tests/cursor-bridge-eni-prompt.test.ts.
 * API: resolveEniSystemPrompt, shouldInjectEniSystem, setEniSystemPromptOverride.
 * Storage schema: chrome.storage.local key `cursorBridgeEniSystemPrompt` (string).
 * Thread schema field: BridgeThreadRecord.eniPromptHash (set in thread-store).
 *
 * User: "proceed" after approving remove sticky ENI wrapper + high-ROI additions
 * (storage override without rebuild; reinject when persona text changes).
 *
 * Override key: `cursorBridgeEniSystemPrompt` (string).
 * Set via extension page console or a future settings UI — no rebuild required.
 * Clear with: chrome.storage.local.remove('cursorBridgeEniSystemPrompt')
 *
 * Bundled fallback: edit `eni-system-prompt.ts` then rebuild + reload.
 */

import { ENI_SYSTEM_PROMPT } from './eni-system-prompt';
import { simpleHash } from './thread-store';

export const ENI_PROMPT_STORAGE_KEY = 'cursorBridgeEniSystemPrompt';

export interface ResolvedEniPrompt {
  /** Full system text to inject when injectEniSystem is true. */
  text: string;
  /** Stable fingerprint for reinject-on-change. */
  hash: string;
  /** True when text came from chrome.storage override. */
  fromOverride: boolean;
}

function fingerprint(text: string): string {
  return simpleHash(text.trim());
}

/** Pure: first turn, or sticky with a different persona fingerprint → reinject. */
export function shouldInjectEniSystem(input: {
  sticky: boolean;
  currentHash: string;
  previousHash?: string | null;
}): boolean {
  if (!input.sticky) return true;
  const prev = (input.previousHash ?? '').trim();
  if (!prev) return true;
  return prev !== input.currentHash;
}

export async function resolveEniSystemPrompt(): Promise<ResolvedEniPrompt> {
  let override: string | null = null;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const data = await chrome.storage.local.get(ENI_PROMPT_STORAGE_KEY);
      const raw = data[ENI_PROMPT_STORAGE_KEY];
      if (typeof raw === 'string' && raw.trim().length > 0) {
        override = raw.trim();
      }
    } catch {
      // fall through to bundled default
    }
  }

  const text = override ?? ENI_SYSTEM_PROMPT.trim();
  return {
    text,
    hash: fingerprint(text),
    fromOverride: Boolean(override),
  };
}

/** Persist override (empty/null clears). Used by tests / future settings. */
export async function setEniSystemPromptOverride(text: string | null): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  if (text == null || !text.trim()) {
    await chrome.storage.local.remove(ENI_PROMPT_STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({ [ENI_PROMPT_STORAGE_KEY]: text.trim() });
}
