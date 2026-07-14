import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
  ACTIVE_CHAT_CONVERSATION_STORAGE_KEY,
  MAX_PERSISTED_CHAT_CHARACTERS,
  MAX_PERSISTED_CHAT_MESSAGES,
  loadActiveChatConversation,
  normalizeActiveChatConversation,
  saveActiveChatConversation,
} from '../core/chat/conversation-store';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(storage, value);
        }),
      },
    },
  });
});

describe('active provider conversation store', () => {
  it('rejects missing, malformed, unsupported, and unidentified records', () => {
    expect(normalizeActiveChatConversation(undefined)).toBeNull();
    expect(normalizeActiveChatConversation([])).toBeNull();
    expect(normalizeActiveChatConversation({
      schemaVersion: 99,
      logicalConversationId: 'conversation-1',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    })).toBeNull();
    expect(normalizeActiveChatConversation({
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: '   ',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    })).toBeNull();
  });

  it('keeps transcript metadata while stripping runtime attachment data', () => {
    expect(normalizeActiveChatConversation({
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: ' conversation-1 ',
      createdAt: 10,
      updatedAt: 20,
      messages: [
        {
          role: 'user',
          text: 'look at this',
          providerId: 'qwen-web',
          modelId: ' qwen3.7-plus ',
          attachments: [{
            kind: 'image',
            name: ' card.png ',
            mimeType: ' image/png ',
            previewUrl: 'blob:runtime-only',
            dataUrl: 'data:image/png;base64,secret',
            providerData: { token: 'not-for-storage' },
          }, {
            kind: 'audio',
            name: 'ignore.wav',
            mimeType: 'audio/wav',
          }],
        },
        {
          role: 'assistant',
          text: 'I can see it.',
          reasoningText: 'Inspected the image.',
          providerId: 'deepseek-web',
          modelId: 'deepseek-web',
        },
        { role: 'system', text: 'discard me' },
        { role: 'user', text: 42 },
      ],
    })).toEqual({
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: 'conversation-1',
      createdAt: 10,
      updatedAt: 20,
      messages: [
        {
          role: 'user',
          text: 'look at this',
          providerId: 'qwen-web',
          modelId: 'qwen3.7-plus',
          attachments: [{
            kind: 'image',
            name: 'card.png',
            mimeType: 'image/png',
          }],
        },
        {
          role: 'assistant',
          text: 'I can see it.',
          reasoningText: 'Inspected the image.',
          providerId: 'deepseek-web',
          modelId: 'deepseek-web',
        },
      ],
    });
  });

  it('retains only the newest bounded message suffix', () => {
    const messages = Array.from({ length: MAX_PERSISTED_CHAT_MESSAGES + 1 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `message-${index}`,
    }));

    const normalized = normalizeActiveChatConversation({
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: 'conversation-1',
      createdAt: 10,
      updatedAt: 20,
      messages,
    });

    expect(normalized?.messages).toHaveLength(MAX_PERSISTED_CHAT_MESSAGES);
    expect(normalized?.messages[0]?.text).toBe('message-1');
    expect(normalized?.messages.at(-1)?.text).toBe(`message-${MAX_PERSISTED_CHAT_MESSAGES}`);
  });

  it('caps combined text and reasoning while preserving the newest content', () => {
    const normalized = normalizeActiveChatConversation({
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: 'conversation-1',
      createdAt: 10,
      updatedAt: 20,
      messages: [
        { role: 'assistant', text: 'a'.repeat(600_000), reasoningText: 'old reasoning' },
        { role: 'user', text: 'b'.repeat(300_000) },
        { role: 'assistant', text: 'c'.repeat(300_000) },
      ],
    });

    const characterCount = normalized?.messages.reduce((sum, message) => (
      sum + message.text.length + (message.reasoningText?.length ?? 0)
    ), 0);
    expect(characterCount).toBe(MAX_PERSISTED_CHAT_CHARACTERS);
    expect(normalized?.messages[0]?.text).toHaveLength(400_000);
    expect(normalized?.messages[0]?.reasoningText).toBeUndefined();
    expect(normalized?.messages.at(-1)?.text).toBe('c'.repeat(300_000));
  });

  it('saves and reloads the normalized record at the stable storage key', async () => {
    const saved = await saveActiveChatConversation({
      logicalConversationId: 'conversation-1',
      createdAt: 10,
      updatedAt: 20,
      messages: [{
        role: 'user',
        text: 'persist me',
        attachments: [{
          kind: 'image',
          name: 'image.png',
          mimeType: 'image/png',
          previewUrl: 'blob:runtime-only',
        }],
      }],
    });

    expect(storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual(saved);
    expect(saved.messages[0]?.attachments?.[0]).toEqual({
      kind: 'image',
      name: 'image.png',
      mimeType: 'image/png',
    });
    await expect(loadActiveChatConversation()).resolves.toEqual({
      status: 'ok',
      conversation: saved,
    });
  });

  it('distinguishes absent storage from invalid or future records without rewriting storage', async () => {
    await expect(loadActiveChatConversation()).resolves.toEqual({ status: 'absent' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = {
      schemaVersion: 99,
      logicalConversationId: 'conversation-1',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    };
    await expect(loadActiveChatConversation()).resolves.toEqual({
      status: 'invalid',
      reason: 'unsupported_schema_version',
    });
    expect(storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual({
      schemaVersion: 99,
      logicalConversationId: 'conversation-1',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = {
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: 'conversation-1',
      messages: { not: 'an-array' },
      createdAt: 1,
      updatedAt: 2,
    };
    await expect(loadActiveChatConversation()).resolves.toEqual({
      status: 'invalid',
      reason: 'nested_corrupt_messages',
    });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    const nestedCorrupt = {
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: 'conversation-1',
      messages: [{ role: 'system', text: 'not a valid chat role' }],
      createdAt: 1,
      updatedAt: 2,
    };
    storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = nestedCorrupt;
    await expect(loadActiveChatConversation()).resolves.toEqual({
      status: 'invalid',
      reason: 'nested_corrupt_message_role',
    });
    expect(storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual(nestedCorrupt);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    const badAttachment = {
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: 'conversation-1',
      messages: [{
        role: 'user',
        text: 'hello',
        attachments: [{ kind: 'file', name: 'x', mimeType: 'text/plain' }],
      }],
      createdAt: 1,
      updatedAt: 2,
    };
    storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = badAttachment;
    await expect(loadActiveChatConversation()).resolves.toEqual({
      status: 'invalid',
      reason: 'nested_corrupt_attachment',
    });
    expect(storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual(badAttachment);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    const overMessages = {
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: 'conversation-over-messages',
      messages: Array.from({ length: MAX_PERSISTED_CHAT_MESSAGES + 1 }, (_, index) => ({
        role: 'user' as const,
        text: `m${index}`,
      })),
      createdAt: 1,
      updatedAt: 2,
    };
    storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = overMessages;
    await expect(loadActiveChatConversation()).resolves.toEqual({
      status: 'invalid',
      reason: 'over_message_budget',
    });
    expect(storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual(overMessages);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    const overCharacters = {
      schemaVersion: ACTIVE_CHAT_CONVERSATION_SCHEMA_VERSION,
      logicalConversationId: 'conversation-over-characters',
      messages: [{
        role: 'user' as const,
        text: 'x'.repeat(MAX_PERSISTED_CHAT_CHARACTERS + 1),
      }],
      createdAt: 1,
      updatedAt: 2,
    };
    storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY] = overCharacters;
    await expect(loadActiveChatConversation()).resolves.toEqual({
      status: 'invalid',
      reason: 'over_character_budget',
    });
    expect(storage[ACTIVE_CHAT_CONVERSATION_STORAGE_KEY]).toEqual(overCharacters);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
