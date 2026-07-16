import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderRuntimeHandlerDependencies } from '../entrypoints/background/provider-runtime-handlers';
import { createProviderRuntimeHandlers } from '../entrypoints/background/provider-runtime-handlers';
import {
  classifyProviderChatSubmitPayload,
  PROVIDER_RUNTIME_PAYLOAD_DECODERS,
} from '../core/messaging/provider-runtime-request-codec';
import type { RuntimeMessageContext } from '../core/messaging/runtime-boundary';
import type { RuntimeCommandHandler } from '../core/messaging/runtime-command-registry';
import {
  CHAT_MODELS,
  isSupportedChatModelRef,
} from '../core/chat/provider-registry';

const context: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'extension_context',
  senderUrl: 'chrome-extension://extension-id/sidepanel.html',
  senderOrigin: 'chrome-extension://extension-id',
  tabId: 17,
  documentSessionId: 'sidepanel-document-1',
};

describe('provider runtime handlers', () => {
  it('registers the four typed provider commands and two payload decoders', () => {
    const handlers = createProviderRuntimeHandlers(createDependencies());

    expect(handlers.map((handler) => handler.type)).toEqual([
      'GET_CURSOR_BRIDGE_STATUS',
      'UPLOAD_CHAT_IMAGE',
      'GET_CHAT_CATALOG',
      'SET_ACTIVE_CHAT_MODEL',
    ]);
    expect(Object.keys(PROVIDER_RUNTIME_PAYLOAD_DECODERS).sort()).toEqual([
      'SET_ACTIVE_CHAT_MODEL',
      'UPLOAD_CHAT_IMAGE',
    ]);
  });

  it('dispatches payloadless catalog and cursor status commands through dependencies', async () => {
    const dependencies = createDependencies();
    const handlers = createProviderRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, { type: 'GET_CURSOR_BRIDGE_STATUS' })).resolves.toEqual({
      ok: true,
      status: bridgeStatus(),
    });
    await expect(dispatch(handlers, { type: 'GET_CHAT_CATALOG' })).resolves.toEqual({
      ok: true,
      models: CHAT_MODELS,
      activeModel: CHAT_MODELS[0].ref,
      statuses: [
        { providerId: 'deepseek-web', available: true },
        { providerId: 'qwen-web', available: false, reason: 'missing_auth' },
      ],
    });
    expect(vi.mocked(dependencies.refreshProviderAuth).mock.calls).toEqual([
      ['deepseek-web', 17],
      ['qwen-web', 17],
    ]);
    expect(dependencies.getProviderStatus).toHaveBeenCalledTimes(2);
  });

  it('fails closed for malformed provider-shaped chat submissions', () => {
    expect(classifyProviderChatSubmitPayload({
      text: 'hello',
      model: { providerId: 'qwen-web', modelId: 'stale-model' },
      logicalConversationId: 'conversation-1',
    })).toEqual({ kind: 'invalid', error: 'unsupported_chat_model' });
    expect(classifyProviderChatSubmitPayload({
      text: 'hello',
      model: CHAT_MODELS[0].ref,
      logicalConversationId: '   ',
    })).toEqual({ kind: 'invalid', error: 'invalid_logical_conversation_id' });
    expect(classifyProviderChatSubmitPayload({
      text: 'hello',
      model: CHAT_MODELS[0].ref,
      logicalConversationId: 'conversation-1',
      transcript: { role: 'user', content: 'lost' },
    })).toEqual({ kind: 'invalid', error: 'invalid_provider_chat_request' });
    expect(classifyProviderChatSubmitPayload({
      text: 'hello',
      model: CHAT_MODELS[0].ref,
      logicalConversationId: 'conversation-1',
      attachments: [{ id: 'file-1', name: 'image.png' }],
    })).toEqual({ kind: 'invalid', error: 'invalid_provider_chat_request' });
    expect(classifyProviderChatSubmitPayload({
      text: 'hello',
      model: CHAT_MODELS[0].ref,
      logicalConversationId: 'conversation-1',
      refFileIds: ['file-1', 7],
    })).toEqual({ kind: 'invalid', error: 'invalid_provider_chat_request' });
    expect(classifyProviderChatSubmitPayload({
      text: 'legacy',
      refFileIds: ['file-1'],
    })).toEqual({ kind: 'legacy' });
    expect(classifyProviderChatSubmitPayload({
      text: '  provider prompt  ',
      model: CHAT_MODELS[1].ref,
      logicalConversationId: ' conversation-1 ',
      transcript: [],
    })).toEqual({
      kind: 'provider',
      request: {
        text: '  provider prompt  ',
        model: CHAT_MODELS[1].ref,
        logicalConversationId: 'conversation-1',
        transcript: [],
        refFileIds: [],
        attachments: [],
        config: undefined,
      },
    });
    expect(classifyProviderChatSubmitPayload({
      text: 'qwen image',
      model: CHAT_MODELS[1].ref,
      logicalConversationId: 'conversation-1',
      refFileIds: ['deepseek-file-id'],
    })).toEqual({ kind: 'invalid', error: 'invalid_provider_chat_request' });
    expect(classifyProviderChatSubmitPayload({
      text: 'qwen image',
      model: CHAT_MODELS[1].ref,
      logicalConversationId: 'conversation-1',
      attachments: [{
        id: 'file-1',
        name: 'image.png',
        mimeType: 'image/png',
        providerFileId: 'file-1',
      }],
    })).toEqual({ kind: 'invalid', error: 'invalid_provider_chat_request' });
    expect(classifyProviderChatSubmitPayload({
      text: 'qwen image',
      model: CHAT_MODELS[1].ref,
      logicalConversationId: 'conversation-1',
      attachments: [{
        id: 'file-1',
        name: 'image.png',
        mimeType: 'image/png',
        providerData: {},
      }],
    })).toEqual({ kind: 'invalid', error: 'invalid_provider_chat_request' });
  });

  it('keeps malformed and unsupported provider payloads in the domain-error family', async () => {
    const dependencies = createDependencies();
    const handlers = createProviderRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'SET_ACTIVE_CHAT_MODEL',
      payload: null,
    })).resolves.toEqual({ ok: false, error: 'unsupported_chat_model' });
    await expect(dispatch(handlers, {
      type: 'SET_ACTIVE_CHAT_MODEL',
      payload: { model: { providerId: 'other', modelId: 'unknown' } },
    })).resolves.toEqual({ ok: false, error: 'unsupported_chat_model' });
    vi.mocked(dependencies.uploadImage).mockResolvedValueOnce({
      ok: false,
      error: 'chat_disabled',
    });
    await expect(dispatch(handlers, {
      type: 'UPLOAD_CHAT_IMAGE',
      payload: 'not-an-object',
    })).resolves.toEqual({ ok: false, error: 'chat_disabled' });
    await expect(dispatch(handlers, {
      type: 'UPLOAD_CHAT_IMAGE',
      payload: { model: { providerId: 'other', modelId: 'unknown' } },
    })).resolves.toEqual({ ok: false, error: 'unsupported_chat_model' });

    expect(dependencies.saveActiveModel).not.toHaveBeenCalled();
    expect(dependencies.uploadImage).toHaveBeenCalledTimes(2);
  });

  it('wires the reset-owned upload signal through DeepSeek and Qwen transports', () => {
    const background = readFileSync('entrypoints/background.ts', 'utf8');
    expect(background).toMatch(/createPowHeadersForPath\([\s\S]*?upload\.signal[\s\S]*?uploadDeepSeekFile\([\s\S]*?upload\.signal\)/);
    expect(background).toMatch(/uploadQwenImage\(\{[\s\S]*?signal: upload\.signal/);
    expect(background).toContain('providerImageUploadCoordinator.resetSession()');
    expect(background).not.toContain("if (message.type === 'CHAT_SUBMIT_PROMPT')");
    expect(background).toMatch(/getChatCatalogModels[\s\S]*?supportsImages: false/);
    expect(background).toMatch(/executeLocalSkillImporterToolCall[\s\S]*?getRuntimeAuthorizationDescriptors[\s\S]*?refreshMcpServerDiscovery/);
  });

  it('decodes valid provider payloads once before invoking storage and upload operations', async () => {
    const dependencies = createDependencies();
    const handlers = createProviderRuntimeHandlers(dependencies);
    const model = CHAT_MODELS[1].ref;

    await expect(dispatch(handlers, {
      type: 'SET_ACTIVE_CHAT_MODEL',
      payload: { model },
    })).resolves.toEqual({ ok: true, model });
    await expect(dispatch(handlers, {
      type: 'UPLOAD_CHAT_IMAGE',
      payload: {
        model,
        dataUrl: 'data:image/png;base64,AQID',
        type: 'image/png',
        size: 3,
      },
    })).resolves.toEqual({
      ok: true,
      attachment: {
        id: 'provider-file-1',
        name: 'image.png',
        mimeType: 'image/png',
        providerFileId: 'provider-file-1',
      },
    });

    expect(dependencies.saveActiveModel).toHaveBeenCalledWith(model);
    expect(dependencies.uploadImage).toHaveBeenCalledWith({
      model,
      image: {
        isPlainObject: true,
        dataUrl: 'data:image/png;base64,AQID',
        name: undefined,
        mimeType: undefined,
        alternateMimeType: 'image/png',
        sizeBytes: undefined,
        alternateSizeBytes: 3,
      },
    }, 17);
  });

  it('deduplicates provider status and degrades one provider failure', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.getModels).mockResolvedValue([
      CHAT_MODELS[0],
      { ...CHAT_MODELS[0], label: 'DeepSeek duplicate' },
      CHAT_MODELS[1],
    ]);
    vi.mocked(dependencies.refreshProviderAuth).mockImplementation(async (providerId) => {
      if (providerId === 'qwen-web') throw new Error('Qwen refresh unavailable');
    });

    const result = await dispatch(
      createProviderRuntimeHandlers(dependencies),
      { type: 'GET_CHAT_CATALOG' },
    );

    expect(result).toMatchObject({
      ok: true,
      statuses: [
        { providerId: 'deepseek-web', available: true },
        {
          providerId: 'qwen-web',
          available: false,
          reason: 'Qwen refresh unavailable',
        },
      ],
    });
    expect(dependencies.getProviderStatus).toHaveBeenCalledTimes(1);
  });

  it('serializes active-model persistence in request arrival order', async () => {
    const first = deferred<(typeof CHAT_MODELS)[number]['ref']>();
    const second = deferred<(typeof CHAT_MODELS)[number]['ref']>();
    const dependencies = createDependencies();
    vi.mocked(dependencies.saveActiveModel)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const handlers = createProviderRuntimeHandlers(dependencies);

    const firstDispatch = dispatch(handlers, {
      type: 'SET_ACTIVE_CHAT_MODEL',
      payload: { model: CHAT_MODELS[1].ref },
    });
    const secondDispatch = dispatch(handlers, {
      type: 'SET_ACTIVE_CHAT_MODEL',
      payload: { model: CHAT_MODELS[0].ref },
    });
    await Promise.resolve();
    expect(dependencies.saveActiveModel).toHaveBeenCalledTimes(1);

    first.resolve(CHAT_MODELS[1].ref);
    await firstDispatch;
    await Promise.resolve();
    expect(dependencies.saveActiveModel).toHaveBeenCalledTimes(2);
    second.resolve(CHAT_MODELS[0].ref);
    await expect(secondDispatch).resolves.toEqual({
      ok: true,
      model: CHAT_MODELS[0].ref,
    });
  });

  it('keeps provider contracts independent of concrete implementations', () => {
    const contracts = readFileSync(
      'core/messaging/provider-runtime-contracts.ts',
      'utf8',
    );
    expect(contracts).not.toContain('cursor-bridge/thread-store');
    expect(contracts).not.toContain('deepseek-runtime-contracts');
  });
});

