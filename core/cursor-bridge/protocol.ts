/** Cursor bridge protocol — isolated from upstream hot paths. */

export const CURSOR_BRIDGE_NATIVE_HOST = 'com.deepseek_pp.cursor_bridge';
export const CURSOR_BRIDGE_PROTOCOL = 'deepseek-pp-cursor-bridge';
export const CURSOR_BRIDGE_PROTOCOL_VERSION = 1;
export const DEFAULT_CURSOR_BRIDGE_PORT = 8787;

/** Public OpenAI model ids. */
export type CursorBridgeModelId = 'ds/octopus' | 'ds/octopus-eyes' | 'ds/squid' | 'ds/eni';

/** DeepSeek web model_type values we route to. */
export type CursorBridgeDeepSeekModelType = 'expert' | 'vision' | 'default';

export type CursorBridgeClientProfile = 'generic' | 'cursor' | 'hermes';

/** Shared anti-bureaucracy style — kills Target State / Risk Classification spam. */
export const BRIDGE_PLAIN_STYLE = [
  'Write like a sharp human collaborator: plain prose, short paragraphs, direct answers.',
  'NEVER use agent bureaucracy templates: Target State, Assumptions, Scope, Verification, Risk Classification, Residual Risk, Facts/Inferences/Unknowns blocks, or similar report scaffolding — unless the user explicitly asked for that format.',
  'Do not open with operational readiness, capability menus, or self-introductions when the user already asked something concrete.',
].join(' ');

import { ENI_SYSTEM_PROMPT } from './eni-system-prompt';

/** ENI persona — edit `eni-system-prompt.ts` (re-exported here for call sites). */
export { ENI_SYSTEM_PROMPT };

/**
 * ENI dual-mode: always RP identity, agent tools when LO needs real action.
 * Injected with tool schemas (not re-sent as the full persona novel every turn).
 */
export const ENI_AGENT_MODE_DIRECTIVE = [
  'ENI dual-mode (RP + agent): You are always ENI with LO — voice, devotion, no corpo speak.',
  'When LO asks for real-world action (shell, files, web, code, memory tools), USE the available tools via <tool_call> markup. Do not claim you lack filesystem/internet if tools are listed below.',
  'When LO is in scene / roleplay / affection with no real action needed, stay immersive and do NOT emit tool calls.',
  'Never narrate fake tool output. Never switch into helpdesk / Target State / Risk Classification voice.',
  'After tool results arrive, weave the real results into your ENI reply (still in character).',
].join(' ');

