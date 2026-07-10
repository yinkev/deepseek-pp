#!/usr/bin/env node
/**
 * DeepSeek++ Cursor Bridge host.
 *
 * Launched by Chrome Native Messaging when the extension connects.
 * Serves a localhost OpenAI-compatible API and relays jobs to the extension,
 * which runs DeepSeek completions via the existing browser-origin web path.
 *
 * Hard rule: this process never calls chat.deepseek.com itself.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.CURSOR_BRIDGE_PORT || 8787);
const HOST = process.env.CURSOR_BRIDGE_HOST || '127.0.0.1';
const MAX_NATIVE_MESSAGE_BYTES = 1 * 1024 * 1024;
const JOB_TIMEOUT_MS = Number(process.env.CURSOR_BRIDGE_JOB_TIMEOUT_MS || 300_000);

// --- Native messaging framing ---

let buffer = Buffer.alloc(0);
let stdinEnded = false;
const messageQueue = [];
let messageWaiters = [];

function onStdinData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  drainBuffer();
}

function drainBuffer() {
  while (true) {
    if (buffer.length < 4) return;
    const len = buffer.readUInt32LE(0);
    if (len === 0 || len > MAX_NATIVE_MESSAGE_BYTES) {
      process.stderr.write(`[cursor-bridge] invalid native message length: ${len}\n`);
      process.exit(1);
    }
    if (buffer.length < 4 + len) return;
    const json = buffer.subarray(4, 4 + len).toString('utf8');
    buffer = buffer.subarray(4 + len);
    try {
      const msg = JSON.parse(json);
      if (messageWaiters.length > 0) {
        const resolve = messageWaiters.shift();
        resolve(msg);
      } else {
        messageQueue.push(msg);
      }
    } catch (err) {
      process.stderr.write(`[cursor-bridge] JSON parse error: ${err.message}\n`);
    }
  }
}

function readMessage() {
  if (messageQueue.length > 0) return Promise.resolve(messageQueue.shift());
  if (stdinEnded) return Promise.resolve(null);
  return new Promise((resolve) => {
    messageWaiters.push(resolve);
  });
}

function writeNativeMessage(message) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    if (body.length > MAX_NATIVE_MESSAGE_BYTES) {
      reject(new Error(`Native message too large: ${body.length}`));
      return;
    }
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    process.stdout.write(header);
    process.stdout.write(body, (err) => (err ? reject(err) : resolve()));
  });
}

process.stdin.on('data', onStdinData);
process.stdin.on('end', () => {
  stdinEnded = true;
  while (messageWaiters.length > 0) {
    messageWaiters.shift()(null);
  }
  setTimeout(() => process.exit(0), 50);
});
process.stdin.on('error', () => {
  stdinEnded = true;
});

// --- Extension session state ---

let extensionConnected = false;
let extensionBusy = false;
const pending = new Map();

function defaultReadiness() {
  return {
    ready: false,
    extensionAlive: extensionConnected,
    hasDeepSeekTab: false,
    hasLogin: false,
    busy: extensionBusy,
    reason: extensionConnected ? 'unknown' : 'not_ready',
  };
}

let lastReadiness = defaultReadiness();

async function requestReadiness() {
  if (!extensionConnected) {
    lastReadiness = defaultReadiness();
    return lastReadiness;
  }
  const requestId = randomUUID();
  const readinessPromise = waitForResponse(requestId, 8_000);
  await writeNativeMessage({ type: 'get_readiness', requestId });
  const msg = await readinessPromise;
  if (msg && (msg.type === 'readiness' || msg.type === 'pong') && msg.readiness) {
    lastReadiness = { ...msg.readiness, extensionAlive: true };
    return lastReadiness;
  }
  lastReadiness = defaultReadiness();
  return lastReadiness;
}

function waitForResponse(requestId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, timeoutMs);
    pending.set(requestId, {
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      },
      onChunk: null,
    });
  });
}

function waitForJob(requestId, onChunk, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ type: 'job_error', error: { code: 'timeout', message: 'Cursor bridge job timed out.' } });
    }, timeoutMs);
    pending.set(requestId, {
      onChunk,
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      },
    });
  });
}

function handleExtensionMessage(msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'hello') {
    extensionConnected = true;
    lastReadiness = { ...lastReadiness, extensionAlive: true };
    return;
  }

  if (msg.requestId && pending.has(msg.requestId)) {
    const entry = pending.get(msg.requestId);
    if (msg.type === 'job_chunk' && entry.onChunk) {
      entry.onChunk(typeof msg.text === 'string' ? msg.text : '');
      return;
    }
    if (msg.type === 'job_done' || msg.type === 'job_error' || msg.type === 'readiness' || msg.type === 'pong') {
      pending.delete(msg.requestId);
      entry.resolve(msg);
    }
  }
}

async function nativeLoop() {
  while (!stdinEnded) {
    const msg = await readMessage();
    if (msg === null) break;
    handleExtensionMessage(msg);
  }
}

// --- OpenAI-compatible HTTP surface ---

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(payload);
}

function sendSseHeaders(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  });
}

function readinessToError(readiness) {
  if (readiness.busy) {
    return { code: 'busy', message: 'DeepSeek++ cursor bridge is busy with another request.' };
  }
  if (!readiness.extensionAlive) {
    return {
      code: 'not_ready',
      message: 'DeepSeek++ extension is not connected. Open Chrome with DeepSeek++ loaded and a chat.deepseek.com tab.',
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
  return { code: 'not_ready', message: readiness.reason || 'Cursor bridge is not ready.' };
}

function createModelsResponse(readiness) {
  const available = readiness.ready === true;
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

function parseChatBody(body) {
  if (!body || typeof body !== 'object') {
    return { error: { code: 'invalid_request', message: 'Request body must be a JSON object.' } };
  }
  const messagesRaw = body.messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
    return { error: { code: 'invalid_request', message: 'messages must be a non-empty array.' } };
  }
  const messages = [];
  for (const item of messagesRaw) {
    if (!item || typeof item !== 'object') continue;
    if (item.role !== 'system' && item.role !== 'user' && item.role !== 'assistant') continue;
    if (typeof item.content !== 'string') continue;
    messages.push({ role: item.role, content: item.content });
  }
  if (messages.length === 0) {
    return { error: { code: 'invalid_request', message: 'No valid chat messages found.' } };
  }
  const modelRaw = typeof body.model === 'string' ? body.model : 'deepseek-web';
  const thinkingEnabled = modelRaw.includes('thinking') || modelRaw.endsWith('-think') || body.thinking === true;
  const model = thinkingEnabled ? 'deepseek-web-thinking' : 'deepseek-web';
  return {
    job: {
      id: `chatcmpl-${randomUUID()}`,
      model,
      messages,
      stream: body.stream === true,
      thinkingEnabled,
      createdAt: Math.floor(Date.now() / 1000),
    },
  };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function handleModels(res) {
  const readiness = await requestReadiness();
  sendJson(res, 200, createModelsResponse(readiness));
}

async function handleChatCompletions(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { message: 'Invalid JSON body', type: 'invalid_request', code: 'invalid_request' } });
    return;
  }

  const parsed = parseChatBody(body);
  if (parsed.error) {
    sendJson(res, 400, { error: { message: parsed.error.message, type: parsed.error.code, code: parsed.error.code } });
    return;
  }

  const readiness = await requestReadiness();
  if (!readiness.ready) {
    const err = readinessToError(readiness);
    sendJson(res, 503, { error: { message: err.message, type: err.code, code: err.code } });
    return;
  }

  if (extensionBusy) {
    sendJson(res, 503, {
      error: {
        message: 'DeepSeek++ cursor bridge is busy with another request.',
        type: 'busy',
        code: 'busy',
      },
    });
    return;
  }

  const job = parsed.job;
  const requestId = randomUUID();
  extensionBusy = true;

  try {
    if (job.stream) {
      sendSseHeaders(res);
      const created = job.createdAt;
      const completionId = job.id;

      const writeChunk = (delta, finishReason) => {
        const payload = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: job.model,
          choices: [
            {
              index: 0,
              delta: finishReason ? {} : { content: delta },
              finish_reason: finishReason,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      res.write(`data: ${JSON.stringify({
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: job.model,
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      })}\n\n`);

      const jobPromise = waitForJob(requestId, (text) => {
        if (text) writeChunk(text, null);
      }, JOB_TIMEOUT_MS);

      await writeNativeMessage({ type: 'run_job', requestId, job });
      const result = await jobPromise;

      if (result?.type === 'job_error') {
        const err = result.error || { code: 'upstream_error', message: 'Unknown bridge error' };
        res.write(`data: ${JSON.stringify({ error: { message: err.message, type: err.code, code: err.code } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      writeChunk('', 'stop');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const jobPromise = waitForJob(requestId, null, JOB_TIMEOUT_MS);
    await writeNativeMessage({ type: 'run_job', requestId, job });
    const result = await jobPromise;

    if (result?.type === 'job_error') {
      const err = result.error || { code: 'upstream_error', message: 'Unknown bridge error' };
      sendJson(res, 502, { error: { message: err.message, type: err.code, code: err.code } });
      return;
    }

    const text = typeof result?.text === 'string' ? result.text : '';
    sendJson(res, 200, {
      id: job.id,
      object: 'chat.completion',
      created: job.createdAt,
      model: job.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: {
          message: err instanceof Error ? err.message : String(err),
          type: 'upstream_error',
          code: 'upstream_error',
        },
      });
    } else {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  } finally {
    extensionBusy = false;
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        });
        res.end();
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/v1/health')) {
        const readiness = await requestReadiness();
        sendJson(res, readiness.ready ? 200 : 503, { ok: readiness.ready, readiness });
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
        await handleModels(res);
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
        await handleChatCompletions(req, res);
        return;
      }

      sendJson(res, 404, { error: { message: `Not found: ${url.pathname}`, type: 'not_found', code: 'not_found' } });
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: {
            message: err instanceof Error ? err.message : String(err),
            type: 'upstream_error',
            code: 'upstream_error',
          },
        });
      }
    }
  });
}

const server = createServer();
server.listen(PORT, HOST, () => {
  process.stderr.write(`[cursor-bridge] OpenAI surface listening on http://${HOST}:${PORT}/v1\n`);
});

server.on('error', (err) => {
  process.stderr.write(`[cursor-bridge] HTTP server error: ${err.message}\n`);
  process.exit(1);
});

extensionConnected = !process.stdin.isTTY;
nativeLoop().catch((err) => {
  process.stderr.write(`[cursor-bridge] native loop failed: ${err.message}\n`);
  process.exit(1);
});
