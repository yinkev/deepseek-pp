import {
  createClientHeaders,
  createPowHeaders,
  submitPromptStreaming,
  type ModelTurn,
  type SubmitPromptInput,
} from '../deepseek/adapter';
import {
  DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN,
  createDeepSeekWebVisionContinuationRoute,
  createDeepSeekWebVisionRoute,
  normalizeDeepSeekWebVisionRefFileIds,
} from '../deepseek/web-vision';
import { extractToolCalls } from '../interceptor/tool-parser';
import { createStreamingToolTextAccumulator } from '../interceptor/streaming-tool-text';
import { createStreamingToolCallParser } from '../interceptor/streaming-tool-call-parser';
import type { ResponseTokenSpeedPayload } from '../interceptor/token-speed';
import { DEFAULT_LOCALE } from '../i18n';
import { executeToolCallsSequentially } from '../tool-loop/engine';
import type { ToolCall, ToolDescriptor, ToolExecutionRecord } from '../types';
import type { ToolParsingInput } from '../tool/invocation';
import {
  buildContinuationPrompt,
  buildFinalizationPrompt,
  buildNudgePrompt,
  extractTaskCompleteSignal,
  shouldNudge,
} from './prompt';
import {
  INLINE_AGENT_MAX_NUDGES,
  INLINE_AGENT_MAX_STEPS,
  INLINE_AGENT_REQUEST_DELAY_MAX_MS,
  INLINE_AGENT_REQUEST_DELAY_MIN_MS,
  INLINE_AGENT_STEP_TIMEOUT_MS,
  type InlineAgentPromptOptions,
  type InlineAgentLoopCompleteMsg,
  type InlineAgentLoopErrorMsg,
  type InlineAgentStartPayload,
  type InlineAgentStepCompleteMsg,
  type InlineAgentStreamChunkMsg,
  type InlineAgentToolDetectedMsg,
} from './types';

type PostFn = (type: string, data: unknown) => void;
type ExecuteToolFn = (call: ToolCall) => Promise<ToolExecutionRecord>;

const INLINE_AGENT_STREAM_EVENT_MAX_CHARS = 12000;
const INLINE_AGENT_FALLBACK_PARSE_MAX_CHARS = 120_000;
const TRUNCATION_SUFFIX = '\n...[truncated]';

export interface InlineAgentLoopDeps {
  post: PostFn;
  executeTool: ExecuteToolFn;
  signal: AbortSignal;
}

