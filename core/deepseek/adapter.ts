import { DEEPSEEK_API_URL } from '../constants';
import {
  extractResponseUsageStatsFromParsed,
  extractResponseTextForTokenSpeed,
  extractResponseTextFromParsed,
  isStreamFinishedFromParsed,
  parseSSEChunk,
  parseSSEData,
} from '../interceptor/sse-parser';
import {
  createResponseTokenSpeedTracker,
  type ResponseTokenSpeedPayload,
} from '../interceptor/token-speed';
import {
  solvePowChallengeLocally,
  type PowAnswer,
  type PowChallenge,
} from './pow';

const DEEPSEEK_WEB_ORIGIN = new URL(DEEPSEEK_API_URL).origin;
const COMPLETION_PATH = new URL(DEEPSEEK_API_URL).pathname;
const POW_CHALLENGE_PATH = '/api/v0/chat/create_pow_challenge';
const CHAT_SESSION_CREATE_PATH = '/api/v0/chat_session/create';
const HISTORY_PATH = '/api/v0/chat/history_messages';
const DEFAULT_MODEL_TYPE = 'default';
const DEFAULT_APP_VERSION = '2.0.0';
const DEEPSEEK_CLIENT_PLATFORM = 'web';
const USER_TOKEN_STORAGE_KEY = 'userToken';
const SUPPORTED_MODEL_TYPES = new Set(['DEFAULT', 'default', 'expert', 'vision']);
const TOKEN_SPEED_EMIT_INTERVAL_MS = 250;
export const BYPASS_HOOK_HEADER = 'X-DPP-Bypass-Hook';

let rememberedClientHeaders: Record<string, string> | null = null;

export interface ModelTurn {
  assistantText: string;
  responseMessageId: number | null;
  requestMessageId: number | null;
  finished: boolean;
}

export interface DeepSeekHistorySnapshot {
  chatSessionId: string;
  parentMessageId: number | null;
  assistantMessageId: number | null;
  messageCount: number;
  verifiedAt: number;
}

interface DeepSeekHistoryMessage {
  id: number | null;
  parentId: number | null;
  role: string | null;
}

export interface SubmitPromptInput {
  chatSessionId: string;
  parentMessageId: number | null;
  modelType: string | null;
  prompt: string;
  refFileIds: string[];
  thinkingEnabled: boolean;
  searchEnabled: boolean;
  clientHeaders: Record<string, string>;
  powHeaders: Record<string, string>;
}

export interface StreamCallbacks {
  onTextChunk?(text: string, fullText: string): void;
  onTokenSpeed?(progress: ResponseTokenSpeedPayload): void;
  onFinished?(): void;
  retainAssistantText?: boolean;
}

export interface CreatePowHeadersOptions {
  wasmUrl?: string;
  targetPath?: string;
}

export class DeepSeekAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekAuthError';
  }
}

export class DeepSeekPowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekPowError';
  }
}

export class DeepSeekSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekSessionError';
  }
}

export class DeepSeekPayloadError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = 'DeepSeekPayloadError';
    this.retryable = options?.retryable ?? false;
  }
}

export async function createChatSession(clientHeaders: Record<string, string>): Promise<string> {
  const response = await fetch(new URL(CHAT_SESSION_CREATE_PATH, DEEPSEEK_API_URL).href, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...clientHeaders },
    body: JSON.stringify({}),
  });
  const json = await readJsonResponse(response, 'DeepSeek chat session create');
  const data = json?.data;
  const chatSessionId = firstString(data?.biz_data?.chat_session?.id);

  if (isAuthBizError(data, json)) {
    throw new DeepSeekAuthError('DeepSeek auth token was rejected while creating chat session.');
  }

  if (!response.ok || data?.biz_code !== 0 || !chatSessionId) {
    throw new DeepSeekSessionError(`Failed to create DeepSeek chat session with HTTP ${response.status}${formatBizCode(data, json)}.`);
  }

  return chatSessionId;
}

