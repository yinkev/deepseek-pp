import type { ToolCall, ToolExecutionRecord, ToolResult } from '../types';

export type ToolLoopExecuteTool = (call: ToolCall) => Promise<ToolExecutionRecord>;

export interface ExecuteToolCallsOptions {
  signal?: AbortSignal;
}

export async function executeToolCallsSequentially(
  calls: readonly ToolCall[],
  executeTool: ToolLoopExecuteTool,
  options?: ExecuteToolCallsOptions,
): Promise<ToolExecutionRecord[]> {
  const results: ToolExecutionRecord[] = [];
  for (const call of calls) {
    if (options?.signal?.aborted) break;
    results.push(await executeTool(call));
  }
  return results;
}

export interface ToolContinuationLoopInput<TTurn> {
  initialTurn: TTurn;
  maxDepth: number;
  getAssistantText: (turn: TTurn) => string;
  getParentMessageId: (turn: TTurn) => number | null;
  extractToolCalls: (assistantText: string) => ToolCall[];
  executeToolCall: (call: ToolCall, parentMessageId: number) => Promise<ToolExecutionRecord>;
  buildContinuationPrompt: (executions: ToolExecutionRecord[]) => string;
  submitContinuation: (
    prompt: string,
    parentMessageId: number,
    executions: ToolExecutionRecord[],
  ) => Promise<TTurn>;
  signal?: AbortSignal;
}

export type ToolContinuationStopReason =
  | 'aborted'
  | 'continuation_limit_exhausted'
  | 'pending_tool_calls_without_parent'
  | 'no_parent_message'
  | 'no_tool_calls';

export interface ToolContinuationLoopResult<TTurn> {
  turn: TTurn;
  executions: ToolExecutionRecord[];
  stopReason: ToolContinuationStopReason;
  depth: number;
  pendingToolCallCount: number;
}

export async function runToolContinuationLoop<TTurn>(
  input: ToolContinuationLoopInput<TTurn>,
): Promise<ToolContinuationLoopResult<TTurn>> {
  let turn = input.initialTurn;
  let parentMessageId = input.getParentMessageId(turn);
  const executions: ToolExecutionRecord[] = [];
  let depth = 0;

  for (; depth < input.maxDepth; depth += 1) {
    if (input.signal?.aborted) {
      return { turn, executions, stopReason: 'aborted', depth, pendingToolCallCount: 0 };
    }
    if (parentMessageId === null) {
      const pendingToolCallCount = input.extractToolCalls(input.getAssistantText(turn)).length;
      return {
        turn,
        executions,
        stopReason: pendingToolCallCount > 0 ? 'pending_tool_calls_without_parent' : 'no_parent_message',
        depth,
        pendingToolCallCount,
      };
    }

    const calls = input.extractToolCalls(input.getAssistantText(turn));
    if (calls.length === 0) {
      return { turn, executions, stopReason: 'no_tool_calls', depth, pendingToolCallCount: 0 };
    }

    const stepExecutions: ToolExecutionRecord[] = [];
    for (const call of calls) {
      if (input.signal?.aborted) break;
      const execution = await input.executeToolCall(call, parentMessageId);
      stepExecutions.push(execution);
      executions.push(execution);
    }
    if (input.signal?.aborted || stepExecutions.length === 0) {
      return { turn, executions, stopReason: 'aborted', depth, pendingToolCallCount: 0 };
    }

    turn = await input.submitContinuation(
      input.buildContinuationPrompt(stepExecutions),
      parentMessageId,
      stepExecutions,
    );
    parentMessageId = input.getParentMessageId(turn);
  }

  if (input.signal?.aborted) {
    return { turn, executions, stopReason: 'aborted', depth, pendingToolCallCount: 0 };
  }
  const pendingToolCallCount = input.extractToolCalls(input.getAssistantText(turn)).length;
  if (pendingToolCallCount === 0 && parentMessageId === null) {
    return { turn, executions, stopReason: 'no_parent_message', depth, pendingToolCallCount: 0 };
  }
  return {
    turn,
    executions,
    stopReason: pendingToolCallCount > 0 ? 'continuation_limit_exhausted' : 'no_tool_calls',
    depth,
    pendingToolCallCount,
  };
}

export function createToolExecutionRecord(
  call: ToolCall,
  result: ToolResult,
  limits: { detailMaxLength: number; outputMaxLength: number },
): ToolExecutionRecord {
  return {
    name: call.name,
    provider: call.provider,
    descriptorId: call.descriptorId,
    result: {
      ok: result.ok,
      summary: result.summary,
      detail: clampText(result.detail, limits.detailMaxLength),
      output: result.output === undefined
        ? undefined
        : clampText(JSON.stringify(result.output), limits.outputMaxLength),
      truncated: result.truncated,
      error: result.error,
    },
  };
}

export function clampText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}
