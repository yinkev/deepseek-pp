import type { SSEEvent } from '../types';

export interface ResponseStreamUsageStats {
  modelType?: string | null;
  insertedAt?: number | null;
  updatedAt?: number | null;
  accumulatedTokenUsage?: number | null;
}

export function normalizeSseNewlines(chunk: string): string {
  return chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function parseSSEChunk(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const normalized = normalizeSseNewlines(chunk);
  const blocks = normalized.split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;

    const event: Partial<SSEEvent> = {};
    const dataLines: string[] = [];
    const lines = block.split('\n');

    for (const line of lines) {
      if (line.startsWith('id:')) {
        event.id = line.slice(3).trim();
      } else if (line.startsWith('event:')) {
        event.type = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) continue;

    // DeepSeek emits one JSON object per data line / event.
    // If framing is wrong (CRLF, partial splits), multiple JSON data lines can
    // land in one block. Concatenating them yields invalid JSON and drops tokens.
    // Prefer one SSEEvent per JSON data line when each line is its own object.
    const jsonLike = dataLines.every((line) => line.startsWith('{') || line.startsWith('['));
    if (jsonLike && dataLines.length > 1) {
      for (const data of dataLines) {
        events.push({
          type: event.type ?? 'message',
          data,
          id: event.id,
        });
      }
      continue;
    }

    events.push({
      type: event.type ?? 'message',
      data: dataLines.join('\n'),
      id: event.id,
    });
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
  if (typeof path !== 'string') return false;
  // Absolute response paths
  if (path === 'response' || path.startsWith('response/')) return true;
  // Relative paths nested under a response BATCH (common for the first tokens).
  // e.g. {"p":"response","o":"BATCH","v":[{"p":"fragments/-1/content","v":"Hi"}]}
  if (
    path === 'content'
    || path === 'text'
    || path === 'markdown'
    || path === 'delta'
    || path.startsWith('fragments/')
  ) {
    return true;
  }
  return false;
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
  // Format 2: {"p":"...", "o":"APPEND"|"SET", "v":"text"} — explicit write/append
  // DeepSeek often SETs the first fragment content, then APPENDs the rest.
  if (parsed.p && (parsed.o === 'APPEND' || parsed.o === 'SET') && typeof parsed.v === 'string') {
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
  if (!parsed.p && typeof parsed.v === 'string') {
    return parsed.v;
  }
  // Nested snapshot: {"v":{"response":{"fragments":[{"content":"..."}]}}}
  if (!parsed.p && parsed.v && typeof parsed.v === 'object' && !Array.isArray(parsed.v)) {
    const nested = extractTextFromResponseSnapshot(parsed.v);
    if (nested) return nested;
  }
  if (
    isResponseTextPatchPath(parsed.p)
    && (parsed.o === 'APPEND' || parsed.o === 'SET')
    && typeof parsed.v === 'string'
  ) {
    return parsed.v;
  }
  if (isResponseTextPatchPath(parsed.p) && typeof parsed.v === 'string' && !parsed.o) {
    return parsed.v;
  }
  // SET whole response object (often carries initial fragments with opening text)
  if (
    (parsed.p === 'response' || parsed.p === 'response/fragments')
    && (parsed.o === 'SET' || parsed.o === 'APPEND' || !parsed.o)
    && parsed.v
    && typeof parsed.v === 'object'
  ) {
    const nested = extractTextFromResponseSnapshot(parsed.p === 'response/fragments' ? { fragments: parsed.v } : parsed.v);
    if (nested) return nested;
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

function extractTextFromResponseSnapshot(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.content === 'string' && record.content) return record.content;
  if (typeof record.text === 'string' && record.text) return record.text;

  const response = record.response && typeof record.response === 'object'
    ? record.response as Record<string, unknown>
    : record;

  const fragments = response.fragments;
  if (Array.isArray(fragments)) {
    const parts = fragments
      .map((frag) => extractFragmentText(frag))
      .filter((part): part is string => part !== null);
    if (parts.length > 0) return parts.join('');
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((frag) => extractFragmentText(frag))
      .filter((part): part is string => part !== null);
    if (parts.length > 0) return parts.join('');
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

function isFragmentsPath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  // Absolute: response/fragments
  // Relative under BATCH(response): fragments
  // Nested: anything ending with /fragments
  return path === 'fragments' || path === 'response/fragments' || path.endsWith('/fragments');
}

function isFragmentsAppendPatch(parsed: any): boolean {
  return isFragmentsPath(parsed?.p) &&
    parsed.o === 'APPEND' &&
    Array.isArray(parsed.v);
}

function isResponseFragmentsAppendPatch(parsed: any): boolean {
  // Same as fragments append: relative "fragments" is common as first tokens inside BATCH.
  return isFragmentsAppendPatch(parsed);
}

function extractFragmentText(fragment: unknown): string | null {
  if (!fragment || typeof fragment !== 'object') return null;
  const value = fragment as Record<string, unknown>;
  if (typeof value.content === 'string') return value.content;
  if (typeof value.text === 'string') return value.text;
  return null;
}


/**
 * Stateful assembler for DeepSeek response patches.
 * SET replaces fragment content (emitting only the new suffix when cumulative);
 * APPEND always appends. Prevents both opening loss and SET duplication.
 */
export class ResponseTextAssembler {
  private content = '';

  get text(): string {
    return this.content;
  }

  /** Apply one parsed SSE data object; returns newly visible delta for streaming. */
  apply(parsed: unknown): string {
    const ops = flattenResponseTextOps(parsed);
    let delta = '';
    for (const op of ops) {
      if (!op.text) continue;
      if (op.mode === 'append') {
        this.content += op.text;
        delta += op.text;
        continue;
      }
      // set / replace
      if (op.text === this.content) continue;
      if (op.text.startsWith(this.content)) {
        const extra = op.text.slice(this.content.length);
        this.content = op.text;
        delta += extra;
        continue;
      }
      if (this.content.startsWith(op.text)) {
        // Shrink — keep longer already-emitted text for clients that already saw it.
        continue;
      }
      // Non-prefix replace (rare): treat as append of full set when empty, else replace silently for final text.
      if (!this.content) {
        this.content = op.text;
        delta += op.text;
      } else {
        this.content = op.text;
      }
    }
    return delta;
  }

  reset(): void {
    this.content = '';
  }
}

type TextOp = { mode: 'append' | 'set'; text: string };

function flattenResponseTextOps(parsed: unknown): TextOp[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const value = parsed as Record<string, unknown>;

  if (value.o === 'BATCH' && Array.isArray(value.v)) {
    return value.v.flatMap((item) => flattenResponseTextOps(item));
  }

  // Bare string append (DeepSeek shorthand)
  if (!value.p && typeof value.v === 'string') {
    return [{ mode: 'append', text: value.v }];
  }

  if (!value.p && value.v && typeof value.v === 'object' && !Array.isArray(value.v)) {
    const nested = extractTextFromResponseSnapshot(value.v);
    return nested ? [{ mode: 'set', text: nested }] : [];
  }

  if (isResponseFragmentsAppendPatch(value)) {
    const text = (value.v as unknown[])
      .map((frag) => extractFragmentText(frag))
      .filter((part): part is string => Boolean(part))
      .join('');
    return text ? [{ mode: 'append', text }] : [];
  }

  if (
    (value.p === 'response' || value.p === 'response/fragments')
    && value.v
    && typeof value.v === 'object'
  ) {
    const nested = extractTextFromResponseSnapshot(
      value.p === 'response/fragments' ? { fragments: value.v } : value.v,
    );
    if (nested) {
      const mode = value.o === 'APPEND' ? 'append' : 'set';
      return [{ mode, text: nested }];
    }
  }

  if (isResponseTextPatchPath(value.p) && typeof value.v === 'string') {
    if (value.o === 'SET') return [{ mode: 'set', text: value.v }];
    // APPEND or missing o → append
    return [{ mode: 'append', text: value.v }];
  }

  return [];
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