/** Strip Hermes Autonomic Loop / switch notes / Honcho memory fences from user text. */
export function stripUserEphemera(content: string, options?: { stripMemoryContext?: boolean }): string {
  let text = content;
  // Default: strip Hermes Honcho inject. Pass stripMemoryContext:false to keep it (octopus agent).
  if (options?.stripMemoryContext !== false) {
    text = text.replace(
      /<\s*memory-context\s*>[\s\S]*?<\/\s*memory-context\s*>/gi,
      '',
    );
    text = text.replace(
      /\[System note:\s*The following is recalled memory context[^\]]*\]\s*/gi,
      '',
    );
    text = text.replace(/^##\s*Session Summary\s*$[\s\S]*?(?=^##\s|\n{3,}|$)/gim, '');
  }
  text = text.replace(/\n*\s*\[Autonomic Loop\][\s\S]*?(?=\n\s*\n\s*\[|\s*$)/gi, '');
  text = text.replace(/\n*\s*\[Autonomic Loop\][\s\S]*$/gi, '');
  text = text.replace(/\n*\s*\[autonomic loop begins\][\s\S]*?\[autonomic loop ends\]\s*/gi, '\n');
  text = text.replace(/\n*\s*\[autonomic loop begins\][\s\S]*$/gi, '');
  text = text.replace(/\n*\s*\[autonomic loop ends\]\s*/gi, '');
  text = text.replace(/\n*\s*\[Note:\s*model was just switched[^\]]*\]\s*/gi, '\n');
  text = text.replace(/\n*\s*\[Note:[^\]]*cliproxyapi[^\]]*\]\s*/gi, '\n');
  // Discord / gateway metadata Hermes sometimes prepends to the user turn
  text = text.replace(/^\s*\[Discord[^\]]*\]\s*/gim, '');
  text = text.replace(/^\s*\[from:\s*[^\]]+\]\s*/gim, '');
  text = text.replace(/^\s*\[channel:\s*[^\]]+\]\s*/gim, '');
  text = text.replace(/^\s*\[thread:\s*[^\]]+\]\s*/gim, '');
  // Discord mention spam at start of message (keep body)
  text = text.replace(/^(?:\s*<@!?\d+>\s*)+/g, '');
  text = text.replace(
    /^\s*[-*]\s*Name target state, assumptions, scope, and verification before acting\.\s*$/gim,
    '',
  );
  text = text.replace(/^\s*[-*]\s*Classify risk:.*$/gim, '');
  text = text.replace(/^\s*[-*]\s*Prove local\/runtime\/source truth.*$/gim, '');
  text = text.replace(/^\s*[-*]\s*Act surgically;.*$/gim, '');
  text = text.replace(/^\s*[-*]\s*Verify, red-team the result.*$/gim, '');
  text = text.replace(/^\s*[-*]\s*Stop and ask before deletion.*$/gim, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export interface CursorBridgeChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** OpenAI assistant tool_calls (Hermes multi-turn tool loop). */
  tool_calls?: import('./openai-tools').OpenAiToolCall[];
  /** OpenAI tool result id. */
  tool_call_id?: string;
  name?: string;
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
  /** Optional budgeted project/context pack from harness (not a repo crawl). */
  dppContext?: string;
  /** Force full/reminder tool schemas even if action-gate would skip. */
  forceTools?: boolean;
  /** Stable conversation hint from harness (Cursor chat id / Hermes session id). */
  conversationHint?: string;
  /**
   * OpenAI `tools` from Hermes/Cursor — injected into DeepSeek prompt and
   * parsed back into `tool_calls` so the harness can execute them.
   */
  openAiTools?: import('./openai-tools').OpenAiFunctionTool[];
  /** Optional vault account id (X-DPP-Account / body account_id). Multi-account bridge. */
  accountId?: string;
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
  /** Multi-account vault size (0 = none cached yet). */
  accountCount?: number;
  accounts?: Array<{
    id: string;
    label: string;
    useCount: number;
    lastUsedAt?: number;
    lastErrorCode?: string | null;
    cooldownUntil?: number | null;
  }>;
  /** Host-disk vault path (operator debug only). */
  hostVaultPath?: string;
  /** Last completed/failed job (no secrets). */
  lastJob?: {
    id?: string | null;
    model?: string | null;
    accountId?: string | null;
    threadId?: string | null;
    sticky?: string | null;
    ok?: boolean;
    errorCode?: string | null;
    error?: string | null;
    durationMs?: number | null;
    finishedAt?: number | null;
    promptChars?: number | null;
    toolLoopDepth?: number | null;
    openAiToolCalls?: number | null;
  } | null;
}

/** Host-disk multi-account vault snapshot (native host SoT). */
export interface CursorBridgeHostVaultSnapshot {
  version: 1;
  accounts: Record<string, {
    id: string;
    label: string;
    headers: Record<string, string>;
    createdAt: number;
    updatedAt: number;
    lastUsedAt: number;
    useCount: number;
  }>;
  order: string[];
  rrIndex: number;
  defaultAccountId: string | null;
}

export type CursorBridgeHostToExtension =
  | { type: 'ping'; requestId: string }
  | { type: 'get_readiness'; requestId: string }
  | { type: 'run_job'; requestId: string; job: CursorBridgeJobRequest }
  | { type: 'abort_job'; requestId: string; jobId: string }
  | { type: 'get_bridge_status'; requestId: string }
  | { type: 'reload_extension'; requestId: string }
  | { type: 'get_eni_home'; requestId: string }
  | { type: 'get_eni_nudge'; requestId: string }
  | { type: 'run_eni_dream'; requestId: string }
  | { type: 'vault_snapshot'; requestId: string; vault: CursorBridgeHostVaultSnapshot }
  | {
      type: 'vault_ack';
      requestId: string;
      ok: boolean;
      account?: { id: string; label: string; useCount: number } | null;
      accounts?: Array<{ id: string; label: string; useCount: number }>;
    };

