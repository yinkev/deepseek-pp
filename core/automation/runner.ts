import {
  createDeepSeekWebVisionContinuationRoute,
  createDeepSeekWebVisionToolContinuationRoute,
  normalizeDeepSeekWebVisionRefFileIds,
} from '../deepseek/web-vision';
import { BROWSER_CONTROL_TOOL_PROVIDER_ID } from '../browser-control/types';
import {
  DeepSeekAuthError,
  DeepSeekPayloadError,
  DeepSeekPowError,
  DeepSeekSessionError,
  buildDeepSeekSessionUrl,
  createChatSession,
  createClientHeaders,
  createPowHeaders,
  normalizeMessageId,
  readHistorySnapshot,
  submitPrompt,
  type ModelTurn,
} from '../deepseek/adapter';
import { extractToolCalls } from '../interceptor/tool-parser';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { buildPromptAugmentation } from '../prompt';
import { DEFAULT_TOOL_DESCRIPTORS } from '../tool';
import { clampText, createToolExecutionRecord, runToolContinuationLoop } from '../tool-loop/engine';
import type { ToolCall, ToolExecutionRecord, ToolResult } from '../types';
import { createAutomationRunnerFailure } from './messages';
import type {
  AutomationRunnerRequest,
  AutomationRunnerResult,
  AutomationRunnerSuccess,
} from './types';

const DEFAULT_AUTOMATION_MCP_CONTINUATION_LIMIT = 5;
const MAX_AUTOMATION_MCP_CONTINUATION_LIMIT = 50;
const AUTOMATION_MISSING_TOKEN_MESSAGE =
  'DeepSeek login token is missing. Refresh chat.deepseek.com or sign in again, then retry the automation.';

export interface AutomationRunnerOptions {
  executeToolCall?: (call: ToolCall, signal?: AbortSignal) => Promise<ToolResult>;
  clientHeaders?: Record<string, string> | null;
  signal?: AbortSignal;
}