export async function createPowHeaders(
  clientHeaders: Record<string, string>,
  options: CreatePowHeadersOptions = {},
): Promise<Record<string, string>> {
  const targetPath = options.targetPath ?? COMPLETION_PATH;
  try {
    const challenge = await createPowChallenge(clientHeaders, targetPath);
    const answer = await solvePowChallenge(challenge, options.wasmUrl);
    return {
      'X-DS-PoW-Response': base64EncodeUtf8(JSON.stringify({
        algorithm: answer.algorithm,
        challenge: answer.challenge,
        salt: answer.salt,
        answer: answer.answer,
        signature: answer.signature,
        target_path: targetPath,
      })),
    };
  } catch (err) {
    if (err instanceof DeepSeekPowError) throw err;
    if (err instanceof DeepSeekAuthError) throw err;
    throw new DeepSeekPowError(err instanceof Error ? err.message : String(err));
  }
}

export function createClientHeaders(options?: { missingTokenMessage?: string }): Record<string, string> {
  const token = readDeepSeekUserToken();
  if (rememberedClientHeaders) {
    if (!token || rememberedClientHeaders.Authorization === `Bearer ${token}`) {
      return { ...rememberedClientHeaders };
    }
    rememberedClientHeaders = null;
  }

  if (!token) {
    throw new DeepSeekAuthError(
      options?.missingTokenMessage ?? 'DeepSeek login token is missing. Refresh chat.deepseek.com or sign in again.',
    );
  }

  return {
    Authorization: `Bearer ${token}`,
    'X-App-Version': getDeepSeekAppVersion(),
    'x-client-platform': DEEPSEEK_CLIENT_PLATFORM,
    'x-client-version': getDeepSeekAppVersion(),
    'x-client-locale': getDeepSeekLocale(),
    'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
  };
}

export function forgetDeepSeekClientHeaders(): void {
  rememberedClientHeaders = null;
}

export function rememberDeepSeekClientHeaders(headersInit: HeadersInit | undefined): void {
  const headers = normalizeHeaders(headersInit);
  if (!headers) return;

  const authorization = headers.get('authorization');
  if (!authorization) return;

  rememberedClientHeaders = {
    Authorization: authorization,
    'X-App-Version': headers.get('x-app-version') || getDeepSeekAppVersion(),
    'x-client-platform': headers.get('x-client-platform') || DEEPSEEK_CLIENT_PLATFORM,
    'x-client-version': headers.get('x-client-version') || getDeepSeekAppVersion(),
    'x-client-locale': headers.get('x-client-locale') || getDeepSeekLocale(),
    'x-client-timezone-offset': headers.get('x-client-timezone-offset') || String(-new Date().getTimezoneOffset() * 60),
  };
}

const STORAGE_HEADERS_KEY = 'deepseekCachedClientHeaders';
type ClientHeaderStorageArea = Pick<chrome.storage.LocalStorageArea, 'get' | 'set' | 'remove'>;

export async function saveClientHeadersToStorage(): Promise<boolean> {
  if (!rememberedClientHeaders) return false;
  await removeStoredClientHeaders();
  return true;
}

export async function loadClientHeadersFromStorage(): Promise<Record<string, string> | null> {
  await removeStoredClientHeaders();
  return rememberedClientHeaders ? { ...rememberedClientHeaders } : null;
}

export async function clearClientHeadersFromStorage(): Promise<void> {
  forgetDeepSeekClientHeaders();
  await removeStoredClientHeaders();
}

export async function scrubStoredClientHeaders(): Promise<void> {
  await removeStoredClientHeaders();
}

export async function submitPrompt(input: SubmitPromptInput, signal?: AbortSignal): Promise<ModelTurn> {
  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      'content-type': 'application/json',
      [BYPASS_HOOK_HEADER]: '1',
      ...input.clientHeaders,
      ...input.powHeaders,
    },
    body: JSON.stringify({
      chat_session_id: input.chatSessionId,
      parent_message_id: input.parentMessageId,
      model_type: normalizeModelType(input.modelType),
      prompt: input.prompt,
      ref_file_ids: input.refFileIds,
      thinking_enabled: input.thinkingEnabled,
      search_enabled: input.searchEnabled,
      action: null,
      preempt: false,
    }),
  });

  if (!response.ok) {
    throw new DeepSeekPayloadError(await readFailureMessage(response), { retryable: true });
  }

  if (!response.body) {
    throw new DeepSeekPayloadError('DeepSeek completion response did not include a stream body.', { retryable: true });
  }

  return readCompletionStream(response);
}

