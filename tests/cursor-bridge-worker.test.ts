import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetBridgeThreadStoreForTests,
  probeCursorBridgeReadiness,
  runCursorBridgeJob,
} from '../core/cursor-bridge';

beforeEach(() => {
  __resetBridgeThreadStoreForTests();
});

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

  it('runs expert (ds/octopus) through injected adapter deps', async () => {
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
        model: 'ds/octopus',
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

    expect(result).toMatchObject({ text: 'Hello', sticky: false });
    expect(chunks).toEqual(['Hel', 'lo']);
    expect(createSession).toHaveBeenCalledOnce();
    expect(createPow).toHaveBeenCalledOnce();
    expect(submitStreaming).toHaveBeenCalledOnce();
    expect(submitStreaming.mock.calls[0][0]).toMatchObject({
      chatSessionId: 'session-1',
      modelType: 'expert',
      thinkingEnabled: false,
    });
    expect(submitStreaming.mock.calls[0][0].prompt).toContain('hi');
  });

  it('uses vision modelType for ds/octopus-eyes with uploaded file ids', async () => {
    const createSession = vi.fn(async () => 'session-eyes');
    const createPow = vi.fn(async () => ({ 'X-DS-PoW-Response': 'pow' }));
    const createUploadPow = vi.fn(async () => ({ 'X-DS-PoW-Response': 'upload-pow' }));
    const uploadFile = vi.fn(async () => ({
      id: 'file-1',
      fileName: 'image.png',
      fileSize: 12,
      mimeType: 'image/png',
      status: 'SUCCESS',
      signedPath: null,
      auditResult: 'PASS',
      retryable: null,
      width: 10,
      height: 10,
    }));
    const submitStreaming = vi.fn(async (_input, callbacks) => {
      callbacks.onTextChunk?.('cat', 'cat');
      return { assistantText: 'cat', responseMessageId: 1, requestMessageId: null, finished: true };
    });
    const resolveImageBlob = vi.fn(async () => ({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      filename: 'image.png',
    }));

    const result = await runCursorBridgeJob(
      {
        id: 'job-eyes',
        model: 'ds/octopus-eyes',
        messages: [{ role: 'user', content: 'What is this?' }],
        stream: false,
        thinkingEnabled: false,
        createdAt: Date.now(),
        images: [{ url: 'data:image/png;base64,aaa', mimeType: 'image/png' }],
      },
      {
        loadClientHeaders: async () => ({ Authorization: 'Bearer token' }),
        queryDeepSeekTabs: async () => [{ id: 1 }],
        createSession,
        createPow,
        createUploadPow,
        submitStreaming,
        uploadFile,
        resolveImageBlob,
      },
      () => {},
    );

    expect(result).toMatchObject({ text: 'cat', sticky: false });
    expect(createUploadPow).toHaveBeenCalledOnce();
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(uploadFile.mock.calls[0][0].powHeaders).toEqual({ 'X-DS-PoW-Response': 'upload-pow' });
    expect(submitStreaming).toHaveBeenCalledOnce();
    expect(submitStreaming.mock.calls[0][0]).toMatchObject({
      modelType: 'vision',
      refFileIds: ['file-1'],
    });
  });

  it('runs eyes subcall then expert main when octopus receives images', async () => {
    const createSession = vi.fn(async () => 'session');
    const createPow = vi.fn(async () => ({ 'X-DS-PoW-Response': 'pow' }));
    const createUploadPow = vi.fn(async () => ({ 'X-DS-PoW-Response': 'upload-pow' }));
    const uploadFile = vi.fn(async () => ({
      id: 'file-eyes',
      fileName: 'image.png',
      fileSize: 12,
      mimeType: 'image/png',
      status: 'SUCCESS',
      signedPath: null,
      auditResult: 'PASS',
      retryable: null,
      width: 10,
      height: 10,
    }));
    const submitStreaming = vi.fn(async (input, callbacks) => {
      if (input.modelType === 'vision') {
        callbacks.onTextChunk?.('Red error banner', 'Red error banner');
        return {
          assistantText: 'Red error banner',
          responseMessageId: 1,
          requestMessageId: null,
          finished: true,
        };
      }
      callbacks.onTextChunk?.('Fix null check', 'Fix null check');
      return {
        assistantText: 'Fix null check',
        responseMessageId: 2,
        requestMessageId: null,
        finished: true,
      };
    });
    const resolveImageBlob = vi.fn(async () => ({
      blob: new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' }),
      filename: 'shot.png',
    }));

    const result = await runCursorBridgeJob(
      {
        id: 'job-auto-eyes',
        model: 'ds/octopus',
        messages: [{ role: 'user', content: 'How do I fix this UI error?' }],
        stream: true,
        thinkingEnabled: false,
        createdAt: Date.now(),
        images: [{ url: 'https://example.com/x.png', mimeType: 'image/png' }],
      },
      {
        loadClientHeaders: async () => ({ Authorization: 'Bearer token' }),
        queryDeepSeekTabs: async () => [{ id: 1 }],
        createSession,
        createPow,
        createUploadPow,
        submitStreaming,
        uploadFile,
        resolveImageBlob,
      },
      () => {},
    );

    expect(result).toMatchObject({ text: 'Fix null check', sticky: false });
    expect(uploadFile).toHaveBeenCalledOnce();
    // vision subcall + expert main
    expect(submitStreaming).toHaveBeenCalledTimes(2);
    expect(submitStreaming.mock.calls[0][0]).toMatchObject({
      modelType: 'vision',
      refFileIds: ['file-eyes'],
    });
    expect(submitStreaming.mock.calls[1][0]).toMatchObject({
      modelType: 'expert',
      refFileIds: [],
    });
    expect(submitStreaming.mock.calls[1][0].prompt).toContain('Eyes notes');
    expect(submitStreaming.mock.calls[1][0].prompt).toContain('Red error banner');
    expect(submitStreaming.mock.calls[1][0].prompt).toContain('How do I fix this UI error?');
  });

  it('returns missing_login without calling DeepSeek when headers absent', async () => {
    const submitStreaming = vi.fn();
    const result = await runCursorBridgeJob(
      {
        id: 'job-2',
        model: 'ds/octopus',
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

  it('reuses sticky main session and delta prompt on second turn', async () => {
    let sessionCounter = 0;
    const createSession = vi.fn(async () => {
      sessionCounter += 1;
      return `session-${sessionCounter}`;
    });
    const createPow = vi.fn(async () => ({ 'X-DS-PoW-Response': 'pow' }));
    const submitStreaming = vi.fn(async (input, callbacks) => {
      const text = input.parentMessageId == null ? 'Answer one' : 'Answer two';
      callbacks.onTextChunk?.(text, text);
      return {
        assistantText: text,
        responseMessageId: input.parentMessageId == null ? 10 : 20,
        requestMessageId: null,
        finished: true,
      };
    });

    const deps = {
      loadClientHeaders: async () => ({ Authorization: 'Bearer token' }),
      queryDeepSeekTabs: async () => [{ id: 1 }],
      createSession,
      createPow,
      submitStreaming,
    };

    const first = await runCursorBridgeJob(
      {
        id: 'job-a',
        model: 'ds/octopus',
        messages: [{ role: 'user', content: 'First sticky question about binders' }],
        stream: true,
        thinkingEnabled: false,
        createdAt: Date.now(),
        threadId: 'test-thread-sticky-1',
      },
      deps,
      () => {},
    );
    expect(first).toMatchObject({ text: 'Answer one', sticky: false, threadId: 'test-thread-sticky-1' });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(submitStreaming.mock.calls[0][0]).toMatchObject({
      chatSessionId: 'session-1',
      parentMessageId: null,
    });
    expect(submitStreaming.mock.calls[0][0].prompt).toContain('First sticky question');

    const second = await runCursorBridgeJob(
      {
        id: 'job-b',
        model: 'ds/octopus',
        messages: [
          { role: 'user', content: 'First sticky question about binders' },
          { role: 'assistant', content: 'Answer one' },
          { role: 'user', content: 'Follow-up about parent ids' },
        ],
        stream: true,
        thinkingEnabled: false,
        createdAt: Date.now(),
        threadId: 'test-thread-sticky-1',
      },
      deps,
      () => {},
    );
    expect(second).toMatchObject({ text: 'Answer two', sticky: true, threadId: 'test-thread-sticky-1' });
    // No new session for main turn
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(submitStreaming).toHaveBeenCalledTimes(2);
    expect(submitStreaming.mock.calls[1][0]).toMatchObject({
      chatSessionId: 'session-1',
      parentMessageId: 10,
    });
    // Delta: no full history dump
    expect(submitStreaming.mock.calls[1][0].prompt).toContain('Follow-up about parent ids');
    expect(submitStreaming.mock.calls[1][0].prompt).not.toContain('Conversation so far');
    expect(submitStreaming.mock.calls[1][0].prompt).not.toContain('First sticky question about binders');
  });

  it('maps ds/squid to default modelType with search enabled', async () => {
    const createSession = vi.fn(async () => 'session-squid');
    const createPow = vi.fn(async () => ({ 'X-DS-PoW-Response': 'pow' }));
    const submitStreaming = vi.fn(async (_input, callbacks) => {
      callbacks.onTextChunk?.('fast', 'fast');
      return { assistantText: 'fast', responseMessageId: 1, requestMessageId: null, finished: true };
    });

    const result = await runCursorBridgeJob(
      {
        id: 'job-squid',
        model: 'ds/squid',
        messages: [{ role: 'user', content: 'quick fact' }],
        stream: false,
        thinkingEnabled: false,
        createdAt: Date.now(),
        threadId: 'squid-thread',
      },
      {
        loadClientHeaders: async () => ({ Authorization: 'Bearer token' }),
        queryDeepSeekTabs: async () => [{ id: 1 }],
        createSession,
        createPow,
        submitStreaming,
      },
      () => {},
    );

    expect(result).toMatchObject({ text: 'fast' });
    expect(submitStreaming.mock.calls[0][0]).toMatchObject({
      modelType: 'default',
      searchEnabled: true,
    });
  });

  it('uses eyes cache on second identical image without vision subcall', async () => {
    const createSession = vi.fn(async () => 'session');
    const createPow = vi.fn(async () => ({ 'X-DS-PoW-Response': 'pow' }));
    const createUploadPow = vi.fn(async () => ({ 'X-DS-PoW-Response': 'upload-pow' }));
    const uploadFile = vi.fn(async () => ({
      id: 'file-eyes',
      fileName: 'image.png',
      fileSize: 12,
      mimeType: 'image/png',
      status: 'SUCCESS',
      signedPath: null,
      auditResult: 'PASS',
      retryable: null,
      width: 10,
      height: 10,
    }));
    const submitStreaming = vi.fn(async (input, callbacks) => {
      if (input.modelType === 'vision') {
        callbacks.onTextChunk?.('Cached visual', 'Cached visual');
        return {
          assistantText: 'Cached visual',
          responseMessageId: 1,
          requestMessageId: null,
          finished: true,
        };
      }
      callbacks.onTextChunk?.('Expert answer', 'Expert answer');
      return {
        assistantText: 'Expert answer',
        responseMessageId: 2,
        requestMessageId: null,
        finished: true,
      };
    });
    const resolveImageBlob = vi.fn(async () => ({
      blob: new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' }),
      filename: 'shot.png',
    }));
    const image = { url: 'https://example.com/same-cache.png', mimeType: 'image/png' };
    const deps = {
      loadClientHeaders: async () => ({ Authorization: 'Bearer token' }),
      queryDeepSeekTabs: async () => [{ id: 1 }],
      createSession,
      createPow,
      createUploadPow,
      submitStreaming,
      uploadFile,
      resolveImageBlob,
    };

    await runCursorBridgeJob(
      {
        id: 'job-cache-1',
        model: 'ds/octopus',
        messages: [{ role: 'user', content: 'What is in the image?' }],
        stream: false,
        thinkingEnabled: false,
        createdAt: Date.now(),
        images: [image],
        threadId: 'eyes-cache-thread-a',
      },
      deps,
      () => {},
    );
    expect(submitStreaming.mock.calls.filter((c) => c[0].modelType === 'vision')).toHaveLength(1);

    await runCursorBridgeJob(
      {
        id: 'job-cache-2',
        model: 'ds/octopus',
        messages: [{ role: 'user', content: 'Again, what is in the image?' }],
        stream: false,
        thinkingEnabled: false,
        createdAt: Date.now(),
        images: [image],
        threadId: 'eyes-cache-thread-b',
      },
      deps,
      () => {},
    );
    // Still only one vision subcall total
    expect(submitStreaming.mock.calls.filter((c) => c[0].modelType === 'vision')).toHaveLength(1);
    // Second main prompt still has eyes notes from cache
    const mainCalls = submitStreaming.mock.calls.filter((c) => c[0].modelType === 'expert');
    expect(mainCalls).toHaveLength(2);
    expect(mainCalls[1][0].prompt).toContain('Cached visual');
  });

  it('reuses sticky session without explicit threadId via fingerprint', async () => {
    let n = 0;
    const createSession = vi.fn(async () => {
      n += 1;
      return `sess-${n}`;
    });
    const createPow = vi.fn(async () => ({ 'X-DS-PoW-Response': 'pow' }));
    const submitStreaming = vi.fn(async (input, callbacks) => {
      const text = input.parentMessageId == null ? 'First answer about binders' : 'Second answer continues binders';
      callbacks.onTextChunk?.(text, text);
      return {
        assistantText: text,
        responseMessageId: input.parentMessageId == null ? 11 : 22,
        requestMessageId: null,
        finished: true,
      };
    });
    const deps = {
      loadClientHeaders: async () => ({ Authorization: 'Bearer token' }),
      queryDeepSeekTabs: async () => [{ id: 1 }],
      createSession,
      createPow,
      submitStreaming,
    };
    const seed = 'Fingerprint seed about sticky binders for multi-turn agents';
    await runCursorBridgeJob(
      {
        id: 'j1',
        model: 'ds/octopus',
        messages: [{ role: 'user', content: seed }],
        stream: false,
        thinkingEnabled: false,
        createdAt: Date.now(),
        clientProfile: 'cursor',
      },
      deps,
      () => {},
    );
    const second = await runCursorBridgeJob(
      {
        id: 'j2',
        model: 'ds/octopus',
        messages: [
          { role: 'user', content: seed },
          { role: 'assistant', content: 'First answer about binders' },
          { role: 'user', content: 'Continue with parent ids' },
        ],
        stream: false,
        thinkingEnabled: false,
        createdAt: Date.now(),
        clientProfile: 'cursor',
      },
      deps,
      () => {},
    );
    expect(second).toMatchObject({ sticky: true });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(submitStreaming.mock.calls[1][0].chatSessionId).toBe('sess-1');
    expect(submitStreaming.mock.calls[1][0].parentMessageId).toBe(11);
  });
});
