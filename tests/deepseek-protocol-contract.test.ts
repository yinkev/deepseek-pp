import { describe, expect, it, vi } from 'vitest';
import {
  DEEPSEEK_API_URL,
  DEEPSEEK_BYPASS_HOOK_HEADER,
  DEEPSEEK_CHAT_STREAM_ROUTE_PATHS,
  DEEPSEEK_FILE_FETCH_PATH,
  DEEPSEEK_FILE_UPLOAD_PATH,
  DEEPSEEK_OFFICIAL_API_URL,
  DEEPSEEK_WEB_ORIGIN,
  DEEPSEEK_WEB_ROUTES,
  isDeepSeekChatStreamUrl,
  isDeepSeekHistoryUrl,
} from '../core/deepseek/contracts';
import { submitOfficialDeepSeekStreaming } from '../core/deepseek/official-api';
import { createBufferedSSEParser, XmlToolStreamFilter } from '../core/interceptor/fetch-hook';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import {
  extractResponseTextFromParsed,
  isStreamFinishedFromParsed,
  parseSSEChunk,
  parseSSEData,
} from '../core/interceptor/sse-parser';
import {
  DEEPSEEK_REQUEST_BODY_FIXTURE,
  DEEPSEEK_ROUTE_CONTRACT,
  DEEPSEEK_ROUTE_CURRENT_GAPS,
  DEEPSEEK_SSE_CRLF_LEGAL_WIRE,
  DEEPSEEK_SSE_CURRENT_GAPS,
  LEGAL_DEEPSEEK_ROUTE_FIXTURES,
  LEGAL_DEEPSEEK_SSE_FIXTURES,
  UNKNOWN_DEEPSEEK_SSE_EVENT,
} from './fixtures/external-runtime/deepseek';