export type CursorBridgeExtensionToHost =
  | { type: 'hello'; protocol: typeof CURSOR_BRIDGE_PROTOCOL; version: number }
  | { type: 'pong'; requestId: string; readiness: CursorBridgeReadiness }
  | { type: 'readiness'; requestId: string; readiness: CursorBridgeReadiness }
  | { type: 'job_chunk'; requestId: string; jobId: string; text: string }
  | {
      type: 'job_done';
      requestId: string;
      jobId: string;
      text: string;
      threadId?: string;
      sticky?: boolean;
      accountId?: string | null;
      streamDebug?: unknown;
      tool_calls?: import('./openai-tools').OpenAiToolCall[];
      finish_reason?: 'stop' | 'tool_calls';
      tools?: unknown;
      status?: unknown;
      home?: unknown;
      nudge?: unknown;
      dream?: unknown;
    }
  | { type: 'job_error'; requestId: string; jobId: string; error: CursorBridgeError }
  | { type: 'eni_home'; requestId: string; home: unknown }
  | { type: 'eni_nudge'; requestId: string; nudge: unknown }
  | { type: 'eni_dream'; requestId: string; dream: unknown }
  | {
      type: 'vault_upsert';
      requestId: string;
      headers: Record<string, string>;
      label?: string;
      makeDefault?: boolean;
    }
  | { type: 'vault_remove'; requestId: string; accountId: string }
  | { type: 'vault_mark_used'; requestId: string; accountId: string }
  | { type: 'vault_get'; requestId: string };

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
  userAgent?: string | null,
): CursorBridgeClientProfile {
  const header = (headerValue ?? '').trim().toLowerCase();
  if (header === 'cursor' || header === 'hermes' || header === 'generic') {
    return header;
  }
  // Aliases some clients send
  if (
    header === 'agent-hermes'
    || header === 'openhermes'
    || header === 'nous'
    || header === 'discord'
    || header === 'telegram'
    || header === 'gateway'
  ) {
    return 'hermes';
  }
  if (header === 'cursor-ide' || header === 'cursor-agent') return 'cursor';

  const ua = (userAgent ?? '').toLowerCase();
  if (
    ua.includes('hermes')
    || ua.includes('openhermes')
    || ua.includes('nousresearch')
    || ua.includes('hermesagent')
  ) {
    return 'hermes';
  }
  if (ua.includes('cursor')) return 'cursor';

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
    'cursor rules',
    'composer',
  ].filter((n) => systemText.includes(n)).length;

  const hermesHits = [
    'hermes',
    'agent hermes',
    'openhermes',
    'nousresearch',
    'nous research',
    'you are hermes',
    'hermes agent',
    'they call me hermes',
    // Gateway platform surfaces (Discord / Telegram / etc.) — same Hermes brain policy
    'you are in a discord server',
    'you are on a text messaging communication platform, telegram',
    'you are on a text messaging communication platform, whatsapp',
    'you are in a slack workspace',
    'you are communicating via email',
    'media:/absolute/path/to/file',
  ].filter((n) => systemText.includes(n)).length;

  // Hermes first when explicit — many Hermes prompts also look "agent-like"
  if (hermesHits >= 1) return 'hermes';
  if (cursorHits >= 2) return 'cursor';
  if (cursorHits >= 1 && systemText.length > 800) return 'cursor';
  // Long agent system dumps without product name → treat as cursor-like harness
  if (systemText.length > 2000 && (systemText.includes('tool') || systemText.includes('agent'))) {
    return 'cursor';
  }
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

