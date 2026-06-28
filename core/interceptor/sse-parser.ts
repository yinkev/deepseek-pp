import type { SSEEvent } from '../types';

const STRUCTURED_RESPONSE_CHILD_KEYS = ['parts', 'fragments', 'segments', 'children', 'contents'] as const;
const STRUCTURED_RESPONSE_TEXT_KEYS = ['content', 'text', 'markdown', 'value', 'message', 'body'] as const;

export interface ResponseStreamUsageStats {
  modelType?: string | null;
  insertedAt?: number | null;
  updatedAt?: number | null;
  accumulatedTokenUsage?: number | null;
}

export function parseSSEChunk(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const blocks = chunk.split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;

    const event: Partial<SSEEvent> = {};
    const lines = block.split('\n');

    for (const line of lines) {
      if (line.startsWith('id:')) {
        event.id = line.slice(3).trim();
      } else if (line.startsWith('event:')) {
        event.type = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        event.data = event.data != null ? event.data + '\n' + line.slice(5).trim() : line.slice(5).trim();
      }
    }

    if (event.data !== undefined) {
      events.push({
        type: event.type ?? 'message',
        data: event.data,
        id: event.id,
      });
    }
  }

  return events;
}

export function parseSSEData(data: string): unknown | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function extractResponseUsageStatsFromParsed(
  parsed: unknown,
  eventType?: string,
): ResponseStreamUsageStats | null {
  const stats = collectResponseUsageStats(parsed, eventType);
  return hasResponseUsageStats(stats) ? stats : null;
}

export function isResponseTextPatchPath(path: unknown): path is string {
  return isTextPatchPath(path) && isResponsePatchPath(path);
}

function isTextPatchPath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  const lastSegment = path.split('/').pop();
  return (
    lastSegment === 'content' ||
    lastSegment === 'text' ||
    lastSegment === 'markdown' ||
    lastSegment === 'delta'
  );
}

function isResponsePatchPath(path: unknown): path is string {
  return typeof path === 'string' && (path === 'response' || path.startsWith('response/'));
}

export function isThinkingPatchPath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  const lastSegment = path.split('/').pop();
  return lastSegment === 'reasoning_content' || lastSegment === 'thinking_content';
}

export function extractTextFromParsed(parsed: any): string | null {
  if (parsed?.o === 'BATCH' && Array.isArray(parsed.v)) {
    const text = parsed.v
      .map((item: unknown) => extractTextFromParsed(item))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }
  // Format 1: {"v":"text"} — shorthand text append (no path)
  if (!parsed.p && typeof parsed.v === 'string') {
    return parsed.v;
  }
  // Format 2: {"p":"...", "o":"APPEND", "v":"text"} — explicit append
  if (parsed.p && parsed.o === 'APPEND' && typeof parsed.v === 'string') {
    return parsed.v;
  }
  // Format 3: {"p":"response/fragments/-1/content", "v":"text"} — text/content patch (no "o" field)
  if (isTextPatchPath(parsed.p) && typeof parsed.v === 'string' && !parsed.o) {
    return parsed.v;
  }
  // Format 4: {"p":"response/fragments", "o":"APPEND", "v":[{content:"text",...}]} — new fragment with initial content
  if (isFragmentsAppendPatch(parsed)) {
    const text = parsed.v
      .map((frag: unknown) => extractFragmentText(frag))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }
  return null;
}

export function extractResponseTextFromParsed(parsed: any): string | null {
  if (parsed?.o === 'BATCH' && Array.isArray(parsed.v)) {
    const text = parsed.v
      .map((item: unknown) => extractResponseTextFromParsed(item))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }
  const responseObjectText = extractResponseObjectText(parsed);
  if (responseObjectText) return responseObjectText;
  if (!parsed.p && typeof parsed.v === 'string') {
    return parsed.v;
  }
  if (isResponseTextPatchPath(parsed.p) && parsed.o === 'APPEND' && typeof parsed.v === 'string') {
    return parsed.v;
  }
  if (isResponseTextPatchPath(parsed.p) && typeof parsed.v === 'string' && !parsed.o) {
    return parsed.v;
  }
  if (isResponseFragmentsAppendPatch(parsed)) {
    const text = parsed.v
      .map((frag: unknown) => extractFragmentText(frag))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }
  return null;
}

