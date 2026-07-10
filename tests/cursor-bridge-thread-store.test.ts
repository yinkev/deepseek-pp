import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetBridgeThreadStoreForTests,
  getEyesCache,
  getThread,
  modelFamilyFromBridgeModel,
  putThread,
  resolveThreadId,
  setEyesCache,
  simpleHash,
} from '../core/cursor-bridge';

describe('cursor-bridge thread store', () => {
  beforeEach(() => {
    __resetBridgeThreadStoreForTests();
  });

  // User: "proceed" — eni family + eniPromptHash on thread records.
  it('maps model families', () => {
    expect(modelFamilyFromBridgeModel('ds/octopus')).toBe('octopus');
    expect(modelFamilyFromBridgeModel('ds/octopus-eyes')).toBe('octopus-eyes');
    expect(modelFamilyFromBridgeModel('ds/squid')).toBe('squid');
    expect(modelFamilyFromBridgeModel('ds/eni')).toBe('eni');
  });

  it('prefers explicit thread id over fingerprint', () => {
    const id = resolveThreadId({
      explicitThreadId: 'cursor-xyz',
      model: 'ds/octopus',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(id).toBe('cursor-xyz');
  });

  it('fingerprints by profile + family + first user turn', () => {
    const a = resolveThreadId({
      model: 'ds/octopus',
      clientProfile: 'cursor',
      messages: [{ role: 'user', content: 'same seed question' }],
    });
    const b = resolveThreadId({
      model: 'ds/octopus',
      clientProfile: 'cursor',
      messages: [
        { role: 'user', content: 'same seed question' },
        { role: 'assistant', content: 'ans' },
        { role: 'user', content: 'follow up' },
      ],
    });
    expect(a).toBe(b);
    expect(a.startsWith('fp-cursor-octopus-')).toBe(true);

    const hermes = resolveThreadId({
      model: 'ds/octopus',
      clientProfile: 'hermes',
      messages: [{ role: 'user', content: 'same seed question' }],
    });
    expect(hermes).not.toBe(a);
  });

  it('persists threads and eyes cache in memory', async () => {
    const now = Date.now();
    await putThread({
      id: 't1',
      modelFamily: 'octopus',
      chatSessionId: 'sess',
      parentMessageId: 3,
      modelType: 'expert',
      sessionUrl: 'https://chat.deepseek.com/a/chat/s/sess',
      createdAt: now,
      updatedAt: now,
      turnCount: 1,
      eniPromptHash: 'abc123',
    });
    const got = await getThread('t1');
    expect(got?.chatSessionId).toBe('sess');
    expect(got?.parentMessageId).toBe(3);
    expect(got?.eniPromptHash).toBe('abc123');

    const hash = simpleHash('img');
    await setEyesCache(hash, 'notes here');
    expect(await getEyesCache(hash)).toBe('notes here');
  });
});
