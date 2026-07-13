import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_CHAT_MODEL_STORAGE_KEY,
  getActiveChatModelRef,
  saveActiveChatModelRef,
} from '../core/chat/provider-model-store';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          storage = { ...storage, ...value };
        }),
      },
    },
  });
});

describe('active chat provider model', () => {
  it('defaults to DeepSeek and persists qwen3.7-plus', async () => {
    await expect(getActiveChatModelRef()).resolves.toEqual({
      providerId: 'deepseek-web',
      modelId: 'deepseek-web',
    });
    await saveActiveChatModelRef({ providerId: 'qwen-web', modelId: 'qwen3.7-plus' });
    expect(storage[ACTIVE_CHAT_MODEL_STORAGE_KEY]).toEqual({
      providerId: 'qwen-web',
      modelId: 'qwen3.7-plus',
    });
    await expect(getActiveChatModelRef()).resolves.toEqual(storage[ACTIVE_CHAT_MODEL_STORAGE_KEY]);
  });

  it('rejects models outside the internal catalog', async () => {
    await expect(saveActiveChatModelRef({
      providerId: 'qwen-web',
      modelId: 'invented-model',
    })).rejects.toThrow('Unsupported chat model');
  });
});