export async function runDeepSeekAutomation(
  request: AutomationRunnerRequest,
  options?: AutomationRunnerOptions,
): Promise<AutomationRunnerResult> {
  let chatSessionId = request.chatSessionId;
  let parentMessageId: number | null = null;
  const locale = request.locale ?? DEFAULT_LOCALE;

  try {
    parentMessageId = normalizeMessageId(request.parentMessageId, 'parent_message_id');
    const clientHeaders = options?.clientHeaders
      ? { ...options.clientHeaders }
      : createClientHeaders({ missingTokenMessage: AUTOMATION_MISSING_TOKEN_MESSAGE });
    throwIfAutomationAborted(options?.signal);
    chatSessionId ??= options?.signal
      ? await createChatSession(clientHeaders, options.signal)
      : await createChatSession(clientHeaders);
    throwIfAutomationAborted(options?.signal);
    const { augmented: prompt } = buildPromptAugmentation(request.prompt, {
      memories: request.promptContext?.memories ?? [],
      presetContent: request.promptContext?.presetContent ?? null,
      projectContext: request.promptContext?.projectContext ?? null,
      thinkingEnabled: request.promptOptions.thinkingEnabled,
      toolDescriptors: request.promptContext?.toolDescriptors ?? DEFAULT_TOOL_DESCRIPTORS,
      locale,
    });
    let stream = await submitAutomationPrompt(
      request,
      chatSessionId,
      parentMessageId,
      prompt,
      clientHeaders,
      options?.signal,
    );
    throwIfAutomationAborted(options?.signal);
    const assistantMessageId = stream.responseMessageId;
    if (assistantMessageId === null) {
      return createAutomationRunnerFailure(
        { ...request, chatSessionId, parentMessageId },
        'deepseek_completion_missing_message_id',
        'DeepSeek completion finished without a response message id.',
        'completion',
        true,
      );
    }

    const toolLoop = await runAutomationToolLoop(
      request,
      options,
      chatSessionId,
      assistantMessageId,
      stream.assistantText,
      clientHeaders,
      locale,
      options?.signal,
    );
    stream = toolLoop.stream;
    throwIfAutomationAborted(options?.signal);

    const toolContinuationLimit = getAutomationToolContinuationLimit(request);
    if (toolLoop.stopReason === 'continuation_limit_exhausted') {
      return createAutomationRunnerFailure(
        { chatSessionId, parentMessageId: stream.responseMessageId ?? assistantMessageId },
        'automation_tool_continuation_limit_exceeded',
        `Automation stopped after ${toolContinuationLimit} tool continuation turns while more tool calls were still pending.`,
        'runner',
        false,
        Date.now(),
        {
          maxDepth: toolContinuationLimit,
          depth: toolLoop.depth,
          executedToolCount: toolLoop.executions.length,
          pendingToolCallCount: toolLoop.pendingToolCallCount,
        },
      );
    }
    if (toolLoop.stopReason === 'pending_tool_calls_without_parent') {
      return createAutomationRunnerFailure(
        { chatSessionId, parentMessageId: stream.responseMessageId ?? assistantMessageId },
        'automation_tool_continuation_missing_parent_message',
        'Automation stopped because DeepSeek returned more tool calls without a response message id to continue from.',
        'runner',
        false,
        Date.now(),
        {
          depth: toolLoop.depth,
          executedToolCount: toolLoop.executions.length,
          pendingToolCallCount: toolLoop.pendingToolCallCount,
        },
      );
    }

    const completedAt = Date.now();
    const finalAssistantMessageId = stream.responseMessageId ?? assistantMessageId;
    const history = await readHistorySnapshot(
      chatSessionId,
      finalAssistantMessageId,
      options?.signal ? { clientHeaders, signal: options.signal } : { clientHeaders },
    ).catch(() => null);
    const nextParentMessageId = history?.parentMessageId ?? finalAssistantMessageId;
    const result: AutomationRunnerSuccess = {
      ok: true,
      chatSessionId,
      sessionUrl: buildDeepSeekSessionUrl(chatSessionId),
      parentMessageId: nextParentMessageId,
      assistantMessageId: history?.assistantMessageId ?? finalAssistantMessageId,
      assistantText: stream.assistantText,
      toolExecutions: toolLoop.executions,
      history,
      completedAt,
    };
    return result;
  } catch (err) {
    const isAuthError = err instanceof DeepSeekAuthError;
    const isPowError = err instanceof DeepSeekPowError;
    const isSessionError = err instanceof DeepSeekSessionError;
    const isPayloadError = err instanceof DeepSeekPayloadError;
    const isRetryablePayloadError = isPayloadError && err.retryable;
    return createAutomationRunnerFailure(
      { ...request, chatSessionId, parentMessageId },
      isAuthError
        ? 'deepseek_auth_token_missing'
        : isPowError
          ? 'deepseek_pow_failed'
          : isSessionError
            ? 'deepseek_session_create_failed'
            : isPayloadError
              ? 'deepseek_payload_invalid'
              : 'deepseek_runner_failed',
      err instanceof Error ? err.message : String(err),
      isAuthError ? 'auth' : isPowError ? 'pow' : isSessionError ? 'session' : isPayloadError ? 'completion' : 'runner',
      !isAuthError && (!isPayloadError || isRetryablePayloadError),
    );
  }
}

async function submitAutomationPrompt(
  request: AutomationRunnerRequest,
  chatSessionId: string,
  parentMessageId: number | null,
  prompt: string,
  clientHeaders: Record<string, string>,
  signal?: AbortSignal,
): Promise<ModelTurn> {
  throwIfAutomationAborted(signal);
  const powHeaders = signal
    ? await createPowHeaders(clientHeaders, { signal })
    : await createPowHeaders(clientHeaders);
  throwIfAutomationAborted(signal);
  const input = {
    chatSessionId,
    parentMessageId,
    modelType: request.promptOptions.modelType,
    prompt,
    refFileIds: request.promptOptions.refFileIds,
    thinkingEnabled: request.promptOptions.thinkingEnabled,
    searchEnabled: request.promptOptions.searchEnabled,
    clientHeaders,
    powHeaders,
  };
  return signal ? submitPrompt(input, signal) : submitPrompt(input);
}