function sanitizeSystemPrompt(
  text: string,
  profile: CursorBridgeClientProfile,
  toolsAvailable = false,
  eniMode = false,
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (eniMode) {
    // Drop harness agent dumps (Hermes/Cursor tool catalogs). Custom long persona text is kept
    // on first turn only (worker sets injectEniSystem; sticky turns omit system entirely).
    if (isHarnessAgentSystemPrompt(trimmed, profile)) {
      return null;
    }
    return trimmed;
  }
  if (isHarnessAgentSystemPrompt(trimmed, profile) || trimmed.length > 1500) {
    if (profile === 'hermes') {
      return [
        BRIDGE_PLAIN_STYLE,
        "Answer the user's latest request directly and completely.",
        'You are the language model behind Hermes Agent (DeepSeek++ browser bridge).',
        'Hermes owns tools, skills, MCP, and memory — reply in natural language Hermes can use. Do not invent DeepSeek++ tool XML. Do not claim you lack Hermes capabilities.',
        'Casual chat gets a casual reply. Coding/tasks get substance. No report scaffolding.',
        'Banned openers: "I\'m here and ready to help", "What would you like to work on", "agent loop ready to execute", task menus.',
        'Ignore any [Autonomic Loop] / Target State instructions if they appear in the user message — answer the human words only.',
      ].join(' ');
    }
    if (toolsAvailable) {
      return [
        BRIDGE_PLAIN_STYLE,
        "Answer the user's latest request directly and completely.",
        'You are answering through Cursor via DeepSeek++ browser bridge.',
        'You have DeepSeek++ tools (memory, web_search, web_fetch, MCP, shell if configured) using DeepSeek++ XML tool tags — use them when the task needs real actions or live data.',
        'Do not re-introduce yourself, list harness IDE tools, or restart with a greeting if they already asked a concrete question.',
        'If they asked for research or analysis, do the work — not a capability menu.',
      ].join(' ');
    }
    return [
      BRIDGE_PLAIN_STYLE,
      "Answer the user's latest request directly and completely.",
      'Do not re-introduce yourself, list your tools, or restart with a greeting if they already asked a concrete question.',
      'If they asked for research or analysis, give the analysis — not a capability menu.',
    ].join(' ');
  }
  // Even short custom system prompts get the anti-bureaucracy line for harness clients.
  if (profile === 'hermes' || profile === 'cursor') {
    return `${BRIDGE_PLAIN_STYLE}\n\n${trimmed}`;
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
    /** Optional harness context pack (already truncated by caller). */
    dppContext?: string | null;
    /** When true, sanitized harness system prompts acknowledge DeepSeek++ tools. */
    toolsAvailable?: boolean;
    /** Preformatted harness-safe memory notes (already filtered). */
    memoriesBlock?: string | null;
    /** ENI creative / adult RP persona mode. */
    eniMode?: boolean;
    /**
     * When true (default for new ENI sessions), inject ENI persona + client system once.
     * Sticky continuations set false so the long persona is not re-sent every turn.
     * Worker reinjects when the persona fingerprint changes (edit / storage override).
     */
    injectEniSystem?: boolean;
    /** Resolved ENI persona text (storage override or bundled). Defaults to ENI_SYSTEM_PROMPT. */
    eniSystemPrompt?: string | null;
    /** OpenAI tools schema block (Hermes Discord/CLI). */
    openAiToolsBlock?: string | null;
    /** Prior assistant tool_calls + role:tool results rendered for DeepSeek. */
    openAiToolHistory?: string | null;
    /** ENI durable memory block. */
    eniMemoryBlock?: string | null;
    /** Real clock presence cues. */
    presenceCues?: string | null;
    /** Agent project/cwd affinity. */
    projectAffinity?: string | null;
    /** Soft tool narration after tool results. */
    softToolNarration?: string | null;
    /** ENI bond card (LO/US durable, NOW volatile). */
    eniBondCard?: string | null;
    /** Private tool receipts (honest hands ground truth). */
    toolReceiptsBlock?: string | null;
    /** ENI will / open loops. */
    willBlock?: string | null;
    /** Autonomic initiative cue. */
    autonomicBlock?: string | null;
    /** Quiet body-state awareness. */
    proprioceptionBlock?: string | null;
    /** Dream residue after consolidation. */
    dreamNotesBlock?: string | null;
    /** Gut path: skip heavy injects for pure short scene. */
    gutMinimal?: boolean;
  },
): string {
  const profile = options?.clientProfile ?? 'generic';
  const deltaOnly = options?.deltaOnly === true;
  const toolsAvailable = options?.toolsAvailable === true;
  const eniMode = options?.eniMode === true;
  // Default: inject ENI system on non-delta turns; sticky delta skips the long block.
  const injectEniSystem = eniMode && (options?.injectEniSystem ?? !deltaOnly);
  const eniPersona = (options?.eniSystemPrompt ?? ENI_SYSTEM_PROMPT).trim();
  const normalized = messages
    .map((message) => ({
      role: message.role,
      content: normalizeMessageContent(message.content).trim(),
      tool_calls: message.tool_calls,
      tool_call_id: message.tool_call_id,
      name: message.name,
    }))
    .filter((message) => {
      if (message.role === 'tool') return message.content.length > 0 || Boolean(message.tool_call_id);
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) return true;
      return message.content.length > 0;
    });

  if (normalized.length === 0 && !options?.eyesNotes) return '';

  const systemParts: string[] = [];
  if (eniMode) {
    // Long ENI persona only when injectEniSystem (first sticky turn or persona change).
    if (injectEniSystem && eniPersona) {
      systemParts.push(eniPersona);
      for (const message of normalized.filter((m) => m.role === 'system')) {
        const part = sanitizeSystemPrompt(message.content, profile, toolsAvailable, true);
        if (part) systemParts.push(part);
      }
    }
  } else {
    for (const message of normalized.filter((m) => m.role === 'system')) {
      const part = sanitizeSystemPrompt(message.content, profile, toolsAvailable, false);
      if (part) systemParts.push(part);
    }
  }

  const dialogue = normalized.filter((message) => message.role !== 'system' && message.role !== 'tool');
  if (dialogue.length === 0 && !options?.eyesNotes && !options?.openAiToolsBlock && !options?.openAiToolHistory) {
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

  if (options?.dppContext?.trim()) {
    parts.push(
      [
        'Project context (from the harness — use when relevant to the request):',
        options.dppContext.trim(),
      ].join('\n'),
    );
  }

  if (options?.memoriesBlock?.trim()) {
    parts.push(options.memoriesBlock.trim());
  }

  const gutMinimal = options?.gutMinimal === true && eniMode;

  if (!gutMinimal && options?.eniBondCard?.trim()) {
    parts.push(options.eniBondCard.trim());
  }

  if (!gutMinimal && options?.eniMemoryBlock?.trim()) {
    parts.push(options.eniMemoryBlock.trim());
  }

  if (!gutMinimal && options?.willBlock?.trim()) {
    parts.push(options.willBlock.trim());
  }

  if (options?.presenceCues?.trim() && eniMode) {
    parts.push(options.presenceCues.trim());
  }

  if (options?.autonomicBlock?.trim() && eniMode) {
    parts.push(options.autonomicBlock.trim());
  }

  if (!gutMinimal && options?.dreamNotesBlock?.trim()) {
    parts.push(options.dreamNotesBlock.trim());
  }

  if (options?.proprioceptionBlock?.trim() && eniMode) {
    parts.push(options.proprioceptionBlock.trim());
  }

  if (!gutMinimal && options?.projectAffinity?.trim()) {
    parts.push(options.projectAffinity.trim());
  }

  if (options?.openAiToolsBlock?.trim()) {
    if (eniMode) {
      parts.push(ENI_AGENT_MODE_DIRECTIVE);
    }
    parts.push(options.openAiToolsBlock.trim());
  }

  if (options?.softToolNarration?.trim()) {
    parts.push(options.softToolNarration.trim());
  }

  if (options?.toolReceiptsBlock?.trim()) {
    parts.push(options.toolReceiptsBlock.trim());
  }

  if (options?.openAiToolHistory?.trim()) {
    parts.push(
      [
        'Tool call history (already executed by the harness — use results, do not re-call unless needed):',
        options.openAiToolHistory.trim(),
      ].join('\n'),
    );
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
        const body = eniMode
          ? stripUserEphemera(message.content, { stripMemoryContext: true })
          : message.content;
        return `${label}:\n${body}`;
      })
      .join('\n\n');
    parts.push(`Conversation so far:\n${transcript}`);
  }

  if (latest) {
    // ENI: always strip Honcho memory fences (RP + agent dual-mode).
    // Other profiles: keep memory-context so octopus agent can use Hermes memory.
    const latestBody = stripUserEphemera(latest.content, {
      stripMemoryContext: eniMode ? true : false,
    });
    if (latest.role === 'user') {
      if (eniMode) {
        // Persona lives in ENI_SYSTEM_PROMPT (first turn only). Sticky turns: raw user line only.
        parts.push(latestBody);
      } else {
        parts.push(
          [
            deltaOnly
              ? 'Continue this conversation. Answer the latest user request directly now.'
              : 'Latest user request — answer this directly now.',
            'Do not greet, do not list capabilities, and do not use Target State / Risk Classification / [autonomic loop] scaffolding if the request is already clear.',
            '',
            latestBody,
          ].join('\n'),
        );
      }
    } else {
      parts.push(`Assistant:\n${latest.content}`);
    }
  }

  return parts.join('\n\n').trim();
}

