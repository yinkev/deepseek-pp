import { MEMORY_IMPORT_TOOL_NAMES } from '../memory/import-tool';
import { SKILL_CREATOR_TOOL_NAMES } from '../skill/creator-tool';
import type { ToolExecutionRecord } from '../types';
import { redactDurableToolString } from './redaction';
import type { ToolDescriptor } from './types';

const SIDEPANEL_RICH_RESULT_TOOL_NAMES = new Set<string>([
  ...SKILL_CREATOR_TOOL_NAMES,
  ...MEMORY_IMPORT_TOOL_NAMES,
]);
const SIDEPANEL_TOOL_RESULT_DETAIL_LIMIT = 16_000;
const SIDEPANEL_TOOL_RESULT_OUTPUT_LIMIT = 16_000;
const SIDEPANEL_TOOL_RESULT_MAX_DEPTH = 8;
const SIDEPANEL_TOOL_RESULT_MAX_NODES = 1_000;
const SIDEPANEL_TOOL_RESULT_MAX_ARRAY_ITEMS = 100;
const SIDEPANEL_TOOL_RESULT_MAX_OBJECT_KEYS = 100;

export function isSidepanelChatToolDescriptor(descriptor: ToolDescriptor): boolean {
  if (!descriptor.execution.enabled) return false;
  // Sidepanel chat streams markdown only. Tools that require an approval/save card
  // must stay in the content-script experience until sidepanel can render results.
  return !SIDEPANEL_RICH_RESULT_TOOL_NAMES.has(descriptor.name);
}

export function filterSidepanelChatToolDescriptors(
  descriptors: readonly ToolDescriptor[],
): ToolDescriptor[] {
  return descriptors.filter(isSidepanelChatToolDescriptor);
}

export function formatSidepanelToolResultsForContinuation(executions: readonly ToolExecutionRecord[]): string {
  return executions.map((execution) =>
    `<${execution.name}_result>\n${JSON.stringify(sanitizeSidepanelToolResultForContinuation(execution.result))}\n</${execution.name}_result>`
  ).join('\n');
}

export function sanitizeSidepanelToolResultForContinuation(
  result: ToolExecutionRecord['result'],
): ToolExecutionRecord['result'] {
  return {
    ok: result.ok,
    summary: truncateSidepanelToolString(redactDurableToolString(result.summary), 2_000) ?? '',
    detail: truncateSidepanelToolString(redactDurableToolString(result.detail), SIDEPANEL_TOOL_RESULT_DETAIL_LIMIT),
    output: sanitizeSidepanelToolOutputForContinuation(result.output),
    truncated: result.truncated,
    error: result.error
      ? {
        code: result.error.code,
        message: truncateSidepanelToolString(redactDurableToolString(result.error.message), 2_000) ?? '',
        retryable: result.error.retryable,
        details: result.error.details
          ? sanitizeSidepanelRecordForContinuation(result.error.details, 4_000)
          : undefined,
      }
      : undefined,
  };
}

