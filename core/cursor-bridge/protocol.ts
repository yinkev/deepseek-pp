/** Cursor bridge protocol — isolated from upstream hot paths. */

export const CURSOR_BRIDGE_NATIVE_HOST = 'com.deepseek_pp.cursor_bridge';
export const CURSOR_BRIDGE_PROTOCOL = 'deepseek-pp-cursor-bridge';
export const CURSOR_BRIDGE_PROTOCOL_VERSION = 1;
export const DEFAULT_CURSOR_BRIDGE_PORT = 8787;

/** Public OpenAI model ids. */
export type CursorBridgeModelId = 'ds/octopus' | 'ds/octopus-eyes' | 'ds/squid';

/** DeepSeek web model_type values we route to. */
export type CursorBridgeDeepSeekModelType = 'expert' | 'vision' | 'default';

export type CursorBridgeClientProfile = 'generic' | 'cursor' | 'hermes';

export interface CursorBridgeChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Image part extracted from OpenAI multimodal content. */
export interface CursorBridgeImagePart {
  /** data: URL or https URL. Host may strip data and leave a bridge asset ref. */
  url: string;
  mimeType?: string;
  /** When host stores bytes, extension fetches via this path. */
  assetPath?: string;
}

export interface CursorBridgeJobRequest {
  id: string;
  model: CursorBridgeModelId | string;
  messages: CursorBridgeChatMessage[];
  stream: boolean;
  thinkingEnabled: boolean;
  createdAt: number;
  /** Client profile for prompt hygiene. */
  clientProfile?: CursorBridgeClientProfile;
  /** Images attached to this turn (usually latest user message). */
  images?: CursorBridgeImagePart[];
  /** Sticky bridge thread id (explicit or host-resolved fingerprint). */
  threadId?: string;
  /** Force a new DeepSeek main session for this thread. */
  resetThread?: boolean;
}

export type CursorBridgeErrorCode =
  | 'not_ready'
  | 'missing_tab'
  | 'missing_login'
  | 'busy'
  | 'invalid_request'
  | 'upstream_error'
  | 'aborted'
  | 'timeout';

export interface CursorBridgeError {
  code: CursorBridgeErrorCode;
  message: string;
}

export interface CursorBridgeReadiness {
  ready: boolean;
  extensionAlive: boolean;
  hasDeepSeekTab: boolean;
  hasLogin: boolean;
  busy: boolean;
  reason?: string;
}

export type CursorBridgeHostToExtension =
  | { type: 'ping'; requestId: string }
  | { type: 'get_readiness'; requestId: string }
  | { type: 'run_job'; requestId: string; job: CursorBridgeJobRequest }
  | { type: 'abort_job'; requestId: string; jobId: string };

export type CursorBridgeExtensionToHost =
  | { type: 'hello'; protocol: typeof CURSOR_BRIDGE_PROTOCOL; version: number }
  | { type: 'pong'; requestId: string; readiness: CursorBridgeReadiness }
  | { type: 'readiness'; requestId: string; readiness: CursorBridgeReadiness }
  | { type: 'job_chunk'; requestId: string; jobId: string; text: string }
  | { type: 'job_done'; requestId: string; jobId: string; text: string }
  | { type: 'job_error'; requestId: string; jobId: string; error: CursorBridgeError };

export function isCursorBridgeEnvelope(value: unknown): value is CursorBridgeHostToExtension | CursorBridgeExtensionToHost {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string');
}

/**
 * Flatten OpenAI-style message content (text only).
 * Cursor often sends content as an array of parts, not a plain string.
 */
export function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part);
        continue;
      }
      if (!part || typeof part !== 'object') continue;
      const record = part as Record<string, unknown>;
      if (typeof record.text === 'string') parts.push(record.text);
      else if (typeof record.content === 'string') parts.push(record.content);
      else if (record.type === 'text' && typeof record.value === 'string') parts.push(record.value);
    }
    return parts.join('\n');
  }
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
  }
  return '';
}

