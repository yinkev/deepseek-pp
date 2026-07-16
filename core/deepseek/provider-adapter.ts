import type {
  ChatModelRef,
  ChatProviderAdapter,
} from '../chat/provider';
import {
  createChatSession,
  createPowHeaders,
  submitPromptStreaming,
} from './adapter';

export interface DeepSeekWebProviderAdapterDeps {
  loadClientHeaders: () => Promise<Record<string, string> | null>;
  createSession?: typeof createChatSession;
  createPow?: typeof createPowHeaders;
  submitStreaming?: typeof submitPromptStreaming;
  modelType?: string | null;
  loadModelType?: () => Promise<string | null>;
}

export function createDeepSeekWebProviderAdapter(
  deps: DeepSeekWebProviderAdapterDeps,
): ChatProviderAdapter {
  const createSession = deps.createSession ?? createChatSession;
  const createPow = deps.createPow ?? createPowHeaders;
  const submitStreaming = deps.submitStreaming ?? submitPromptStreaming;

  return {
    providerId: 'deepseek-web',
    async getStatus() {
      return { available: Boolean((await deps.loadClientHeaders())?.Authorization) };
    },
    listModels: () => [{
      ref: { providerId: 'deepseek-web', modelId: 'deepseek-web' },
      label: 'DeepSeek',
      supportsImages: true,
    }],
    async createSession(model, signal) {
      assertDeepSeekModel(model);
      const headers = await requireHeaders(deps.loadClientHeaders);
      signal?.throwIfAborted();
      return {
        conversationId: await createSession(headers, signal),
        parentCursor: null,
      };
    },
    async streamTurn(input, events) {
      assertDeepSeekModel(input.model);
      const headers = await requireHeaders(deps.loadClientHeaders);
      const parentMessageId = parseDeepSeekParentCursor(input.session.parentCursor);
      const modelType = deps.loadModelType ? await deps.loadModelType() : deps.modelType ?? null;
      const turn = await submitStreaming({
        chatSessionId: input.session.conversationId,
        parentMessageId,
        modelType,
        prompt: input.prompt,
        refFileIds: (input.attachments ?? [])
          .map((attachment) => attachment.providerFileId)
          .filter((id): id is string => Boolean(id)),
        thinkingEnabled: input.thinkingEnabled,
        searchEnabled: false,
        clientHeaders: headers,
        powHeaders: await createPow(headers, undefined, input.signal),
      }, {
        onTextChunk: events.onTextDelta,
      }, input.signal);
      return {
        assistantText: turn.assistantText,
        thinkingText: '',
        session: {
          conversationId: input.session.conversationId,
          parentCursor: turn.responseMessageId === null ? null : String(turn.responseMessageId),
        },
        finished: turn.finished,
      };
    },
  };
}

function parseDeepSeekParentCursor(cursor: string | null): number | null {
  if (cursor === null) return null;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid DeepSeek parent cursor: ${cursor}`);
  }
  return value;
}

async function requireHeaders(
  loadClientHeaders: () => Promise<Record<string, string> | null>,
): Promise<Record<string, string>> {
  const headers = await loadClientHeaders();
  if (!headers?.Authorization) throw new Error('DeepSeek login token is missing.');
  return headers;
}

function assertDeepSeekModel(model: ChatModelRef): void {
  if (model.providerId !== 'deepseek-web' || model.modelId !== 'deepseek-web') {
    throw new Error(`Unsupported DeepSeek model: ${model.providerId}/${model.modelId}`);
  }
}
