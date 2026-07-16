import type { SSEEvent } from '../types';
import { normalizeDeepSeekMessageId } from './request-codec';

export type { SSEEvent } from '../types';

export function normalizeSseNewlines(chunk: string): string {
  return chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export interface ResponseStreamUsageStats {
  modelType?: string | null;
  insertedAt?: number | null;
  updatedAt?: number | null;
  accumulatedTokenUsage?: number | null;
}

export interface DeepSeekStreamSummary {
  assistantText: string;
  responseMessageId: number | null;
  requestMessageId: number | null;
  finished: boolean;
}

export interface DeepSeekStreamParseDebug {
  events: Array<{
    op?: string;
    path?: string;
    sample?: string;
    delta?: string;
    extracted?: string | null;
    raw?: string;
  }>;
  finalText: string;
  rawEvents: string[];
}

export let lastStreamParseDebug: DeepSeekStreamParseDebug = createEmptyStreamParseDebug();

const responseAssemblers = new WeakMap<DeepSeekStreamSummary, ResponseTextAssembler>();

export function getLastStreamParseDebug(): DeepSeekStreamParseDebug {
  return lastStreamParseDebug;
}

export interface DeepSeekSseByteDecoder {
  push(bytes: Uint8Array): SSEEvent[];
  finish(): SSEEvent[];
}

export interface DeepSeekSseTextDecoder {
  push(text: string): SSEEvent[];
  finish(): SSEEvent[];
}

export interface DeepSeekSseFrame {
  readonly block: string;
  readonly separator: string;
  readonly event: SSEEvent | null;
  readonly parsed: unknown | null;
}

export interface DeepSeekSseFrameDecoder {
  push(text: string): DeepSeekSseFrame[];
  finish(): DeepSeekSseFrame[];
}

export function createDeepSeekStreamSummary(): DeepSeekStreamSummary {
  const summary: DeepSeekStreamSummary = {
    assistantText: '',
    responseMessageId: null,
    requestMessageId: null,
    finished: false,
  };
  responseAssemblers.set(summary, new ResponseTextAssembler());
  lastStreamParseDebug = createEmptyStreamParseDebug();
  return summary;
}

export function createDeepSeekSseByteDecoder(): DeepSeekSseByteDecoder {
  const decoder = new TextDecoder();
  const textDecoder = createDeepSeekSseTextDecoder();

  return {
    push(bytes) {
      return textDecoder.push(decoder.decode(bytes, { stream: true }));
    },
    finish() {
      const decoded = decoder.decode();
      const events = decoded ? textDecoder.push(decoded) : [];
      return events.concat(textDecoder.finish());
    },
  };
}

export function createDeepSeekSseTextDecoder(): DeepSeekSseTextDecoder {
  const frameDecoder = createDeepSeekSseFrameDecoder();

  return {
    push(text) {
      return parseSSEFrames(frameDecoder.push(text));
    },
    finish() {
      return parseSSEFrames(frameDecoder.finish());
    },
  };
}

export function createDeepSeekSseFrameDecoder(): DeepSeekSseFrameDecoder {
  let buffer = '';
  let scanFrom = 0;

  const drain = (final = false): DeepSeekSseFrame[] => {
    const frames: DeepSeekSseFrame[] = [];
    const boundaryPattern = /(?:\r\n|\r(?!\n)|\n)(?:\r\n|\r(?!\n)|\n)/g;
    boundaryPattern.lastIndex = scanFrom;
    let offset = 0;
    let match: RegExpExecArray | null;

    while ((match = boundaryPattern.exec(buffer)) !== null) {
      const separator = match[0];
      const endsWithAmbiguousCr = !final
        && match.index + separator.length === buffer.length
        && separator.endsWith('\r');
      if (endsWithAmbiguousCr) break;
      frames.push(createDeepSeekSseFrame(buffer.slice(offset, match.index), separator));
      offset = match.index + separator.length;
    }

    buffer = buffer.slice(offset);
    scanFrom = Math.max(0, buffer.length - 3);
    return frames;
  };

  return {
    push(text) {
      buffer += text;
      return drain();
    },
    finish() {
      const frames = drain(true);
      if (buffer) frames.push(createDeepSeekSseFrame(buffer, ''));
      buffer = '';
      scanFrom = 0;
      return frames;
    },
  };
}

export function consumeDeepSeekSseEvents(
  events: readonly SSEEvent[],
  summary: DeepSeekStreamSummary,
  options: {
    retainAssistantText?: boolean;
    onParsed?: (parsed: unknown, event: SSEEvent) => void;
  } = {},
): string {
  const appendedText: string[] = [];

  for (const event of events) {
    const parsed = parseSSEData(event.data);
    if (!parsed) continue;
    consumeParsedDeepSeekSseEvent(parsed, event, summary, options, appendedText);
  }

  return appendedText.join('');
}

export function consumeDeepSeekSseFrames(
  frames: readonly DeepSeekSseFrame[],
  summary: DeepSeekStreamSummary,
  options: {
    retainAssistantText?: boolean;
    onParsed?: (parsed: unknown, event: SSEEvent) => void;
  } = {},
): string {
  const appendedText: string[] = [];
  for (const frame of frames) {
    if (!frame.event || !frame.parsed) continue;
    consumeParsedDeepSeekSseEvent(frame.parsed, frame.event, summary, options, appendedText);
  }
  return appendedText.join('');
}

export function parseSSEChunk(chunk: string): SSEEvent[] {
  const decoder = createDeepSeekSseFrameDecoder();
  return parseSSEFrames(decoder.push(chunk).concat(decoder.finish()));
}

function parseSSEFrames(frames: readonly DeepSeekSseFrame[]): SSEEvent[] {
  const events: SSEEvent[] = [];
  for (const frame of frames) {
    if (!frame.event) continue;
    const dataLines = frame.event.data.split('\n');
    const independentlyJsonEncoded = dataLines.length > 1
      && dataLines.every((line) => line.startsWith('{') || line.startsWith('['));
    if (!independentlyJsonEncoded) {
      events.push(frame.event);
      continue;
    }
    for (const data of dataLines) {
      events.push({ ...frame.event, data });
    }
  }
  return events;
}

function createDeepSeekSseFrame(block: string, separator: string): DeepSeekSseFrame {
  const event = parseSSEBlock(block);
  let parsedResolved = false;
  let parsed: unknown | null = null;
  return {
    block,
    separator,
    event,
    get parsed() {
      if (!parsedResolved) {
        parsed = event ? parseSSEData(event.data) : null;
        parsedResolved = true;
      }
      return parsed;
    },
  };
}

function parseSSEBlock(block: string): SSEEvent | null {
  if (!block.trim()) return null;

  const event: Partial<SSEEvent> = {};
  for (const line of block.split(/\r\n|\r|\n/)) {
    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'id') {
      event.id = value;
    } else if (field === 'event') {
      event.type = value;
    } else if (field === 'data') {
      event.data = event.data != null ? `${event.data}\n${value}` : value;
    }
  }

  if (event.data === undefined) return null;
  return {
    type: event.type ?? 'message',
    data: event.data,
    id: event.id,
  };
}

