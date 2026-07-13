import { extractToolCalls, stripToolCalls } from '../interceptor/tool-parser';
import { createStreamingToolTextAccumulator } from '../interceptor/streaming-tool-text';
import {
  clampText,
  createToolExecutionRecord,
  runToolContinuationLoop,
} from '../tool-loop/engine';
import type {
  ToolCall,
  ToolDescriptor,
  ToolExecutionRecord,
  ToolResult,
} from '../types';
import type {
  ChatModelRef,
  ChatProviderAdapter,
  ProviderAttachment,
  ProviderSession,
  ProviderTurn,
} from './provider';

export interface RunProviderToolLoopInput {
  adapter: ChatProviderAdapter;
  model: ChatModelRef;
  session: ProviderSession;
  prompt: string;
  originalTask: string;
  thinkingEnabled: boolean;
  attachments?: ProviderAttachment[];
  toolDescriptors: readonly ToolDescriptor[];
  executeTool: (call: ToolCall) => Promise<ToolResult>;
  onVisibleText?: (text: string) => void;
  onThinkingText?: (text: string, fullText: string) => void;
  maxDepth?: number;
  signal?: AbortSignal;
}

export interface ProviderToolLoopResult {
  turn: ProviderTurn;
  session: ProviderSession;
  executions: ToolExecutionRecord[];
  finalVisibleText: string;
}

export async function runProviderToolLoop(
  input: RunProviderToolLoopInput,
): Promise<ProviderToolLoopResult> {
  const streamTurn = (
    prompt: string,
    session: ProviderSession,
    attachments?: ProviderAttachment[],
  ) => streamVisibleProviderTurn({
    ...input,
    prompt,
    session,
    attachments,
  });
  const initialTurn = await streamTurn(input.prompt, input.session, input.attachments);
  const loop = await runToolContinuationLoop({
    initialTurn,
    maxDepth: input.maxDepth ?? 20,
    getAssistantText: (turn) => turn.assistantText,
    getParentCursor: (turn) => turn.session.parentCursor,
    extractToolCalls: (text) => extractToolCalls(text, { descriptors: input.toolDescriptors }),
    async executeToolCall(call) {
      if (input.signal?.aborted) {
        return createToolExecutionRecord(call, {
          ok: false,
          summary: 'Aborted',
          detail: 'Request aborted before tool execution.',
          name: call.name,
          provider: call.provider,
          descriptorId: call.descriptorId,
        }, { detailMaxLength: 4000, outputMaxLength: 8000 });
      }
      return createToolExecutionRecord(
        call,
        await input.executeTool(call),
        { detailMaxLength: 4000, outputMaxLength: 8000 },
      );
    },
    buildContinuationPrompt: (executions) => buildProviderContinuationPrompt(
      executions,
      input.originalTask,
    ),
    submitContinuation: (prompt, parentCursor) => streamTurn(prompt, {
      conversationId: initialTurn.session.conversationId,
      parentCursor,
    }),
  });

  return {
    turn: loop.turn,
    session: loop.turn.session,
    executions: loop.executions,
    finalVisibleText: stripToolCalls(loop.turn.assistantText, {
      descriptors: input.toolDescriptors,
    }).trim(),
  };
}

export function buildProviderContinuationPrompt(
  executions: readonly ToolExecutionRecord[],
  originalTask: string,
): string {
  const results = executions.map((execution) => ({
    tool: execution.name,
    ok: execution.result.ok,
    summary: execution.result.summary,
    detail: clampText(execution.result.detail, 4000),
    output: clampText(
      execution.result.output === undefined ? undefined : String(execution.result.output),
      8000,
    ),
    truncated: execution.result.truncated === true,
  }));
  return [
    '[TOOL_RESULTS]',
    JSON.stringify(results, null, 2),
    '[/TOOL_RESULTS]',
    '',
    `Original task: ${clampText(originalTask, 8000) ?? ''}`,
    'Continue from the real tool results. Answer naturally without exposing tool XML unless another tool is required.',
  ].join('\n');
}

async function streamVisibleProviderTurn(
  input: RunProviderToolLoopInput,
): Promise<ProviderTurn> {
  const accumulator = createStreamingToolTextAccumulator(input.toolDescriptors);
  let visibleLength = 0;
  const emitGrowth = (visible: string) => {
    if (visible.length <= visibleLength) return;
    const delta = visible.slice(visibleLength);
    visibleLength = visible.length;
    if (delta) input.onVisibleText?.(delta);
  };
  const turn = await input.adapter.streamTurn({
    model: input.model,
    session: input.session,
    prompt: input.prompt,
    thinkingEnabled: input.thinkingEnabled,
    attachments: input.attachments,
    signal: input.signal,
  }, {
    onTextDelta(text) {
      emitGrowth(accumulator.append(text));
    },
    onThinkingDelta(text, fullText) {
      input.onThinkingText?.(text, fullText);
    },
  });
  emitGrowth(accumulator.flush());
  return turn;
}