/** Extract image URLs from OpenAI multimodal message content. */
export function extractImageParts(content: unknown): CursorBridgeImagePart[] {
  const images: CursorBridgeImagePart[] = [];

  const pushUrl = (url: unknown, mimeHint?: unknown) => {
    if (typeof url !== 'string' || !url.trim()) return;
    const trimmed = url.trim();
    if (!trimmed.startsWith('data:image/') && !trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return;
    }
    const mimeType =
      typeof mimeHint === 'string' && mimeHint.startsWith('image/')
        ? mimeHint
        : mimeFromDataUrl(trimmed);
    images.push({ url: trimmed, mimeType });
  };

  if (typeof content === 'string') {
    // Rare: bare data URL as entire content
    if (content.startsWith('data:image/')) pushUrl(content);
    return images;
  }

  if (!Array.isArray(content)) return images;

  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : '';

    if (type === 'image_url' || type === 'input_image') {
      const imageUrl = record.image_url;
      if (typeof imageUrl === 'string') {
        pushUrl(imageUrl, record.mime_type ?? record.media_type);
      } else if (imageUrl && typeof imageUrl === 'object') {
        const nested = imageUrl as Record<string, unknown>;
        pushUrl(nested.url, nested.mime_type ?? nested.media_type ?? record.mime_type);
      }
      continue;
    }

    if (type === 'image' && typeof record.url === 'string') {
      pushUrl(record.url, record.mime_type ?? record.media_type);
      continue;
    }

    // OpenAI Responses-style
    if (type === 'input_image' && typeof record.image_url === 'string') {
      pushUrl(record.image_url, record.mime_type);
    }
  }

  return images;
}

export function extractImagesFromMessages(messages: Array<{ content?: unknown }>): CursorBridgeImagePart[] {
  const out: CursorBridgeImagePart[] = [];
  for (const message of messages) {
    out.push(...extractImageParts(message.content));
  }
  return out;
}

function mimeFromDataUrl(url: string): string | undefined {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);/i.exec(url);
  return match?.[1]?.toLowerCase();
}

export function detectClientProfile(
  messages: CursorBridgeChatMessage[],
  headerValue?: string | null,
): CursorBridgeClientProfile {
  const header = (headerValue ?? '').trim().toLowerCase();
  if (header === 'cursor' || header === 'hermes' || header === 'generic') {
    return header;
  }

  const systemText = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n')
    .toLowerCase();

  if (!systemText) return 'generic';

  const cursorHits = [
    'cursor ide',
    'you are a coding agent',
    'agent skills',
    'mcp server',
  ].filter((n) => systemText.includes(n)).length;

  const hermesHits = [
    'hermes',
    'agent hermes',
    'openhermes',
  ].filter((n) => systemText.includes(n)).length;

  if (cursorHits >= 2) return 'cursor';
  if (hermesHits >= 1 && systemText.length > 400) return 'hermes';
  if (cursorHits >= 1 && systemText.length > 1200) return 'cursor';
  return 'generic';
}

/** Cursor/Hermes agent system dumps make DeepSeek role-play greetings instead of answering. */
function isHarnessAgentSystemPrompt(text: string, profile: CursorBridgeClientProfile): boolean {
  const lower = text.toLowerCase();
  const hits = [
    'you are a coding agent',
    'you are an ai coding assistant',
    'mcp server',
    'tool calling',
    'available tools',
    'follow these instructions carefully',
    'cursor ide',
    'agent skills',
    'hermes',
  ].filter((needle) => lower.includes(needle)).length;

  if (profile === 'cursor' || profile === 'hermes') {
    return hits >= 1 || text.length > 1200;
  }
  return hits >= 2 || (hits >= 1 && text.length > 1200);
}

function sanitizeSystemPrompt(text: string, profile: CursorBridgeClientProfile): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (isHarnessAgentSystemPrompt(trimmed, profile) || trimmed.length > 1500) {
    return [
      "Answer the user's latest request directly and completely.",
      'Do not re-introduce yourself, list your tools, or restart with a greeting if they already asked a concrete question.',
      'If they asked for research or analysis, give the analysis — not a capability menu.',
    ].join(' ');
  }
  return trimmed;
}

/**
 * Build a single DeepSeek web prompt from multi-turn OpenAI messages.
 * Emphasizes the latest user turn so multi-turn harness history does not collapse into greetings.
 */
