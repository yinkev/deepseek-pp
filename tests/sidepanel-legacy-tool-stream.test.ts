import { describe, expect, it, vi } from 'vitest';
import {
  createSidepanelLegacyToolStream,
  executeSidepanelToolCalls,
} from '../core/chat/sidepanel-legacy-tool-stream';
import { createSandboxToolDescriptors } from '../core/sandbox';
import { composeSidepanelChatToolDescriptors } from '../core/tool/sidepanel';
import { createMemoryToolDescriptors } from '../core/tool';

describe('sidepanel legacy tool stream', () => {
  const descriptors = composeSidepanelChatToolDescriptors(createMemoryToolDescriptors('en'), 'en');
  const sandboxPayload = JSON.stringify({
    language: 'javascript',
    code: 'return [3,1,4,1,5,9,2,6].reduce((a,b)=>a+b,0);',
  });
  const sandboxXml = `<sandbox_run>${sandboxPayload}</sandbox_run>`;

  it('hides split sandbox XML from the visible stream while keeping full text for extraction', () => {
    const visible: string[] = [];
    const stream = createSidepanelLegacyToolStream(descriptors, (delta) => visible.push(delta));

    stream.onTextChunk('<sandbox_', '<sandbox_');
    stream.onTextChunk(`run>${sandboxPayload.slice(0, 12)}`, `<sandbox_run>${sandboxPayload.slice(0, 12)}`);
    stream.onTextChunk(
      `${sandboxPayload.slice(12)}</sandbox_run>`,
      sandboxXml,
    );
    stream.onTextChunk('', sandboxXml);
    stream.finishStream();

    expect(visible.join('')).not.toContain('<sandbox_run>');
    expect(visible.join('')).not.toContain('</sandbox_run>');
    expect(stream.getFullText()).toBe(sandboxXml);

    const calls = stream.extractCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('sandbox_run');
  });

  it('executes sandbox once and supports a final done-only continuation shape', async () => {
    const visible: string[] = [];
    const doneEvents: Array<{ text: string; done: boolean }> = [];
    const stream = createSidepanelLegacyToolStream(descriptors, (delta) => visible.push(delta));
    const executeTool = vi.fn(async () => ({
      ok: true,
      summary: '31',
      detail: '31',
      output: { value: 31 },
    }));

    // Model emits only the tool call first.
    for (const chunk of ['<sandbox_run>', sandboxPayload, '</sandbox_run>']) {
      const full = visible.join('') + chunk; // not used for full; we rebuild
      void full;
    }
    stream.onTextChunk(sandboxXml, sandboxXml);
    stream.finishStream();
    const calls = stream.extractCalls();
    expect(calls).toHaveLength(1);

    const execs = await executeSidepanelToolCalls(calls, executeTool);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(execs[0]?.result.ok).toBe(true);
    expect(execs[0]?.result.summary).toBe('31');

    // Final natural-language continuation: no tools → one empty done:true.
    const finalVisible: string[] = [];
    const finalStream = createSidepanelLegacyToolStream(descriptors, (delta) => finalVisible.push(delta));
    finalStream.onTextChunk('TOOL_OK sum=31', 'TOOL_OK sum=31');
    finalStream.finishStream();
    expect(finalStream.extractCalls()).toHaveLength(0);
    expect(finalVisible.join('')).toBe('TOOL_OK sum=31');
    doneEvents.push({ text: '', done: true });
    expect(doneEvents).toEqual([{ text: '', done: true }]);
    expect(visible.join('')).not.toContain('sandbox_run');
  });

  it('does not invent sandbox when the catalog is memory-only', () => {
    const memoryOnly = createMemoryToolDescriptors('en');
    const stream = createSidepanelLegacyToolStream(memoryOnly, () => undefined);
    stream.onTextChunk(sandboxXml, sandboxXml);
    stream.finishStream();
    expect(stream.extractCalls()).toHaveLength(0);
    expect(createSandboxToolDescriptors('en')[0]?.name).toBe('sandbox_run');
  });
});
