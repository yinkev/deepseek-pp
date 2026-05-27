import type { ToolCall, ToolError } from '../types';
import {
  createToolCallFromInvocation,
  createToolInvocationCatalog,
  createXmlToolCallRegex,
  getToolInvocationLabel,
  type ToolInvocationCatalog,
  type ToolParsingInput,
} from '../tool';

const LEGACY_TOOL_CALLS_BLOCK_REGEX = /<｜DSML｜tool_calls>\s*[\s\S]*?\s*<\/｜DSML｜tool_calls>/g;
const LEGACY_INVOKE_REGEX = /<｜DSML｜invoke name="([^"]+)">\s*([\s\S]*?)\s*<\/｜DSML｜invoke>/g;
const LEGACY_PARAMETER_REGEX = /<｜DSML｜parameter name="([^"]+)" string="(true|false)">([\s\S]*?)<\/｜DSML｜parameter>/g;

export function extractToolCalls(text: string, input?: ToolParsingInput): ToolCall[] {
  const catalog = createToolInvocationCatalog(input?.descriptors);
  return [
    ...extractXmlToolCalls(text, catalog),
    ...extractLegacyToolCalls(text, catalog),
  ];
}

function extractXmlToolCalls(text: string, catalog: ToolInvocationCatalog): ToolCall[] {
  const calls: ToolCall[] = [];
  const regex = createXmlToolCallRegex(catalog);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const invocationName = match[1];
    const body = match[2].trim();
    const raw = match[0];
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(body);
      if (!isToolPayload(parsed)) {
        calls.push(createToolCallFromInvocation(invocationName, {}, raw, catalog, {
          parseError: createToolParseError(
            'tool_call_payload_invalid',
            invocationName,
            'Tool call body must be a JSON object.',
          ),
        }));
        continue;
      }
      payload = parsed;
    } catch (err) {
      calls.push(createToolCallFromInvocation(invocationName, {}, raw, catalog, {
        parseError: createToolParseError(
          'tool_call_json_invalid',
          invocationName,
          [
            'Tool call body is not valid JSON.',
            'Use double quotes for strings and escape backslashes in local file paths, for example "D:\\\\project\\\\file.txt" or "D:/project/file.txt".',
            err instanceof Error ? err.message : String(err),
          ].join(' '),
        ),
      }));
      continue;
    }
    calls.push(createToolCallFromInvocation(invocationName, payload, raw, catalog));
  }

  return calls;
}

function extractLegacyToolCalls(text: string, catalog: ToolInvocationCatalog): ToolCall[] {
  const calls: ToolCall[] = [];
  const blockRegex = new RegExp(LEGACY_TOOL_CALLS_BLOCK_REGEX.source, 'g');
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const blockContent = blockMatch[0];
    const invokeRegex = new RegExp(LEGACY_INVOKE_REGEX.source, 'g');
    let invokeMatch: RegExpExecArray | null;

    while ((invokeMatch = invokeRegex.exec(blockContent)) !== null) {
      const invocationName = invokeMatch[1];
      const invokeContent = invokeMatch[2];
      const payload: Record<string, unknown> = {};
      const paramRegex = new RegExp(LEGACY_PARAMETER_REGEX.source, 'g');
      let paramMatch: RegExpExecArray | null;

      while ((paramMatch = paramRegex.exec(invokeContent)) !== null) {
        const paramName = paramMatch[1];
        const isString = paramMatch[2] === 'true';
        const value = paramMatch[3];
        if (isString) {
          payload[paramName] = value;
          continue;
        }
        try {
          payload[paramName] = JSON.parse(value);
        } catch {
          payload[paramName] = value;
        }
      }

      calls.push(createToolCallFromInvocation(invocationName, payload, invokeMatch[0], catalog));
    }
  }

  return calls;
}

export function stripToolCalls(text: string, input?: ToolParsingInput): string {
  const catalog = createToolInvocationCatalog(input?.descriptors);
  const regex = createXmlToolCallRegex(catalog);
  const legacyRegex = new RegExp(LEGACY_TOOL_CALLS_BLOCK_REGEX.source, 'g');
  return text.replace(regex, '').replace(legacyRegex, '').trim();
}

export function replaceToolCallsWithSummary(text: string, input?: ToolParsingInput): string {
  const catalog = createToolInvocationCatalog(input?.descriptors);
  const regex = createXmlToolCallRegex(catalog);
  const legacyRegex = new RegExp(LEGACY_TOOL_CALLS_BLOCK_REGEX.source, 'g');
  return text
    .replace(regex, (match) => replaceMatchWithSummary(match, catalog))
    .replace(legacyRegex, (match) => replaceMatchWithSummary(match, catalog));
}

function replaceMatchWithSummary(match: string, catalog: ToolInvocationCatalog): string {
  const calls = extractToolCalls(match, { descriptors: catalog.descriptors });
  if (calls.length === 0) return '';
  const lines = calls.map(call => {
    const name = call.name;
    if (call.parseError) return `• ${getToolInvocationLabel(name, catalog)}：格式错误`;
    const detail = (call.payload as any).name || (call.payload as any).content || (call.payload as any).id || '';
    return `• ${getToolInvocationLabel(name, catalog)}${detail ? '：' + detail : ''}`;
  });
  const executedCount = calls.filter(call => !call.parseError).length;
  const header = executedCount === calls.length
    ? `🔧 已执行工具（${calls.length}次）`
    : `🔧 已执行工具（${executedCount}次，${calls.length - executedCount}次格式错误）`;
  return '\n\n---\n' + header + '\n' + lines.join('\n') + '\n---';
}

function isToolPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function createToolParseError(code: string, invocationName: string, message: string): ToolError {
  return {
    code,
    message,
    retryable: false,
    details: { invocationName },
  };
}
