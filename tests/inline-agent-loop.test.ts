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

  it('aborts runaway finalization output without aborting the parent loop', async () => {
    const parent = new AbortController();
    const post = vi.fn();
    let finalizationSignal: AbortSignal | undefined;

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
      .mockImplementationOnce(async (
        _input: unknown,
        callbacks: { onTextChunk?: (text: string, fullText: string) => void },
        signal?: AbortSignal,
      ) => {
        finalizationSignal = signal;
        callbacks.onTextChunk?.('x'.repeat(12_000), 'x'.repeat(12_000));
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return {
          assistantText: '',
          responseMessageId: 12,
          requestMessageId: 11,
          finished: true,
        };
      });

    const done = runInlineAgentLoop(createPayload(), {
      post,
      executeTool: vi.fn(),
      signal: parent.signal,
    });

    await vi.advanceTimersByTimeAsync(7000);
    await done;

    expect(finalizationSignal).toBeDefined();
    expect(finalizationSignal?.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(post).toHaveBeenCalledWith('AGENT_STEP_COMPLETE', expect.objectContaining({
      stepIndex: 1,
      responseMessageId: null,
    }));
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      totalSteps: 2,
      totalTools: 1,
      finalText: 'x'.repeat(12_000),
    }));
  });

  it('aborts runaway continuation output and completes with the partial answer', async () => {
    const parent = new AbortController();
    const post = vi.fn();
    let continuationSignal: AbortSignal | undefined;

    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (
      _input: unknown,
      callbacks: { onTextChunk?: (text: string, fullText: string) => void },
      signal?: AbortSignal,
    ) => {
      continuationSignal = signal;
      callbacks.onTextChunk?.('y'.repeat(12_000), 'y'.repeat(12_000));
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return {
        assistantText: '',
        responseMessageId: 11,
        requestMessageId: 10,
        finished: true,
      };
    });

    const done = runInlineAgentLoop(createPayload(), {
      post,
      executeTool: vi.fn(),
      signal: parent.signal,
    });

    await done;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(continuationSignal).toBeDefined();
    expect(continuationSignal?.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(post).toHaveBeenCalledWith('AGENT_STEP_COMPLETE', expect.objectContaining({
      stepIndex: 0,
      responseMessageId: null,
    }));
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      totalSteps: 1,
      totalTools: 1,
      finalText: 'y'.repeat(12_000),
    }));
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
