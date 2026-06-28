import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createArtifactToolDescriptors } from '../core/artifact';
import { createBufferedSSEParser, XmlToolStreamFilter } from '../core/interceptor/fetch-hook';
import { extractResponseTextFromParsed, parseSSEChunk, parseSSEData } from '../core/interceptor/sse-parser';

describe('XmlToolStreamFilter', () => {
  it('strips whitespace-padded artifact tags with large canvas HTML across SSE events', () => {
    const html = [
      '<!doctype html><html><body><canvas id="stage"></canvas>',
      '<script>',
      'const ctx = document.getElementById("stage").getContext("2d");'.repeat(3000),
      '</script></body></html>',
    ].join('');
    const payload = JSON.stringify({
      filename: 'canvas-design.html',
      content: html,
      language: 'html',
      previewMode: 'html',
    });

    const output = runFilter([
      sseText('Intro < artifact'),
      sseText('_create >' + payload.slice(0, 10_000)),
      sseText(payload.slice(10_000, 80_000)),
      sseText(payload.slice(80_000) + '</ artifact'),
      sseText('_create > done'),
    ]);

    expect(output).not.toContain('artifact_create');
    expect(output).not.toContain('<canvas');
    expect(output).not.toContain('getContext');
    expect(readVisibleText(output)).toBe('Intro  done');
  });

  it('keeps response fragment structure while suppressing a streamed artifact body', () => {
    const payload = JSON.stringify({
      filename: 'fragment-demo.html',
      content: '<!doctype html><canvas></canvas>',
      language: 'html',
    });

    const output = runFilter([
      sseFragment('Before < artifact'),
      sseFragment('_create >' + payload),
      sseFragment('</ artifact_create > after'),
    ]);

    expect(output).toContain('"p":"response/fragments"');
    expect(output).not.toContain('fragment-demo.html');
    expect(output).not.toContain('<canvas');
    expect(readVisibleText(output)).toBe('Before  after');
  });

  it('filters tool calls from initial response object fragments', () => {
    const payload = JSON.stringify({
      filename: 'seed-demo.html',
      content: '<!doctype html><canvas></canvas>',
      language: 'html',
    });

    const output = runFilter([
      sseResponseObjectFragment('Before < artifact_create >' + payload + '</ artifact_create > after'),
    ]);

    expect(output).not.toContain('seed-demo.html');
    expect(output).not.toContain('<canvas');
    expect(readVisibleText(output)).toBe('Before  after');
  });

  it('filters browser tool calls even when descriptors do not include browser tools', () => {
    const output = runFilter([
      sseText('Before <browser_snapshot>{}</browser_snapshot> after'),
    ]);

    expect(output).not.toContain('browser_snapshot');
    expect(readVisibleText(output)).toBe('Before  after');
  });

  it('filters plain legacy tool-call wrappers across SSE events', () => {
    const output = runFilter([
      sseText('Before <tool_'),
      sseText('calls><invoke name="browser_snapshot">'),
      sseText('<parameter name="targetLeaseId"></parameter><parameter name="snapshotId"></parameter>'),
      sseText('</invoke><invoke name="browser_evaluate_script"><parameter name="script"></parameter></invoke></tool_'),
      sseText('calls> after'),
    ]);

    expect(output).not.toContain('<tool_calls>');
    expect(output).not.toContain('browser_snapshot');
    expect(output).not.toContain('browser_evaluate_script');
    expect(readVisibleText(output)).toBe('Before  after');
  });

  it('filters whitespace-padded plain legacy wrappers across SSE events', () => {
    const output = runFilter([
      sseText('Before < tool_'),
      sseText('calls >< invoke name="browser_snapshot" >'),
      sseText('< parameter name="targetLeaseId" ></ parameter >< parameter name="snapshotId" ></ parameter >'),
      sseText('</ invoke ></ tool_'),
      sseText('calls > after'),
    ]);

    expect(output).not.toContain('tool_calls');
    expect(output).not.toContain('browser_snapshot');
    expect(readVisibleText(output)).toBe('Before  after');
  });

  it('filters tool calls from nested response message_content parts', () => {
    const output = runFilter([
      sseResponseObjectMessageContent('Before <browser_snapshot>{}</browser_snapshot> after'),
    ]);

    expect(output).not.toContain('browser_snapshot');
    expect(readVisibleText(output)).toBe('Before  after');
  });

  it('buffers partial SSE events before parsing full-text stream state', () => {
    const parsed: unknown[] = [];
    const parser = createBufferedSSEParser((event) => parsed.push(event));
    const event = sseText('Split event text');

    parser.append(event.slice(0, 8));
    parser.append(event.slice(8, 21));
    expect(parsed).toEqual([]);

    parser.append(event.slice(21));
    expect(parsed).toHaveLength(1);
    expect(extractResponseTextFromParsed(parsed[0])).toBe('Split event text');
  });

  it('keeps response-object message ids discoverable for continuation state', () => {
    const source = readFileSync(join(process.cwd(), 'core/interceptor/fetch-hook.ts'), 'utf8');

    expect(source).toContain('normalizeMessageId(response.message_id)');
    expect(source).toContain("value.p === 'response/message_id'");
    expect(source).not.toContain('normalizeMessageId(value.message_id)');
  });
});

function runFilter(chunks: string[]): string {
  const filter = new XmlToolStreamFilter(createArtifactToolDescriptors('en'));
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

function sseFragment(text: string): string {
  return `data: ${JSON.stringify({ p: 'response/fragments', o: 'APPEND', v: [{ content: text }] })}\n\n`;
}

function sseResponseObjectFragment(text: string): string {
  return `data: ${JSON.stringify({ v: { response: { message_id: 2, fragments: [{ content: text }] } } })}\n\n`;
}

function sseResponseObjectMessageContent(text: string): string {
  return `data: ${JSON.stringify({ v: { response: { message_id: 2, message_content: { parts: [{ content: text }] } } } })}\n\n`;
}

function readVisibleText(output: string): string {
  return parseSSEChunk(output)
    .map((event) => parseSSEData(event.data))
    .map((parsed) => extractResponseTextFromParsed(parsed))
    .filter((text): text is string => text !== null)
    .join('');
}
