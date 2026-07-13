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

let writeQueue: Promise<void> = Promise.resolve();

export async function loadActiveChatConversation(): Promise<PersistedChatConversation | null> {
  await writeQueue;
  const data = await chrome.storage.local.get(ACTIVE_CHAT_CONVERSATION_STORAGE_KEY) as Record<string, unknown>;
  return normalizeActiveChatConversation(data[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]);
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
  return {
    ...message,
    text,
    ...(reasoningText ? { reasoningText } : { reasoningText: undefined }),
  };
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
