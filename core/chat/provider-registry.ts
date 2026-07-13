import { DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES } from '../deepseek/upload-limits';
import { QWEN_IMAGE_UPLOAD_MAX_BYTES } from '../qwen/upload-limits';
import type { ChatModelRef, ProviderModel } from './provider';

export const CHAT_MODELS: ProviderModel[] = [
  {
    ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
    label: 'DeepSeek',
    supportsImages: true,
    imageUploadMaxBytes: DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES,
  },
  {
    ref: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
    label: 'Qwen 3.7 Plus',
    supportsImages: true,
    imageUploadMaxBytes: QWEN_IMAGE_UPLOAD_MAX_BYTES,
  },
];

export function isSupportedChatModelRef(value: unknown): value is ChatModelRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return CHAT_MODELS.some((model) => (
    model.ref.providerId === record.providerId && model.ref.modelId === record.modelId
  ));
}

export function getChatImageUploadMaxBytes(ref: ChatModelRef): number {
  return CHAT_MODELS.find((model) => (
    model.ref.providerId === ref.providerId && model.ref.modelId === ref.modelId
  ))?.imageUploadMaxBytes ?? DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES;
}
