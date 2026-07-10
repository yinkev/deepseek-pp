import type {
  CursorBridgeError,
  CursorBridgeJobRequest,
  CursorBridgeReadiness,
} from './protocol';
import {
  detectClientProfile,
  extractImagesFromMessages,
  messagesToPrompt,
  modelThinkingEnabled,
  normalizeBridgeModel,
  normalizeMessageContent,
} from './protocol';
import {
  normalizeOpenAiTools,
  type OpenAiToolCall,
} from './openai-tools';

/** Engineering budgets for clients (not an official DeepSeek web guarantee). */
export const BRIDGE_MODEL_CONTEXT_LENGTH: Record<string, number> = {
  // Live chat.deepseek.com remote feature store (per-account):
  // model_configs[].file_feature.token_limit + normal_history_and_file_token_limit
  // Fallback in FE when config missing is 61440 — NOT the real window.
  'ds/octopus': 890880,
  'ds/octopus-eyes': 890880,
  'ds/squid': 890880,
  'ds/eni': 890880,
};

export function createModelsResponse(readiness: CursorBridgeReadiness) {
  const available = readiness.ready;
  const model = (id: string, contextLength: number) => ({
    id,
    object: 'model' as const,
    created: 0,
    owned_by: 'deepseek-pp-cursor-bridge',
    permission: [] as unknown[],
    root: id,
    parent: null,
    available,
    // OpenAI-ish + common agent fields
    context_length: contextLength,
    context_window: contextLength,
    max_model_len: contextLength,
    max_tokens: Math.min(8192, Math.floor(contextLength / 8)),
  });
  return {
    object: 'list',
    data: [
      model('ds/octopus', BRIDGE_MODEL_CONTEXT_LENGTH['ds/octopus']),
      model('ds/octopus-eyes', BRIDGE_MODEL_CONTEXT_LENGTH['ds/octopus-eyes']),
      model('ds/squid', BRIDGE_MODEL_CONTEXT_LENGTH['ds/squid']),
      model('ds/eni', BRIDGE_MODEL_CONTEXT_LENGTH['ds/eni']),
    ],
  };
}

