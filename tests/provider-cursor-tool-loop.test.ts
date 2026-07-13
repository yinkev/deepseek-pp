import { describe, expect, it, vi } from 'vitest';
import { runToolContinuationLoop } from '../core/tool-loop/engine';
import type { ToolCall, ToolExecutionRecord } from '../core/types';

describe('provider-neutral tool continuation cursor', () => {
  it('passes an opaque string cursor through execution and continuation', async () => {
    const call: ToolCall = {
      name: 'sandbox_run',
      payload: { code: '1 + 1' },
      raw: '<sandbox_run>{"code":"1 + 1"}</sandbox_run>',
    };
    const execution: ToolExecutionRecord = {
      name: 'sandbox_run',
      result: { ok: true, summary: '2', detail: '2' },
    };
    const executeToolCall = vi.fn(async () => execution);
    const submitContinuation = vi.fn(async () => ({
      assistantText: 'The result is 2.',
      parentCursor: 'qwen-response-2',
    }));

    const result = await runToolContinuationLoop({
      initialTurn: {
        assistantText: '<sandbox_run>{"code":"1 + 1"}</sandbox_run>',
        parentCursor: 'qwen-response-1',
      },
      maxDepth: 2,
      getAssistantText: (turn) => turn.assistantText,
      getParentCursor: (turn) => turn.parentCursor,
      extractToolCalls: () => [call],
      executeToolCall,
      buildContinuationPrompt: () => 'tool result: 2',
      submitContinuation,
    });

    expect(executeToolCall).toHaveBeenCalledWith(call, 'qwen-response-1');
    expect(submitContinuation).toHaveBeenCalledWith('tool result: 2', 'qwen-response-1');
    expect(result.turn.parentCursor).toBe('qwen-response-2');
  });
});
