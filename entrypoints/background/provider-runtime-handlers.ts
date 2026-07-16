import type {
  ChatModelRef,
  ProviderId,
  ProviderModel,
  ProviderStatus,
} from '../../core/chat/provider';
import type {
  CursorBridgeStatus,
  EncodedProviderImageUploadRequest,
} from '../../core/messaging/provider-runtime-contracts';
import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import { defineProviderPayloadRuntimeCommandHandler } from './runtime-handler';

export interface ProviderRuntimeHandlerDependencies {
  getModels(): Promise<readonly ProviderModel[]>;
  getCursorBridgeStatus(): Promise<CursorBridgeStatus>;
  refreshProviderAuth(
    providerId: ProviderId,
    preferredTabId?: number,
  ): Promise<unknown>;
  getProviderStatus(providerId: ChatModelRef['providerId']): Promise<ProviderStatus>;
  getActiveModel(): Promise<ChatModelRef>;
  saveActiveModel(model: ChatModelRef): Promise<ChatModelRef>;
  uploadImage(
    request: { model: unknown; image: EncodedProviderImageUploadRequest },
    excludeTabId?: number,
  ): Promise<
    | { ok: true; attachment: import('../../core/chat/provider').ProviderAttachment }
    | { ok: false; error: string }
  >;
}

export function createProviderRuntimeHandlers(
  dependencies: ProviderRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  let activeModelSaveChain = Promise.resolve();

  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_CURSOR_BRIDGE_STATUS', async () => ({
      ok: true,
      status: await dependencies.getCursorBridgeStatus(),
    })),
    defineProviderPayloadRuntimeCommandHandler('UPLOAD_CHAT_IMAGE', (payload, context) => (
      dependencies.uploadImage({ model: payload.model, image: payload.image }, context.tabId)
    )),
    definePayloadlessRuntimeCommandHandler('GET_CHAT_CATALOG', async (context) => {
      const modelsPromise = dependencies.getModels();
      const activeModelPromise = dependencies.getActiveModel();
      const models = [...await modelsPromise];
      const providerIds = [...new Set(models.map((model) => model.ref.providerId))];
      const statuses = await Promise.all(providerIds.map(async (providerId) => {
        try {
          await dependencies.refreshProviderAuth(providerId, context.tabId);
          return {
            providerId,
            ...await dependencies.getProviderStatus(providerId),
          };
        } catch (error) {
          return {
            providerId,
            available: false,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }));
      return {
        ok: true,
        models,
        activeModel: await activeModelPromise,
        statuses,
      };
    }),
    defineProviderPayloadRuntimeCommandHandler('SET_ACTIVE_CHAT_MODEL', async (payload) => {
      const model = payload.model;
      if (!model) return { ok: false as const, error: 'unsupported_chat_model' };
      const operation = activeModelSaveChain.then(() => (
        dependencies.saveActiveModel(model)
      ));
      activeModelSaveChain = operation.then(() => undefined, () => undefined);
      return { ok: true, model: await operation };
    }),
  ]);
}
