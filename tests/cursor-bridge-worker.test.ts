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

    expect(result).toEqual({ text: 'Hello' });
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

    expect(result).toEqual({ text: 'cat' });
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

    expect(result).toEqual({ text: 'Fix null check' });
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
});
