import type { ChatMessage } from '../types';

export const ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION = 1 as const;
export const ACTIVE_CHAT_CONVERSATION_STORAGE_KEY = 'deepseek_pp_active_chat_conversation';
export const MAX_PERSISTED_CHAT_MESSAGES = 200;
export const MAX_PERSISTED_CHAT_CHARACTERS = 1_000_000;

export interface PersistedChatAttachment {
  kind: 'image';
  name: string;
  mimeType: string;
}

export interface PersistedChatMessage {
  role: 'user' | 'assistant';
  text: string;
  reasoningText?: string;
  providerId?: 'deepseek-web' | 'qwen-web';
  modelId?: string;
  attachments?: PersistedChatAttachment[];
}

export interface PersistedChatConversation {
  schemaVersion: typeof ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION;
  logicalConversationId: string;
  messages: PersistedChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ActiveChatConversationInput {
  logicalConversationId: string;
  messages: readonly ChatMessage[];
  createdAt?: number;
  updatedAt?: number;
}

/** Distinguishes missing storage from a present but unusable record. */
export type LoadActiveChatConversationResult =
  | { status: 'absent' }
  | { status: 'ok'; conversation: PersistedChatConversation }
  | { status: 'invalid'; reason: string };

let writeQueue: Promise<void> = Promise.resolve();

export async function loadActiveChatConversation(): Promise<LoadActiveChatConversationResult> {
  await writeQueue;
  const data = await chrome.storage.local.get(ACTIVE_CHAT_CONVERSATION_STORAGE_KEY) as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(data, ACTIVE_CHAT_CONVERSATION_STORAGE_KEY)
    || data[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] === undefined) {
    return { status: 'absent' };
  }

  const raw = data[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY];
  const parsed = parseActiveChatConversationRecord(raw);
  if (!parsed.ok) {
    return { status: 'invalid', reason: parsed.reason };
  }
  return { status: 'ok', conversation: parsed.conversation };
}

export function saveActiveChatConversation(
  input: ActiveChatConversationInput,
): Promise<PersistedChatConversation> {
  const now = Date.now();
  const normalized = normalizeActiveChatConversation({
    schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
    logicalConversationId: input.logicalConversationId,
    messages: input.messages,
    createdAt: finiteTimestamp(input.createdAt) ?? now,
    updatedAt: finiteTimestamp(input.updatedAt) ?? now,
  });
  if (!normalized) {
    return Promise.reject(new Error('Active chat conversation is invalid.'));
  }

  const write = writeQueue.then(async () => {
    await chrome.storage.local.set({
      [ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]: normalized,
    });
    return normalized;
  });
  writeQueue = write.then(() => undefined, () => undefined);
  return write;
}

/**
 * Lossy normalizer for save paths and unit tests: filters invalid nested
 * messages/attachments and applies retention budgets. Prefer
 * parseActiveChatConversationRecord for load-time fail-closed decoding.
 */
export function normalizeActiveChatConversation(value: unknown): PersistedChatConversation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION) return null;

  const logicalConversationId = trimmedString(record.logicalConversationId);
  const createdAt = finiteTimestamp(record.createdAt);
  const updatedAt = finiteTimestamp(record.updatedAt);
  if (!logicalConversationId || createdAt === null || updatedAt === null) return null;

  return {
    schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
    logicalConversationId,
    messages: normalizeMessages(record.messages),
    createdAt,
    updatedAt,
  };
}

/**
 * Strict decoder for durable records. Present nested corruption fails closed
 * without filtering, truncation, or rewrite.
 */
export function parseActiveChatConversationRecord(
  value: unknown,
): { ok: true; conversation: PersistedChatConversation } | { ok: false; reason: string } {
  if (value === undefined || value === null) {
    return { ok: false, reason: 'missing_record' };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'malformed_record' };
  }

  const record = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'schemaVersion')) {
    return { ok: false, reason: 'missing_schema_version' };
  }
  if (record.schemaVersion !== ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION) {
    return { ok: false, reason: 'unsupported_schema_version' };
  }

  const logicalConversationId = trimmedString(record.logicalConversationId);
  const createdAt = finiteTimestamp(record.createdAt);
  const updatedAt = finiteTimestamp(record.updatedAt);
  if (!logicalConversationId || createdAt === null || updatedAt === null) {
    return { ok: false, reason: 'invalid_identity_or_timestamps' };
  }

  if (!Object.prototype.hasOwnProperty.call(record, 'messages')) {
    return { ok: false, reason: 'missing_messages' };
  }
  const decodedMessages = decodeMessagesStrict(record.messages);
  if (!decodedMessages.ok) {
    return decodedMessages;
  }
  if (decodedMessages.messages.length > MAX_PERSISTED_CHAT_MESSAGES) {
    return { ok: false, reason: 'over_message_budget' };
  }
  let totalCharacters = 0;
  for (const message of decodedMessages.messages) {
    totalCharacters += message.text.length + (message.reasoningText?.length ?? 0);
    if (totalCharacters > MAX_PERSISTED_CHAT_CHARACTERS) {
      return { ok: false, reason: 'over_character_budget' };
    }
  }

  return {
    ok: true,
    conversation: {
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId,
      messages: decodedMessages.messages,
      createdAt,
      updatedAt,
    },
  };
}

function decodeMessagesStrict(
  value: unknown,
): { ok: true; messages: PersistedChatMessage[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'nested_corrupt_messages' };
  }

  const messages: PersistedChatMessage[] = [];
  for (const item of value) {
    const decoded = decodeMessageStrict(item);
    if (!decoded.ok) return decoded;
    messages.push(decoded.message);
  }
  return { ok: true, messages };
}