describe('DeepSeek external protocol contract', () => {
  it('keeps one production authority for all released web and official routes', () => {
    expect(DEEPSEEK_WEB_ORIGIN).toBe(DEEPSEEK_ROUTE_CONTRACT.origin);
    expect(DEEPSEEK_WEB_ROUTES).toEqual(DEEPSEEK_ROUTE_CONTRACT.routes);
    expect(DEEPSEEK_API_URL).toBe(`${DEEPSEEK_ROUTE_CONTRACT.origin}${DEEPSEEK_ROUTE_CONTRACT.routes.completion}`);
    expect(DEEPSEEK_OFFICIAL_API_URL).toBe(DEEPSEEK_ROUTE_CONTRACT.officialApi);
    expect(DEEPSEEK_FILE_UPLOAD_PATH).toBe(DEEPSEEK_ROUTE_CONTRACT.routes.uploadFile);
    expect(DEEPSEEK_FILE_FETCH_PATH).toBe(DEEPSEEK_ROUTE_CONTRACT.routes.fetchFiles);
    expect(DEEPSEEK_BYPASS_HOOK_HEADER).toBe(DEEPSEEK_ROUTE_CONTRACT.bypassHeader);
    expect(DEEPSEEK_CHAT_STREAM_ROUTE_PATHS).toEqual([
      DEEPSEEK_ROUTE_CONTRACT.routes.completion,
      DEEPSEEK_ROUTE_CONTRACT.routes.regenerate,
    ]);
  });

  it('preserves released route matches and records substring false positives as T3.4 gaps', () => {
    for (const fixture of LEGAL_DEEPSEEK_ROUTE_FIXTURES) {
      const matches = fixture.kind === 'stream'
        ? isDeepSeekChatStreamUrl(fixture.url)
        : isDeepSeekHistoryUrl(fixture.url);
      expect(matches, fixture.url).toBe(true);
    }
    expect(isDeepSeekChatStreamUrl('https://chat.deepseek.com/api/v0/chat/create_pow_challenge')).toBe(false);

    for (const fixture of DEEPSEEK_ROUTE_CURRENT_GAPS) {
      const matches = fixture.kind === 'stream'
        ? isDeepSeekChatStreamUrl(fixture.url)
        : isDeepSeekHistoryUrl(fixture.url);
      expect(matches, fixture.name).toBe(fixture.currentMatch);
      expect(fixture.target).toBe('exact-origin-path-and-method-policy-after-T3.4');
    }
  });

  it('preserves unknown request siblings and leaves invalid JSON or empty prompts untouched', () => {
    const result = augmentRequestBody(JSON.stringify(DEEPSEEK_REQUEST_BODY_FIXTURE), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 4,
      locale: 'en',
    });
    const output = JSON.parse(result?.body ?? '{}');

    for (const [key, value] of Object.entries(DEEPSEEK_REQUEST_BODY_FIXTURE)) {
      if (key === 'prompt') continue;
      expect(output[key], key).toEqual(value);
    }
    expect(output.prompt).toContain(DEEPSEEK_REQUEST_BODY_FIXTURE.prompt);
    expect(result?.agentTaskPrompt).toBe(DEEPSEEK_REQUEST_BODY_FIXTURE.prompt);
    expect(augmentRequestBody('{bad json}', requestState())).toBeNull();
    expect(augmentRequestBody(JSON.stringify({ prompt: '', future_sibling: true }), requestState())).toBeNull();
  });

  it('decodes every released DeepSeek SSE text and finished shape', () => {
    for (const fixture of LEGAL_DEEPSEEK_SSE_FIXTURES) {
      const events = parseSSEChunk(fixture.wire);
      expect(events, fixture.name).toHaveLength(1);
      const parsed = parseSSEData(events[0].data);
      expect(parsed, fixture.name).toEqual(fixture.parsed);
      expect(extractResponseTextFromParsed(parsed), fixture.name).toBe(fixture.text);
      expect(isStreamFinishedFromParsed(parsed), fixture.name).toBe(fixture.finished);
    }
  });

  it('classifies malformed JSON as a gap while treating direct CRLF codec decoding as legal', () => {
    const malformed = parseSSEChunk(DEEPSEEK_SSE_CURRENT_GAPS[0].wire);
    expect(malformed).toHaveLength(1);
    expect(parseSSEData(malformed[0].data)).toBeNull();
    expect(DEEPSEEK_SSE_CURRENT_GAPS[0].target).toBe('observable-protocol-error-after-T5.1');

    const crlf = parseSSEChunk(DEEPSEEK_SSE_CRLF_LEGAL_WIRE);
    expect(crlf).toHaveLength(2);
    expect(crlf[0]).toMatchObject({ type: 'ready', data: '{"model_type":"vision"}' });
    expect(parseSSEData(crlf[0].data)).toEqual({ model_type: 'vision' });
    expect(crlf[1]).toMatchObject({ type: 'message', data: '{"v":"text"}' });
    expect(parseSSEData(crlf[1].data)).toEqual({ v: 'text' });
    expect(extractResponseTextFromParsed(parseSSEData(crlf[1].data))).toBe('text');
  });

  it('keeps passive CRLF boundary detection as a streaming gap until flush', () => {
    const gap = DEEPSEEK_SSE_CURRENT_GAPS[1];
    expect(gap.target).toBe('streaming-crlf-boundary-detection-after-R3.4');

    const seen: Array<{ parsed: unknown; type?: string; data: string }> = [];
    const parser = createBufferedSSEParser((parsed, event) => {
      seen.push({ parsed, type: event.type, data: event.data });
    });

    parser.append(gap.wire);
    expect(seen).toHaveLength(0);

    parser.flush();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      type: 'ready',
      data: '{"model_type":"vision"}',
      parsed: { model_type: 'vision' },
    });
    expect(seen[1]).toMatchObject({
      type: 'message',
      data: '{"v":"text"}',
      parsed: { v: 'text' },
    });
    expect(extractResponseTextFromParsed(seen[1].parsed)).toBe('text');
  });

  it('retains unknown SSE events byte-for-byte through the visible-stream filter', () => {
    const filter = new XmlToolStreamFilter([]);
    const decoder = new TextDecoder();
    const output: string[] = [];
    const controller = {
      enqueue(data: Uint8Array) {
        output.push(decoder.decode(data));
      },
    } as ReadableStreamDefaultController<Uint8Array>;

    filter.processChunk(UNKNOWN_DEEPSEEK_SSE_EVENT, controller);
    filter.flush(controller);
    expect(output.join('')).toBe(UNKNOWN_DEEPSEEK_SSE_EVENT);
  });

  it('passes official API cancellation through and fails explicitly on a missing stream body', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException('cancelled', 'AbortError');
    }) as unknown as typeof fetch;

    await expect(submitOfficialDeepSeekStreaming({
      apiKey: 'contract-key',
      messages: [{ role: 'user', content: 'cancel' }],
      fetchImpl,
    }, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    await expect(submitOfficialDeepSeekStreaming({
      apiKey: 'contract-key',
      messages: [{ role: 'user', content: 'missing body' }],
      fetchImpl: vi.fn(async () => new Response(null, { status: 200 })),
    }, {})).rejects.toThrow('DeepSeek official API response did not include a stream body.');
  });

  it('preserves the official thinking_content response alias', async () => {
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode([
          'data: {"choices":[{"delta":{"thinking_content":"legacy thinking"},"finish_reason":null}]}',
          'data: [DONE]',
        ].join('\n\n')));
        controller.close();
      },
    }));

    await expect(submitOfficialDeepSeekStreaming({
      apiKey: 'contract-key',
      messages: [{ role: 'user', content: 'alias' }],
      fetchImpl: vi.fn(async () => response),
    }, {})).resolves.toEqual({
      assistantText: '',
      reasoningText: 'legacy thinking',
      finished: true,
    });
  });
});

function requestState() {
  return {
    memories: [],
    skills: [],
    activePreset: null,
    modelType: null,
    toolDescriptors: [],
    messageCount: 0,
    locale: 'en' as const,
  };
}