export function extractResponseTextForTokenSpeed(parsed: unknown): string | null {
  const value = parsed as { o?: unknown; p?: unknown; v?: unknown } | null;
  if (value && typeof value === 'object' && value.o === 'BATCH' && Array.isArray(value.v)) {
    const text = value.v
      .map((item) => extractResponseTextForTokenSpeed(item))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }

  const responseText = extractResponseTextFromParsed(parsed as any);
  if (responseText) return responseText;

  if (!value || typeof value !== 'object') return null;

  if (Array.isArray(value.v)) {
    const text = value.v
      .map((item) => extractResponseTextForTokenSpeed(item))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }

  if (isThinkingPatchPath(value.p) && typeof value.v === 'string') {
    return value.v;
  }

  return null;
}

function isFragmentsAppendPatch(parsed: any): boolean {
  return typeof parsed?.p === 'string' &&
    parsed.p.endsWith('/fragments') &&
    parsed.o === 'APPEND' &&
    Array.isArray(parsed.v);
}

function isResponseFragmentsAppendPatch(parsed: any): boolean {
  return parsed?.p === 'response/fragments' && parsed.o === 'APPEND' && Array.isArray(parsed.v);
}

function extractFragmentText(fragment: unknown): string | null {
  if (!fragment || typeof fragment !== 'object') return null;
  const value = fragment as Record<string, unknown>;
  if (typeof value.content === 'string') return value.content;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.markdown === 'string') return value.markdown;
  return null;
}

function extractResponseObjectText(parsed: any): string | null {
  const response = getResponseObject(parsed);
  if (!response) return null;

  const direct = firstString(
    response.content,
    response.text,
    response.markdown,
    response.answer,
  );
  if (direct) return direct;

  if (Array.isArray(response.fragments)) {
    const text = response.fragments
      .map((fragment: unknown) => extractFragmentText(fragment))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    if (text.length > 0) return text;
  }

  const structured = [
    response.message_content,
    response.messageContent,
  ]
    .map((part) => extractStructuredResponseText(part))
    .filter((part: string | null): part is string => part !== null)
    .join('');
  if (structured.length > 0) return structured;

  return null;
}

function extractStructuredResponseText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const text = value
      .map((item) => extractStructuredResponseText(item))
      .filter((part: string | null): part is string => part !== null)
      .join('');
    return text.length > 0 ? text : null;
  }
  if (!isRecord(value)) return null;

  const direct = firstString(...STRUCTURED_RESPONSE_TEXT_KEYS.map((key) => value[key]));
  if (direct) return direct;

  for (const key of STRUCTURED_RESPONSE_CHILD_KEYS) {
    const text = extractStructuredResponseText(value[key]);
    if (text) return text;
  }
  return null;
}

function getResponseObject(parsed: any): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== 'object') return null;

  if (isRecord(parsed.response)) return parsed.response;

  if (parsed.p === 'response' && isRecord(parsed.v)) return parsed.v;

  if (!parsed.p && isRecord(parsed.v)) {
    const value = parsed.v as Record<string, unknown>;
    if (isRecord(value.response)) return value.response;
  }

  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isStreamFinishedFromParsed(parsed: any): boolean {
  if (parsed.p === 'response/status' && parsed.v === 'FINISHED') return true;
  if (parsed.o === 'BATCH' && Array.isArray(parsed.v)) {
    return parsed.v.some(
      (item: { p: string; v: string }) => item.p === 'quasi_status' && item.v === 'FINISHED',
    );
  }
  return false;
}

