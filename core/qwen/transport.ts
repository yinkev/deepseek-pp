const QWEN_ORIGIN = 'https://chat.qwen.ai';
const QWEN_CREATE_CHAT_URL = `${QWEN_ORIGIN}/api/v2/chats/new`;
const QWEN_COMPLETION_URL = `${QWEN_ORIGIN}/api/v2/chat/completions`;

export type QwenModelId = 'qwen3.7-plus';

export interface QwenCachedAuth {
  authorization: string;
  version: string;
  bxUmidToken?: string;
  bxUa?: string;
}

export interface QwenSession {
  chatId: string;
  parentId: string | null;
}

export interface QwenTurnInput {
  session: QwenSession;
  modelId: QwenModelId;
  prompt: string;
  thinkingEnabled: boolean;
  files?: Record<string, unknown>[];
  signal?: AbortSignal;
}

export interface QwenTurnCallbacks {
  onTextChunk?: (chunk: string, fullText: string) => void;
  onThinking?: (text: string) => void;
}

export interface QwenTurn {
  assistantText: string;
  thinkingText: string;
  responseId: string;
  finished: boolean;
}

export type QwenWebErrorCode =
  | 'missing_auth'
  | 'auth_rejected'
  | 'rate_limited'
  | 'upstream_error'
  | 'invalid_response';

export class QwenWebError extends Error {
  constructor(
    public readonly code: QwenWebErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'QwenWebError';
  }
}

export interface QwenWebTransport {
  createSession(modelId: QwenModelId, signal?: AbortSignal): Promise<QwenSession>;
  streamTurn(input: QwenTurnInput, callbacks: QwenTurnCallbacks): Promise<QwenTurn>;
}

export interface QwenWebTransportDeps {
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  loadAuth: () => Promise<QwenCachedAuth | null>;
  randomUUID?: () => string;
  now?: () => number;
}

export interface BuildQwenTurnPayloadInput {
  prompt: string;
  modelId: QwenModelId;
  chatId: string;
  parentId: string | null;
  userMessageId: string;
  responseId: string;
  timestampSeconds: number;
  thinkingEnabled: boolean;
  files?: Record<string, unknown>[];
}

export function buildQwenTurnPayload(input: BuildQwenTurnPayloadInput) {
  const featureConfig = {
    thinking_enabled: input.thinkingEnabled,
    output_schema: 'phase',
    research_mode: 'normal',
    auto_thinking: input.thinkingEnabled,
    thinking_format: 'summary',
    auto_search: false,
  };

  return {
    stream: true,
    version: '2.1',
    incremental_output: true,
    chat_id: input.chatId,
    chat_mode: 'normal',
    model: input.modelId,
    parent_id: input.parentId,
    chat_type: 't2t',
    sub_chat_type: 't2t',
    messages: [{
      fid: input.userMessageId,
      parentId: input.parentId,
      childrenIds: [input.responseId],
      role: 'user',
      content: input.prompt,
      user_action: 'chat',
      files: input.files ?? [],
      timestamp: input.timestampSeconds,
      models: [input.modelId],
      chat_type: 't2t',
      feature_config: featureConfig,
      extra: { meta: { subChatType: 't2t' } },
      sub_chat_type: 't2t',
    }],
    timestamp: input.timestampSeconds + 1,
  };
}

