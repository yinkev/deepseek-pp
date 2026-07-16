import { normalizeOfficialApiChatConfig } from '../../core/chat/official-api-config';
import type { OfficialApiChatConfig } from '../../core/chat/official-api-config-contract';
import type { ChatModelRef, ProviderAttachment } from '../../core/chat/provider';
import { decodeDeepSeekRuntimePayload } from '../../core/messaging/deepseek-runtime-request-codec';
import { classifyProviderChatSubmitPayload } from '../../core/messaging/provider-runtime-request-codec';
import {
  definePayloadlessRuntimeCommandHandler,
  defineRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type { ChatRuntimeService } from './chat-runtime-service';
import { defineDeepSeekPayloadRuntimeCommandHandler } from './runtime-handler';

export interface ProviderChatSubmitCommandRequest {
  text: string;
  model: ChatModelRef;
  logicalConversationId: string;
  streamTargetId?: string;
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  refFileIds: string[];
  attachments: ProviderAttachment[];
  officialApiConfig?: OfficialApiChatConfig;
}

export interface ChatRuntimeHandlerDependencies {
  service: ChatRuntimeService;
  submitProvider(
    request: ProviderChatSubmitCommandRequest,
    excludeTabId?: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  getOfficialApiChatConfig(): Promise<OfficialApiChatConfig>;
  saveOfficialApiChatConfig(config: OfficialApiChatConfig): Promise<OfficialApiChatConfig>;
}

export function createChatRuntimeHandlers(
  dependencies: ChatRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    defineRuntimeCommandHandler({
      type: 'CHAT_SUBMIT_PROMPT',
      decode(message) {
        const classified = classifyProviderChatSubmitPayload(message.payload);
        if (classified.kind !== 'provider') {
          return classified.kind === 'legacy'
            ? {
                kind: 'legacy' as const,
                request: decodeDeepSeekRuntimePayload(
                  'CHAT_SUBMIT_PROMPT',
                  message.payload,
                ),
              }
            : classified;
        }
        return {
          kind: 'provider' as const,
          request: {
            text: classified.request.text,
            model: classified.request.model,
            logicalConversationId: classified.request.logicalConversationId,
            ...(classified.request.streamTargetId === undefined
              ? {}
              : { streamTargetId: classified.request.streamTargetId }),
            transcript: classified.request.transcript,
            refFileIds: classified.request.refFileIds,
            attachments: classified.request.attachments,
            ...(classified.request.config === undefined
              ? {}
              : {
                  officialApiConfig: normalizeOfficialApiChatConfig(
                    classified.request.config,
                  ),
                }),
          },
        };
      },
      handle(decoded, context) {
        if (decoded.kind === 'invalid') {
          return { ok: false as const, error: decoded.error };
        }
        return decoded.kind === 'provider'
          ? dependencies.submitProvider(decoded.request, context.tabId)
          : dependencies.service.submitPrompt(decoded.request, context.tabId);
      },
    }),
    defineDeepSeekPayloadRuntimeCommandHandler('UPLOAD_DEEPSEEK_IMAGE', (payload, context) => (
      dependencies.service.uploadImage(payload, context.tabId)
    )),
    definePayloadlessRuntimeCommandHandler('CHAT_NEW_SESSION', async () => {
      await dependencies.service.resetSession();
      return { ok: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('GET_OFFICIAL_API_CHAT_CONFIG', () => (
      dependencies.getOfficialApiChatConfig()
    )),
    defineDeepSeekPayloadRuntimeCommandHandler('SAVE_OFFICIAL_API_CHAT_CONFIG', (config) => (
      dependencies.saveOfficialApiChatConfig(config)
    )),
  ]);
}