function collectResponseUsageStats(
  parsed: unknown,
  eventType?: string,
): ResponseStreamUsageStats {
  if (!parsed || typeof parsed !== 'object') return {};

  const value = parsed as Record<string, unknown>;
  let stats: ResponseStreamUsageStats = {};

  if (eventType === 'ready' && typeof value.model_type === 'string') {
    stats.modelType = value.model_type;
  }

  if (eventType === 'update_session') {
    stats = mergeResponseUsageStats(stats, {
      updatedAt: readFiniteNumber(value.updated_at),
    });
  }

  if (value.o === 'BATCH' && Array.isArray(value.v)) {
    for (const item of value.v) {
      stats = mergeResponseUsageStats(stats, collectResponseUsageStats(item, eventType));
    }
  }

  if (typeof value.p === 'string') {
    stats = mergeResponseUsageStats(stats, collectPatchUsageStats(value));
  }

  if (value.response && typeof value.response === 'object') {
    stats = mergeResponseUsageStats(stats, collectResponseObjectUsageStats(value.response));
  }

  if (value.v && typeof value.v === 'object' && !Array.isArray(value.v)) {
    stats = mergeResponseUsageStats(stats, collectResponseUsageStats(value.v, eventType));
  }

  return stats;
}

function collectPatchUsageStats(value: Record<string, unknown>): ResponseStreamUsageStats {
  const path = value.p;
  if (typeof path !== 'string') return {};

  if (path === 'response/accumulated_token_usage' || path === 'accumulated_token_usage') {
    return { accumulatedTokenUsage: readNonNegativeNumber(value.v) };
  }
  if (path === 'response/inserted_at' || path === 'inserted_at') {
    return { insertedAt: readFiniteNumber(value.v) };
  }
  if (path === 'response/updated_at' || path === 'updated_at') {
    return { updatedAt: readFiniteNumber(value.v) };
  }
  if ((path === 'response/model_type' || path === 'model_type') && typeof value.v === 'string') {
    return { modelType: value.v };
  }
  if (path === 'response' && value.v && typeof value.v === 'object' && !Array.isArray(value.v)) {
    return collectResponseObjectUsageStats(value.v);
  }
  return {};
}

function collectResponseObjectUsageStats(value: unknown): ResponseStreamUsageStats {
  if (!value || typeof value !== 'object') return {};
  const response = value as Record<string, unknown>;
  const stats: ResponseStreamUsageStats = {};
  const insertedAt = readFiniteNumber(response.inserted_at);
  const accumulatedTokenUsage = readNonNegativeNumber(response.accumulated_token_usage);
  if (insertedAt !== null) stats.insertedAt = insertedAt;
  if (accumulatedTokenUsage !== null) stats.accumulatedTokenUsage = accumulatedTokenUsage;
  if (typeof response.model_type === 'string') {
    stats.modelType = response.model_type;
  }
  return stats;
}

function mergeResponseUsageStats(
  left: ResponseStreamUsageStats,
  right: ResponseStreamUsageStats,
): ResponseStreamUsageStats {
  const merged = { ...left };
  if ('modelType' in right && right.modelType !== null && right.modelType !== undefined) merged.modelType = right.modelType;
  if ('insertedAt' in right && right.insertedAt !== null && right.insertedAt !== undefined) merged.insertedAt = right.insertedAt;
  if ('updatedAt' in right && right.updatedAt !== null && right.updatedAt !== undefined) merged.updatedAt = right.updatedAt;
  if (
    'accumulatedTokenUsage' in right &&
    right.accumulatedTokenUsage !== null &&
    right.accumulatedTokenUsage !== undefined
  ) {
    merged.accumulatedTokenUsage = right.accumulatedTokenUsage;
  }
  return merged;
}

function hasResponseUsageStats(stats: ResponseStreamUsageStats): boolean {
  return stats.modelType !== undefined ||
    stats.insertedAt !== undefined ||
    stats.updatedAt !== undefined ||
    stats.accumulatedTokenUsage !== undefined;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNonNegativeNumber(value: unknown): number | null {
  const number = readFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}