export function createQwenWebTransport(deps: QwenWebTransportDeps): QwenWebTransport {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => Date.now());

  const loadRequiredAuth = async (): Promise<QwenCachedAuth> => {
    const auth = await deps.loadAuth();
    if (!auth?.authorization) {
      throw new QwenWebError(
        'missing_auth',
        'Qwen login is missing. Sign in at chat.qwen.ai once, then retry.',
      );
    }
    return auth;
  };

  const requestHeaders = (auth: QwenCachedAuth, accept: string): Record<string, string> => {
    const headers: Record<string, string> = {
      Accept: accept,
      'Content-Type': 'application/json',
      Authorization: auth.authorization,
      Version: auth.version,
      source: 'web',
      'X-Source': 'web',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Request-Id': randomUUID(),
      Timezone: new Date(now()).toString(),
    };
    if (auth.bxUmidToken) headers['bx-umidtoken'] = auth.bxUmidToken;
    if (auth.bxUa) headers['bx-ua'] = auth.bxUa;
    return headers;
  };

  return {
    async createSession(modelId, signal) {
      const auth = await loadRequiredAuth();
      const response = await fetchImpl(QWEN_CREATE_CHAT_URL, {
        method: 'POST',
        credentials: 'include',
        signal,
        referrer: `${QWEN_ORIGIN}/`,
        headers: requestHeaders(auth, 'application/json'),
        body: JSON.stringify({ title: modelId, chat: {} }),
      });
      await throwForQwenFailure(response, 'create chat');
      const payload = await readJson(response, 'create chat');
      const chatId = readString(readRecord(readRecord(payload).data).id);
      if (!chatId) {
        throw new QwenWebError('invalid_response', 'Qwen did not return a chat id.');
      }
      return { chatId, parentId: null };
    },

    async streamTurn(input, callbacks) {
      const auth = await loadRequiredAuth();
      const timestampSeconds = Math.floor(now() / 1000);
      const payload = buildQwenTurnPayload({
        prompt: input.prompt,
        modelId: input.modelId,
        chatId: input.session.chatId,
        parentId: input.session.parentId,
        userMessageId: randomUUID(),
        responseId: randomUUID(),
        timestampSeconds,
        thinkingEnabled: input.thinkingEnabled,
        files: input.files,
      });
      const url = `${QWEN_COMPLETION_URL}?chat_id=${encodeURIComponent(input.session.chatId)}`;
      const response = await fetchImpl(url, {
        method: 'POST',
        credentials: 'include',
        signal: input.signal,
        referrer: `${QWEN_ORIGIN}/`,
        headers: requestHeaders(auth, 'text/event-stream'),
        body: JSON.stringify(payload),
      });
      await throwForQwenFailure(response, 'stream completion');
      if (!response.body) {
        throw new QwenWebError('invalid_response', 'Qwen completion did not include a stream body.');
      }
      return readQwenCompletionStream(response.body, callbacks);
    },
  };
}

async function readQwenCompletionStream(
  body: ReadableStream<Uint8Array>,
  callbacks: QwenTurnCallbacks,
): Promise<QwenTurn> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assistantText = '';
  let thinkingText = '';
  let responseId: string | null = null;
  let finished = false;

  const consumeEvent = (eventText: string) => {
    for (const rawLine of eventText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const dataText = line.slice(5).trim();
      if (!dataText || dataText === '[DONE]') {
        if (dataText === '[DONE]') finished = true;
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(dataText);
      } catch {
        continue;
      }
      const record = readRecord(value);
      const created = readRecord(record['response.created']);
      responseId = responseId
        ?? readString(created.response_id)
        ?? readString(created.id)
        ?? readString(record.response_id)
        ?? readCreatedResponseId(record);

      const choices = Array.isArray(record.choices) ? record.choices : [];
      const firstChoice = readRecord(choices[0]);
      const delta = readRecord(firstChoice.delta);
      const phase = readString(delta.phase) ?? '';
      if (phase === 'thinking_summary') {
        const extra = readRecord(delta.extra);
        const thought = readRecord(extra.summary_thought);
        const chunks = Array.isArray(thought.content) ? thought.content : [];
        const next = chunks.filter((chunk): chunk is string => typeof chunk === 'string').join(' ').trim();
        if (next) {
          thinkingText = next;
          callbacks.onThinking?.(thinkingText);
        }
      }
      const content = readString(delta.content);
      if (content && (phase === 'answer' || phase === 'finished' || !phase)) {
        assistantText += content;
        callbacks.onTextChunk?.(content, assistantText);
      }
      if (
        readString(delta.status)?.toLowerCase() === 'finished'
        && (phase === 'answer' || phase === 'finished' || !phase)
      ) finished = true;
    }
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        consumeEvent(part);
        if (finished) break;
      }
    }
    if (!finished) {
      buffer += decoder.decode();
      if (buffer.trim()) consumeEvent(buffer);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  if (!responseId) {
    throw new QwenWebError('invalid_response', 'Qwen stream did not return a response id.');
  }
  return { assistantText, thinkingText, responseId, finished };
}

function readCreatedResponseId(record: Record<string, unknown>): string | null {
  if (record.type !== 'response.created') return null;
  const response = readRecord(record.response);
  return readString(response.response_id) ?? readString(response.id);
}

async function throwForQwenFailure(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new QwenWebError('auth_rejected', 'Qwen rejected the cached login. Open Qwen and sign in again.', response.status);
  }
  if (response.status === 429) {
    throw new QwenWebError('rate_limited', 'Qwen daily or request rate limit reached.', response.status);
  }
  throw new QwenWebError('upstream_error', `Qwen ${operation} failed with HTTP ${response.status}.`, response.status);
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new QwenWebError('invalid_response', `Qwen ${operation} returned invalid JSON.`);
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
