import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDeepSeekSessionUrl,
  clearClientHeadersFromStorage,
  createClientHeaders,
  createChatSession,
  createPowHeaders,
  loadClientHeadersFromStorage,
  rememberDeepSeekClientHeaders,
  saveClientHeadersToStorage,
  scrubStoredClientHeaders,
  submitPromptStreaming,
} from '../core/deepseek/adapter';
import type { ResponseTokenSpeedPayload } from '../core/interceptor/token-speed';

describe('DeepSeek web adapter streaming', () => {
  afterEach(async () => {
    await clearClientHeadersFromStorage();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('can stream chunks without retaining the full assistant text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => createSseResponse([
      'data: {"v":"Hello "}',
      'data: {"v":"world"}',
      'data: {"p":"response/status","v":"FINISHED"}',
    ].join('\n\n'))));

    const chunks: string[] = [];
    const fullTexts: string[] = [];
    const turn = await submitPromptStreaming(createSubmitInput(), {
      retainAssistantText: false,
      onTextChunk(text, fullText) {
        chunks.push(text);
        fullTexts.push(fullText);
      },
    });

    expect(chunks.join('')).toBe('Hello world');
    expect(fullTexts.every((fullText) => fullText === '')).toBe(true);
    expect(turn).toMatchObject({
      assistantText: '',
      finished: true,
    });
  });

  it('retains full assistant text by default', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => createSseResponse([
      'data: {"v":"Hello "}',
      'data: {"v":"world"}',
    ].join('\n\n'))));

    const fullTexts: string[] = [];
    const turn = await submitPromptStreaming(createSubmitInput(), {
      onTextChunk(_text, fullText) {
        fullTexts.push(fullText);
      },
    });

    expect(fullTexts.at(-1)).toBe('Hello world');
    expect(turn.assistantText).toBe('Hello world');
  });

  it('emits token speed progress for bypass streaming requests', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('fetch', vi.fn(async () => createSseResponse([
      'event: ready\ndata: {"request_message_id":1,"response_message_id":2,"model_type":"vision"}',
      'data: {"v":{"response":{"message_id":2,"inserted_at":1000,"accumulated_token_usage":0}}}',
      'data: {"p":"response/fragments/-1/content","v":"Hello "}',
      'data: {"p":"response/fragments/-1/content","v":"world"}',
      'data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":3302},{"p":"quasi_status","v":"FINISHED"}]}',
      'event: update_session\ndata: {"updated_at":1003.11}',
    ].join('\n\n'))));

    const progress: ResponseTokenSpeedPayload[] = [];
    const turn = await submitPromptStreaming(createSubmitInput(), {
      onTokenSpeed(next) {
        progress.push(next);
      },
      onTextChunk() {
        now += 1000;
      },
    });

    const final = progress.at(-1);
    expect(turn.responseMessageId).toBe(2);
    expect(final).toMatchObject({
      active: false,
      accumulatedTokens: 3302,
      tokenSource: 'server',
      speedSource: 'server',
      modelType: 'vision',
      chatSessionId: 'session-1',
      assistantMessageId: 2,
    });
    expect(final?.tokensPerSecond).toBeCloseTo(3302 / 3.11, 5);
  });

  it('submits Vision file refs in the completion body', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => createSseResponse([
      'event: ready\ndata: {"request_message_id":1,"response_message_id":2,"model_type":"vision"}',
    ].join('\n\n')));
    vi.stubGlobal('fetch', fetchImpl);

    await submitPromptStreaming({
      ...createSubmitInput(),
      modelType: 'vision',
      refFileIds: ['file-1'],
      thinkingEnabled: false,
      searchEnabled: false,
    }, {});

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model_type: 'vision',
      ref_file_ids: ['file-1'],
      thinking_enabled: false,
      search_enabled: false,
    });
  });

  it('builds absolute DeepSeek chat session URLs outside the page origin', () => {
    expect(buildDeepSeekSessionUrl('session-1')).toBe('https://chat.deepseek.com/a/chat/s/session-1');
  });

  it('sanitizes chat session create failure payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        biz_code: 123,
        biz_data: {
          signed_path: 'https://signed.example/private',
          authorization: 'Bearer secret',
        },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(createChatSession({ Authorization: 'Bearer test-token' }))
      .rejects.toThrow('Failed to create DeepSeek chat session with HTTP 200, biz_code 123.');
    await expect(createChatSession({ Authorization: 'Bearer test-token' }))
      .rejects.not.toThrow(/signed\.example|Bearer secret/);
  });

  it('sanitizes chat session non-JSON failure bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'signed_path=https://signed.example/private Authorization=Bearer secret',
      { status: 502 },
    )));

    const error = await captureError(() => createChatSession({ Authorization: 'Bearer test-token' }));
    expect(error?.message).toBe('DeepSeek chat session create returned non-JSON HTTP 502.');
    expect(error?.message).not.toMatch(/signed\.example|Bearer secret/);
  });

  it('sanitizes PoW challenge failure payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        biz_code: 124,
        biz_data: {
          signed_path: 'https://signed.example/private',
          authorization: 'Bearer secret',
        },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(createPowHeaders({ Authorization: 'Bearer test-token' }))
      .rejects.toThrow('Failed to create DeepSeek PoW challenge with HTTP 200, biz_code 124.');
    await expect(createPowHeaders({ Authorization: 'Bearer test-token' }))
      .rejects.not.toThrow(/signed\.example|Bearer secret/);
  });

  it('sanitizes PoW challenge non-JSON failure bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'signed_path=https://signed.example/private Authorization=Bearer secret',
      { status: 502 },
    )));

    const error = await captureError(() => createPowHeaders({ Authorization: 'Bearer test-token' }));
    expect(error?.message).toBe('DeepSeek PoW challenge returned non-JSON HTTP 502.');
    expect(error?.message).not.toMatch(/signed\.example|Bearer secret/);
  });

  it('sanitizes completion failure bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'signed_path=https://signed.example/private Authorization=Bearer secret',
      { status: 502 },
    )));

    const error = await captureError(() => submitPromptStreaming({
      ...createSubmitInput(),
      modelType: 'vision',
      refFileIds: ['file-1'],
    }, {}));
    expect(error?.message).toBe('DeepSeek completion failed with HTTP 502.');
    expect(error?.message).not.toMatch(/signed\.example|Bearer secret/);
  });

  it('keeps captured client headers in memory and scrubs extension storage', async () => {
    const { session, local } = stubChromeStorage();

    rememberDeepSeekClientHeaders({
      Authorization: 'Bearer session-token',
      'x-client-locale': 'en-US',
    });

    await expect(saveClientHeadersToStorage()).resolves.toBe(true);
    await expect(loadClientHeadersFromStorage()).resolves.toMatchObject({
      Authorization: 'Bearer session-token',
      'x-client-locale': 'en-US',
    });
    expect(session.data.deepseekCachedClientHeaders).toBeUndefined();
    expect(local.data.deepseekCachedClientHeaders).toBeUndefined();
    expect(local.remove).toHaveBeenCalledWith('deepseekCachedClientHeaders');
  });

  it('removes legacy local client headers instead of migrating them', async () => {
    const { session, local } = stubChromeStorage({
      local: {
        deepseekCachedClientHeaders: {
          Authorization: 'Bearer legacy-token',
          'x-client-locale': 'en-US',
        },
      },
    });

    await expect(loadClientHeadersFromStorage()).resolves.toBeNull();
    expect(session.data.deepseekCachedClientHeaders).toBeUndefined();
    expect(local.data.deepseekCachedClientHeaders).toBeUndefined();
  });

  it('removes legacy local client headers when session storage is unavailable', async () => {
    const { local } = stubChromeStorage({
      session: null,
      local: {
        deepseekCachedClientHeaders: {
          Authorization: 'Bearer legacy-token',
        },
      },
    });

    await expect(loadClientHeadersFromStorage()).resolves.toBeNull();
    expect(local.data.deepseekCachedClientHeaders).toBeUndefined();
  });

  it('clears client headers from session and legacy local storage', async () => {
    const { session, local } = stubChromeStorage({
      session: { deepseekCachedClientHeaders: { Authorization: 'Bearer session-token' } },
      local: { deepseekCachedClientHeaders: { Authorization: 'Bearer legacy-token' } },
    });

    await clearClientHeadersFromStorage();

    expect(session.data.deepseekCachedClientHeaders).toBeUndefined();
    expect(local.data.deepseekCachedClientHeaders).toBeUndefined();
  });

  it('scrubs stored client headers without clearing remembered in-memory headers', async () => {
    const { session, local } = stubChromeStorage({
      session: { deepseekCachedClientHeaders: { Authorization: 'Bearer session-token' } },
      local: { deepseekCachedClientHeaders: { Authorization: 'Bearer legacy-token' } },
    });
    rememberDeepSeekClientHeaders({ Authorization: 'Bearer live-token' });

    await scrubStoredClientHeaders();

    expect(session.data.deepseekCachedClientHeaders).toBeUndefined();
    expect(local.data.deepseekCachedClientHeaders).toBeUndefined();
    expect(createClientHeaders()).toMatchObject({ Authorization: 'Bearer live-token' });
  });

  it('clears remembered in-memory client headers when cached headers are cleared', async () => {
    stubChromeStorage();
    vi.stubGlobal('localStorage', createLocalStorage());

    rememberDeepSeekClientHeaders({ Authorization: 'Bearer stale-token' });
    expect(createClientHeaders()).toMatchObject({ Authorization: 'Bearer stale-token' });

    await clearClientHeadersFromStorage();

    expect(() => createClientHeaders()).toThrow('DeepSeek login token is missing.');
  });
});

function createSubmitInput() {
  return {
    chatSessionId: 'session-1',
    parentMessageId: 1,
    modelType: null,
    prompt: 'hello',
    refFileIds: [],
    thinkingEnabled: false,
    searchEnabled: false,
    clientHeaders: {},
    powHeaders: {},
  };
}

function createSseResponse(text: string): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  }), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function captureError(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

function stubChromeStorage(initial?: {
  session?: Record<string, unknown> | null;
  local?: Record<string, unknown>;
}) {
  const session = initial?.session === null ? null : createStorageArea(initial?.session);
  const local = createStorageArea(initial?.local);
  vi.stubGlobal('chrome', {
    storage: {
      ...(session ? { session } : {}),
      local,
    },
  });
  return { session: session!, local };
}

function createStorageArea(initial: Record<string, unknown> = {}) {
  const area = {
    data: { ...initial },
    get: vi.fn(async (keys?: string | string[]) => {
      if (typeof keys === 'string') return { [keys]: area.data[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, area.data[key]]));
      }
      return { ...area.data };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(area.data, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete area.data[key];
      }
    }),
  };
  return area;
}

function createLocalStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
}
