import {
  createToolCallFromInvocation,
  createToolInvocationCatalog,
  getPreferredToolInvocationName,
} from '../tool';
import type { JsonValue, ToolCall, ToolDescriptor } from '../tool/types';

export type ProviderToolProtocol = 'direct-xml' | 'json-envelope';

export interface ParsedJsonToolEnvelope {
  kind: 'final' | 'tool_calls';
  content: string;
  calls: ToolCall[];
}

export function renderJsonToolEnvelopePrompt(
  taskPrompt: string,
  descriptors: readonly ToolDescriptor[],
): string {
  const instruction = [
    '<<DEEPSEEK_PP_TOOL_MODE>>',
    'DeepSeek++ provides the local tools listed below. Return ONLY one raw JSON object, with no text before or after it.',
    'Use exactly one shape:',
    '{"kind":"final","content":"your natural final answer"}',
    '{"kind":"tool_calls","tool_calls":[{"id":"call_1","name":"TOOL_NAME","arguments":{}}]}',
    'All listed tools exist and are callable by DeepSeek++. Never say a listed tool does not exist.',
    'Do not use XML, Markdown fences, or any other wrapper. Multiple tool calls are allowed when needed.',
    'When durable identity, preferences, corrections, or decisions should be remembered, call memory_save if it is listed.',
    '<<END_DEEPSEEK_PP_TOOL_MODE>>',
  ].join('\n');
  return [
    instruction,
    `Available DeepSeek++ tools:\n${renderCompactToolList(descriptors)}`,
    `Task and context:\n${taskPrompt}`,
    instruction,
  ].join('\n\n');
}

export function renderJsonToolEnvelopeRepairPrompt(
  taskPrompt: string,
  descriptors: readonly ToolDescriptor[],
  previousOutput: string,
): string {
  return [
    renderJsonToolEnvelopePrompt(taskPrompt, descriptors),
    '<<DEEPSEEK_PP_TOOL_REPAIR>>',
    'Your previous response did not follow the required raw JSON final/tool_calls shape.',
    'Return ONLY the corrected raw JSON object now. The listed DeepSeek++ tools are available.',
    `Previous invalid response:\n${clamp(previousOutput.trim() || '[empty]', 1200)}`,
    '<<END_DEEPSEEK_PP_TOOL_REPAIR>>',
  ].join('\n\n');
}

export function parseJsonToolEnvelope(
  rawOutput: string,
  descriptors: readonly ToolDescriptor[],
): ParsedJsonToolEnvelope {
  const text = extractJsonObject(rawOutput);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Qwen tool protocol returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(payload)) {
    throw new Error('Qwen tool protocol response must be a JSON object.');
  }

  if (payload.kind === 'final') {
    if (typeof payload.content !== 'string') {
      throw new Error('Qwen final tool protocol response must include string content.');
    }
    return { kind: 'final', content: payload.content, calls: [] };
  }
  if (payload.kind !== 'tool_calls' || !Array.isArray(payload.tool_calls) || payload.tool_calls.length === 0) {
    throw new Error('Qwen tool protocol response must use kind final or non-empty tool_calls.');
  }

  const catalog = createToolInvocationCatalog(descriptors);
  const calls = payload.tool_calls.map((value, index) => {
    if (!isRecord(value) || typeof value.name !== 'string') {
      throw new Error(`Qwen tool call ${index + 1} must include a tool name.`);
    }
    const descriptor = catalog.descriptorByInvocationName.get(value.name)
      ?? catalog.descriptorByName.get(value.name);
    if (!descriptor) throw new Error(`Qwen requested unknown DeepSeek++ tool: ${value.name}`);
    const argumentsValue = parseArguments(value.arguments, index);
    return createToolCallFromInvocation(
      value.name,
      argumentsValue,
      JSON.stringify(value),
      catalog,
      { id: typeof value.id === 'string' && value.id.trim() ? value.id : `call_${index + 1}` },
    );
  });
  return { kind: 'tool_calls', content: '', calls };
}

function renderCompactToolList(descriptors: readonly ToolDescriptor[]): string {
  const catalog = createToolInvocationCatalog(descriptors);
  return descriptors.map((descriptor) => {
    const required = new Set(descriptor.inputSchema.required ?? []);
    const parameters = Object.entries(descriptor.inputSchema.properties ?? {}).map(([name, schema]) => (
      `${name}${required.has(name) ? '*' : ''}:${renderSchemaType(schema)}`
    ));
    return `- ${getPreferredToolInvocationName(descriptor, catalog)}(${parameters.join(', ')}) — ${descriptor.description}`;
  }).join('\n');
}

function renderSchemaType(schema: JsonValue): string {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'any';
  const record = schema as Record<string, JsonValue>;
  const type = typeof record.type === 'string' ? record.type : 'any';
  const values = Array.isArray(record.enum)
    ? record.enum.filter((value): value is string | number | boolean => (
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ))
    : [];
  return values.length > 0 ? `${type}[${values.join('|')}]` : type;
}

function parseArguments(value: unknown, index: number): Record<string, unknown> {
  let resolved = value;
  if (typeof resolved === 'string') {
    try {
      resolved = JSON.parse(resolved);
    } catch (error) {
      throw new Error(`Qwen tool call ${index + 1} arguments are invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!isRecord(resolved)) throw new Error(`Qwen tool call ${index + 1} arguments must be a JSON object.`);
  return resolved;
}

function extractJsonObject(rawOutput: string): string {
  const trimmed = rawOutput.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] ?? trimmed).trim();
  if (text.startsWith('{') && text.endsWith('}')) return text;

  const start = text.indexOf('{');
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clamp(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated]` : value;
}
