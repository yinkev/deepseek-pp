import type { OfficialApiChatConfig } from '../chat/official-api-config';
import type { ChatModelRef, ChatProviderAdapter } from '../chat/provider';
import {
  submitOfficialDeepSeekStreaming,
  type OfficialDeepSeekMessage,
} from './official-api';

export interface DeepSeekOfficialProviderAdapterDeps {
  loadApiKey: () => Promise<string | null>;
  loadConfig: () => Promise<OfficialApiChatConfig>;
  submit?: typeof submitOfficialDeepSeekStreaming;
  randomUUID?: () => string;
}

export function createDeepSeekOfficialProviderAdapter(
  deps: DeepSeekOfficialProviderAdapterDeps,
): ChatProviderAdapter {
  const submit = deps.submit ?? submitOfficialDeepSeekStreaming;
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  const messagesBySession = new Map<string, OfficialDeepSeekMessage[]>();

  return {
    providerId: 'deepseek-web',
    async getStatus() {
      return { available: Boolean(await deps.loadApiKey()) };
    },
    listModels: () => [{
      ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
      label: 'DeepSeek',
      supportsImages: false,
    }],
    async createSession(model, signal) {
      assertDeepSeekModel(model);
      if (!await deps.loadApiKey()) throw new Error('DeepSeek API key is missing.');
      signal?.throwIfAborted();
      const conversationId = `deepseek-official:${randomUUID()}`;
      messagesBySession.set(conversationId, []);
      return { conversationId, parentCursor: null };
    },
    async streamTurn(input, events) {
      assertDeepSeekModel(input.model);
      const apiKey = await deps.loadApiKey();
      if (!apiKey) throw new Error('DeepSeek API key is missing.');
      const previous = messagesBySession.get(input.session.conversationId) ?? [];
      const messages: OfficialDeepSeekMessage[] = [
        ...previous,
        { role: 'user', content: input.prompt },
      ];
      const turn = await submit({
        apiKey,
        config: input.officialApiConfig ?? await deps.loadConfig(),
        messages,
      }, {
        onTextChunk: events.onTextDelta,
        onReasoningChunk: events.onThinkingDelta,
      }, input.signal);
      messagesBySession.set(input.session.conversationId, [
        ...messages,
        {
          role: 'assistant',
          content: turn.assistantText,
          ...(turn.reasoningText ? { reasoningContent: turn.reasoningText } : {}),
        },
      ]);
      const turnNumber = Number(input.session.parentCursor ?? '0') + 1;
      return {
        assistantText: turn.assistantText,
        thinkingText: turn.reasoningText,
        session: {
          conversationId: input.session.conversationId,
          parentCursor: String(turnNumber),
        },
        finished: turn.finished,
      };
    },
  };
}

function assertDeepSeekModel(model: ChatModelRef): void {
  if (model.providerId !== 'deepseek-web' || model.modelId !== 'deepseek-web') {
    throw new Error(`Unsupported DeepSeek model: ${model.providerId}/${model.modelId}`);
  }
}
