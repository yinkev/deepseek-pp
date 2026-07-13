import { describe, expect, it, vi } from 'vitest';
import {
  buildQwenTurnPayload,
  createQwenWebTransport,
} from '../core/qwen/transport';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe('Qwen web transport', () => {
  it('builds the qwen3.7-plus web payload with an opaque string parent cursor', () => {
    expect(buildQwenTurnPayload({
      prompt: 'Continue the same conversation',
      modelId: 'qwen3.7-plus',
      chatId: 'chat-1',
      parentId: 'parent-1',
      userMessageId: 'user-1',
      responseId: 'response-1',
      timestampSeconds: 123,
      thinkingEnabled: true,
      files: [{ id: 'file-qwen-1', type: 'image' }],
    })).toMatchObject({
      stream: true,
      version: '2.1',
      incremental_output: true,
      chat_id: 'chat-1',
      chat_mode: 'normal',
      model: 'qwen3.7-plus',
      parent_id: 'parent-1',
      chat_type: 't2t',
      sub_chat_type: 't2t',
      timestamp: 124,
      messages: [{
        fid: 'user-1',
        parentId: 'parent-1',
        childrenIds: ['response-1'],
        role: 'user',
        content: 'Continue the same conversation',
        models: ['qwen3.7-plus'],
        files: [{ id: 'file-qwen-1', type: 'image' }],
        feature_config: {
          thinking_enabled: true,
          output_schema: 'phase',
          research_mode: 'normal',
          auto_thinking: true,
          thinking_format: 'summary',
          auto_search: false,
        },
      }],
    });
  });

  it('creates a chat and streams thinking plus answer without exposing thinking as answer text', async () => {
    const fetchImpl = vi.fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'chat-1' } }))
      .mockResolvedValueOnce(sseResponse([
        'data: {"response.created":{"response_id":"upstream-response-1"}}',
        'data: {"choices":[{"delta":{"phase":"thinking_summary","extra":{"summary_thought":{"content":["Checked context"]}}}}]}',
        'data: {"choices":[{"delta":{"phase":"answer","content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"phase":"answer","content":"lo","status":"finished"}}]}',
      ]));
    const transport = createQwenWebTransport({
      fetchImpl,
      loadAuth: async () => ({
        authorization: 'Bearer test-token',
        version: '0.2.63',
        bxUmidToken: 'test-umid',
      }),
      randomUUID: sequenceUuid('request-1', 'user-1', 'response-1'),
      now: () => 123_000,
    });

    const session = await transport.createSession('qwen3.7-plus');
    const chunks: string[] = [];
    const turn = await transport.streamTurn({
      session,
      modelId: 'qwen3.7-plus',
      prompt: 'Say hello',
      thinkingEnabled: true,
    }, {
      onTextChunk: (chunk) => chunks.push(chunk),
    });

    expect(session).toEqual({ chatId: 'chat-1', parentId: null });
    expect(turn).toEqual({
      assistantText: 'Hello',
      thinkingText: 'Checked context',
      responseId: 'upstream-response-1',
      finished: true,
    });
    expect(chunks).toEqual(['Hel', 'lo']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [createUrl, createInit] = fetchImpl.mock.calls[0];
    expect(String(createUrl)).toBe('https://chat.qwen.ai/api/v2/chats/new');
    expect(createInit).toMatchObject({ method: 'POST', credentials: 'include' });

    const [streamUrl, streamInit] = fetchImpl.mock.calls[1];
    expect(String(streamUrl)).toBe('https://chat.qwen.ai/api/v2/chat/completions?chat_id=chat-1');
    expect(streamInit).toMatchObject({ method: 'POST', credentials: 'include' });
    const headers = streamInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers.Version).toBe('0.2.63');
    expect(headers['bx-umidtoken']).toBe('test-umid');
    expect(headers.Cookie).toBeUndefined();
    expect(JSON.parse(String(streamInit?.body))).toMatchObject({
      model: 'qwen3.7-plus',
      parent_id: null,
      messages: [{ content: 'Say hello' }],
    });
  });

  it('surfaces missing authentication and daily rate limits without retrying', async () => {
    const unauthenticated = createQwenWebTransport({
      fetchImpl: vi.fn<FetchMock>(),
      loadAuth: async () => null,
      randomUUID: sequenceUuid('request-1'),
      now: () => 123_000,
    });
    await expect(unauthenticated.createSession('qwen3.7-plus')).rejects.toMatchObject({
      code: 'missing_auth',
    });

    const fetchImpl = vi.fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'chat-1' } }))
      .mockResolvedValueOnce(new Response('{"detail":"Daily limit reached"}', { status: 429 }));
    const limited = createQwenWebTransport({
      fetchImpl,
      loadAuth: async () => ({ authorization: 'Bearer test-token', version: '0.2.63' }),
      randomUUID: sequenceUuid('request-1', 'user-1', 'response-1'),
      now: () => 123_000,
    });
    const session = await limited.createSession('qwen3.7-plus');

    await expect(limited.streamTurn({
      session,
      modelId: 'qwen3.7-plus',
      prompt: 'hello',
      thinkingEnabled: true,
    }, {})).rejects.toEqual(expect.objectContaining({ code: 'rate_limited' }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops and closes the Qwen stream as soon as the finished phase arrives', async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 1) throw new Error('read after Qwen finished');
        controller.enqueue(new TextEncoder().encode([
          'data: {"response.created":{"response_id":"response-finished"}}',
          '',
          'data: {"choices":[{"delta":{"phase":"answer","content":"Done","status":"finished"}}]}',
          '',
          '',
        ].join('\n')));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const fetchImpl = vi.fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'chat-1' } }))
      .mockResolvedValueOnce(new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }));
    const transport = createQwenWebTransport({
      fetchImpl,
      loadAuth: async () => ({ authorization: 'Bearer token', version: '0.2.63' }),
      randomUUID: sequenceUuid('request-1', 'user-1', 'response-1'),
      now: () => 123_000,
    });

    const session = await transport.createSession('qwen3.7-plus');
    await expect(transport.streamTurn({
      session,
      modelId: 'qwen3.7-plus',
      prompt: 'finish',
      thinkingEnabled: true,
    }, {})).resolves.toMatchObject({
      assistantText: 'Done',
      responseId: 'response-finished',
      finished: true,
    });
    expect(pulls).toBe(1);
    expect(cancelled).toBe(true);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(lines: string[]): Response {
  return new Response(lines.join('\n\n'), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

function sequenceUuid(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `uuid-${index}`;
}
