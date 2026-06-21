import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InlineAgentStartPayload } from '../core/inline-agent/types';
import type { ToolExecutionRecord } from '../core/types';

const adapterMocks = vi.hoisted(() => ({
  createClientHeaders: vi.fn(),
  createPowHeaders: vi.fn(),
  submitPromptStreaming: vi.fn(),
}));

vi.mock('../core/deepseek/adapter', () => ({
  createClientHeaders: adapterMocks.createClientHeaders,
  createPowHeaders: adapterMocks.createPowHeaders,
  submitPromptStreaming: adapterMocks.submitPromptStreaming,
}));

const { runInlineAgentLoop } = await import('../core/inline-agent/loop');

describe('runInlineAgentLoop Vision routing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    adapterMocks.createClientHeaders.mockReturnValue({ Authorization: 'Bearer test-token' });
    adapterMocks.createPowHeaders.mockResolvedValue({ 'X-DS-PoW-Response': 'pow' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops Vision file refs for continuations and finalization', async () => {
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input: unknown, callbacks: { onTextChunk?: (text: string, fullText: string) => void }) => {
        callbacks.onTextChunk?.('Done.', 'Done.');
        return {
          assistantText: '',
          responseMessageId: 11,
          requestMessageId: 10,
          finished: true,
        };
      })
      .mockImplementationOnce(async (_input: unknown, callbacks: { onTextChunk?: (text: string, fullText: string) => void }) => {
        callbacks.onTextChunk?.('Final answer.', 'Final answer.');
        return {
          assistantText: '',
          responseMessageId: 12,
          requestMessageId: 11,
          finished: true,
        };
      });

    const done = runInlineAgentLoop(createPayload(), {
      post: vi.fn(),
      executeTool: vi.fn(),
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(7000);
    await done;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPromptStreaming.mock.calls[0][0]).toMatchObject({
      modelType: null,
      refFileIds: [],
      thinkingEnabled: false,
      searchEnabled: false,
    });
    expect(adapterMocks.submitPromptStreaming.mock.calls[1][0]).toMatchObject({
      parentMessageId: 11,
      modelType: null,
      refFileIds: [],
      thinkingEnabled: false,
      searchEnabled: false,
    });
  });
});

function createPayload(): InlineAgentStartPayload {
  return {
    loopId: 'loop-1',
    chatSessionId: 'session-1',
    parentMessageId: 9,
    originalPrompt: 'Read the attached image, then use the tool.',
    agentTaskPrompt: 'Read the attached image, then use the tool.',
    toolExecutions: [createExecution()],
    promptOptions: {
      modelType: 'vision',
      searchEnabled: true,
      thinkingEnabled: true,
      refFileIds: ['file-vision'],
    },
    toolDescriptors: [],
    locale: 'en',
  };
}

function createExecution(): ToolExecutionRecord {
  return {
    name: 'web_search',
    provider: {
      kind: 'local',
      id: 'web',
      displayName: 'DeepSeek++ Web Search',
      transport: 'in_process',
    },
    result: {
      ok: true,
      summary: 'Search completed.',
      output: [{ title: 'Result', url: 'https://example.com' }],
    },
  };
}