export function parseChatCompletionsBody(
  body: unknown,
  jobId: string,
  now = Date.now(),
  clientHeader?: string | null,
  userAgent?: string | null,
): {
  job?: CursorBridgeJobRequest;
  error?: CursorBridgeError;
} {
  if (!body || typeof body !== 'object') {
    return { error: { code: 'invalid_request', message: 'Request body must be a JSON object.' } };
  }

  const record = body as Record<string, unknown>;
  const messagesRaw = record.messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
    return { error: { code: 'invalid_request', message: 'messages must be a non-empty array.' } };
  }

  const messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: OpenAiToolCall[];
    tool_call_id?: string;
    name?: string;
  }> = [];
  for (const item of messagesRaw) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') continue;
    const content = normalizeMessageContent((item as { content?: unknown }).content).trim();
    const rec = item as Record<string, unknown>;
    if (role === 'tool') {
      messages.push({
        role: 'tool',
        content: content || '(empty tool result)',
        tool_call_id: typeof rec.tool_call_id === 'string' ? rec.tool_call_id : undefined,
        name: typeof rec.name === 'string' ? rec.name : undefined,
      });
      continue;
    }
    let tool_calls: OpenAiToolCall[] | undefined;
    if (role === 'assistant' && Array.isArray(rec.tool_calls)) {
      tool_calls = rec.tool_calls
        .map((tc, index) => {
          if (!tc || typeof tc !== 'object') return null;
          const t = tc as Record<string, unknown>;
          const fn = t.function && typeof t.function === 'object'
            ? (t.function as Record<string, unknown>)
            : null;
          if (!fn || typeof fn.name !== 'string') return null;
          return {
            id: typeof t.id === 'string' ? t.id : `call_${index}`,
            type: 'function' as const,
            function: {
              name: fn.name,
              arguments: typeof fn.arguments === 'string'
                ? fn.arguments
                : JSON.stringify(fn.arguments ?? {}),
            },
          };
        })
        .filter((x): x is OpenAiToolCall => Boolean(x));
      if (tool_calls.length === 0) tool_calls = undefined;
    }
    // Keep messages that only contain images (empty text) as empty user markers for history.
    if (!content && role !== 'user' && !tool_calls) continue;
    messages.push({
      role,
      content: content || (tool_calls ? '' : '(image attached)'),
      tool_calls,
    });
  }

  if (messages.length === 0) {
    return { error: { code: 'invalid_request', message: 'No valid chat messages found.' } };
  }

  const openAiTools = normalizeOpenAiTools(record.tools);
  const images = extractImagesFromMessages(messagesRaw as Array<{ content?: unknown }>);
  const clientProfile = detectClientProfile(
    messages.filter((m) => m.role !== 'tool') as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    clientHeader,
    userAgent,
  );
  const prompt = messagesToPrompt(
    messages.filter((m) => m.role !== 'tool') as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    { clientProfile },
  );
  if (!prompt && images.length === 0 && openAiTools.length === 0) {
    return { error: { code: 'invalid_request', message: 'Prompt is empty after normalizing messages.' } };
  }

  const model = normalizeBridgeModel(typeof record.model === 'string' ? record.model : undefined);
  const stream = record.stream === true;
  const thinkingEnabled =
    modelThinkingEnabled(typeof record.model === 'string' ? record.model : undefined)
    || (record.thinking === true)
    || (typeof record.thinking === 'object' && record.thinking !== null && (record.thinking as { type?: string }).type === 'enabled');

  const threadId =
    (typeof record.thread_id === 'string' && record.thread_id.trim())
    || (typeof record.threadId === 'string' && record.threadId.trim())
    || undefined;
  const resetThread =
    record.reset_thread === true
    || record.resetThread === true
    || record.new_session === true;

  const dppContextRaw =
    (typeof record.dpp_context === 'string' && record.dpp_context)
    || (typeof record.dppContext === 'string' && record.dppContext)
    || (record.metadata && typeof record.metadata === 'object'
      && typeof (record.metadata as { dpp_context?: string }).dpp_context === 'string'
      && (record.metadata as { dpp_context: string }).dpp_context)
    || '';
  const dppContext = typeof dppContextRaw === 'string' && dppContextRaw.trim()
    ? dppContextRaw.trim().slice(0, 12_000)
    : undefined;

  const forceTools =
    record.force_tools === true
    || record.forceTools === true;
  const conversationHintRaw =
    (typeof record.conversation_id === 'string' && record.conversation_id)
    || (typeof record.conversationId === 'string' && record.conversationId)
    || (typeof record.session_id === 'string' && record.session_id)
    || (typeof record.sessionId === 'string' && record.sessionId)
    || (record.metadata && typeof record.metadata === 'object'
      && typeof (record.metadata as { conversation_id?: string }).conversation_id === 'string'
      && (record.metadata as { conversation_id: string }).conversation_id)
    || '';
  const conversationHint = typeof conversationHintRaw === 'string' && conversationHintRaw.trim()
    ? conversationHintRaw.trim().slice(0, 128)
    : undefined;

  const accountIdRaw =
    (typeof record.account_id === 'string' && record.account_id)
    || (typeof record.accountId === 'string' && record.accountId)
    || (record.metadata && typeof record.metadata === 'object'
      && typeof (record.metadata as { account_id?: string }).account_id === 'string'
      && (record.metadata as { account_id: string }).account_id)
    || '';
  const accountId = typeof accountIdRaw === 'string' && accountIdRaw.trim()
    ? accountIdRaw.trim().slice(0, 64)
    : undefined;

  return {
    job: {
      id: jobId,
      model,
      messages,
      stream,
      thinkingEnabled,
      createdAt: now,
      clientProfile,
      images: images.length > 0 ? images : undefined,
      threadId: threadId || undefined,
      resetThread: resetThread || undefined,
      dppContext,
      forceTools: forceTools || undefined,
      conversationHint,
      openAiTools: openAiTools.length > 0 ? openAiTools : undefined,
      accountId,
    },
  };
}

export function createNonStreamCompletion(
  model: string,
  text: string,
  id: string,
  created: number,
  toolCalls?: OpenAiToolCall[],
) {
  const hasTools = Boolean(toolCalls && toolCalls.length > 0);
  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: hasTools
          ? { role: 'assistant', content: text || null, tool_calls: toolCalls }
          : { role: 'assistant', content: text },
        finish_reason: hasTools ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function createStreamChunk(model: string, id: string, created: number, delta: string, finishReason: string | null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta: finishReason ? {} : { content: delta },
        finish_reason: finishReason,
      },
    ],
  };
}

export function createErrorResponse(error: CursorBridgeError, status = 503) {
  return {
    status,
    body: {
      error: {
        message: error.message,
        type: error.code,
        code: error.code,
      },
    },
  };
}

export function readinessToError(readiness: CursorBridgeReadiness): CursorBridgeError {
  if (readiness.busy) {
    return { code: 'busy', message: 'DeepSeek++ cursor bridge is busy with another request.' };
  }
  if (!readiness.extensionAlive) {
    return {
      code: 'not_ready',
      message: 'DeepSeek++ extension is not connected to the cursor bridge host. Open Chrome with the extension loaded.',
    };
  }
  if (!readiness.hasLogin) {
    return {
      code: 'missing_login',
      message: 'DeepSeek login token is missing. Sign in at chat.deepseek.com once so the extension can cache your login, then retry.',
    };
  }
  return {
    code: 'not_ready',
    message: readiness.reason ?? 'Cursor bridge is not ready.',
  };
}
