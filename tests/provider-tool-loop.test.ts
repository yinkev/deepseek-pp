import { describe, expect, it, vi } from 'vitest';
import { runProviderToolLoop } from '../core/chat/provider-tool-loop';
import type { ChatProviderAdapter, ProviderSession } from '../core/chat/provider';
import { DEFAULT_TOOL_DESCRIPTORS } from '../core/tool';
import { createSandboxToolDescriptors } from '../core/sandbox';

describe('shared provider tool loop', () => {
  it('runs a Qwen JSON-envelope sandbox continuation without exposing protocol text', async () => {
    const model = { providerId: 'qwen-web', modelId: 'qwen3.7-plus' } as const;
    const turns = [
      {
        raw: JSON.stringify({
          kind: 'tool_calls',
          tool_calls: [{
            id: 'call_1',
            name: 'sandbox_run',
            arguments: { language: 'javascript', code: '37 * 17.29' },
          }],
        }),
        cursor: 'qwen-response-1',
      },
      {
        raw: JSON.stringify({ kind: 'final', content: 'The total is $639.73.' }),
        cursor: 'qwen-response-2',
      },
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
      toolProtocol: 'json-envelope',
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
    expect(streamTurn.mock.calls[0][0].prompt).toContain('<<DEEPSEEK_PP_TOOL_MODE>>');
    expect(streamTurn.mock.calls[0][0].prompt).toContain('sandbox_run(');
    expect(streamTurn.mock.calls[0][0].prompt).not.toContain('<sandbox_run>');
    expect(streamTurn.mock.calls[1][0].prompt).toContain('Executed sandbox code');
    expect(streamTurn.mock.calls[1][0].prompt).not.toContain('tool XML');
    expect(visible.join('')).toBe('The total is $639.73.');
    expect(visible.join('')).not.toMatch(/tool_calls|sandbox_run|37 \* 17\.29|<sandbox/);
    expect(result.session).toEqual({
      conversationId: 'qwen-chat-1',
      parentCursor: 'qwen-response-2',
    } satisfies ProviderSession);
    expect(result.finalVisibleText).toBe('The total is $639.73.');
  });

  it('repairs one invalid Qwen envelope before executing a local tool', async () => {
    const model = { providerId: 'qwen-web', modelId: 'qwen3.7-plus' } as const;
    const turns = [
      { raw: 'Tool sandbox_run does not exists.', cursor: 'qwen-response-1' },
      {
        raw: JSON.stringify({
          kind: 'tool_calls',
          tool_calls: [{
            name: 'sandbox_run',
            arguments: { language: 'javascript', code: '2 + 2' },
          }],
        }),
        cursor: 'qwen-response-2',
      },
      { raw: JSON.stringify({ kind: 'final', content: 'It is 4.' }), cursor: 'qwen-response-3' },
    ];
    let index = 0;
    const streamTurn = vi.fn(async (input, events) => {
      const next = turns[index++];
      events.onTextDelta?.(next.raw, next.raw);
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
    const executeTool = vi.fn(async () => ({ ok: true, summary: 'Executed', output: 4 }));

    const result = await runProviderToolLoop({
      adapter,
      model,
      session: { conversationId: 'qwen-chat-1', parentCursor: null },
      prompt: 'Use the sandbox to calculate 2 + 2.',
      originalTask: 'Use the sandbox to calculate 2 + 2.',
      thinkingEnabled: true,
      toolProtocol: 'json-envelope',
      toolDescriptors: [...DEFAULT_TOOL_DESCRIPTORS, ...createSandboxToolDescriptors('en')],
      executeTool,
      onVisibleText: (text) => visible.push(text),
    });

    expect(streamTurn).toHaveBeenCalledTimes(3);
    expect(streamTurn.mock.calls[1][0].session.parentCursor).toBe('qwen-response-1');
    expect(streamTurn.mock.calls[1][0].prompt).toContain('<<DEEPSEEK_PP_TOOL_REPAIR>>');
    expect(executeTool).toHaveBeenCalledOnce();
    expect(visible.join('')).toBe('It is 4.');
    expect(result.finalVisibleText).toBe('It is 4.');
  });

  it('stops after one invalid-envelope repair attempt', async () => {
    const model = { providerId: 'qwen-web', modelId: 'qwen3.7-plus' } as const;
    let index = 0;
    const streamTurn = vi.fn(async (input) => {
      index += 1;
      return {
        assistantText: `invalid response ${index}`,
        thinkingText: '',
        session: { ...input.session, parentCursor: `qwen-response-${index}` },
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

    await expect(runProviderToolLoop({
      adapter,
      model,
      session: { conversationId: 'qwen-chat-1', parentCursor: null },
      prompt: 'Calculate 2 + 2.',
      originalTask: 'Calculate 2 + 2.',
      thinkingEnabled: true,
      toolProtocol: 'json-envelope',
      toolDescriptors: createSandboxToolDescriptors('en'),
      executeTool: vi.fn(),
    })).rejects.toThrow('Qwen tool protocol returned invalid JSON');

    expect(streamTurn).toHaveBeenCalledTimes(2);
  });

  it('preserves the existing direct-XML loop for DeepSeek', async () => {
    const model = { providerId: 'deepseek-web', modelId: 'deepseek-chat' } as const;
    const turns = [
      { raw: '<sandbox_run>{"language":"javascript","code":"3 * 3"}</sandbox_run>', cursor: '12' },
      { raw: 'The result is 9.', cursor: '13' },
    ];
    let index = 0;
    const adapter: ChatProviderAdapter = {
      providerId: 'deepseek-web',
      getStatus: async () => ({ available: true }),
      listModels: () => [],
      createSession: async () => ({ conversationId: 'deepseek-chat-1', parentCursor: null }),
      streamTurn: vi.fn(async (input, events) => {
        const next = turns[index++];
        events.onTextDelta?.(next.raw, next.raw);
        return {
          assistantText: next.raw,
          thinkingText: '',
          session: { ...input.session, parentCursor: next.cursor },
          finished: true,
        };
      }),
    };
    const visible: string[] = [];
    const executeTool = vi.fn(async () => ({ ok: true, summary: 'Executed', output: 9 }));

    const result = await runProviderToolLoop({
      adapter,
      model,
      session: { conversationId: 'deepseek-chat-1', parentCursor: null },
      prompt: 'Calculate 3 * 3.',
      originalTask: 'Calculate 3 * 3.',
      thinkingEnabled: false,
      toolDescriptors: createSandboxToolDescriptors('en'),
      executeTool,
      onVisibleText: (text) => visible.push(text),
    });

    expect(executeTool).toHaveBeenCalledOnce();
    expect(visible.join('')).toBe('The result is 9.');
    expect(result.finalVisibleText).toBe('The result is 9.');
  });
});

function split(value: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}
