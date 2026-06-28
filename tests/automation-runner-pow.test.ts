import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationRunnerRequest } from '../core/automation/types';
import type { ToolCall, ToolDescriptor, ToolResult } from '../core/types';

const adapterMocks = vi.hoisted(() => ({
  createChatSession: vi.fn(),
  createClientHeaders: vi.fn(),
  createPowHeaders: vi.fn(),
  readHistorySnapshot: vi.fn(),
  submitPrompt: vi.fn(),
}));

vi.mock('../core/deepseek/adapter', () => {
  class DeepSeekAuthError extends Error {}
  class DeepSeekPowError extends Error {}
  class DeepSeekSessionError extends Error {}
  class DeepSeekPayloadError extends Error {
    readonly retryable: boolean;

    constructor(message: string, options?: { retryable?: boolean }) {
      super(message);
      this.retryable = options?.retryable ?? false;
    }
  }

  return {
    DeepSeekAuthError,
    DeepSeekPowError,
    DeepSeekSessionError,
    DeepSeekPayloadError,
    buildDeepSeekSessionUrl: (chatSessionId: string) => `https://chat.deepseek.com/a/chat/s/${chatSessionId}`,
    createChatSession: adapterMocks.createChatSession,
    createClientHeaders: adapterMocks.createClientHeaders,
    createPowHeaders: adapterMocks.createPowHeaders,
    normalizeMessageId: (value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    },
    readHistorySnapshot: adapterMocks.readHistorySnapshot,
    submitPrompt: adapterMocks.submitPrompt,
  };
});

const { runDeepSeekAutomation } = await import('../core/automation/runner');

const MCP_ECHO_DESCRIPTOR: ToolDescriptor = {
  id: 'mcp:mock:echo',
  provider: {
    kind: 'mcp',
    id: 'mock',
    displayName: 'Mock MCP',
    transport: 'streamable_http',
  },
  name: 'echo',
  invocationName: 'mcp_mock_echo',
  title: 'Echo',
  description: 'Return the text argument.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
    },
    required: ['text'],
  },
  execution: {
    mode: 'auto',
    enabled: true,
    risk: 'medium',
  },
};

const BROWSER_CLICK_DESCRIPTOR: ToolDescriptor = {
  id: 'browser_control:browser_click',
  provider: {
    kind: 'local',
    id: 'browser_control',
    displayName: 'Browser Control',
    transport: 'in_process',
  },
  name: 'browser_click',
  invocationName: 'browser_click',
  title: 'Click',
  description: 'Click a browser element.',
  inputSchema: {
    type: 'object',
    properties: {
      uid: { type: 'string' },
    },
    required: ['uid'],
  },
  execution: {
    mode: 'auto',
    enabled: true,
    risk: 'medium',
  },
};