export async function submitPromptStreaming(
  input: SubmitPromptInput,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<ModelTurn> {
  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      'content-type': 'application/json',
      [BYPASS_HOOK_HEADER]: '1',
      ...input.clientHeaders,
      ...input.powHeaders,
    },
    body: JSON.stringify({
      chat_session_id: input.chatSessionId,
      parent_message_id: input.parentMessageId,
      model_type: normalizeModelType(input.modelType),
      prompt: input.prompt,
      ref_file_ids: input.refFileIds,
      thinking_enabled: input.thinkingEnabled,
      search_enabled: input.searchEnabled,
      action: null,
      preempt: false,
    }),
  });

  if (!response.ok) {
    throw new DeepSeekPayloadError(await readFailureMessage(response), { retryable: true });
  }

  if (!response.body) {
    throw new DeepSeekPayloadError('DeepSeek completion response did not include a stream body.', { retryable: true });
  }

  const decoratedCallbacks = callbacks.onTokenSpeed
    ? {
      ...callbacks,
      onTokenSpeed(progress: ResponseTokenSpeedPayload) {
        callbacks.onTokenSpeed?.({
          ...progress,
          chatSessionId: input.chatSessionId,
          modelType: progress.modelType ?? input.modelType,
        });
      },
    }
    : callbacks;

  return readCompletionStreamWithCallbacks(response, decoratedCallbacks);
}

export function getDeepSeekWebOrigin(): string {
  const hostname = globalThis.location?.hostname;
  if (hostname === 'chat.deepseek.com') {
    return globalThis.location.origin;
  }
  return DEEPSEEK_WEB_ORIGIN;
}

export interface ReadHistorySnapshotOptions {
  clientHeaders?: Record<string, string>;
  baseUrl?: string;
}

export async function readHistorySnapshot(
  chatSessionId: string,
  expectedAssistantMessageId: number,
  options?: ReadHistorySnapshotOptions,
): Promise<DeepSeekHistorySnapshot | null> {
  const clientHeaders = options?.clientHeaders ?? createClientHeaders();
  const baseUrl = options?.baseUrl ?? getDeepSeekWebOrigin();
  const url = new URL(HISTORY_PATH, baseUrl);
  url.searchParams.set('chat_session_id', chatSessionId);
  const response = await fetch(url.href, {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...clientHeaders,
    },
  });
  if (!response.ok) return null;

  const json = await response.json();
  const data = json?.data?.biz_data ?? json?.data ?? json?.biz_data ?? json;
  const rawMessages: unknown[] = Array.isArray(data?.chat_messages) ? data.chat_messages : [];
  if (rawMessages.length === 0) return null;

  const messages = rawMessages
    .map((message: unknown) => normalizeHistoryMessage(message))
    .filter((message: DeepSeekHistoryMessage): message is DeepSeekHistoryMessage => message.id !== null);
  if (messages.length === 0) return null;

  const expected = messages.find((message) => message.id === expectedAssistantMessageId);
  const latestAssistant =
    expected ??
    [...messages].reverse().find((message) => message.role !== 'user') ??
    messages[messages.length - 1];

  return {
    chatSessionId,
    parentMessageId: latestAssistant.id,
    assistantMessageId: latestAssistant.id,
    messageCount: messages.length,
    verifiedAt: Date.now(),
  };
}

export function normalizeMessageId(value: unknown, fieldName = 'message_id'): number | null {
  const id = coerceMessageId(value);
  if (id !== null || value === null || value === undefined || value === '') return id;
  throw new DeepSeekPayloadError(`DeepSeek ${fieldName} must be a u32 number, received ${JSON.stringify(value)}.`);
}

export function buildDeepSeekSessionUrl(chatSessionId: string): string {
  return `${getDeepSeekWebOrigin()}/a/chat/s/${chatSessionId}`;
}

async function readCompletionStream(response: Response): Promise<ModelTurn> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const summary: ModelTurn = { assistantText: '', responseMessageId: null, requestMessageId: null, finished: false };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const boundary = buffer.lastIndexOf('\n\n');
    if (boundary === -1) continue;

    consumeSSEText(buffer.slice(0, boundary + 2), summary);
    buffer = buffer.slice(boundary + 2);
  }

  if (buffer.trim()) consumeSSEText(buffer, summary);
  return summary;
}