export async function runInlineAgentLoop(
  payload: InlineAgentStartPayload,
  deps: InlineAgentLoopDeps,
): Promise<void> {
  const { post, executeTool, signal } = deps;
  const { loopId, chatSessionId, toolDescriptors, promptOptions } = payload;
  const { powWasmUrl } = payload;
  const locale = payload.locale ?? DEFAULT_LOCALE;
  const parsingInput: ToolParsingInput = { descriptors: toolDescriptors };
  const textContinuationPromptOptions = promptOptions.refFileIds.length > 0
    ? createDeepSeekWebVisionContinuationRoute()
    : promptOptions;
  let currentPromptOptions = textContinuationPromptOptions;

  let parentMessageId: number | null = payload.parentMessageId;
  let allExecutions: ToolExecutionRecord[] = [...payload.toolExecutions];
  let nudgeCount = 0;
  let totalSteps = 0;
  let totalTools = allExecutions.length;
  // When the model emits `<task_complete>` we already have the final answer;
  // reuse its summary and skip the redundant finalization step.
  let resolvedFinalText: string | null = null;

  try {
    const clientHeaders = createClientHeaders();

    for (let step = 0; step < INLINE_AGENT_MAX_STEPS; step++) {
      if (signal.aborted) break;
      if (step > 0) {
        await waitBetweenDeepSeekRequests(signal);
        if (signal.aborted) break;
      }

      const prompt = buildContinuationPrompt(payload.originalPrompt, allExecutions, locale);
      const powHeaders = await createPowHeaders(clientHeaders, { wasmUrl: powWasmUrl });
      const streamState = createInlineAgentStreamState({
        loopId,
        stepIndex: step,
        toolDescriptors,
        parsingInput,
        post,
      });

      post('AGENT_STEP_STARTED', { loopId, stepIndex: step });

      const input: SubmitPromptInput = {
        chatSessionId,
        parentMessageId,
        modelType: currentPromptOptions.modelType,
        prompt,
        refFileIds: currentPromptOptions.refFileIds,
        thinkingEnabled: currentPromptOptions.thinkingEnabled,
        searchEnabled: currentPromptOptions.searchEnabled,
        clientHeaders,
        powHeaders,
      };

      const stepTimeout = createStepSignal(signal);
      const turn: ModelTurn = await submitPromptStreaming(input, {
        retainAssistantText: false,
        onTokenSpeed(progress) {
          postAgentTokenSpeed(post, payload, `step:${step}`, progress);
        },
        onTextChunk(text) {
          streamState.onTextChunk(text);
        },
      }, stepTimeout.signal);
      stepTimeout.clear();
      const streamSnapshot = streamState.flush();
      currentPromptOptions = textContinuationPromptOptions;

      if (signal.aborted) break;

      parentMessageId = turn.responseMessageId;
      if (parentMessageId == null) {
        post('AGENT_STEP_COMPLETE', {
          loopId,
          stepIndex: step,
          responseMessageId: null,
          toolExecutions: [],
        } satisfies InlineAgentStepCompleteMsg);
        totalSteps = step + 1;
        break;
      }
      const toolCalls = streamSnapshot.toolCalls;
      const visibleText = streamSnapshot.visibleText;

      if (extractTaskCompleteSignal(visibleText)) {
        resolvedFinalText = visibleText;
        post('AGENT_STEP_COMPLETE', {
          loopId,
          stepIndex: step,
          responseMessageId: turn.responseMessageId,
          toolExecutions: [],
        } satisfies InlineAgentStepCompleteMsg);
        totalSteps = step + 1;
        break;
      }

      if (toolCalls.length === 0) {
        if (!shouldNudge(payload.originalPrompt, allExecutions, visibleText, nudgeCount)) {
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: turn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        nudgeCount++;
        if (nudgeCount > INLINE_AGENT_MAX_NUDGES) {
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: turn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        const nudgePrompt = buildNudgePrompt(payload.originalPrompt, visibleText, allExecutions, nudgeCount, locale);
        const nudgeInput: SubmitPromptInput = {
          ...input,
          prompt: nudgePrompt,
          parentMessageId: turn.responseMessageId,
        };

        await waitBetweenDeepSeekRequests(signal);
        if (signal.aborted) break;

        const nudgePowHeaders = await createPowHeaders(clientHeaders, { wasmUrl: powWasmUrl });
        nudgeInput.powHeaders = nudgePowHeaders;

        const nudgeStreamState = createInlineAgentStreamState({
          loopId,
          stepIndex: step,
          toolDescriptors,
          parsingInput,
          post,
          fallbackText: visibleText,
        });
        const nudgeTimeout = createStepSignal(signal);
        const nudgeTurn = await submitPromptStreaming(nudgeInput, {
          retainAssistantText: false,
          onTokenSpeed(progress) {
            postAgentTokenSpeed(post, payload, `step:${step}:nudge:${nudgeCount}`, progress);
          },
          onTextChunk(text) {
            nudgeStreamState.onTextChunk(text);
          },
        }, nudgeTimeout.signal);
        nudgeTimeout.clear();
        const nudgeStreamSnapshot = nudgeStreamState.flush();

        if (signal.aborted) break;

        parentMessageId = nudgeTurn.responseMessageId;
        const nudgeToolCalls = nudgeStreamSnapshot.toolCalls;
        const nudgeVisibleText = nudgeStreamSnapshot.visibleText;

        if (extractTaskCompleteSignal(nudgeVisibleText)) {
          resolvedFinalText = nudgeVisibleText;
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: nudgeTurn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        if (nudgeToolCalls.length === 0) {
          if (!visibleText.trim() && !nudgeVisibleText.trim()) {
            throw new Error('DeepSeek returned an empty agent continuation after a delayed retry.');
          }

          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: nudgeTurn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        const nudgeExecs = await executeToolCallsSequentially(nudgeToolCalls, executeTool, { signal });
        allExecutions = [...allExecutions, ...nudgeExecs];
        totalTools += nudgeExecs.length;
        currentPromptOptions = createVisionPromptOptionsFromToolExecutions(
          nudgeExecs,
          textContinuationPromptOptions,
        );

        post('AGENT_STEP_COMPLETE', {
          loopId,
          stepIndex: step,
          responseMessageId: nudgeTurn.responseMessageId,
          toolExecutions: nudgeExecs,
        } satisfies InlineAgentStepCompleteMsg);
        totalSteps = step + 1;
        nudgeCount = 0;

        continue;
      }

      nudgeCount = 0;
      const stepExecs = await executeToolCallsSequentially(toolCalls, executeTool, { signal });
      allExecutions = [...allExecutions, ...stepExecs];
      totalTools += stepExecs.length;
      currentPromptOptions = createVisionPromptOptionsFromToolExecutions(
        stepExecs,
        textContinuationPromptOptions,
      );

      post('AGENT_STEP_COMPLETE', {
        loopId,
        stepIndex: step,
        responseMessageId: turn.responseMessageId,
        toolExecutions: stepExecs,
      } satisfies InlineAgentStepCompleteMsg);
      totalSteps = step + 1;

      if (signal.aborted) break;
    }

    let finalText = '';
    if (resolvedFinalText !== null) {
      // The model already emitted `<task_complete>` with a summary; reuse it
      // instead of issuing a redundant finalization request.
      finalText = resolvedFinalText;
    } else if (!signal.aborted && totalTools > 0 && totalSteps > 0 && parentMessageId != null) {
      try {
        await waitBetweenDeepSeekRequests(signal);
        if (signal.aborted) {
          post('AGENT_LOOP_COMPLETE', {
            loopId,
            totalSteps,
            totalTools,
            finalText,
          } satisfies InlineAgentLoopCompleteMsg);
          return;
        }

        const powHeaders = await createPowHeaders(clientHeaders, { wasmUrl: powWasmUrl });
        const finalizationPrompt = buildFinalizationPrompt(payload.originalPrompt, allExecutions, locale);
        const finalInput: SubmitPromptInput = {
          chatSessionId,
          parentMessageId,
          modelType: currentPromptOptions.modelType,
          prompt: finalizationPrompt,
          refFileIds: currentPromptOptions.refFileIds,
          thinkingEnabled: currentPromptOptions.thinkingEnabled,
          searchEnabled: currentPromptOptions.searchEnabled,
          clientHeaders,
          powHeaders,
        };

        let finalStepStarted = false;
        const finalStreamState = createInlineAgentStreamState({
          loopId,
          stepIndex: totalSteps,
          toolDescriptors,
          parsingInput,
          post,
        });
        const finalTurn = await submitPromptStreaming(finalInput, {
          retainAssistantText: false,
          onTokenSpeed(progress) {
            postAgentTokenSpeed(post, payload, `step:${totalSteps}:final`, progress);
          },
          onTextChunk(text) {
            if (!text.trim()) return;
            if (!finalStepStarted) {
              post('AGENT_STEP_STARTED', { loopId, stepIndex: totalSteps });
              finalStepStarted = true;
            }
            finalStreamState.onTextChunk(text);
          },
        }, signal);
        const finalStreamSnapshot = finalStreamState.flush();

        finalText = finalStreamSnapshot.visibleText;
        if (finalText.trim()) {
          if (!finalStepStarted) {
            post('AGENT_STEP_STARTED', { loopId, stepIndex: totalSteps });
            post('AGENT_STREAM_CHUNK', {
              loopId,
              stepIndex: totalSteps,
              text: '',
              fullText: clampStreamEventText(finalText),
            } satisfies InlineAgentStreamChunkMsg);
          }
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: totalSteps,
            responseMessageId: finalTurn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps++;
        }
      } catch {
        // Finalization is best-effort; loop still completes
      }
    }

    post('AGENT_LOOP_COMPLETE', {
      loopId,
      totalSteps,
      totalTools,
      finalText,
    } satisfies InlineAgentLoopCompleteMsg);
  } catch (err) {
    if (signal.aborted) {
      post('AGENT_LOOP_COMPLETE', {
        loopId,
        totalSteps,
        totalTools,
        finalText: '',
      } satisfies InlineAgentLoopCompleteMsg);
      return;
    }

    post('AGENT_LOOP_ERROR', {
      loopId,
      stepIndex: totalSteps,
      totalTools,
      error: err instanceof Error ? err.message : String(err),
    } satisfies InlineAgentLoopErrorMsg);
  }
}

function postAgentTokenSpeed(
  post: PostFn,
  payload: InlineAgentStartPayload,
  requestKey: string,
  progress: ResponseTokenSpeedPayload,
): void {
  post('AGENT_TOKEN_SPEED', {
    ...progress,
    requestId: `agent:${payload.loopId}:${requestKey}`,
    chatSessionId: payload.chatSessionId,
    modelType: progress.modelType ?? payload.promptOptions.modelType,
  } satisfies ResponseTokenSpeedPayload);
}

function createVisionPromptOptionsFromToolExecutions(
  executions: readonly ToolExecutionRecord[],
  fallback: InlineAgentPromptOptions,
): InlineAgentPromptOptions {
  const values: unknown[] = [];
  for (const execution of executions) {
    const output = readToolExecutionOutputObject(execution);
    const refs = output?.refFileIds;
    if (Array.isArray(refs)) values.push(...refs);
  }
  const refFileIds = normalizeDeepSeekWebVisionRefFileIds(values)
    .slice(0, DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN);
  if (refFileIds.length === 0) return fallback;
  return createDeepSeekWebVisionRoute({
    modelType: fallback.modelType,
    refFileIds,
    thinkingEnabled: fallback.thinkingEnabled,
    searchEnabled: fallback.searchEnabled,
  });
}

function readToolExecutionOutputObject(
  execution: ToolExecutionRecord,
): Record<string, unknown> | null {
  const output = execution.result.output;
  if (!output) return null;
  if (typeof output === 'object' && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  if (typeof output !== 'string') return null;
  try {
    const parsed = JSON.parse(output) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function createInlineAgentStreamState(input: {
  loopId: string;
  stepIndex: number;
  toolDescriptors: readonly ToolDescriptor[];
  parsingInput: ToolParsingInput;
  post: PostFn;
  fallbackText?: string;
}) {
  const visibleText = createStreamingToolTextAccumulator(input.toolDescriptors);
  const toolCallParser = createStreamingToolCallParser(input.toolDescriptors);
  const completedToolCalls: ToolCall[] = [];
  const completedToolCallSignatures = new Set<string>();
  let fallbackText = '';
  let fallbackTextTruncated = false;
  let lastPostedText = clampStreamEventText(input.fallbackText ?? '');

  const postVisibleText = (nextText: string) => {
    const fullText = clampStreamEventText(nextText || input.fallbackText || '');
    if (fullText === lastPostedText) return;
    lastPostedText = fullText;
    input.post('AGENT_STREAM_CHUNK', {
      loopId: input.loopId,
      stepIndex: input.stepIndex,
      text: '',
      fullText,
    } satisfies InlineAgentStreamChunkMsg);
  };

  const addCompletedToolCall = (call: ToolCall) => {
    const signature = createInlineAgentToolCallSignature(call);
    if (completedToolCallSignatures.has(signature)) return;
    completedToolCallSignatures.add(signature);
    completedToolCalls.push(call);
    input.post('AGENT_TOOL_DETECTED', {
      loopId: input.loopId,
      stepIndex: input.stepIndex,
      call,
    } satisfies InlineAgentToolDetectedMsg);
  };

  return {
    onTextChunk(text: string) {
      postVisibleText(visibleText.append(text));
      appendFallbackText(text);

      const event = toolCallParser.append(text);
      event.completed.forEach(addCompletedToolCall);
    },
    flush() {
      const finalVisibleText = visibleText.flush();
      postVisibleText(finalVisibleText);
      toolCallParser.flush();
      addFallbackToolCalls();
      return {
        visibleText: finalVisibleText,
        toolCalls: [...completedToolCalls],
      };
    },
  };

  function appendFallbackText(text: string) {
    if (fallbackTextTruncated) return;
    if (fallbackText.length + text.length > INLINE_AGENT_FALLBACK_PARSE_MAX_CHARS) {
      fallbackTextTruncated = true;
      fallbackText = '';
      return;
    }
    fallbackText += text;
  }

  function addFallbackToolCalls() {
    if (fallbackTextTruncated || !shouldFallbackParseToolCalls(fallbackText, completedToolCalls)) return;
    for (const call of extractToolCalls(fallbackText, input.parsingInput)) {
      addCompletedToolCall(call);
    }
  }
}

function shouldFallbackParseToolCalls(text: string, completedToolCalls: readonly ToolCall[]): boolean {
  if (!text) return false;
  if (text.includes('｜DSML｜')) return true;
  return completedToolCalls.length === 0 && text.includes('<');
}

function createInlineAgentToolCallSignature(call: ToolCall): string {
  if (call.id) return `id:${call.id}`;
  return `${call.provider?.id ?? ''}:${call.name}:${call.invocationName ?? ''}:${JSON.stringify(call.payload)}`;
}

function clampStreamEventText(value: string): string {
  return value.length > INLINE_AGENT_STREAM_EVENT_MAX_CHARS
    ? `${value.slice(0, INLINE_AGENT_STREAM_EVENT_MAX_CHARS)}${TRUNCATION_SUFFIX}`
    : value;
}

function waitBetweenDeepSeekRequests(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const delay = randomInt(INLINE_AGENT_REQUEST_DELAY_MIN_MS, INLINE_AGENT_REQUEST_DELAY_MAX_MS);
  return new Promise((resolve) => {
    const timeout = setTimeout(cleanup, delay);
    const onAbort = () => cleanup();

    function cleanup() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createStepSignal(parentSignal: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INLINE_AGENT_STEP_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  parentSignal.addEventListener('abort', onParentAbort, { once: true });
  const clear = () => {
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', onParentAbort);
  };
  return { signal: controller.signal, clear };
}
