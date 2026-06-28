import { describe, expect, it } from 'vitest';
import { XmlToolStreamFilter, createBufferedSSEParser } from '../core/interceptor/fetch-hook';
import { DEFAULT_TOOL_DESCRIPTORS } from '../core/tool';
import { extractResponseTextFromParsed, parseSSEChunk, parseSSEData } from '../core/interceptor/sse-parser';

function runFilter(chunks: string[]): string {
  const filter = new XmlToolStreamFilter(DEFAULT_TOOL_DESCRIPTORS, 'test prompt');
  const decoder = new TextDecoder();
  const output: string[] = [];
  const controller = {
    enqueue(data: Uint8Array) {
      output.push(decoder.decode(data));
    },
  } as ReadableStreamDefaultController<Uint8Array>;

  for (const chunk of chunks) {
    filter.processChunk(chunk, controller);
  }
  filter.flush(controller);
  return output.join('');
}

function sseText(text: string): string {
  return `data: ${JSON.stringify({ p: 'response/content', o: 'APPEND', v: text })}\n\n`;
}

function readVisibleText(output: string): string {
  return parseSSEChunk(output)
    .map((event) => parseSSEData(event.data))
    .map((parsed) => extractResponseTextFromParsed(parsed))
    .filter((text): text is string => text !== null)
    .join('');
}

describe('XmlToolStreamFilter', () => {
  it('passes through normal text without tool calls', () => {
    const output = runFilter([sseText('Hello world'), sseText(' more text')]);
    expect(readVisibleText(output)).toBe('Hello world more text');
  });

  it('strips memory_save tool blocks from visible text', () => {
    const output = runFilter([
      sseText('Before '),
      sseText('<memory_save>content</memory_save>'),
      sseText(' after'),
    ]);
    expect(readVisibleText(output)).toBe('Before  after');
    expect(output).not.toContain('memory_save');
  });

  it('strips web_search tool blocks', () => {
    const output = runFilter([
      sseText('Going to site '),
      sseText('<web_search>query</web_search>'),
      sseText(' done'),
    ]);
    expect(readVisibleText(output)).toBe('Going to site  done');
    expect(output).not.toContain('web_search');
  });

  it('handles tool blocks split across multiple chunks', () => {
    const output = runFilter([
      sseText('Start '),
      sseText('<memory_save>'),
      sseText('value</memory_save>'),
      sseText(' End'),
    ]);
    expect(readVisibleText(output)).toBe('Start  End');
    expect(output).not.toContain('memory_save');
  });

  it('preserves text before and after tool blocks', () => {
    const output = runFilter([
      sseText('Intro text '),
      sseText('<web_search>query</web_search>'),
      sseText(' Outro text'),
    ]);
    expect(readVisibleText(output)).toBe('Intro text  Outro text');
  });

  it('handles empty chunks gracefully', () => {
    const output = runFilter([sseText(''), sseText('Hello'), sseText('')]);
    expect(readVisibleText(output)).toContain('Hello');
  });

  it('handles multiple tool calls in sequence', () => {
    const output = runFilter([
      sseText('First '),
      sseText('<memory_save>data1</memory_save>'),
      sseText(' Middle '),
      sseText('<web_search>query2</web_search>'),
      sseText(' Last'),
    ]);
    expect(readVisibleText(output)).toContain('First');
    expect(readVisibleText(output)).toContain('Middle');
    expect(readVisibleText(output)).toContain('Last');
    expect(output).not.toContain('memory_save');
    expect(output).not.toContain('web_search');
  });

  it('strips tool blocks with content across events', () => {
    const output = runFilter([
      sseText('Before '),
      sseText('<memory_save>some '),
      sseText('content here</memory_save>'),
      sseText(' After'),
    ]);
    expect(readVisibleText(output)).toBe('Before  After');
    expect(output).not.toContain('memory_save');
  });

  it('handles tool block in single event', () => {
    const output = runFilter([
      sseText('Start <memory_save>val</memory_save> End'),
    ]);
    expect(readVisibleText(output)).toBe('Start  End');
    expect(output).not.toContain('memory_save');
  });
});

describe('createBufferedSSEParser', () => {
  it('parses complete SSE events', () => {
    const parsed: unknown[] = [];
    const parser = createBufferedSSEParser((p) => parsed.push(p));
    parser.append('data: {"text":"hello"}\n\n');
    parser.flush();
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({ text: 'hello' });
  });

  it('buffers incomplete events until boundary', () => {
    const parsed: unknown[] = [];
    const parser = createBufferedSSEParser((p) => parsed.push(p));
    parser.append('data: {"text":"hel');
    expect(parsed).toHaveLength(0);
    parser.append('lo"}\n\n');
    expect(parsed).toHaveLength(1);
    parser.flush();
  });

  it('handles multiple events in one append', () => {
    const parsed: unknown[] = [];
    const parser = createBufferedSSEParser((p) => parsed.push(p));
    parser.append('data: {"a":1}\n\ndata: {"b":2}\n\n');
    parser.flush();
    expect(parsed).toHaveLength(2);
  });

  it('flush processes remaining buffer', () => {
    const parsed: unknown[] = [];
    const parser = createBufferedSSEParser((p) => parsed.push(p));
    parser.append('data: {"text":"partial"}');
    expect(parsed).toHaveLength(0);
    parser.flush();
    expect(parsed).toHaveLength(1);
  });

  it('ignores empty blocks', () => {
    const parsed: unknown[] = [];
    const parser = createBufferedSSEParser((p) => parsed.push(p));
    parser.append('\n\ndata: {"text":"hello"}\n\n');
    parser.flush();
    expect(parsed).toHaveLength(1);
  });

  it('skips non-data lines', () => {
    const parsed: unknown[] = [];
    const parser = createBufferedSSEParser((p) => parsed.push(p));
    parser.append('event: message\ndata: {"text":"hello"}\n\n');
    parser.flush();
    expect(parsed).toHaveLength(1);
  });

  it('ignores invalid JSON in data lines', () => {
    const parsed: unknown[] = [];
    const parser = createBufferedSSEParser((p) => parsed.push(p));
    parser.append('data: not-json\n\n');
    parser.append('data: {"valid":true}\n\n');
    parser.flush();
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({ valid: true });
  });
});