async function readCompletionStreamWithCallbacks(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<ModelTurn> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const summary: ModelTurn = { assistantText: '', responseMessageId: null, requestMessageId: null, finished: false };
  const retainAssistantText = callbacks.retainAssistantText !== false;
  const speedTracker = callbacks.onTokenSpeed
    ? createResponseTokenSpeedTracker((progress) => callbacks.onTokenSpeed?.({
      ...progress,
      assistantMessageId: summary.responseMessageId,
    }), TOKEN_SPEED_EMIT_INTERVAL_MS)
    : null;
  const onParsed = speedTracker
    ? (parsed: unknown, event: ReturnType<typeof parseSSEChunk>[number]) => {
      speedTracker.updateServerStats(extractResponseUsageStatsFromParsed(parsed, event.type));
      const tokenText = extractResponseTextForTokenSpeed(parsed);
      if (tokenText) speedTracker.append(tokenText);
      if (isStreamFinishedFromParsed(parsed)) speedTracker.finish();
    }
    : undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const boundary = buffer.lastIndexOf('\n\n');
      if (boundary === -1) continue;

      const complete = buffer.slice(0, boundary + 2);
      buffer = buffer.slice(boundary + 2);

      const newText = consumeSSEText(complete, summary, { retainAssistantText, onParsed });
      if (newText && callbacks.onTextChunk) {
        callbacks.onTextChunk(newText, summary.assistantText);
      }
    }

    if (buffer.trim()) {
      const newText = consumeSSEText(buffer, summary, { retainAssistantText, onParsed });
      if (newText && callbacks.onTextChunk) {
        callbacks.onTextChunk(newText, summary.assistantText);
      }
    }
  } finally {
    speedTracker?.finish();
  }

  callbacks.onFinished?.();
  return summary;
}

function consumeSSEText(
  text: string,
  summary: ModelTurn,
  options: {
    retainAssistantText?: boolean;
    onParsed?: (parsed: unknown, event: ReturnType<typeof parseSSEChunk>[number]) => void;
  } = {},
): string {
  const retainAssistantText = options.retainAssistantText !== false;
  const appendedText: string[] = [];
  const events = parseSSEChunk(text);
  for (const event of events) {
    const parsed = parseSSEData(event.data);
    if (!parsed) continue;
    collectMessageIds(parsed, summary);
    options.onParsed?.(parsed, event);

    const eventText = extractResponseTextFromParsed(parsed);
    if (eventText) {
      appendedText.push(eventText);
      if (retainAssistantText) summary.assistantText += eventText;
    }
    if (isStreamFinishedFromParsed(parsed)) summary.finished = true;
  }
  return appendedText.join('');
}

function collectMessageIds(parsed: unknown, summary: ModelTurn) {
  if (!parsed || typeof parsed !== 'object') return;
  const value = parsed as Record<string, unknown>;

  const responseId = firstMessageId(value.response_message_id, value.responseMessageId);
  if (responseId !== null) summary.responseMessageId = responseId;

  const requestId = firstMessageId(value.request_message_id, value.requestMessageId);
  if (requestId !== null) summary.requestMessageId = requestId;

  if (value.o === 'BATCH' && Array.isArray(value.v)) {
    for (const item of value.v) collectMessageIds(item, summary);
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
    for (const item of value.v) collectMessageIds(item, summary);
  } else if (value.v && typeof value.v === 'object') {
    collectMessageIds(value.v, summary);
  }
}

function normalizeHistoryMessage(raw: unknown): DeepSeekHistoryMessage {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    id: firstMessageId(value.message_id, value.id, value.uuid),
    parentId: firstMessageId(value.parent_id, value.parent_message_id, value.parentMessageId),
    role: firstString(value.message_role, value.role)?.toLowerCase() ?? null,
  };
}

function readDeepSeekUserToken(): string | null {
  try {
    const raw = localStorage.getItem(USER_TOKEN_STORAGE_KEY);
    if (!raw) return null;

    const parsed = tryParseJson(raw);
    if (typeof parsed === 'string') return parsed.trim() || null;
    if (parsed && typeof parsed === 'object') {
      return firstString(
        (parsed as Record<string, unknown>).token,
        (parsed as Record<string, unknown>).value,
        (parsed as Record<string, unknown>).accessToken,
      );
    }

    if (raw.trim() === 'null') return null;
    return raw.trim() || null;
  } catch {
    return null;
  }
}