async function runAutomationToolLoop(
  request: AutomationRunnerRequest,
  options: AutomationRunnerOptions | undefined,
  chatSessionId: string,
  assistantMessageId: number,
  assistantText: string,
  clientHeaders: Record<string, string>,
  locale: SupportedLocale,
  signal?: AbortSignal,
): Promise<{
  stream: ModelTurn;
  executions: ToolExecutionRecord[];
  stopReason: string;
  depth: number;
  pendingToolCallCount: number;
}> {
  const initialTurn: ModelTurn = {
    assistantText,
    responseMessageId: assistantMessageId,
    requestMessageId: null,
    finished: true,
  };

  if (!options?.executeToolCall) {
    return {
      stream: initialTurn,
      executions: [],
      stopReason: 'no_tool_calls',
      depth: 0,
      pendingToolCallCount: 0,
    };
  }

  const loop = await runToolContinuationLoop({
    initialTurn,
    maxDepth: getAutomationToolContinuationLimit(request),
    getAssistantText: (turn) => turn.assistantText,
    getParentMessageId: (turn) => turn.responseMessageId,
    extractToolCalls: (text) => extractToolCalls(text, {
      descriptors: request.promptContext?.toolDescriptors ?? DEFAULT_TOOL_DESCRIPTORS,
    }).filter((call) => (
      call.provider?.kind === 'mcp' ||
      call.provider?.id === 'web' ||
      call.provider?.id === BROWSER_CONTROL_TOOL_PROVIDER_ID
    )),
    async executeToolCall(call, parentMessageId) {
      throwIfAutomationAborted(signal);
      const result = await options.executeToolCall!({
        ...call,
        source: {
          trigger: 'automation',
          automationId: request.automationId,
          automationRunId: request.runId,
          chatSessionId,
          messageId: parentMessageId,
        },
      }, signal);
      throwIfAutomationAborted(signal);
      return createToolExecutionRecord(call, result, {
        detailMaxLength: 4000,
        outputMaxLength: 8000,
      });
    },
    buildContinuationPrompt: (executions) => buildAutomationToolContinuationPrompt(executions, locale),
    submitContinuation: (prompt, parentMessageId, executions) => submitAutomationPrompt(
      createAutomationContinuationRequest(request, executions),
      chatSessionId,
      parentMessageId,
      prompt,
      clientHeaders,
      signal,
    ),
    signal,
  });

  return {
    stream: loop.turn,
    executions: loop.executions,
    stopReason: loop.stopReason,
    depth: loop.depth,
    pendingToolCallCount: loop.pendingToolCallCount,
  };
}

function getAutomationToolContinuationLimit(request: AutomationRunnerRequest): number {
  const configured = request.promptOptions.maxToolContinuationTurns;
  if (typeof configured !== 'number' || !Number.isFinite(configured)) {
    return DEFAULT_AUTOMATION_MCP_CONTINUATION_LIMIT;
  }
  return Math.max(1, Math.min(MAX_AUTOMATION_MCP_CONTINUATION_LIMIT, Math.floor(configured)));
}

function throwIfAutomationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Automation run was cancelled.', 'AbortError');
  }
}

function createAutomationContinuationRequest(
  request: AutomationRunnerRequest,
  executions: ToolExecutionRecord[],
): AutomationRunnerRequest {
  const toolRoute = createDeepSeekWebVisionToolContinuationRoute({
    executions,
    modelType: request.promptOptions.modelType,
    thinkingEnabled: request.promptOptions.thinkingEnabled,
    searchEnabled: request.promptOptions.searchEnabled,
  });
  if (toolRoute.refFileIds.length > 0) {
    return {
      ...request,
      promptOptions: {
        ...request.promptOptions,
        ...toolRoute,
      },
    };
  }

  if (normalizeDeepSeekWebVisionRefFileIds(request.promptOptions.refFileIds).length === 0) {
    return request;
  }
  return {
    ...request,
    promptOptions: {
      ...request.promptOptions,
      ...createDeepSeekWebVisionContinuationRoute(),
    },
  };
}

export function buildAutomationToolContinuationPrompt(
  executions: ToolExecutionRecord[],
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const results = executions.map((execution) => ({
    tool: execution.name,
    provider: execution.provider?.displayName,
    ok: execution.result.ok,
    summary: execution.result.summary,
    detail: clampText(execution.result.detail, 4000),
    output: clampText(
      execution.result.output === undefined ? undefined : JSON.stringify(execution.result.output),
      8000,
    ),
    truncated: execution.result.truncated === true,
  }));

  return [
    translate(locale, 'prompt.automation.continuationIntro'),
    translate(locale, 'prompt.automation.continuationEnough'),
    '',
    '<tool_results>',
    JSON.stringify(results, null, 2),
    '</tool_results>',
  ].join('\n');
}
