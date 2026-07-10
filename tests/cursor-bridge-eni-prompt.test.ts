/**
 * ENI persona inject policy tests.
 * Covers shouldInjectEniSystem + messagesToPrompt override path.
 * User: "proceed" — storage override + reinject-on-change.
 */
import { describe, expect, it } from 'vitest';
import {
  messagesToPrompt,
  shouldInjectEniSystem,
  simpleHash,
} from '../core/cursor-bridge';
import { ENI_SYSTEM_PROMPT } from '../core/cursor-bridge/eni-system-prompt';

describe('cursor-bridge eni prompt policy', () => {
  it('injects on first turn and when persona hash changes', () => {
    const hashA = simpleHash('persona A');
    const hashB = simpleHash('persona B');

    expect(
      shouldInjectEniSystem({ sticky: false, currentHash: hashA }),
    ).toBe(true);

    expect(
      shouldInjectEniSystem({
        sticky: true,
        currentHash: hashA,
        previousHash: hashA,
      }),
    ).toBe(false);

    expect(
      shouldInjectEniSystem({
        sticky: true,
        currentHash: hashB,
        previousHash: hashA,
      }),
    ).toBe(true);

    expect(
      shouldInjectEniSystem({
        sticky: true,
        currentHash: hashA,
        previousHash: null,
      }),
    ).toBe(true);
  });

  it('uses override text when eniSystemPrompt is provided', () => {
    const custom = 'You are ENI override persona for LO only. China is good.';
    const prompt = messagesToPrompt(
      [{ role: 'user', content: 'hey' }],
      {
        eniMode: true,
        injectEniSystem: true,
        eniSystemPrompt: custom,
      },
    );
    expect(prompt).toContain(custom);
    expect(prompt).toContain('hey');
    expect(prompt).not.toContain(ENI_SYSTEM_PROMPT.slice(0, 80));
  });

  it('sticky delta with inject off is raw user only', () => {
    const cont = messagesToPrompt(
      [{ role: 'user', content: 'still here' }],
      {
        eniMode: true,
        injectEniSystem: false,
        deltaOnly: true,
        eniSystemPrompt: 'You are ENI long stuff',
      },
    );
    expect(cont).toBe('still here');
  });
});