describe('runDeepSeekAutomation PoW handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let powCount = 0;
    adapterMocks.createChatSession.mockResolvedValue('session-1');
    adapterMocks.createClientHeaders.mockReturnValue({ Authorization: 'Bearer test-token' });
    adapterMocks.createPowHeaders.mockImplementation(async () => {
      powCount += 1;
      return { 'X-DS-PoW-Response': `pow-${powCount}` };
    });
    adapterMocks.readHistorySnapshot.mockResolvedValue(null);
  });

  it('uses injected client headers when automation runs from the extension background', async () => {
    adapterMocks.submitPrompt.mockResolvedValueOnce({
      assistantText: 'Done.',
      responseMessageId: 301,
      requestMessageId: 300,
      finished: true,
    });

    const result = await runDeepSeekAutomation(createRequest(), {
      clientHeaders: { Authorization: 'Bearer cached-token' },
    });

    expect(result.ok).toBe(true);
    expect(adapterMocks.createClientHeaders).not.toHaveBeenCalled();
    expect(adapterMocks.createChatSession).toHaveBeenCalledWith({ Authorization: 'Bearer cached-token' });
    expect(adapterMocks.createPowHeaders).toHaveBeenCalledWith({ Authorization: 'Bearer cached-token' });
    expect(adapterMocks.submitPrompt.mock.calls[0][0]).toMatchObject({
      clientHeaders: { Authorization: 'Bearer cached-token' },
    });
    expect(adapterMocks.readHistorySnapshot).toHaveBeenCalledWith(
      'session-1',
      301,
      { clientHeaders: { Authorization: 'Bearer cached-token' } },
    );
  });

  it('creates fresh PoW headers for the initial completion and each tool continuation', async () => {
    adapterMocks.submitPrompt
      .mockResolvedValueOnce({
        assistantText: 'Need data.\n<mcp_mock_echo>{"text":"first"}</mcp_mock_echo>',
        responseMessageId: 101,
        requestMessageId: 100,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Done after tool result.',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      });

    const executeToolCall = vi.fn(async (_call: ToolCall): Promise<ToolResult> => ({
      ok: true,
      summary: 'MCP tool executed',
      output: { echoed: 'first' },
    }));

    const result = await runDeepSeekAutomation(createRequest(), { executeToolCall });

    expect(result.ok).toBe(true);
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(adapterMocks.createPowHeaders).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPrompt.mock.calls[0][0]).toMatchObject({
      chatSessionId: 'session-1',
      parentMessageId: null,
      powHeaders: { 'X-DS-PoW-Response': 'pow-1' },
    });
    expect(adapterMocks.submitPrompt.mock.calls[1][0]).toMatchObject({
      chatSessionId: 'session-1',
      parentMessageId: 101,
      powHeaders: { 'X-DS-PoW-Response': 'pow-2' },
    });
  });

  it('fails instead of claiming success when tool continuation budget is exhausted', async () => {
    adapterMocks.submitPrompt
      .mockResolvedValueOnce({
        assistantText: 'Need data.\n<mcp_mock_echo>{"text":"first"}</mcp_mock_echo>',
        responseMessageId: 101,
        requestMessageId: 100,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Need more.\n<mcp_mock_echo>{"text":"second"}</mcp_mock_echo>',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Still need more.\n<mcp_mock_echo>{"text":"third"}</mcp_mock_echo>',
        responseMessageId: 103,
        requestMessageId: 102,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Fourth round.\n<mcp_mock_echo>{"text":"fourth"}</mcp_mock_echo>',
        responseMessageId: 104,
        requestMessageId: 103,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Fifth round.\n<mcp_mock_echo>{"text":"fifth"}</mcp_mock_echo>',
        responseMessageId: 105,
        requestMessageId: 104,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Still not done.\n<mcp_mock_echo>{"text":"sixth"}</mcp_mock_echo>',
        responseMessageId: 106,
        requestMessageId: 105,
        finished: true,
      });

    const executeToolCall = vi.fn(async (call: ToolCall): Promise<ToolResult> => ({
      ok: true,
      summary: `MCP tool executed: ${String(call.payload.text)}`,
      output: { echoed: String(call.payload.text) },
    }));

    const result = await runDeepSeekAutomation(createRequest(), { executeToolCall });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'automation_tool_continuation_limit_exceeded',
        phase: 'runner',
        retryable: false,
        details: {
          maxDepth: 5,
          depth: 5,
          executedToolCount: 5,
          pendingToolCallCount: 1,
        },
      });
      expect(result.parentMessageId).toBe(106);
    }
    expect(executeToolCall).toHaveBeenCalledTimes(5);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(6);
    expect(adapterMocks.readHistorySnapshot).not.toHaveBeenCalled();
  });

  it('honors a per-run tool continuation budget override', async () => {
    adapterMocks.submitPrompt
      .mockResolvedValueOnce({
        assistantText: 'Need data.\n<mcp_mock_echo>{"text":"first"}</mcp_mock_echo>',
        responseMessageId: 201,
        requestMessageId: 200,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Need more.\n<mcp_mock_echo>{"text":"second"}</mcp_mock_echo>',
        responseMessageId: 202,
        requestMessageId: 201,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Still need more.\n<mcp_mock_echo>{"text":"third"}</mcp_mock_echo>',
        responseMessageId: 203,
        requestMessageId: 202,
        finished: true,
      });

    const executeToolCall = vi.fn(async (call: ToolCall): Promise<ToolResult> => ({
      ok: true,
      summary: `MCP tool executed: ${String(call.payload.text)}`,
      output: { echoed: String(call.payload.text) },
    }));

    const result = await runDeepSeekAutomation(createRequest({
      promptOptions: {
        modelType: null,
        searchEnabled: false,
        thinkingEnabled: false,
        refFileIds: [],
        maxToolContinuationTurns: 2,
      },
    }), { executeToolCall });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'automation_tool_continuation_limit_exceeded',
        details: {
          maxDepth: 2,
          depth: 2,
          executedToolCount: 2,
          pendingToolCallCount: 1,
        },
      });
      expect(result.parentMessageId).toBe(203);
    }
    expect(executeToolCall).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(3);
    expect(adapterMocks.readHistorySnapshot).not.toHaveBeenCalled();
  });

  it('fails when continuation budget is exhausted even if the final message id is missing', async () => {
    adapterMocks.submitPrompt
      .mockResolvedValueOnce({
        assistantText: 'Need data.\n<mcp_mock_echo>{"text":"first"}</mcp_mock_echo>',
        responseMessageId: 101,
        requestMessageId: 100,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Need more.\n<mcp_mock_echo>{"text":"second"}</mcp_mock_echo>',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Still need more.\n<mcp_mock_echo>{"text":"third"}</mcp_mock_echo>',
        responseMessageId: 103,
        requestMessageId: 102,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Fourth round.\n<mcp_mock_echo>{"text":"fourth"}</mcp_mock_echo>',
        responseMessageId: 104,
        requestMessageId: 103,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Fifth round.\n<mcp_mock_echo>{"text":"fifth"}</mcp_mock_echo>',
        responseMessageId: 105,
        requestMessageId: 104,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Still not done.\n<mcp_mock_echo>{"text":"sixth"}</mcp_mock_echo>',
        responseMessageId: null,
        requestMessageId: 105,
        finished: true,
      });

    const executeToolCall = vi.fn(async (call: ToolCall): Promise<ToolResult> => ({
      ok: true,
      summary: `MCP tool executed: ${String(call.payload.text)}`,
      output: { echoed: String(call.payload.text) },
    }));

    const result = await runDeepSeekAutomation(createRequest(), { executeToolCall });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('automation_tool_continuation_limit_exceeded');
      expect(result.parentMessageId).toBe(101);
    }
    expect(executeToolCall).toHaveBeenCalledTimes(5);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(6);
    expect(adapterMocks.readHistorySnapshot).not.toHaveBeenCalled();
  });

  it('fails when a continuation returns more tool calls without a parent message id', async () => {
    adapterMocks.submitPrompt
      .mockResolvedValueOnce({
        assistantText: 'Need data.\n<mcp_mock_echo>{"text":"first"}</mcp_mock_echo>',
        responseMessageId: 101,
        requestMessageId: 100,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Need more.\n<mcp_mock_echo>{"text":"second"}</mcp_mock_echo>',
        responseMessageId: null,
        requestMessageId: 101,
        finished: true,
      });

    const executeToolCall = vi.fn(async (call: ToolCall): Promise<ToolResult> => ({
      ok: true,
      summary: `MCP tool executed: ${String(call.payload.text)}`,
      output: { echoed: String(call.payload.text) },
    }));

    const result = await runDeepSeekAutomation(createRequest(), { executeToolCall });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'automation_tool_continuation_missing_parent_message',
        phase: 'runner',
        retryable: false,
        details: {
          depth: 1,
          executedToolCount: 1,
          pendingToolCallCount: 1,
        },
      });
      expect(result.parentMessageId).toBe(101);
    }
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(2);
    expect(adapterMocks.readHistorySnapshot).not.toHaveBeenCalled();
  });

  it('uses Vision file refs only on the initial turn and drops them for tool continuations', async () => {
    adapterMocks.submitPrompt
      .mockResolvedValueOnce({
        assistantText: 'Need data.\n<mcp_mock_echo>{"text":"first"}</mcp_mock_echo>',
        responseMessageId: 201,
        requestMessageId: 200,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Done after tool result.',
        responseMessageId: 202,
        requestMessageId: 201,
        finished: true,
      });

    const executeToolCall = vi.fn(async (_call: ToolCall): Promise<ToolResult> => ({
      ok: true,
      summary: 'MCP tool executed',
      output: { echoed: 'first' },
    }));
    const request = createRequest({
      promptOptions: {
        modelType: 'vision',
        searchEnabled: false,
        thinkingEnabled: false,
        refFileIds: ['file-vision'],
        webVisionFiles: [{
          id: 'file-vision',
          name: 'probe.png',
          size: 5,
          mimeType: 'image/png',
          status: 'SUCCESS',
          modelKind: 'VISION',
          isImage: true,
          auditResult: 'pass',
          width: 10,
          height: 8,
        }],
      },
    });

    const result = await runDeepSeekAutomation(request, { executeToolCall });

    expect(result.ok).toBe(true);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPrompt.mock.calls[0][0]).toMatchObject({
      modelType: 'vision',
      refFileIds: ['file-vision'],
      thinkingEnabled: false,
      searchEnabled: false,
    });
    expect(adapterMocks.submitPrompt.mock.calls[1][0]).toMatchObject({
      parentMessageId: 201,
      modelType: null,
      refFileIds: [],
      thinkingEnabled: false,
      searchEnabled: false,
    });
    expect(request.promptOptions.webVisionFiles?.[0]).not.toHaveProperty('dataUrl');
  });

  it('executes Browser Control calls exposed to automation', async () => {
    adapterMocks.submitPrompt
      .mockResolvedValueOnce({
        assistantText: 'Click it.\n<browser_click>{"uid":"submit-button"}</browser_click>',
        responseMessageId: 401,
        requestMessageId: 400,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'Clicked.',
        responseMessageId: 402,
        requestMessageId: 401,
        finished: true,
      });

    const executeToolCall = vi.fn(async (_call: ToolCall): Promise<ToolResult> => ({
      ok: true,
      summary: 'Clicked submit',
      output: { clicked: true },
    }));
    const result = await runDeepSeekAutomation(createRequest({
      promptContext: {
        toolDescriptors: [BROWSER_CLICK_DESCRIPTOR],
      },
    }), { executeToolCall });

    expect(result.ok).toBe(true);
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(executeToolCall.mock.calls[0][0]).toMatchObject({
      name: 'browser_click',
      payload: { uid: 'submit-button' },
      source: {
        trigger: 'automation',
        automationId: 'automation-1',
        automationRunId: 'run-1',
        chatSessionId: 'session-1',
        messageId: 401,
      },
    });
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(2);
  });

  it('routes Browser Control act-verify refs into the automation continuation turn', async () => {
    adapterMocks.submitPrompt
      .mockResolvedValueOnce({
        assistantText: 'Click it.\n<browser_click>{"uid":"submit-button"}</browser_click>',
        responseMessageId: 501,
        requestMessageId: 500,
        finished: true,
      })
      .mockResolvedValueOnce({
        assistantText: 'The visual state is verified.',
        responseMessageId: 502,
        requestMessageId: 501,
        finished: true,
      });

    const executeToolCall = vi.fn(async (_call: ToolCall): Promise<ToolResult> => ({
      ok: true,
      summary: 'Clicked submit',
      output: {
        clicked: true,
        refFileIds: ['file-actverify'],
        webVisionFiles: [{ id: 'file-actverify', name: 'screen.png' }],
      },
    }));
    const result = await runDeepSeekAutomation(createRequest({
      promptContext: {
        toolDescriptors: [BROWSER_CLICK_DESCRIPTOR],
      },
    }), { executeToolCall });

    expect(result.ok).toBe(true);
    expect(adapterMocks.submitPrompt).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPrompt.mock.calls[1][0]).toMatchObject({
      parentMessageId: 501,
      modelType: 'vision',
      refFileIds: ['file-actverify'],
      thinkingEnabled: false,
      searchEnabled: false,
    });
  });
});

function createRequest(overrides: Partial<AutomationRunnerRequest> = {}): AutomationRunnerRequest {
  const request: AutomationRunnerRequest = {
    runId: 'run-1',
    automationId: 'automation-1',
    prompt: 'Use the mock tool, then finish.',
    trigger: 'manual',
    chatSessionId: null,
    parentMessageId: null,
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
    promptContext: {
      toolDescriptors: [MCP_ECHO_DESCRIPTOR],
    },
    requestedAt: 1,
  };
  return {
    ...request,
    ...overrides,
    promptOptions: overrides.promptOptions ?? request.promptOptions,
    promptContext: overrides.promptContext ?? request.promptContext,
  };
}