export function truncateSidepanelToolString(value: string | undefined, limit: number): string | undefined {
  if (!value || value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated]`;
}

function sanitizeSidepanelToolOutputForContinuation(
  output: ToolExecutionRecord['result']['output'],
): ToolExecutionRecord['result']['output'] {
  if (output === undefined) return undefined;
  return sanitizeSidepanelValueForContinuation(output, SIDEPANEL_TOOL_RESULT_OUTPUT_LIMIT) as ToolExecutionRecord['result']['output'];
}

function sanitizeSidepanelRecordForContinuation(
  value: Record<string, unknown>,
  limit: number,
): Record<string, unknown> {
  return sanitizeSidepanelValueForContinuation(value, limit) as Record<string, unknown>;
}

function sanitizeSidepanelValueForContinuation(value: unknown, limit: number): unknown {
  const budget: SidepanelSanitizeBudget = {
    remaining: limit,
    nodes: 0,
    truncated: false,
    seen: new WeakSet<object>(),
  };
  const sanitized = sanitizeSidepanelValueWithinBudget(value, budget, 0);
  if (!budget.truncated) return sanitized;
  return {
    truncated: true,
    preview: stringifySidepanelPreview(sanitized, limit),
  };
}

interface SidepanelSanitizeBudget {
  remaining: number;
  nodes: number;
  truncated: boolean;
  seen: WeakSet<object>;
}

function sanitizeSidepanelValueWithinBudget(
  value: unknown,
  budget: SidepanelSanitizeBudget,
  depth: number,
): unknown {
  if (budget.remaining <= 0) {
    budget.truncated = true;
    return '[truncated]';
  }
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return takeSidepanelBudgetedString(redactDurableToolString(value) ?? '', budget);
  if (typeof value === 'number' || typeof value === 'boolean') {
    takeSidepanelBudget(String(value).length, budget);
    return value;
  }
  if (typeof value === 'bigint') {
    return takeSidepanelBudgetedString(value.toString(), budget);
  }
  if (typeof value !== 'object') {
    return takeSidepanelBudgetedString(`[${typeof value}]`, budget);
  }
  if (depth >= SIDEPANEL_TOOL_RESULT_MAX_DEPTH) {
    budget.truncated = true;
    return '[max-depth]';
  }
  if (budget.nodes >= SIDEPANEL_TOOL_RESULT_MAX_NODES) {
    budget.truncated = true;
    return '[max-nodes]';
  }
  if (budget.seen.has(value)) {
    return '[circular]';
  }
  budget.nodes += 1;
  budget.seen.add(value);

  if (Array.isArray(value)) {
    const items: unknown[] = [];
    const itemLimit = Math.min(value.length, SIDEPANEL_TOOL_RESULT_MAX_ARRAY_ITEMS);
    for (let index = 0; index < itemLimit; index += 1) {
      items.push(sanitizeSidepanelValueWithinBudget(value[index], budget, depth + 1));
      if (budget.remaining <= 0) break;
    }
    if (value.length > items.length) {
      budget.truncated = true;
      items.push(`[${value.length - items.length} more]`);
    }
    budget.seen.delete(value);
    return items;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value);
  const entryLimit = Math.min(entries.length, SIDEPANEL_TOOL_RESULT_MAX_OBJECT_KEYS);
  for (let index = 0; index < entryLimit; index += 1) {
    const [key, item] = entries[index];
    const sanitizedKey = sanitizeSidepanelObjectKey(key, budget);
    if (budget.remaining <= 0) break;
    const redacted = sanitizeSidepanelSensitiveKeyValue(key, item, budget);
    output[createUniqueSidepanelObjectKey(output, sanitizedKey)] = redacted === undefined
      ? sanitizeSidepanelValueWithinBudget(item, budget, depth + 1)
      : redacted;
    if (budget.remaining <= 0) break;
  }
  if (entries.length > Object.keys(output).length) {
    budget.truncated = true;
    output.truncatedKeys = entries.length - Object.keys(output).length;
  }
  budget.seen.delete(value);
  return output;
}

function sanitizeSidepanelObjectKey(key: string, budget: SidepanelSanitizeBudget): string {
  const sanitized = redactSidepanelObjectKey(key);
  const clipped = takeSidepanelBudgetedString(sanitized, budget);
  return clipped || '[empty-key]';
}

function redactSidepanelObjectKey(key: string): string {
  const lower = key.toLowerCase();
  if (
    lower.includes('authorization') ||
    lower.includes('cookie') ||
    lower.includes('api-key') ||
    lower.includes('api_key') ||
    lower.includes('apikey') ||
    lower.includes('pow-response') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('signed')
  ) {
    return '[redacted:secret-key]';
  }
  if (
    lower === 'base64data' ||
    lower === 'database64' ||
    lower === 'dataurl' ||
    lower === 'image_url' ||
    lower === 'imageurl' ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('filesystem:')
  ) {
    return '[redacted:media-key]';
  }
  if (lower === 'reffileid' || lower === 'reffileids' || lower === 'webvisionfiles') {
    return '[redacted:vision-ref-key]';
  }
  if (lower === 'url' || lower === 'title' || lower.startsWith('http://') || lower.startsWith('https://')) {
    return '[redacted:page-key]';
  }
  return redactDurableToolString(key) ?? '';
}

function createUniqueSidepanelObjectKey(output: Record<string, unknown>, key: string): string {
  if (!(key in output)) return key;
  let suffix = 2;
  while (`${key}_${suffix}` in output) {
    suffix += 1;
  }
  return `${key}_${suffix}`;
}

function sanitizeSidepanelSensitiveKeyValue(
  key: string,
  value: unknown,
  budget: SidepanelSanitizeBudget,
): unknown | undefined {
  const lower = key.toLowerCase();
  if (
    lower.includes('authorization') ||
    lower.includes('cookie') ||
    lower.includes('api-key') ||
    lower.includes('api_key') ||
    lower.includes('apikey') ||
    lower.includes('pow-response') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('signed')
  ) {
    return value === undefined || value === null || value === ''
      ? value
      : takeSidepanelBudgetedString('[redacted:secret]', budget);
  }
  if (
    lower === 'base64data' ||
    lower === 'database64' ||
    lower === 'dataurl' ||
    lower === 'image_url' ||
    lower === 'imageurl' ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('filesystem:')
  ) {
    return value === undefined || value === null || value === ''
      ? value
      : takeSidepanelBudgetedString('[redacted:media]', budget);
  }
  if (lower === 'reffileid' || lower === 'reffileids' || lower === 'webvisionfiles') {
    return takeSidepanelBudgetedString('[redacted:vision-ref]', budget);
  }
  if (
    (lower === 'url' || lower === 'title' || lower.startsWith('http://') || lower.startsWith('https://')) &&
    typeof value === 'string' &&
    value
  ) {
    return takeSidepanelBudgetedString('[redacted:url]', budget);
  }
  return undefined;
}

function takeSidepanelBudgetedString(value: string, budget: SidepanelSanitizeBudget): string {
  if (value.length <= budget.remaining) {
    budget.remaining -= value.length;
    return value;
  }
  budget.truncated = true;
  const clipped = value.slice(0, Math.max(0, budget.remaining));
  budget.remaining = 0;
  return `${clipped}...[truncated]`;
}

function takeSidepanelBudget(length: number, budget: SidepanelSanitizeBudget): void {
  if (length > budget.remaining) {
    budget.truncated = true;
    budget.remaining = 0;
    return;
  }
  budget.remaining -= length;
}

function stringifySidepanelPreview(value: unknown, limit: number): string {
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch {
    return '[truncated]';
  }
}
