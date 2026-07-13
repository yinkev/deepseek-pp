import type {
  ChatModelRef,
  ChatProviderAdapter,
  ProviderStatus,
} from '../chat/provider';
import type { QwenWebTransport } from './transport';

export interface QwenWebProviderAdapterDeps {
  transport: QwenWebTransport;
  getStatus: () => Promise<ProviderStatus>;
}

export function createQwenWebProviderAdapter(
  deps: QwenWebProviderAdapterDeps,
): ChatProviderAdapter {
  return {
    providerId: 'qwen-web',
    getStatus: deps.getStatus,
    listModels: () => [{
      ref: { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
      label: 'Qwen 3.7 Plus',
      supportsImages: true,
    }],
    async createSession(model) {
      assertQwenModel(model);
      const session = await deps.transport.createSession('qwen3.7-plus');
      return { conversationId: session.chatId, parentCursor: session.parentId };
    },
    async streamTurn(input, events) {
      assertQwenModel(input.model);
      let fullThinking = '';
      const turn = await deps.transport.streamTurn({
        session: {
          chatId: input.session.conversationId,
          parentId: input.session.parentCursor,
        },
        modelId: 'qwen3.7-plus',
        prompt: input.prompt,
        thinkingEnabled: input.thinkingEnabled,
        files: (input.attachments ?? [])
          .map((attachment) => attachment.providerData)
          .filter((file): file is Record<string, unknown> => Boolean(file)),
        signal: input.signal,
      }, {
        onTextChunk: events.onTextDelta,
        onThinking(text) {
          const delta = text.startsWith(fullThinking) ? text.slice(fullThinking.length) : text;
          fullThinking = text;
          if (delta) events.onThinkingDelta?.(delta, fullThinking);
        },
      });
      return {
        assistantText: turn.assistantText,
        thinkingText: turn.thinkingText,
        session: {
          conversationId: input.session.conversationId,
          parentCursor: turn.responseId,
        },
        finished: turn.finished,
      };
    },
  };
}

function assertQwenModel(model: ChatModelRef): void {
  if (model.providerId !== 'qwen-web' || model.modelId !== 'qwen3.7-plus') {
    throw new Error(`Unsupported Qwen model: ${model.providerId}/${model.modelId}`);
  }
}