function normalizeHeaders(headersInit: HeadersInit | undefined): Headers | null {
  if (!headersInit) return null;
  try {
    return new Headers(headersInit);
  } catch {
    return null;
  }
}

function getSessionStorageArea(): ClientHeaderStorageArea | null {
  try {
    return chrome.storage?.session ?? null;
  } catch {
    return null;
  }
}

async function removeLegacyClientHeadersFromLocalStorage(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_HEADERS_KEY);
  } catch {}
}

async function removeStoredClientHeaders(): Promise<void> {
  await Promise.all([
    getSessionStorageArea()?.remove(STORAGE_HEADERS_KEY).catch(() => undefined) ?? Promise.resolve(),
    removeLegacyClientHeadersFromLocalStorage(),
  ]);
}

function getDeepSeekAppVersion(): string {
  return DEFAULT_APP_VERSION;
}

function getDeepSeekLocale(): string {
  const documentLocale = typeof document !== 'undefined' ? document.documentElement.lang : '';
  const navigatorLocale = typeof navigator !== 'undefined' ? navigator.language : '';
  return documentLocale || navigatorLocale || 'en-US';
}

function normalizeModelType(modelType: string | null): string {
  if (!modelType) return DEFAULT_MODEL_TYPE;
  if (SUPPORTED_MODEL_TYPES.has(modelType)) return modelType;
  if (modelType === 'chat' || modelType === 'deepseek_chat') return DEFAULT_MODEL_TYPE;
  if (modelType === 'reasoner' || modelType === 'deepseek_reasoner') return 'expert';
  return DEFAULT_MODEL_TYPE;
}

async function createPowChallenge(clientHeaders: Record<string, string>, targetPath: string): Promise<PowChallenge> {
  const response = await fetch(new URL(POW_CHALLENGE_PATH, DEEPSEEK_API_URL).href, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...clientHeaders },
    body: JSON.stringify({ target_path: targetPath }),
  });
  const json = await readJsonResponse(response, 'DeepSeek PoW challenge');
  const data = json?.data;
  const challenge = data?.biz_data?.challenge;

  if (isAuthBizError(data, json)) {
    throw new DeepSeekAuthError('DeepSeek auth token was rejected while creating PoW challenge.');
  }

  if (!response.ok || data?.biz_code !== 0 || !challenge) {
    throw new DeepSeekPowError(`Failed to create DeepSeek PoW challenge with HTTP ${response.status}${formatBizCode(data, json)}.`);
  }

  return {
    algorithm: String(challenge.algorithm),
    challenge: String(challenge.challenge),
    salt: String(challenge.salt),
    difficulty: Number(challenge.difficulty),
    signature: String(challenge.signature),
    expireAt: Number(challenge.expire_at ?? challenge.expireAt ?? 0),
    expireAfter: Number(challenge.expire_after ?? challenge.expireAfter ?? 0),
  };
}

async function solvePowChallenge(challenge: PowChallenge, wasmUrl?: string): Promise<PowAnswer> {
  try {
    return await solvePowChallengeLocally(challenge, wasmUrl);
  } catch (err) {
    const localMessage = err instanceof Error ? err.message : String(err);
    throw new DeepSeekPowError(`DeepSeek PoW challenge failed: ${localMessage}`);
  }
}

function isAuthBizError(data: any, json: any): boolean {
  return data?.biz_code === 40002 || data?.biz_code === 40003 || json?.code === 40002 || json?.code === 40003;
}

function formatBizCode(data: any, json: any): string {
  const code = data?.biz_code ?? json?.code;
  if (typeof code !== 'number' && typeof code !== 'string') return '';
  return `, biz_code ${code}`;
}

async function readFailureMessage(response: Response): Promise<string> {
  return `DeepSeek completion failed with HTTP ${response.status}.`;
}

async function readJsonResponse(response: Response, label: string): Promise<any> {
  const text = await response.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    throw new DeepSeekPowError(`${label} returned non-JSON HTTP ${response.status}.`);
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstMessageId(...values: unknown[]): number | null {
  for (const value of values) {
    const id = coerceMessageId(value);
    if (id !== null) return id;
  }
  return null;
}

function coerceMessageId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFFFFFF) return parsed;
  }
  return null;
}

function tryParseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
