import type { ToolExecutionRecord } from '../types';

export { INCOMPLETE_TOOL_CALL_ERROR_CODE } from '../tool/execution-error';

/**
 * An incomplete streamed call is a recovery-only execution record. It must be
 * included so the inline agent can see the failure and re-emit a closed call;
 * executeToolCall exits on call.parseError before any provider is reached.
 */
export function selectContinuableToolExecutions(
  executions: readonly ToolExecutionRecord[],
): ToolExecutionRecord[] {
  return executions.filter((execution) =>
    !execution.pending &&
    (
      execution.provider?.kind === 'mcp' ||
      execution.provider?.id === 'web' ||
      execution.provider?.id === 'browser_control' ||
      execution.name === 'web_search' ||
      execution.name === 'web_fetch' ||
      execution.name.startsWith('browser_')
    ));
}
