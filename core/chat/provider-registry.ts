import type { ChatModelRef, ProviderModel } from './provider';

export const CHAT_MODELS: ProviderModel[] = [
  {
    ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
    label: 'DeepSeek',
    supportsImages: true,
  },
  {
    ref: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
    label: 'Qwen 3.7 Plus',
    supportsImages: true,
  },
];

export function isSupportedChatModelRef(value: unknown): value is ChatModelRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return CHAT_MODELS.some((model) => (
    model.ref.providerId === record.providerId && model.ref.modelId === record.modelId
  ));
}
