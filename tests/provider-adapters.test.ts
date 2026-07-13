import { describe, expect, it, vi } from 'vitest';
import { createDeepSeekWebProviderAdapter } from '../core/deepseek/provider-adapter';
import { createDeepSeekOfficialProviderAdapter } from '../core/deepseek/official-provider-adapter';
import { createQwenWebProviderAdapter } from '../core/qwen/provider-adapter';
import { CHAT_MODELS } from '../core/chat/provider-registry';

describe('chat provider adapters', () => {
  it('publishes only the approved DeepSeek and qwen3.7-plus choices', () => {
    expect(CHAT_MODELS.map((model) => model.ref)).toEqual([
      { providerId: 'deepseek-web', modelId: 'deepseek-web' },
      { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
    ]);
  });

  it('keeps the Qwen parent cursor opaque across turns', async () => {
    const streamTurn = vi.fn(async () => ({
      assistantText: 'Qwen answer',
      thinkingText: 'Qwen thought',
      responseId: 'qwen-response-2',
      finished: true,
    }));
    const adapter = createQwenWebProviderAdapter({
      getStatus: async () => ({ available: true }),
      transport: {
        createSession: async () => ({ chatId: 'qwen-chat-1', parentId: null }),
        streamTurn,
      },
    });
    const model = { providerId: 'qwen-web', modelId: 'qwen3.7-plus' } as const;
    const session = await adapter.createSession(model);
    const turn = await adapter.streamTurn({
      model,
      session: { ...session, parentCursor: 'qwen-response-1' },
      prompt: 'continue',
      thinkingEnabled: true,
      attachments: [{
        id: 'file-qwen-1',
        name: 'cat.png',
        mimeType: 'image/png',
        providerData: { id: 'file-qwen-1', type: 'image' },
      }],
    }, {});

    expect(streamTurn).toHaveBeenCalledWith(expect.objectContaining({
      session: { chatId: 'qwen-chat-1', parentId: 'qwen-response-1' },
      files: [{ id: 'file-qwen-1', type: 'image' }],
    }), expect.any(Object));
    expect(turn.session).toEqual({
      conversationId: 'qwen-chat-1',
      parentCursor: 'qwen-response-2',
    });
  });

  it('converts cumulative Qwen thinking summaries into UI-safe deltas', async () => {
    const adapter = createQwenWebProviderAdapter({
      getStatus: async () => ({ available: true }),
      transport: {
        createSession: async () => ({ chatId: 'qwen-chat-1', parentId: null }),
        streamTurn: async (_input, callbacks) => {
          callbacks.onThinking?.('Checked');
          callbacks.onThinking?.('Checked context');
          return {
            assistantText: 'done',
            thinkingText: 'Checked context',
            responseId: 'qwen-response-1',
            finished: true,
          };
        },
      },
    });
    const onThinkingDelta = vi.fn();
    await adapter.streamTurn({
      model: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
      session: { conversationId: 'qwen-chat-1', parentCursor: null },
      prompt: 'think',
      thinkingEnabled: true,
    }, { onThinkingDelta });

    expect(onThinkingDelta.mock.calls).toEqual([
      ['Checked', 'Checked'],
      [' context', 'Checked context'],
    ]);
  });

  it('converts only at the DeepSeek numeric parent-id boundary', async () => {
    const submitStreaming = vi.fn(async (input, callbacks) => {
      callbacks.onTextChunk?.('DeepSeek answer', 'DeepSeek answer');
      return {
        assistantText: 'DeepSeek answer',
        responseMessageId: 42,
        requestMessageId: null,
        finished: true,
      };
    });
    const adapter = createDeepSeekWebProviderAdapter({
      loadClientHeaders: async () => ({ Authorization: 'Bearer token' }),
      createSession: async () => 'deepseek-chat-1',
      createPow: async () => ({ 'X-DS-PoW-Response': 'pow' }),
      submitStreaming,
    });
    const model = { providerId: 'deepseek-web', modelId: 'deepseek-web' } as const;
    const turn = await adapter.streamTurn({
      model,
      session: { conversationId: 'deepseek-chat-1', parentCursor: '41' },
      prompt: 'continue',
      thinkingEnabled: false,
    }, {});

    expect(submitStreaming).toHaveBeenCalledWith(expect.objectContaining({
      chatSessionId: 'deepseek-chat-1',
      parentMessageId: 41,
    }), expect.any(Object), undefined);
    expect(turn.session.parentCursor).toBe('42');
  });

  it('preserves official DeepSeek API history behind the same DeepSeek provider model', async () => {
    const submit = vi.fn(async (input, callbacks) => {
      const answer = `answer-${submit.mock.calls.length}`;
      callbacks.onTextChunk?.(answer, answer);
      return { assistantText: answer, reasoningText: '', finished: true };
    });
    const adapter = createDeepSeekOfficialProviderAdapter({
      loadApiKey: async () => 'api-key',
      loadConfig: async () => ({
        model: 'deepseek-v4-pro',
        thinking: 'enabled',
        reasoningEffort: 'max',
      }),
      submit,
      randomUUID: () => 'official-session-1',
    });
    const model = { providerId: 'deepseek-web', modelId: 'deepseek-web' } as const;
    const session = await adapter.createSession(model);
    const first = await adapter.streamTurn({
      model,
      session,
      prompt: 'first',
      thinkingEnabled: true,
    }, {});
    const second = await adapter.streamTurn({
      model,
      session: first.session,
      prompt: 'second',
      thinkingEnabled: true,
    }, {});

    expect(submit.mock.calls[0][0]).toMatchObject({
      apiKey: 'api-key',
      config: { model: 'deepseek-v4-pro', thinking: 'enabled', reasoningEffort: 'max' },
      messages: [{ role: 'user', content: 'first' }],
    });
    expect(submit.mock.calls[1][0].messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer-1' },
      { role: 'user', content: 'second' },
    ]);
    expect(second.session.parentCursor).toBe('2');
  });
});
