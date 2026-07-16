import type { ChatModelRef, ProviderAttachment } from '../chat/provider';
import { isSupportedChatModelRef } from '../chat/provider-registry';
import type {
  EncodedProviderImageUploadRequest,
  ProviderRuntimeCommandContracts,
} from './provider-runtime-contracts';
import { isPlainRuntimeRecord } from './runtime-boundary';

type ProviderRuntimeCommandType = keyof ProviderRuntimeCommandContracts;

export interface DecodedProviderImageUploadRequest {
  model: unknown;
  image: EncodedProviderImageUploadRequest;
}

export interface MaterializedProviderImageUploadRequest {
  file: Blob;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DecodedProviderChatSubmitRequest {
  text: string;
  model: ChatModelRef;
  logicalConversationId: string;
  streamTargetId?: string;
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  refFileIds: string[];
  attachments: ProviderAttachment[];
  config: unknown;
}

export type ProviderChatSubmitPayloadClassification =
  | { kind: 'legacy' }
  | { kind: 'invalid'; error: string }
  | { kind: 'provider'; request: DecodedProviderChatSubmitRequest };

interface DecodedProviderRuntimePayloads {
  UPLOAD_CHAT_IMAGE: DecodedProviderImageUploadRequest;
  SET_ACTIVE_CHAT_MODEL: { model: ChatModelRef | null };
}

export type ProviderRuntimePayloadCommandType = keyof DecodedProviderRuntimePayloads;

export type ProviderRuntimeDecodedPayload<
  TType extends ProviderRuntimePayloadCommandType,
> = DecodedProviderRuntimePayloads[TType];

type ProviderRuntimePayloadDecoderMap = {
  [TType in ProviderRuntimePayloadCommandType]: (
    value: unknown,
  ) => ProviderRuntimeDecodedPayload<TType>;
};

export const PROVIDER_RUNTIME_PAYLOAD_DECODERS: ProviderRuntimePayloadDecoderMap = {
  UPLOAD_CHAT_IMAGE(value) {
    const payload = isPlainRuntimeRecord(value) ? value : {};
    return {
      model: payload.model,
      image: stageProviderImageUpload(value),
    };
  },
  SET_ACTIVE_CHAT_MODEL(value) {
    const payload = isPlainRuntimeRecord(value) ? value : {};
    return {
      model: isSupportedChatModelRef(payload.model) ? payload.model : null,
    };
  },
};

export function decodeProviderRuntimePayload<
  TType extends ProviderRuntimePayloadCommandType,
>(
  type: TType,
  value: unknown,
): ProviderRuntimeDecodedPayload<TType> {
  return PROVIDER_RUNTIME_PAYLOAD_DECODERS[type](value);
}

export function classifyProviderChatSubmitPayload(
  value: unknown,
): ProviderChatSubmitPayloadClassification {
  if (!isPlainRuntimeRecord(value)) return { kind: 'legacy' };
  const providerShaped = Object.hasOwn(value, 'model')
    || Object.hasOwn(value, 'logicalConversationId')
    || Object.hasOwn(value, 'streamTargetId')
    || Object.hasOwn(value, 'transcript')
    || Object.hasOwn(value, 'attachments');
  if (!providerShaped) return { kind: 'legacy' };
  if (!isSupportedChatModelRef(value.model)) {
    return { kind: 'invalid', error: 'unsupported_chat_model' };
  }
  if (
    typeof value.logicalConversationId !== 'string'
    || !value.logicalConversationId.trim()
  ) {
    return { kind: 'invalid', error: 'invalid_logical_conversation_id' };
  }
  if (
    typeof value.text !== 'string'
    || (
      value.streamTargetId !== undefined
      && (
        typeof value.streamTargetId !== 'string'
        || !value.streamTargetId.trim()
      )
    )
  ) {
    return { kind: 'invalid', error: 'invalid_provider_chat_request' };
  }
  const transcript = decodeProviderTranscript(value.transcript);
  const refFileIds = decodeProviderRefFileIds(value.refFileIds);
  const attachments = decodeProviderAttachments(value.attachments);
  if (!transcript || !refFileIds || !attachments) {
    return { kind: 'invalid', error: 'invalid_provider_chat_request' };
  }
  if (
    value.model.providerId === 'qwen-web'
    && (
      refFileIds.length > 0
      || attachments.some((attachment) => (
        !isQwenProviderData(attachment.providerData)
      ))
    )
  ) {
    return { kind: 'invalid', error: 'invalid_provider_chat_request' };
  }
  if (
    value.model.providerId === 'deepseek-web'
    && attachments.some((attachment) => !attachment.providerFileId?.trim())
  ) {
    return { kind: 'invalid', error: 'invalid_provider_chat_request' };
  }
  return {
    kind: 'provider',
    request: {
      text: value.text,
      model: value.model,
      logicalConversationId: value.logicalConversationId.trim(),
      ...(value.streamTargetId === undefined
        ? {}
        : { streamTargetId: value.streamTargetId.trim() }),
      transcript,
      refFileIds,
      attachments,
      config: value.config,
    },
  };
}

function decodeProviderTranscript(
  value: unknown,
): DecodedProviderChatSubmitRequest['transcript'] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const transcript: DecodedProviderChatSubmitRequest['transcript'] = [];
  for (const item of value) {
    if (!isPlainRuntimeRecord(item)) return null;
    if (item.role !== 'user' && item.role !== 'assistant') return null;
    if (typeof item.content !== 'string' || !item.content.trim()) return null;
    transcript.push({ role: item.role, content: item.content });
  }
  return transcript;
}

function decodeProviderRefFileIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const refFileIds: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) return null;
    refFileIds.push(item.trim());
  }
  return refFileIds;
}

function isQwenProviderData(
  value: ProviderAttachment['providerData'],
): boolean {
  return Boolean(
    value
    && typeof value.id === 'string'
    && value.id.trim()
    && value.type === 'image',
  );
}

function decodeProviderAttachments(value: unknown): ProviderAttachment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const attachments: ProviderAttachment[] = [];
  for (const item of value) {
    if (!isPlainRuntimeRecord(item)) return null;
    if (
      typeof item.id !== 'string'
      || !item.id.trim()
      || typeof item.name !== 'string'
      || !item.name.trim()
      || typeof item.mimeType !== 'string'
      || !item.mimeType.trim()
      || (
        item.providerFileId !== undefined
        && (
          typeof item.providerFileId !== 'string'
          || !item.providerFileId.trim()
        )
      )
      || (
        item.dataUrl !== undefined
        && (typeof item.dataUrl !== 'string' || !item.dataUrl.trim())
      )
      || (item.providerData !== undefined && !isPlainRuntimeRecord(item.providerData))
    ) return null;
    attachments.push({
      id: item.id.trim(),
      name: item.name.trim(),
      mimeType: item.mimeType.trim(),
      ...(item.providerFileId === undefined
        ? {}
        : { providerFileId: item.providerFileId.trim() }),
      ...(item.dataUrl === undefined ? {} : { dataUrl: item.dataUrl.trim() }),
      ...(item.providerData === undefined
        ? {}
        : { providerData: item.providerData }),
    });
  }
  return attachments;
}

export function stageProviderImageUpload(
  value: unknown,
): EncodedProviderImageUploadRequest {
  if (!isPlainRuntimeRecord(value)) {
    return {
      isPlainObject: false,
      dataUrl: undefined,
      name: undefined,
      mimeType: undefined,
      alternateMimeType: undefined,
      sizeBytes: undefined,
      alternateSizeBytes: undefined,
    };
  }
  return {
    isPlainObject: true,
    dataUrl: value.dataUrl,
    name: value.name,
    mimeType: value.mimeType,
    alternateMimeType: value.type,
    sizeBytes: value.sizeBytes,
    alternateSizeBytes: value.size,
  };
}

export function materializeProviderImageUpload(
  staged: EncodedProviderImageUploadRequest,
  maxBytes: number,
): MaterializedProviderImageUploadRequest {
  if (!staged.isPlainObject) {
    throw new Error('UPLOAD_CHAT_IMAGE.payload must be a plain object.');
  }
  const dataUrl = typeof staged.dataUrl === 'string' ? staged.dataUrl : '';
  const name = typeof staged.name === 'string' && staged.name.trim()
    ? staged.name.trim()
    : 'image';
  const mimeType = typeof staged.mimeType === 'string' && staged.mimeType.trim()
    ? staged.mimeType.trim()
    : typeof staged.alternateMimeType === 'string' && staged.alternateMimeType.trim()
      ? staged.alternateMimeType.trim()
      : '';
  const sizeBytes = typeof staged.sizeBytes === 'number' && Number.isFinite(staged.sizeBytes)
    ? staged.sizeBytes
    : typeof staged.alternateSizeBytes === 'number' && Number.isFinite(staged.alternateSizeBytes)
      ? staged.alternateSizeBytes
      : 0;

  if (!dataUrl.startsWith('data:')) {
    throw new Error('Image upload payload must include a data URL.');
  }
  if (!mimeType.startsWith('image/')) {
    throw new Error(`${name} is not an image file.`);
  }
  if (sizeBytes <= 0) throw new Error(`${name} is empty.`);
  if (sizeBytes > maxBytes) {
    throw new Error(`${name} exceeds the ${formatUploadBytes(maxBytes)} image upload limit.`);
  }

  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    const separator = dataUrl.indexOf(',');
    const actualMimeType = /^data:([^;,]+)/.exec(
      dataUrl.slice(0, Math.max(separator, 0)),
    )?.[1];
    if (actualMimeType && actualMimeType !== mimeType) {
      throw new Error(`Image MIME type changed from ${mimeType} to ${actualMimeType}.`);
    }
    throw new Error('Image upload payload must be base64 encoded.');
  }

  const base64 = dataUrl.slice(prefix.length);
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (base64.length > maxEncodedLength) {
    throw new Error(`${name} exceeds the ${formatUploadBytes(maxBytes)} image upload limit.`);
  }
  const expectedEncodedLength = Math.ceil(sizeBytes / 3) * 4;
  if (base64.length !== expectedEncodedLength) {
    throw new Error('Image upload payload size changed during transfer.');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error('Image upload payload must be base64 encoded.');
  }

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const actualBytes = (base64.length / 4) * 3 - padding;
  if (actualBytes !== sizeBytes) {
    throw new Error('Image upload payload size changed during transfer.');
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return {
    file: new Blob([bytes], { type: mimeType }),
    name,
    mimeType,
    sizeBytes,
  };
}

function formatUploadBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

type _AllProviderRuntimePayloadCommandsAreDecoded = Exclude<
  ProviderRuntimePayloadCommandType,
  ProviderRuntimeCommandType
> extends never ? true : never;

const _allProviderRuntimePayloadCommandsAreDecoded: _AllProviderRuntimePayloadCommandsAreDecoded = true;
void _allProviderRuntimePayloadCommandsAreDecoded;
