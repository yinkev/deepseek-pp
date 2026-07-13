import { describe, expect, it, vi } from 'vitest';
import { runProviderToolLoop } from '../core/chat/provider-tool-loop';
import type { ChatProviderAdapter, ProviderSession } from '../core/chat/provider';
import { DEFAULT_TOOL_DESCRIPTORS } from '../core/tool';
import { createSandboxToolDescriptors } from '../core/sandbox';

describe('shared provider tool loop', () => {
  it('runs a Qwen sandbox tool continuation without exposing raw tool XML', async () => {
    const model = { providerId: 'qwen-web', modelId: 'qwen3.7-plus' } as const;
    const turns = [
      {
        raw: 'I will calculate.\n<sandbox_run>{"code":"6 * 7"}</sandbox_run>',
        cursor: 'qwen-response-1',
      },
      { raw: 'The result is 42.', cursor: 'qwen-response-2' },
    ];
    let index = 0;
    const streamTurn = vi.fn(async (input, events) => {
      const next = turns[index++];
      for (const chunk of split(next.raw, 7)) events.onTextDelta?.(chunk, '');
      return {
        assistantText: next.raw,
        thinkingText: '',
        session: { ...input.session, parentCursor: next.cursor },
        finished: true,
      };
    });
    const adapter: ChatProviderAdapter = {
      providerId: 'qwen-web',
      getStatus: async () => ({ available: true }),
      listModels: () => [],
      createSession: async () => ({ conversationId: 'qwen-chat-1', parentCursor: null }),
      streamTurn,
    };
    const visible: string[] = [];
    const executeTool = vi.fn(async () => ({
      ok: true,
      summary: 'Executed sandbox code',
      detail: '42',
      output: 42,
    }));

    const result = await runProviderToolLoop({
      adapter,
      model,
      session: { conversationId: 'qwen-chat-1', parentCursor: null },
      prompt: 'Calculate 6 * 7 with sandbox_run.',
      originalTask: 'Calculate 6 * 7 with sandbox_run.',
      thinkingEnabled: true,
      attachments: [{ id: 'file-1', name: 'cat.png', mimeType: 'image/png' }],
      toolDescriptors: [...DEFAULT_TOOL_DESCRIPTORS, ...createSandboxToolDescriptors('en')],
      executeTool,
      onVisibleText: (text) => visible.push(text),
    });

    expect(executeTool).toHaveBeenCalledOnce();
    expect(streamTurn).toHaveBeenCalledTimes(2);
    expect(streamTurn.mock.calls[0][0].attachments).toEqual([
      { id: 'file-1', name: 'cat.png', mimeType: 'image/png' },
    ]);
    expect(streamTurn.mock.calls[1][0].attachments).toBeUndefined();
    expect(streamTurn.mock.calls[1][0].session.parentCursor).toBe('qwen-response-1');
    expect(streamTurn.mock.calls[1][0].prompt).toContain('Executed sandbox code');
    expect(visible.join('')).toContain('I will calculate.');
    expect(visible.join('')).toContain('The result is 42.');
    expect(visible.join('')).not.toMatch(/sandbox_run|6 \* 7|<sandbox/);
    expect(result.session).toEqual({
      conversationId: 'qwen-chat-1',
      parentCursor: 'qwen-response-2',
    } satisfies ProviderSession);
    expect(result.finalVisibleText).toBe('The result is 42.');
  });
});

function split(value: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}
