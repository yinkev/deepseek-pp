import type { OfficialApiChatConfig } from './official-api-config-contract';

export type ProviderId = 'deepseek-web' | 'qwen-web';

export interface ChatModelRef {
  providerId: ProviderId;
  modelId: string;
}

export interface ProviderModel {
  ref: ChatModelRef;
  label: string;
  supportsImages: boolean;
  imageUploadMaxBytes?: number;
}

export interface ProviderStatus {
  available: boolean;
  reason?: string;
}

export interface ProviderSession {
  conversationId: string;
  parentCursor: string | null;
}

export interface ProviderAttachment {
  id: string;
  name: string;
  mimeType: string;
  providerFileId?: string;
  providerData?: Record<string, unknown>;
  dataUrl?: string;
}

export interface ProviderTurnInput {
  model: ChatModelRef;
  session: ProviderSession;
  prompt: string;
  thinkingEnabled: boolean;
  attachments?: ProviderAttachment[];
  officialApiConfig?: OfficialApiChatConfig;
  signal?: AbortSignal;
}

export interface ProviderEvents {
  onTextDelta?: (text: string, fullText: string) => void;
  onThinkingDelta?: (text: string, fullText: string) => void;
}

export interface ProviderTurn {
  assistantText: string;
  thinkingText: string;
  session: ProviderSession;
  finished: boolean;
}

export interface ChatProviderAdapter {
  readonly providerId: ProviderId;
  getStatus(): Promise<ProviderStatus>;
  listModels(): ProviderModel[];
  createSession(model: ChatModelRef, signal?: AbortSignal): Promise<ProviderSession>;
  streamTurn(input: ProviderTurnInput, events: ProviderEvents): Promise<ProviderTurn>;
}