function consumeParsedDeepSeekSseEvent(
  parsed: unknown,
  event: SSEEvent,
  summary: DeepSeekStreamSummary,
  options: {
    retainAssistantText?: boolean;
    onParsed?: (parsed: unknown, event: SSEEvent) => void;
  },
  appendedText: string[],
): void {
  collectDeepSeekMessageIds(parsed, summary);
  options.onParsed?.(parsed, event);
  if (lastStreamParseDebug.rawEvents.length < 50) {
    lastStreamParseDebug.rawEvents.push(event.data.slice(0, 500));
  }

  const record = parsed && typeof parsed === 'object'
    ? parsed as Record<string, unknown>
    : {};
  const path = typeof record.p === 'string' ? record.p : undefined;
  const op = typeof record.o === 'string' ? record.o : undefined;
  let sample: string | undefined;
  if (typeof record.v === 'string') sample = record.v.slice(0, 80);
  else if (record.v != null) {
    try {
      sample = JSON.stringify(record.v).slice(0, 120);
    } catch {
      sample = '[unserializable]';
    }
  }

  let assembler = responseAssemblers.get(summary);
  if (!assembler) {
    assembler = new ResponseTextAssembler();
    responseAssemblers.set(summary, assembler);
  }
  const extracted = extractResponseTextFromParsed(parsed);
  const delta = assembler.apply(parsed);
  if (delta) appendedText.push(delta);
  if (options.retainAssistantText !== false) summary.assistantText = assembler.text;
  if (lastStreamParseDebug.events.length < 40) {
    lastStreamParseDebug.events.push({
      op,
      path,
      sample,
      delta: delta || undefined,
      extracted,
    });
  }
  lastStreamParseDebug.finalText = assembler.text;

  if (isStreamFinishedFromParsed(parsed)) summary.finished = true;
}

export function parseSSEData(data: string): unknown | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function replaceDeepSeekSseFrameData(
  frame: DeepSeekSseFrame,
  data: string,
): string {
  const parts = frame.block.split(/(\r\n|\r|\n)/);
  let replaced = false;
  let output = '';

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? '';
    const lineEnding = parts[index + 1] ?? '';
    if (!line.startsWith('data:')) {
      output += line + lineEnding;
      continue;
    }
    if (!replaced) {
      output += `data: ${data}${lineEnding}`;
      replaced = true;
    }
  }

  return replaced ? output : frame.block;
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
  if (path === 'response' || path.startsWith('response/')) return true;
  return path === 'content'
    || path === 'text'
    || path === 'markdown'
    || path === 'delta'
    || path.startsWith('fragments/');
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
  if (
    (parsed.p === 'response' || parsed.p === 'response/fragments')
    && (parsed.o === 'SET' || parsed.o === 'APPEND' || !parsed.o)
    && parsed.v
    && typeof parsed.v === 'object'
  ) {
    const nested = extractTextFromResponseSnapshot(
      parsed.p === 'response/fragments' ? { fragments: parsed.v } : parsed.v,
    );
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
  if (!Array.isArray(fragments)) return null;
  const parts = fragments
    .map((fragment) => extractFragmentText(fragment))
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join('') : null;
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
  return typeof path === 'string'
    && (path === 'fragments' || path === 'response/fragments' || path.endsWith('/fragments'));
}