function createDependencies(): ProviderRuntimeHandlerDependencies {
  return {
    getModels: vi.fn(async () => CHAT_MODELS),
    getCursorBridgeStatus: vi.fn(async () => bridgeStatus()),
    refreshProviderAuth: vi.fn(async () => null),
    getProviderStatus: vi.fn(async (providerId) => (
      providerId === 'deepseek-web'
        ? { available: true }
        : { available: false, reason: 'missing_auth' }
    )),
    getActiveModel: vi.fn(async () => CHAT_MODELS[0].ref),
    saveActiveModel: vi.fn(async (model) => model),
    uploadImage: vi.fn(async (request) => (
      isSupportedChatModelRef(request.model)
        ? {
            ok: true as const,
            attachment: {
              id: 'provider-file-1',
              name: 'image.png',
              mimeType: 'image/png',
              providerFileId: 'provider-file-1',
            },
          }
        : { ok: false as const, error: 'unsupported_chat_model' }
    )),
  };
}

async function dispatch(
  handlers: readonly RuntimeCommandHandler[],
  message: { type: string; payload?: unknown },
): Promise<unknown> {
  const handler = handlers.find((candidate) => candidate.type === message.type);
  if (!handler) throw new Error(`Missing handler: ${message.type}`);
  return handler.handle(message, context);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function bridgeStatus() {
  return {
    threadCount: 1,
    eyesCacheCount: 2,
    lastError: null,
    lastModel: 'deepseek-web',
    lastThreadId: 'thread-1',
    lastSessionUrl: 'https://chat.deepseek.com/a/chat/s/thread-1',
    stickyHits: 3,
    stickyMisses: 1,
    eyesCacheHits: 4,
    lastPromptChars: 500,
    lastSticky: 'hit' as const,
    lastStreamDebug: null,
  };
}
