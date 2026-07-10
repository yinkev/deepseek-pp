import { describe, expect, it, vi } from 'vitest';
import { probeCursorBridgeReadiness, runCursorBridgeJob } from '../core/cursor-bridge';

describe('cursor-bridge worker', () => {
  it('reports missing tab / login readiness', async () => {
    const noTab = await probeCursorBridgeReadiness({
      loadClientHeaders: async () => ({ Authorization: 'Bearer x' }),
      queryDeepSeekTabs: async () => [],
    }, false);
    expect(noTab.ready).toBe(false);
    expect(noTab.reason).toBe('missing_tab');

    const noLogin = await probeCursorBridgeReadiness({
      loadClientHeaders: async () => null,
      queryDeepSeekTabs: async () => [{ id: 1 }],
    }, false);
    expect(noLogin.ready).toBe(false);
    expect(noLogin.reason).toBe('missing_login');

    const ready = await probeCursorBridgeReadiness({
      loadClientHeaders: async () => ({ Authorization: 'Bearer x' }),
      queryDeepSeekTabs: async () => [{ id: 1 }],
    }, false);
    expect(ready.ready).toBe(true);
  });

  it('runs a browser-origin job through injected adapter deps', async () => {
    const chunks: string[] = [];
    const createSession = vi.fn(async () => 'session-1');
    const createPow = vi.fn(async () => ({ 'X-DS-PoW-Response': 'pow' }));
    const submitStreaming = vi.fn(async (_input, callbacks) => {
      callbacks.onTextChunk?.('Hel', 'Hel');
      callbacks.onTextChunk?.('lo', 'Hello');
      return { assistantText: 'Hello', responseMessageId: 1, requestMessageId: null, finished: true };
    });

    const result = await runCursorBridgeJob(
      {
        id: 'job-1',
        model: 'deepseek-web',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
        thinkingEnabled: false,
        createdAt: Date.now(),
      },
      {
        loadClientHeaders: async () => ({ Authorization: 'Bearer token' }),
        queryDeepSeekTabs: async () => [{ id: 9 }],
        createSession,
        createPow,
        submitStreaming,
      },
      (text) => chunks.push(text),
    );

    expect(result).toEqual({ text: 'Hello' });
    expect(chunks).toEqual(['Hel', 'lo']);
    expect(createSession).toHaveBeenCalledOnce();
    expect(createPow).toHaveBeenCalledOnce();
    expect(submitStreaming).toHaveBeenCalledOnce();
    expect(submitStreaming.mock.calls[0][0]).toMatchObject({
      chatSessionId: 'session-1',
      prompt: 'hi',
      thinkingEnabled: false,
    });
  });

  it('returns missing_login without calling DeepSeek when headers absent', async () => {
    const submitStreaming = vi.fn();
    const result = await runCursorBridgeJob(
      {
        id: 'job-2',
        model: 'deepseek-web',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        thinkingEnabled: false,
        createdAt: Date.now(),
      },
      {
        loadClientHeaders: async () => null,
        queryDeepSeekTabs: async () => [{ id: 1 }],
        submitStreaming,
      },
      () => {},
    );

    expect(result).toMatchObject({ error: { code: 'missing_login' } });
    expect(submitStreaming).not.toHaveBeenCalled();
  });
});
