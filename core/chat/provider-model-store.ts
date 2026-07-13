import type { ChatModelRef } from './provider';
import { CHAT_MODELS, isSupportedChatModelRef } from './provider-registry';

export const ACTIVE_CHAT_MODEL_STORAGE_KEY = 'activeChatModelRef';

export async function getActiveChatModelRef(): Promise<ChatModelRef> {
  const data = await chrome.storage.local.get(ACTIVE_CHAT_MODEL_STORAGE_KEY);
  const stored = data[ACTIVE_CHAT_MODEL_STORAGE_KEY];
  return isSupportedChatModelRef(stored) ? stored : { ...CHAT_MODELS[0].ref };
}

export async function saveActiveChatModelRef(model: ChatModelRef): Promise<ChatModelRef> {
  const modelLabel = `${model.providerId}/${model.modelId}`;
  if (!isSupportedChatModelRef(model)) {
    throw new Error(`Unsupported chat model: ${modelLabel}`);
  }
  const stored = { ...model };
  await chrome.storage.local.set({ [ACTIVE_CHAT_MODEL_STORAGE_KEY]: stored });
  return stored;
}
