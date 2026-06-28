import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHistorySnapshot } from '../core/deepseek/adapter';

describe('readHistorySnapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses injected client headers and base URL in background-safe mode', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe('https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-1');
      return new Response(JSON.stringify({
        data: {
          biz_data: {
            chat_messages: [
              { message_id: 100, parent_id: null, message_role: 'user' },
              { message_id: 101, parent_id: 100, message_role: 'assistant', fragments: [{ content: 'History answer.' }] },
            ],
          },
        },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const snapshot = await readHistorySnapshot('session-1', 101, {
      clientHeaders: { Authorization: 'Bearer injected-token' },
      baseUrl: 'https://chat.deepseek.com',
    });

    expect(snapshot).toMatchObject({
      chatSessionId: 'session-1',
      parentMessageId: 101,
      assistantMessageId: 101,
      assistantText: 'History answer.',
      messageCount: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=session-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer injected-token',
        }),
      }),
    );
  });

  it('can recover the latest assistant id without a streamed response id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        biz_data: {
          chat_messages: [
            { message_id: 100, parent_id: null, message_role: 'user' },
            { message_id: 101, parent_id: 100, message_role: 'assistant' },
            { message_id: 102, parent_id: 101, message_role: 'user' },
            { message_id: 103, parent_id: 102, message_role: 'assistant', message_content: { parts: [{ content: 'Latest answer.' }] } },
          ],
        },
      },
    }), { status: 200 })));

    const snapshot = await readHistorySnapshot('session-1', null, {
      clientHeaders: { Authorization: 'Bearer injected-token' },
      baseUrl: 'https://chat.deepseek.com',
    });

    expect(snapshot).toMatchObject({
      parentMessageId: 103,
      assistantMessageId: 103,
      assistantText: 'Latest answer.',
      messageCount: 4,
    });
  });

  it('does not use a user message as an assistant history fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        biz_data: {
          chat_messages: [
            { message_id: 100, parent_id: null, message_role: 'user' },
          ],
        },
      },
    }), { status: 200 })));

    await expect(readHistorySnapshot('session-1', null, {
      clientHeaders: { Authorization: 'Bearer injected-token' },
      baseUrl: 'https://chat.deepseek.com',
    })).resolves.toBeNull();
  });
});
