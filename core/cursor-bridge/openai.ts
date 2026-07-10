import type { CursorBridgeError, CursorBridgeJobRequest, CursorBridgeReadiness } from './protocol';
import { messagesToPrompt, modelThinkingEnabled, normalizeBridgeModel } from './protocol';

export function createModelsResponse(readiness: CursorBridgeReadiness) {
  const available = readiness.ready;
  return {
    object: 'list',
    data: [
      {
        id: 'deepseek-web',
        object: 'model',
        created: 0,
        owned_by: 'deepseek-pp-cursor-bridge',
        permission: [],
        root: 'deepseek-web',
        parent: null,
        available,
      },
      {
        id: 'deepseek-web-thinking',
        object: 'model',
        created: 0,
        owned_by: 'deepseek-pp-cursor-bridge',
        permission: [],
        root: 'deepseek-web-thinking',
        parent: null,
        available,
      },
    ],
  };
}

export function parseChatCompletionsBody(body: unknown, jobId: string, now = Date.now()): {
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

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  for (const item of messagesRaw) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string') continue;
    messages.push({ role, content });
  }

  if (messages.length === 0) {
    return { error: { code: 'invalid_request', message: 'No valid chat messages found.' } };
  }

  const prompt = messagesToPrompt(messages);
  if (!prompt) {
    return { error: { code: 'invalid_request', message: 'Prompt is empty after normalizing messages.' } };
  }

  const model = normalizeBridgeModel(typeof record.model === 'string' ? record.model : undefined);
  const stream = record.stream === true;
  const thinkingEnabled =
    modelThinkingEnabled(typeof record.model === 'string' ? record.model : undefined)
    || (record.thinking === true)
    || (typeof record.thinking === 'object' && record.thinking !== null && (record.thinking as { type?: string }).type === 'enabled');

  return {
    job: {
      id: jobId,
      model,
      messages,
      stream,
      thinkingEnabled,
      createdAt: now,
    },
  };
}

export function createNonStreamCompletion(model: string, text: string, id: string, created: number) {
  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
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
  if (!readiness.hasDeepSeekTab) {
    return {
      code: 'missing_tab',
      message: 'Open a logged-in chat.deepseek.com tab with DeepSeek++ active, then retry.',
    };
  }
  if (!readiness.hasLogin) {
    return {
      code: 'missing_login',
      message: 'DeepSeek login token is missing. Sign in at chat.deepseek.com and refresh the page.',
    };
  }
  return {
    code: 'not_ready',
    message: readiness.reason ?? 'Cursor bridge is not ready.',
  };
}
