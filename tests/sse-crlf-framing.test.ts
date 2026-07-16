import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createDeepSeekSseByteDecoder,
  createDeepSeekSseFrameDecoder,
  parseSSEChunk,
  parseSSEData,
  extractResponseTextFromParsed,
  ResponseTextAssembler,
} from '../core/deepseek/stream-codec';
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

  it('removes one optional ASCII space without trimming SSE field values', () => {
    const events = parseSSEChunk([
      'id:  id value  ',
      'event:  custom event  ',
      'data:  payload value  ',
      '',
      '',
    ].join('\n'));

    expect(events).toEqual([{
      id: ' id value  ',
      type: ' custom event  ',
      data: ' payload value  ',
    }]);
  });

  it('decodes multibyte UTF-8 and CRLF framing at every byte split', () => {
    const wire = `data: ${JSON.stringify({ v: '多字节🙂' })}\r\n\r\n`;
    const bytes = new TextEncoder().encode(wire);

    for (let splitAt = 0; splitAt <= bytes.length; splitAt++) {
      const decoder = createDeepSeekSseByteDecoder();
      const events = [
        ...decoder.push(bytes.slice(0, splitAt)),
        ...decoder.push(bytes.slice(splitAt)),
        ...decoder.finish(),
      ];
      expect(events.map((event) => parseSSEData(event.data)), `byte split ${splitAt}`)
        .toEqual([{ v: '多字节🙂' }]);
    }
  });

  it('flushes EOF boundaries whose final CR is ambiguous during push', () => {
    for (const separator of ['\r\r', '\n\r']) {
      const decoder = createDeepSeekSseFrameDecoder();
      const wire = `data: ${JSON.stringify({ v: separator })}${separator}`;

      expect(decoder.push(wire), JSON.stringify(separator)).toEqual([]);
      const frames = decoder.finish();
      expect(frames).toHaveLength(1);
      expect(frames[0].separator).toBe(separator);
      expect(frames[0].parsed).toEqual({ v: separator });
      expect(`${frames[0].block}${frames[0].separator}`).toBe(wire);
    }
  });

  it('frames LF, CRLF, bare CR, and mixed boundaries at every chunk split', () => {
    const wire = [
      'data: {"v":"lf"}\n\n',
      'data: {"v":"crlf"}\r\n\r\n',
      'data: {"v":"cr"}\r\r',
      'data: {"v":"crlf-lf"}\r\n\n',
      'data: {"v":"lf-cr"}\n\r',
      'data: {"v":"cr-crlf"}\r\r\n',
    ].join('');
    const expected = ['lf', 'crlf', 'cr', 'crlf-lf', 'lf-cr', 'cr-crlf'];
    const expectedSeparators = ['\n\n', '\r\n\r\n', '\r\r', '\r\n\n', '\n\r', '\r\r\n'];
    const decode = (chunks: string[]) => {
      const decoder = createDeepSeekSseFrameDecoder();
      const frames = chunks
        .flatMap((chunk) => decoder.push(chunk))
        .concat(decoder.finish());
      expect(frames.map((frame) => frame.separator)).toEqual(expectedSeparators);
      expect(frames.map((frame) => `${frame.block}${frame.separator}`).join('')).toBe(wire);
      return frames.map((frame) => (frame.parsed as { v: string }).v);
    };

    for (let splitAt = 0; splitAt <= wire.length; splitAt++) {
      expect(decode([wire.slice(0, splitAt), wire.slice(splitAt)]), `split ${splitAt}`)
        .toEqual(expected);
    }
    expect(decode([...wire]), 'one character per chunk').toEqual(expected);
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