export function messagesToPrompt(
  messages: CursorBridgeChatMessage[],
  options?: {
    clientProfile?: CursorBridgeClientProfile;
    eyesNotes?: string | null;
    /** Sticky continuation: omit prior dialogue; DeepSeek session holds history. */
    deltaOnly?: boolean;
  },
): string {
  const profile = options?.clientProfile ?? 'generic';
  const deltaOnly = options?.deltaOnly === true;
  const normalized = messages
    .map((message) => ({
      role: message.role,
      content: normalizeMessageContent(message.content).trim(),
    }))
    .filter((message) => message.content.length > 0);

  if (normalized.length === 0 && !options?.eyesNotes) return '';

  const systemParts = normalized
    .filter((message) => message.role === 'system')
    .map((message) => sanitizeSystemPrompt(message.content, profile))
    .filter((part): part is string => Boolean(part));

  const dialogue = normalized.filter((message) => message.role !== 'system');
  if (dialogue.length === 0 && !options?.eyesNotes) {
    return systemParts.join('\n\n').trim();
  }

  const latestUserIndex = (() => {
    for (let i = dialogue.length - 1; i >= 0; i -= 1) {
      if (dialogue[i].role === 'user') return i;
    }
    return dialogue.length > 0 ? dialogue.length - 1 : -1;
  })();

  const history = deltaOnly
    ? []
    : (latestUserIndex >= 0 ? dialogue.slice(0, latestUserIndex) : []);
  const latest = latestUserIndex >= 0 ? dialogue[latestUserIndex] : null;

  const parts: string[] = [];
  if (systemParts.length > 0) {
    parts.push(`Instructions:\n${systemParts.join('\n\n')}`);
  }

  if (options?.eyesNotes?.trim()) {
    parts.push(
      [
        'Eyes notes (from vision subcall — treat as tool output about attached image(s)):',
        options.eyesNotes.trim(),
        'Use these notes when the user question depends on the image. Do not claim you cannot see images.',
      ].join('\n'),
    );
  }

  if (history.length > 0) {
    const transcript = history
      .map((message) => {
        const label = message.role === 'assistant' ? 'Assistant' : 'User';
        return `${label}:\n${message.content}`;
      })
      .join('\n\n');
    parts.push(`Conversation so far:\n${transcript}`);
  }

  if (latest) {
    if (latest.role === 'user') {
      parts.push(
        [
          deltaOnly
            ? 'Continue this conversation. Answer the latest user request directly now.'
            : 'Latest user request — answer this directly now.',
          'Do not greet, do not list capabilities, and do not ask what they want if the request is already clear.',
          '',
          latest.content,
        ].join('\n'),
      );
    } else {
      parts.push(`Assistant:\n${latest.content}`);
    }
  }

  return parts.join('\n\n').trim();
}

export function formatEyesNotes(visionText: string, imageCount: number): string {
  const body = visionText.trim() || '(vision returned no text)';
  return [
    `Observed ${imageCount} image(s).`,
    body,
  ].join('\n');
}

/** Domain-agnostic eyes tool prompt (coding, medical, UI, photos — not coding-only). */
export const EYES_SUBCALL_PROMPT = [
  'You are the eyes tool for another model that cannot see the image.',
  'Describe the attached image(s) carefully and completely so that model can answer any follow-up.',
  'Include: what is shown; layout/composition; any readable text (OCR); diagrams, charts, UI, photos, medical images, or other content;',
  'labels, numbers, colors, anomalies, errors, and concrete visual details.',
  'Match detail to the image type (e.g. anatomy for radiographs, UI structure for screenshots, code/text for terminals).',
  'Be dense and factual. Do not greet. Do not refuse. Do not answer as if you are the final assistant — only describe.',
].join(' ');

export function modelThinkingEnabled(model: string | undefined): boolean {
  if (!model) return false;
  // thinking remains a request flag / legacy alias, not a separate product model
  return model.includes('thinking') || model.endsWith('-think');
}

export function isEyesModel(model: string | undefined): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return (
    lower.includes('octopus-eyes')
    || lower.endsWith('/eyes')
    || lower.endsWith('-eyes')
    || lower === 'vision'
    || lower.endsWith('/vision')
    || lower.endsWith('-vision')
  );
}

/** Instant / flash web model (DeepSeek default / “pro” surface with search + native uploads). */
export function isSquidModel(model: string | undefined): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return (
    lower.includes('ds/squid')
    || lower.endsWith('/squid')
    || lower.endsWith('-squid')
    || lower === 'squid'
    || lower.includes('ds/flash')
    || lower.endsWith('/flash')
    || lower === 'flash'
    || lower.includes('instant')
  );
}

export function normalizeBridgeModel(model: string | undefined): CursorBridgeModelId {
  if (isEyesModel(model)) return 'ds/octopus-eyes';
  if (isSquidModel(model)) return 'ds/squid';
  return 'ds/octopus';
}

/** Map OpenAI model id → DeepSeek web model_type. */
export function bridgeModelToDeepSeekType(model: string | undefined): CursorBridgeDeepSeekModelType {
  if (isEyesModel(model)) return 'vision';
  if (isSquidModel(model)) return 'default';
  return 'expert';
}

/** Squid uses native web search; octopus expert does not (eyes are separate). */
export function bridgeModelSearchEnabled(model: string | undefined): boolean {
  return isSquidModel(model);
}

/** Squid attaches images on the main turn; octopus uses eyes subcall. */
export function bridgeModelUsesNativeVision(model: string | undefined): boolean {
  return isSquidModel(model) || isEyesModel(model);
}