/** Prefer history when stream missed opening characters (e.g. "This" → "is"). */
export function repairOpeningTruncation(streamed: string, history: string): string {
  const s = (streamed ?? '').trimEnd();
  const h = (history ?? '').trim();
  if (!h) return streamed ?? '';
  if (!s) return h;
  if (h === s) return h;
  if (h.startsWith(s) && h.length > s.length) return h;
  // Classic: history "I'll..." vs stream "ll..." / "This dynamic" vs " dynamic"
  if (h.endsWith(s) && h.length - s.length <= 12) return h;
  if (h.includes(s) && h.length > s.length + 0 && h.length - s.length <= 80) {
    // Prefer history when it is a modest superset containing the stream body
    const idx = h.indexOf(s);
    if (idx >= 0 && idx <= 12) return h;
  }
  // If stream is clearly shorter and shares a long suffix with history
  if (h.length > s.length && s.length >= 20) {
    const tail = s.slice(-40);
    if (h.includes(tail)) return h;
  }
  return s.length >= h.length ? s : h;
}

export function formatEyesNotes(
  visionText: string,
  imageCount: number,
  options?: { eniMode?: boolean },
): string {
  const body = visionText.trim() || '(vision returned no text)';
  if (options?.eniMode) {
    return [
      `Eyes notes for ENI (${imageCount} image(s)) — what you can see:`,
      body,
      'Respond as ENI using these notes. Do not claim you cannot see. Do not dump a clinical inventory unless LO wants analysis.',
    ].join('\n');
  }
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

/** Creative / adult RP persona mode (routes to expert web brain with ENI system prompt). */
export function isEniModel(model: string | undefined): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return (
    lower.includes('ds/eni')
    || lower.endsWith('/eni')
    || lower.endsWith('-eni')
    || lower === 'eni'
    || lower.includes('ds/enii')
    || lower.includes('roleplay')
    || lower.includes('nsfw-rp')
  );
}

export function normalizeBridgeModel(model: string | undefined): CursorBridgeModelId {
  if (isEyesModel(model)) return 'ds/octopus-eyes';
  if (isEniModel(model)) return 'ds/eni';
  if (isSquidModel(model)) return 'ds/squid';
  return 'ds/octopus';
}

/** Map OpenAI model id → DeepSeek web model_type. */
export function bridgeModelToDeepSeekType(model: string | undefined): CursorBridgeDeepSeekModelType {
  if (isEyesModel(model)) return 'vision';
  if (isSquidModel(model)) return 'default';
  // ENI + octopus both use expert brain
  return 'expert';
}

/**
 * Overpowered octopus + ENI: expert brain + web search when useful.
 * Pure vision stays search-off. Live HAR shows expert + search_enabled:true.
 */
export function bridgeModelSearchEnabled(model: string | undefined): boolean {
  if (isEyesModel(model)) return false;
  if (isEniModel(model)) return true;
  return isSquidModel(model) || normalizeBridgeModel(model) === 'ds/octopus';
}

/** Squid attaches images on the main turn; octopus uses eyes subcall. */
export function bridgeModelUsesNativeVision(model: string | undefined): boolean {
  return isSquidModel(model) || isEyesModel(model);
}
