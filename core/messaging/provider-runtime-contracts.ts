import type {
  ChatModelRef,
  ProviderAttachment,
  ProviderModel,
  ProviderStatus,
} from '../chat/provider';

type AckFailure = { ok: false; error: string };

export interface CursorBridgeStatus {
  threadCount: number;
  eyesCacheCount: number;
  lastError: string | null;
  lastModel: string | null;
  lastThreadId: string | null;
  lastSessionUrl: string | null;
  stickyHits: number;
  stickyMisses: number;
  eyesCacheHits: number;
  lastPromptChars: number | null;
  lastSticky: 'hit' | 'miss' | null;
  lastStreamDebug: unknown | null;
}

export interface ProviderChatImageUploadPayload {
  model: ChatModelRef;
  dataUrl: string;
  name?: string;
  mimeType?: string;
  type?: string;
  sizeBytes?: number;
  size?: number;
}

export interface EncodedProviderImageUploadRequest {
  isPlainObject: boolean;
  dataUrl: unknown;
  name: unknown;
  mimeType: unknown;
  alternateMimeType: unknown;
  sizeBytes: unknown;
  alternateSizeBytes: unknown;
}

export interface ChatCatalogProviderStatus extends ProviderStatus {
  providerId: ChatModelRef['providerId'];
}

export interface ProviderRuntimeCommandContracts {
  UPLOAD_CHAT_IMAGE: {
    request: { type: 'UPLOAD_CHAT_IMAGE'; payload: ProviderChatImageUploadPayload };
    response: { ok: true; attachment: ProviderAttachment } | AckFailure;
  };
  GET_CHAT_CATALOG: {
    request: { type: 'GET_CHAT_CATALOG' };
    response: {
      ok: true;
      models: ProviderModel[];
      activeModel: ChatModelRef;
      statuses: ChatCatalogProviderStatus[];
    };
  };
  SET_ACTIVE_CHAT_MODEL: {
    request: { type: 'SET_ACTIVE_CHAT_MODEL'; payload: { model: ChatModelRef } };
    response: { ok: true; model: ChatModelRef } | AckFailure;
  };
  GET_CURSOR_BRIDGE_STATUS: {
    request: { type: 'GET_CURSOR_BRIDGE_STATUS' };
    response: { ok: true; status: CursorBridgeStatus };
  };
}