function decodeMessageStrict(
  value: unknown,
): { ok: true; message: PersistedChatMessage } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'nested_corrupt_message' };
  }

  const message = value as Record<string, unknown>;
  if (message.role !== 'user' && message.role !== 'assistant') {
    return { ok: false, reason: 'nested_corrupt_message_role' };
  }
  if (typeof message.text !== 'string') {
    return { ok: false, reason: 'nested_corrupt_message_text' };
  }

  let reasoningText: string | undefined;
  if (Object.prototype.hasOwnProperty.call(message, 'reasoningText')) {
    if (typeof message.reasoningText !== 'string') {
      return { ok: false, reason: 'nested_corrupt_message_reasoning' };
    }
    if (message.reasoningText.length > 0) reasoningText = message.reasoningText;
  }

  let providerId: PersistedChatMessage['providerId'];
  if (Object.prototype.hasOwnProperty.call(message, 'providerId')) {
    if (message.providerId !== 'deepseek-web' && message.providerId !== 'qwen-web') {
      return { ok: false, reason: 'nested_corrupt_message_provider' };
    }
    providerId = message.providerId;
  }

  let modelId: string | undefined;
  if (Object.prototype.hasOwnProperty.call(message, 'modelId')) {
    if (typeof message.modelId !== 'string' || message.modelId.trim().length === 0) {
      return { ok: false, reason: 'nested_corrupt_message_model' };
    }
    modelId = message.modelId.trim();
  }

  let attachments: PersistedChatAttachment[] | undefined;
  if (Object.prototype.hasOwnProperty.call(message, 'attachments')) {
    const decodedAttachments = decodeAttachmentsStrict(message.attachments);
    if (!decodedAttachments.ok) return decodedAttachments;
    if (decodedAttachments.attachments.length > 0) {
      attachments = decodedAttachments.attachments;
    }
  }

  if (!message.text && !reasoningText && (!attachments || attachments.length === 0)) {
    return { ok: false, reason: 'nested_corrupt_message_empty' };
  }

  return {
    ok: true,
    message: {
      role: message.role,
      text: message.text,
      ...(reasoningText ? { reasoningText } : {}),
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(attachments ? { attachments } : {}),
    },
  };
}

function decodeAttachmentsStrict(
  value: unknown,
): { ok: true; attachments: PersistedChatAttachment[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) {
    return { ok: false, reason: 'nested_corrupt_attachments' };
  }

  const attachments: PersistedChatAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: 'nested_corrupt_attachment' };
    }
    const attachment = item as Record<string, unknown>;
    const name = trimmedString(attachment.name);
    const mimeType = trimmedString(attachment.mimeType);
    if (attachment.kind !== 'image' || !name || !mimeType) {
      return { ok: false, reason: 'nested_corrupt_attachment' };
    }
    attachments.push({ kind: 'image', name, mimeType });
  }
  return { ok: true, attachments };
}

function normalizeMessages(value: unknown): PersistedChatMessage[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map(normalizeMessage)
    .filter((message): message is PersistedChatMessage => message !== null)
    .slice(-MAX_PERSISTED_CHAT_MESSAGES);

  const selected: PersistedChatMessage[] = [];
  let remainingCharacters = MAX_PERSISTED_CHAT_CHARACTERS;
  for (let index = normalized.length - 1; index >= 0 && remainingCharacters > 0; index--) {
    const message = normalized[index];
    const characterCount = message.text.length + (message.reasoningText?.length ?? 0);
    if (characterCount <= remainingCharacters) {
      selected.push(message);
      remainingCharacters -= characterCount;
      continue;
    }
    selected.push(truncateMessage(message, remainingCharacters));
    remainingCharacters = 0;
  }
  return selected.reverse();
}

function normalizeMessage(value: unknown): PersistedChatMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.role !== 'user' && message.role !== 'assistant') return null;

  const text = typeof message.text === 'string' ? message.text : '';
  const reasoningText = typeof message.reasoningText === 'string' && message.reasoningText.length > 0
    ? message.reasoningText
    : undefined;
  const attachments = normalizeAttachments(message.attachments);
  if (!text && !reasoningText && attachments.length === 0) return null;

  const providerId = message.providerId === 'deepseek-web' || message.providerId === 'qwen-web'
    ? message.providerId
    : undefined;
  const modelId = trimmedString(message.modelId) ?? undefined;

  return {
    role: message.role,
    text,
    ...(reasoningText ? { reasoningText } : {}),
    ...(providerId ? { providerId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function normalizeAttachments(value: unknown): PersistedChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const attachment = item as Record<string, unknown>;
    const name = trimmedString(attachment.name);
    const mimeType = trimmedString(attachment.mimeType);
    if (attachment.kind !== 'image' || !name || !mimeType) return [];
    return [{ kind: 'image' as const, name, mimeType }];
  });
}

function truncateMessage(message: PersistedChatMessage, characters: number): PersistedChatMessage {
  const text = message.text.slice(0, characters);
  const reasoningCharacters = Math.max(0, characters - text.length);
  const reasoningText = reasoningCharacters > 0
    ? message.reasoningText?.slice(0, reasoningCharacters)
    : undefined;
  const truncated = {
    ...message,
    text,
  };
  if (reasoningText) truncated.reasoningText = reasoningText;
  else delete truncated.reasoningText;
  return truncated;
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