function isFragmentsAppendPatch(parsed: any): boolean {
  return isFragmentsPath(parsed?.p)
    && parsed.o === 'APPEND'
    && Array.isArray(parsed.v);
}

function isResponseFragmentsAppendPatch(parsed: any): boolean {
  return isFragmentsAppendPatch(parsed);
}

function extractFragmentText(fragment: unknown): string | null {
  if (!fragment || typeof fragment !== 'object') return null;
  const value = fragment as Record<string, unknown>;
  if (typeof value.content === 'string') return value.content;
  if (typeof value.text === 'string') return value.text;
  return null;
}

/** Stateful DeepSeek response patch assembler that avoids cumulative SET duplication. */
export class ResponseTextAssembler {
  private content = '';

  get text(): string {
    return this.content;
  }

  apply(parsed: unknown): string {
    const operations = flattenResponseTextOps(parsed);
    let delta = '';
    for (const operation of operations) {
      if (!operation.text) continue;
      if (operation.mode === 'append') {
        this.content += operation.text;
        delta += operation.text;
        continue;
      }
      if (operation.text === this.content) continue;
      if (operation.text.startsWith(this.content)) {
        delta += operation.text.slice(this.content.length);
        this.content = operation.text;
        continue;
      }
      if (this.content.startsWith(operation.text)) continue;
      if (!this.content) delta += operation.text;
      this.content = operation.text;
    }
    return delta;
  }

  reset(): void {
    this.content = '';
  }
}

type TextOperation = { mode: 'append' | 'set'; text: string };

function flattenResponseTextOps(parsed: unknown): TextOperation[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const value = parsed as Record<string, unknown>;

  if (value.o === 'BATCH' && Array.isArray(value.v)) {
    return value.v.flatMap((item) => flattenResponseTextOps(item));
  }
  if (!value.p && typeof value.v === 'string') {
    return [{ mode: 'append', text: value.v }];
  }
  if (!value.p && value.v && typeof value.v === 'object' && !Array.isArray(value.v)) {
    const nested = extractTextFromResponseSnapshot(value.v);
    return nested ? [{ mode: 'set', text: nested }] : [];
  }
  if (isResponseFragmentsAppendPatch(value)) {
    const text = (value.v as unknown[])
      .map((fragment) => extractFragmentText(fragment))
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
    if (nested) return [{ mode: value.o === 'APPEND' ? 'append' : 'set', text: nested }];
  }
  if (isResponseTextPatchPath(value.p) && typeof value.v === 'string') {
    return [{ mode: value.o === 'SET' ? 'set' : 'append', text: value.v }];
  }
  return [];
}

function createEmptyStreamParseDebug(): DeepSeekStreamParseDebug {
  return { events: [], finalText: '', rawEvents: [] };
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

function collectDeepSeekMessageIds(parsed: unknown, summary: DeepSeekStreamSummary): void {
  if (!parsed || typeof parsed !== 'object') return;
  const value = parsed as Record<string, unknown>;

  const responseId = firstMessageId(value.response_message_id, value.responseMessageId);
  if (responseId !== null) summary.responseMessageId = responseId;

  const requestId = firstMessageId(value.request_message_id, value.requestMessageId);
  if (requestId !== null) summary.requestMessageId = requestId;

  if (value.o === 'BATCH' && Array.isArray(value.v)) {
    for (const item of value.v) collectDeepSeekMessageIds(item, summary);
  }

  if (typeof value.p === 'string') {
    if (value.p.includes('response_message_id')) {
      const id = firstMessageId(value.v);
      if (id !== null) summary.responseMessageId = id;
    }
    if (value.p.includes('request_message_id')) {
      const id = firstMessageId(value.v);
      if (id !== null) summary.requestMessageId = id;
    }
  }

  if (Array.isArray(value.v)) {
    for (const item of value.v) collectDeepSeekMessageIds(item, summary);
  } else if (value.v && typeof value.v === 'object') {
    collectDeepSeekMessageIds(value.v, summary);
  }
}

function firstMessageId(...values: unknown[]): number | null {
  for (const value of values) {
    const id = normalizeDeepSeekMessageId(value);
    if (id !== null) return id;
  }
  return null;
}
