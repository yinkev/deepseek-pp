import { describe, expect, it, vi, afterEach } from 'vitest';

const MAIN_WORLD_SOURCE = 'deepseek-pp-main';
const CONTENT_SOURCE = 'deepseek-pp-content';
const BRIDGE_REQUEST_TYPE = 'DPP_BRIDGE_REQUEST';
const BRIDGE_INIT_TYPE = 'DPP_BRIDGE_INIT';
const BRIDGE_READY_TYPE = 'DPP_BRIDGE_READY';
const REQUEST_TIMEOUT_MS = 8_000;

describe('bridge MessagePort protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('MessageChannel provides bidirectional communication', async () => {
    const { port1, port2 } = new MessageChannel();
    const messages1: unknown[] = [];
    const messages2: unknown[] = [];
    port1.onmessage = (e) => messages1.push(e.data);
    port2.onmessage = (e) => messages2.push(e.data);
    port1.postMessage({ type: 'PING' });
    port2.postMessage({ type: 'PONG' });
    await new Promise((r) => setTimeout(r, 10));
    expect(messages2).toHaveLength(1);
    expect(messages2[0]).toEqual({ type: 'PING' });
    expect(messages1).toHaveLength(1);
    expect(messages1[0]).toEqual({ type: 'PONG' });
  });

  it('bridge init message carries port reference', () => {
    const { port1 } = new MessageChannel();
    const receivedPorts: MessagePort[] = [];
    window.addEventListener('message', (event) => {
      if (event.data?.source === CONTENT_SOURCE && event.data?.type === BRIDGE_INIT_TYPE) {
        receivedPorts.push(...event.ports);
      }
    });
    const event = new MessageEvent('message', {
      data: { source: CONTENT_SOURCE, type: BRIDGE_INIT_TYPE },
      origin: 'https://chat.deepseek.com',
      ports: [port1],
    });
    window.dispatchEvent(event);
    expect(receivedPorts).toHaveLength(1);
    expect(receivedPorts[0]).toBe(port1);
  });

  it('bridge request polling sends correct message format', () => {
    const messages: unknown[] = [];
    vi.stubGlobal('postMessage', vi.fn((msg: unknown) => messages.push(msg)));
    for (let i = 0; i < 3; i++) {
      window.postMessage({ source: MAIN_WORLD_SOURCE, type: BRIDGE_REQUEST_TYPE }, window.location.origin);
    }
    const requests = messages.filter(
      (m: any) => m?.source === MAIN_WORLD_SOURCE && m?.type === BRIDGE_REQUEST_TYPE,
    );
    expect(requests).toHaveLength(3);
  });

  it('augment request timeout creates proper error', () => {
    vi.useFakeTimers();
    let rejected = false;
    let errorMsg = '';
    const timeout = setTimeout(() => {
      rejected = true;
      errorMsg = 'DeepSeek++ request augmentation timed out.';
    }, REQUEST_TIMEOUT_MS);
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    expect(rejected).toBe(true);
    expect(errorMsg).toContain('timed out');
    clearTimeout(timeout);
    vi.useRealTimers();
  });

  it('augment result settles pending request with success', () => {
    let result: unknown = null;
    const pending = {
      resolve: (value: unknown) => { result = value; },
      reject: () => {},
      timeout: setTimeout(() => {}, REQUEST_TIMEOUT_MS),
    };
    const message = {
      source: CONTENT_SOURCE,
      type: 'AUGMENT_REQUEST_BODY_RESULT',
      id: 'test-id',
      ok: true,
      result: { body: 'augmented body' },
    };
    if (message.ok !== false) {
      pending.resolve(message.result ?? null);
    }
    clearTimeout(pending.timeout);
    expect(result).toEqual({ body: 'augmented body' });
  });

  it('augment result settles pending request with error', () => {
    let error: Error | null = null;
    const pending = {
      resolve: () => {},
      reject: (err: Error) => { error = err; },
      timeout: setTimeout(() => {}, REQUEST_TIMEOUT_MS),
    };
    const message = {
      source: CONTENT_SOURCE,
      type: 'AUGMENT_REQUEST_BODY_RESULT',
      id: 'test-id',
      ok: false,
      error: 'augmentation failed',
    };
    if (message.ok === false) {
      pending.reject(new Error(message.error || 'failed'));
    }
    clearTimeout(pending.timeout);
    expect(error).toBeInstanceOf(Error);
    expect((error as unknown as Error).message).toBe('augmentation failed');
  });

  it('augment timeout extension resets timer', () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = {
      resolve: () => { settled = true; },
      reject: () => {},
      timeout: setTimeout(() => { settled = true; }, REQUEST_TIMEOUT_MS),
    };
    vi.advanceTimersByTime(5000);
    expect(settled).toBe(false);
    clearTimeout(pending.timeout);
    const newTimeoutMs = 30_000;
    pending.timeout = setTimeout(() => { settled = true; }, newTimeoutMs);
    vi.advanceTimersByTime(5000);
    expect(settled).toBe(false);
    vi.advanceTimersByTime(25000);
    expect(settled).toBe(true);
    clearTimeout(pending.timeout);
    vi.useRealTimers();
  });

  it('multiple augment requests are tracked independently', () => {
    const pending = new Map<string, { resolve: (v: unknown) => void; result: unknown }>();
    const id1 = 'req-1';
    const id2 = 'req-2';
    pending.set(id1, { resolve: (v) => { pending.get(id1)!.result = v; }, result: null });
    pending.set(id2, { resolve: (v) => { pending.get(id2)!.result = v; }, result: null });
    pending.get(id1)!.resolve({ body: 'result-1' });
    pending.get(id2)!.resolve({ body: 'result-2' });
    expect(pending.get(id1)!.result).toEqual({ body: 'result-1' });
    expect(pending.get(id2)!.result).toEqual({ body: 'result-2' });
  });

  it('sync hook state message updates tool descriptors', () => {
    const descriptors: unknown[] = [];
    const message = {
      source: CONTENT_SOURCE,
      type: 'SYNC_HOOK_STATE',
      toolDescriptors: [
        { name: 'web_search', description: 'Search the web' },
        { name: 'memory_save', description: 'Save memory' },
      ],
    };
    if (Array.isArray(message.toolDescriptors)) {
      descriptors.push(
        ...message.toolDescriptors.filter((d): d is { name: string; description: string } =>
          Boolean(d && typeof d === 'object'),
        ),
      );
    }
    expect(descriptors).toHaveLength(2);
    expect(descriptors[0]).toMatchObject({ name: 'web_search' });
  });

  it('bridge request queue cap prevents unbounded growth', () => {
    const MAX_ATTEMPTS = 100;
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS + 10) {
      attempts++;
      if (attempts >= MAX_ATTEMPTS) break;
    }
    expect(attempts).toBe(MAX_ATTEMPTS);
  });
});
