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

export interface ToolContinuationLoopInput<TTurn, TCursor extends string | number> {
  initialTurn: TTurn;
  maxDepth: number;
  getAssistantText: (turn: TTurn) => string;
  getParentCursor: (turn: TTurn) => TCursor | null;
  extractToolCalls: (assistantText: string, turn: TTurn) => ToolCall[];
  executeToolCall: (call: ToolCall, parentCursor: TCursor) => Promise<ToolExecutionRecord>;
  buildContinuationPrompt: (executions: ToolExecutionRecord[]) => string;
  submitContinuation: (prompt: string, parentCursor: TCursor) => Promise<TTurn>;
}

export async function runToolContinuationLoop<TTurn, TCursor extends string | number>(
  input: ToolContinuationLoopInput<TTurn, TCursor>,
): Promise<{ turn: TTurn; executions: ToolExecutionRecord[] }> {
  let turn = input.initialTurn;
  let parentCursor = input.getParentCursor(turn);
  const executions: ToolExecutionRecord[] = [];

  for (let depth = 0; depth < input.maxDepth; depth++) {
    if (parentCursor === null) break;

    const calls = input.extractToolCalls(input.getAssistantText(turn), turn);
    if (calls.length === 0) break;

    const stepExecutions: ToolExecutionRecord[] = [];
    for (const call of calls) {
      const execution = await input.executeToolCall(call, parentCursor);
      stepExecutions.push(execution);
      executions.push(execution);
    }

    // Stop the loop if tools were aborted — do not submit continuation.
    const allAborted = stepExecutions.length > 0 && stepExecutions.every((e) => {
      const summary = (e.result?.summary || '').toLowerCase();
      return e.result?.ok === false && (summary === 'aborted' || summary.includes('abort'));
    });
    if (allAborted) break;

    turn = await input.submitContinuation(
      input.buildContinuationPrompt(stepExecutions),
      parentCursor,
    );
    parentCursor = input.getParentCursor(turn);
  }

  return { turn, executions };
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
