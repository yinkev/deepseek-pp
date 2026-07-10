import { describe, expect, it, vi } from 'vitest';
import {
  augmentBridgePrompt,
  buildBridgeToolContinuationPrompt,
  createBridgeVisibleStreamer,
  formatBridgeToolResultNotice,
  formatBridgeToolStartNotice,
  runBridgeToolLoop,
  shortBridgeToolLabel,
  visibleBridgeAssistantText,
} from '../core/cursor-bridge/tool-loop';
import { DEFAULT_TOOL_DESCRIPTORS } from '../core/tool';
import type { ToolCall, ToolResult } from '../core/types';

describe('cursor-bridge tool-loop', () => {
  it('augments prompt with tool schemas from DeepSeek++ catalog', () => {
    const { prompt, renderedToolCount } = augmentBridgePrompt({
      userPrompt: 'Save a note that my favorite binder is OGC.',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      toolsEnabled: true,
    });
    expect(renderedToolCount).toBeGreaterThan(0);
    expect(prompt).toContain('Save a note that my favorite binder is OGC.');
    // tool schema block is rendered for memory tools at minimum
    expect(prompt.toLowerCase()).toMatch(/tool|memory|invoke|tool_call/);
  });

  it('does not inject tools when toolsEnabled is false', () => {
    const { prompt, renderedToolCount } = augmentBridgePrompt({
      userPrompt: 'plain',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      toolsEnabled: false,
    });
    expect(renderedToolCount).toBe(0);
    expect(prompt).toBe('plain');
  });

  it('strips tool XML blocks from visible assistant text', () => {
    const raw = [
      'I will save that.',
      '<memory_save>',
      '{"content":"OGC binder"}',
      '</memory_save>',
      'Done.',
    ].join('\n');
    const visible = visibleBridgeAssistantText(raw, DEFAULT_TOOL_DESCRIPTORS);
    expect(visible).toContain('I will save that.');
    expect(visible).toContain('Done.');
    expect(visible).not.toMatch(/<memory_save>/);
  });

  it('builds continuation prompt with tool results JSON', () => {
    const prompt = buildBridgeToolContinuationPrompt(
      [
        {
          name: 'memory_save',
          result: {
            ok: true,
            summary: 'saved',
            detail: 'id=1',
          },
        },
      ],
      'Remember my binder preference',
    );
    expect(prompt).toContain('tool_results');
    expect(prompt).toContain('memory_save');
    expect(prompt).toContain('Remember my binder preference');
  });

  it('runs tool continuation loop when assistant emits tool XML', async () => {
    const toolName = DEFAULT_TOOL_DESCRIPTORS[0]?.invocationName
      ?? DEFAULT_TOOL_DESCRIPTORS[0]?.name
      ?? 'memory_save';

    const initialText = [
      'Working.',
      `<${toolName}>`,
      '{"content":"test"}',
      `</${toolName}>`,
    ].join('\n');

    const executeTool = vi.fn(async (call: ToolCall): Promise<ToolResult> => ({
      ok: true,
      summary: `ran ${call.name}`,
      detail: 'ok',
      name: call.name,
    }));

    const submitContinuation = vi.fn(async () => ({
      assistantText: 'Final answer after tools.',
      responseMessageId: 99,
      requestMessageId: null,
      finished: true,
    }));

    const result = await runBridgeToolLoop({
      initialTurn: {
        assistantText: initialText,
        responseMessageId: 10,
        requestMessageId: null,
        finished: true,
      },
      originalTask: 'Do the tool thing',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      executeTool,
      submitContinuation,
    });

    expect(executeTool).toHaveBeenCalled();
    expect(submitContinuation).toHaveBeenCalledOnce();
    expect(result.executions.length).toBeGreaterThan(0);
    expect(result.finalVisibleText).toContain('Final answer after tools.');
    expect(result.turn.responseMessageId).toBe(99);
  });

  it('streams only visible prose and suppresses tool XML mid-stream', () => {
    const deltas: string[] = [];
    const streamer = createBridgeVisibleStreamer(DEFAULT_TOOL_DESCRIPTORS, (d) => deltas.push(d));

    // Prose first
    streamer.push('Here is the blunt breakdown.\n\n');
    // Tool XML arrives in pieces (must not leak)
    streamer.push('<memory_');
    streamer.push('save>\n{"content":"secret"}\n</memory_save>\n');
    streamer.push('Done.');
    streamer.flush();

    const joined = deltas.join('');
    expect(joined).toContain('Here is the blunt breakdown.');
    expect(joined).toContain('Done.');
    expect(joined).not.toMatch(/memory_save|secret|<memory/);
  });

  it('resets visible streamer between turns', () => {
    const deltas: string[] = [];
    const streamer = createBridgeVisibleStreamer(DEFAULT_TOOL_DESCRIPTORS, (d) => deltas.push(d));
    streamer.push('Turn one.');
    streamer.flush();
    streamer.reset();
    streamer.push('Turn two.');
    streamer.flush();
    expect(deltas.join('')).toBe('Turn one.Turn two.');
  });


  it('formats short ds/tool notices', () => {
    expect(shortBridgeToolLabel('memory_save')).toBe('mem');
    expect(shortBridgeToolLabel('web_search')).toBe('web');
    expect(formatBridgeToolStartNotice('memory_save')).toContain('ds/tool:mem');
    expect(formatBridgeToolResultNotice('memory_save', true)).toBe('ds/tool:mem saved\n');
    expect(formatBridgeToolResultNotice('memory_save', false)).toBe('ds/tool:mem failed\n');
    expect(formatBridgeToolResultNotice('web_search', true)).toBe('ds/tool:web ok\n');
    expect(formatBridgeToolResultNotice('web_search', false)).toBe('ds/tool:web failed\n');
  });

});

  it('aborts when signal already aborted (no tool execute)', async () => {
    const toolName = DEFAULT_TOOL_DESCRIPTORS[0]?.invocationName
      ?? DEFAULT_TOOL_DESCRIPTORS[0]?.name
      ?? 'memory_save';
    const initialText = [
      'Working.',
      `<${toolName}>`,
      '{"content":"test"}',
      `</${toolName}>`,
    ].join('\n');
    const executeTool = vi.fn(async (call: ToolCall): Promise<ToolResult> => ({
      ok: true,
      summary: `ran ${call.name}`,
      detail: 'ok',
      name: call.name,
    }));
    const ac = new AbortController();
    ac.abort();
    const result = await runBridgeToolLoop({
      initialTurn: {
        assistantText: initialText,
        responseMessageId: 10,
        requestMessageId: null,
        finished: true,
      },
      originalTask: 'Do the tool thing',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      executeTool,
      submitContinuation: async () => ({
        assistantText: 'should not matter',
        responseMessageId: 99,
        requestMessageId: null,
        finished: true,
      }),
      signal: ac.signal,
    });
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.executions.length).toBeGreaterThan(0);
    expect(result.executions[0].result.ok).toBe(false);
  });

