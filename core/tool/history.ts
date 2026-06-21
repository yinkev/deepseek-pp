import type { ToolCall, ToolCallHistoryRecord, ToolExecutionTrigger, ToolResult } from './types';
import { redactDurableToolString, redactDurableToolValue } from './redaction';

const STORAGE_KEY = 'deepseek_pp_tool_history';
const MAX_HISTORY = 200;

export async function appendToolCallHistory(
  call: ToolCall,
  result: ToolResult,
  source: ToolExecutionTrigger,
): Promise<ToolCallHistoryRecord> {
  const record: ToolCallHistoryRecord = {
    id: crypto.randomUUID(),
    call: sanitizeCall(call),
    result: sanitizeResult(result),
    source,
    createdAt: Date.now(),
  };
  const history = await getToolCallHistory();
  await chrome.storage.local.set({
    [STORAGE_KEY]: [record, ...history].slice(0, MAX_HISTORY),
  });
  return record;
}

export async function getToolCallHistory(limit: number = MAX_HISTORY): Promise<ToolCallHistoryRecord[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  const raw = data[STORAGE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is ToolCallHistoryRecord => Boolean(item && typeof item === 'object'))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function clearToolCallHistory(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

function sanitizeCall(call: ToolCall): ToolCall {
  const raw = redactDurableToolString(call.raw) ?? '';
  return {
    ...call,
    payload: truncateRecord(redactDurableToolValue(call.payload) as Record<string, unknown>, 8_000),
    raw: raw.length > 8_000 ? `${raw.slice(0, 8_000)}\n...[truncated]` : raw,
  };
}

function sanitizeResult(result: ToolResult): ToolResult {
  const output = result.output === undefined
    ? undefined
    : truncateString(JSON.stringify(redactDurableToolValue(result.output)), 16_000);
  return {
    ...result,
    detail: truncateString(redactDurableToolString(result.detail), 8_000),
    output,
    error: result.error
      ? {
        ...result.error,
        message: truncateString(redactDurableToolString(result.error.message), 4_000) ?? '',
        details: result.error.details
          ? truncateRecord(redactDurableToolValue(result.error.details) as Record<string, unknown>, 4_000)
          : undefined,
      }
      : undefined,
  };
}

function truncateRecord(value: Record<string, unknown>, maxLength: number): Record<string, unknown> {
  const json = JSON.stringify(value);
  if (json.length <= maxLength) return value;
  return { truncated: true, preview: json.slice(0, maxLength) };
}

function truncateString(value: string | undefined, maxLength: number): string | undefined {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n...[truncated]`;
}
