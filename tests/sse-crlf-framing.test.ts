import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  parseSSEChunk,
  parseSSEData,
  extractResponseTextFromParsed,
  ResponseTextAssembler,
} from '../core/interceptor/sse-parser';
import { submitPromptStreaming } from '../core/deepseek/adapter';

vi.mock('../core/deepseek/pow', () => ({
  solvePowChallengeLocally: vi.fn(async () => ({
    algorithm: 'sha256',
    challenge: 'challenge',
    salt: 'salt',
    answer: 42,
    signature: 'signature',
  })),
}));

describe('SSE CRLF framing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('splits CRLF events so early SET tokens are not lost', () => {
    const chunk = [
      'data: {"p":"response/fragments/-1/content","o":"SET","v":"Multi"}',
      '',
      'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"-turn"}',
      '',
      'data: {"p":"response/status","v":"FINISHED"}',
      '',
      '',
    ].join('\r\n');

    const events = parseSSEChunk(chunk);
    expect(events).toHaveLength(3);
    const texts = events.map((e) => extractResponseTextFromParsed(parseSSEData(e.data)));
    expect(texts[0]).toBe('Multi');
    expect(texts[1]).toBe('-turn');

    const assembler = new ResponseTextAssembler();
    let out = '';
    for (const e of events) {
      out += assembler.apply(parseSSEData(e.data));
    }
    expect(out).toBe('Multi-turn');
  });

  it('recovers when multiple JSON data lines collapse into one block', () => {
    // Simulates bad framing: three data lines, only one blank terminator.
    const collapsed = [
      'data: {"p":"response/fragments/-1/content","o":"SET","v":"Multi"}',
      'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"-turn"}',
      'data: {"p":"response/fragments/-1/content","o":"APPEND","v":" bridges"}',
      '',
      '',
    ].join('\n');

    const events = parseSSEChunk(collapsed);
    expect(events.length).toBe(3);
    const assembler = new ResponseTextAssembler();
    let out = '';
    for (const e of events) out += assembler.apply(parseSSEData(e.data));
    expect(out).toBe('Multi-turn bridges');
  });

  it('without CRLF normalize, multi data lines would collapse (regression guard)', () => {
    const crlf = 'data: {"v":"A"}\r\n\r\ndata: {"v":"B"}\r\n\r\n';
    const naive = crlf.split('\n\n');
    expect(naive.length).toBe(1);
    expect(parseSSEChunk(crlf)).toHaveLength(2);
  });

  it('streams CRLF completion body with full opening word', async () => {
    const body = [
      'data: {"p":"response/fragments/-1/content","o":"SET","v":"Multi"}',
      '',
      'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"-turn bridges"}',
      '',
      'data: {"p":"response/status","v":"FINISHED"}',
      '',
      '',
    ].join('\r\n');

    vi.stubGlobal('fetch', vi.fn(async () => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          const bytes = encoder.encode(body);
          controller.enqueue(bytes.slice(0, 40));
          controller.enqueue(bytes.slice(40, 90));
          controller.enqueue(bytes.slice(90));
          controller.close();
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    }));

    const chunks: string[] = [];
    const turn = await submitPromptStreaming({
      chatSessionId: 's',
      parentMessageId: 1,
      modelType: null,
      prompt: 'hi',
      refFileIds: [],
      thinkingEnabled: false,
      searchEnabled: false,
      clientHeaders: {},
      powHeaders: {},
    }, {
      onTextChunk(text) { chunks.push(text); },
    });

    expect(chunks.join('')).toBe('Multi-turn bridges');
    expect(turn.assistantText).toBe('Multi-turn bridges');
  });
});
