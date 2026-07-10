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
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.CURSOR_BRIDGE_PORT || 8787);
const HOST = process.env.CURSOR_BRIDGE_HOST || '127.0.0.1';
const MAX_NATIVE_MESSAGE_BYTES = 1 * 1024 * 1024;
const JOB_TIMEOUT_MS = Number(process.env.CURSOR_BRIDGE_JOB_TIMEOUT_MS || 300_000);
const hostStartedAt = Date.now();
let activeJobStartedAt = null;
let lastJobMeta = { threadId: null, sticky: null, model: null, error: null };


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
      if (msg.type === 'job_done') {
        const n = msg.streamDebug?.events?.length ?? 0;
        const preview = typeof msg.text === 'string' ? msg.text.slice(0, 40) : '';
        process.stderr.write(`[cursor-bridge] job_done textPreview=${JSON.stringify(preview)} streamEvents=${n}\n`);
      }
      if (msg.type === 'job_done' && msg.streamDebug) {
        try {
          const debugPath = path.join(os.homedir(), '.cursor-bridge-last-stream.json');
          fs.writeFileSync(debugPath, JSON.stringify({
            at: new Date().toISOString(),
            textPreview: typeof msg.text === 'string' ? msg.text.slice(0, 200) : null,
            streamDebug: msg.streamDebug,
          }, null, 2));
        } catch (err) {
          process.stderr.write(`[cursor-bridge] stream debug write failed: ${err}\n`);
        }
      }
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


function simpleHash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function fingerprintThreadId(job) {
  if (job?.threadId && String(job.threadId).trim()) return String(job.threadId).trim().slice(0, 128);
  const model = String(job?.model || 'ds/octopus').toLowerCase();
  let family = 'octopus';
  if (model.includes('eyes') || model.includes('vision')) family = 'octopus-eyes';
  else if (model.includes('squid') || model.includes('flash') || model.includes('instant')) family = 'squid';
  const profile = String(job?.clientProfile || 'generic').toLowerCase();
  const firstUser = (job?.messages || []).find((m) => m.role === 'user')?.content || '';
  const seed = String(firstUser).slice(0, 240);
  return `fp-${profile}-${family}-${simpleHash(`${profile}\n${family}\n${seed}`)}`;
}

// --- OpenAI-compatible HTTP surface ---

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, x-dpp-client, x-dpp-profile, x-dpp-thread-id, x-dpp-reset-thread, x-thread-id',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-expose-headers': 'x-dpp-thread-id, x-dpp-sticky',
    ...extraHeaders,
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

// Ephemeral image assets so large data URLs never go through native messaging.
const bridgeAssets = new Map();
const BRIDGE_ASSET_TTL_MS = 10 * 60 * 1000;
const MAX_INLINE_DATA_URL_CHARS = 24_000;

function pruneBridgeAssets() {
  const now = Date.now();
  for (const [id, asset] of bridgeAssets) {
    if (now - asset.createdAt > BRIDGE_ASSET_TTL_MS) bridgeAssets.delete(id);
  }
}

function storeBridgeAsset(dataUrl) {
  pruneBridgeAssets();
  const id = randomUUID();
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URL');
  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  const mimeMatch = /data:([^;]+)/i.exec(header);
  const mime = mimeMatch?.[1] || 'application/octet-stream';
  const isBase64 = /;base64/i.test(header);
  const buffer = isBase64
    ? Buffer.from(data, 'base64')
    : Buffer.from(decodeURIComponent(data), 'utf8');
  bridgeAssets.set(id, { buffer, mime, createdAt: Date.now() });
  return {
    id,
    path: `/bridge-assets/${id}`,
    url: `http://${HOST}:${PORT}/bridge-assets/${id}`,
    mime,
  };
}

function createModelsResponse(readiness) {
  const available = readiness.ready === true;
  return {
    object: 'list',
    data: [
      {
        id: 'ds/octopus',
        object: 'model',
        created: 0,
        owned_by: 'deepseek-pp-cursor-bridge',
        permission: [],
        root: 'ds/octopus',
        parent: null,
        available,
      },
      {
        id: 'ds/octopus-eyes',
        object: 'model',
        created: 0,
        owned_by: 'deepseek-pp-cursor-bridge',
        permission: [],
        root: 'ds/octopus-eyes',
        parent: null,
        available,
      },
      {
        id: 'ds/squid',
        object: 'model',
        created: 0,
        owned_by: 'deepseek-pp-cursor-bridge',
        permission: [],
        root: 'ds/squid',
        parent: null,
        available,
      },
    ],
  };
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part);
        continue;
      }
      if (!part || typeof part !== 'object') continue;
      if (typeof part.text === 'string') parts.push(part.text);
      else if (typeof part.content === 'string') parts.push(part.content);
      else if (part.type === 'text' && typeof part.value === 'string') parts.push(part.value);
    }
    return parts.join('\n');
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
  }
  return '';
}

function extractImageParts(content) {
  const images = [];
  const pushUrl = (url, mimeHint) => {
    if (typeof url !== 'string' || !url.trim()) return;
    const trimmed = url.trim();
    if (
      !trimmed.startsWith('data:image/')
      && !trimmed.startsWith('http://')
      && !trimmed.startsWith('https://')
    ) {
      return;
    }
    let mimeType = typeof mimeHint === 'string' && mimeHint.startsWith('image/') ? mimeHint : undefined;
    if (!mimeType && trimmed.startsWith('data:image/')) {
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);/i.exec(trimmed);
      if (m) mimeType = m[1].toLowerCase();
    }
    images.push({ url: trimmed, mimeType });
  };

  if (typeof content === 'string') {
    if (content.startsWith('data:image/')) pushUrl(content);
    return images;
  }
  if (!Array.isArray(content)) return images;

  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const type = typeof part.type === 'string' ? part.type : '';
    if (type === 'image_url' || type === 'input_image') {
      const imageUrl = part.image_url;
      if (typeof imageUrl === 'string') {
        pushUrl(imageUrl, part.mime_type || part.media_type);
      } else if (imageUrl && typeof imageUrl === 'object') {
        pushUrl(imageUrl.url, imageUrl.mime_type || imageUrl.media_type || part.mime_type);
      }
      continue;
    }
    if (type === 'image' && typeof part.url === 'string') {
      pushUrl(part.url, part.mime_type || part.media_type);
    }
  }
  return images;
}

function detectClientProfile(messages, headerValue) {
  const header = typeof headerValue === 'string' ? headerValue.trim().toLowerCase() : '';
  if (header === 'cursor' || header === 'hermes' || header === 'generic') return header;

  const systemText = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n')
    .toLowerCase();
  if (!systemText) return 'generic';

  const cursorHits = ['cursor ide', 'you are a coding agent', 'agent skills', 'mcp server']
    .filter((n) => systemText.includes(n)).length;
  const hermesHits = ['hermes', 'agent hermes', 'openhermes']
    .filter((n) => systemText.includes(n)).length;

  if (cursorHits >= 2) return 'cursor';
  if (hermesHits >= 1 && systemText.length > 400) return 'hermes';
  if (cursorHits >= 1 && systemText.length > 1200) return 'cursor';
  return 'generic';
}

function normalizeBridgeModel(modelRaw) {
  if (typeof modelRaw !== 'string') return 'ds/octopus';
  const lower = modelRaw.toLowerCase();
  if (
    lower.includes('octopus-eyes')
    || lower.endsWith('/eyes')
    || lower.endsWith('-eyes')
    || lower === 'vision'
    || lower.endsWith('/vision')
    || lower.endsWith('-vision')
  ) {
    return 'ds/octopus-eyes';
  }
  if (
    lower.includes('ds/squid')
    || lower.endsWith('/squid')
    || lower.endsWith('-squid')
    || lower === 'squid'
    || lower.includes('ds/flash')
    || lower.endsWith('/flash')
    || lower === 'flash'
    || lower.includes('instant')
  ) {
    return 'ds/squid';
  }
  return 'ds/octopus';
}

function parseChatBody(body, clientHeader) {
  if (!body || typeof body !== 'object') {
    return { error: { code: 'invalid_request', message: 'Request body must be a JSON object.' } };
  }
  const messagesRaw = body.messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
    return { error: { code: 'invalid_request', message: 'messages must be a non-empty array.' } };
  }
  const messages = [];
  const images = [];
  for (const item of messagesRaw) {
    if (!item || typeof item !== 'object') continue;
    if (item.role !== 'system' && item.role !== 'user' && item.role !== 'assistant') continue;
    const content = normalizeMessageContent(item.content).trim();
    const parts = extractImageParts(item.content);
    for (const img of parts) {
      if (img.url.startsWith('data:image/') && img.url.length > MAX_INLINE_DATA_URL_CHARS) {
        try {
          const asset = storeBridgeAsset(img.url);
          images.push({
            url: asset.url,
            mimeType: img.mimeType || asset.mime,
            assetPath: asset.path,
          });
        } catch (err) {
          return {
            error: {
              code: 'invalid_request',
              message: err instanceof Error ? err.message : 'Failed to store image asset.',
            },
          };
        }
      } else {
        images.push(img);
      }
    }
    if (!content && item.role !== 'user') continue;
    messages.push({ role: item.role, content: content || '(image attached)' });
  }
  if (messages.length === 0) {
    return { error: { code: 'invalid_request', message: 'No valid chat messages found.' } };
  }
  const modelRaw = typeof body.model === 'string' ? body.model : 'ds/octopus';
  const thinkingEnabled =
    modelRaw.includes('thinking')
    || modelRaw.endsWith('-think')
    || body.thinking === true;
  const model = normalizeBridgeModel(modelRaw);
  const clientProfile = detectClientProfile(messages, clientHeader);
  const threadId =
    (typeof body.thread_id === 'string' && body.thread_id.trim())
    || (typeof body.threadId === 'string' && body.threadId.trim())
    || undefined;
  const resetThread =
    body.reset_thread === true
    || body.resetThread === true
    || body.new_session === true;
  const dppContextRaw =
    (typeof body.dpp_context === 'string' && body.dpp_context)
    || (typeof body.dppContext === 'string' && body.dppContext)
    || '';
  const dppContext = dppContextRaw && String(dppContextRaw).trim()
    ? String(dppContextRaw).trim().slice(0, 12000)
    : undefined;
  return {
    job: {
      id: `chatcmpl-${randomUUID()}`,
      model,
      messages,
      stream: body.stream === true,
      thinkingEnabled,
      createdAt: Math.floor(Date.now() / 1000),
      clientProfile,
      images: images.length > 0 ? images : undefined,
      threadId,
      resetThread: resetThread || undefined,
      dppContext,
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

  const clientHeader = req.headers['x-dpp-client'] || req.headers['x-dpp-profile'] || null;
  const threadHeader = req.headers['x-dpp-thread-id'] || req.headers['x-thread-id'] || null;
  const resetHeader = req.headers['x-dpp-reset-thread'] === '1' || req.headers['x-dpp-reset-thread'] === 'true';
  const parsed = parseChatBody(body, clientHeader);
  if (parsed.job) {
    if (!parsed.job.threadId && typeof threadHeader === 'string' && threadHeader.trim()) {
      parsed.job.threadId = threadHeader.trim();
    }
    if (resetHeader) parsed.job.resetThread = true;
  }
  if (parsed.error) {
    sendJson(res, 400, { error: { message: parsed.error.message, type: parsed.error.code, code: parsed.error.code } });
    return;
  }

  const readiness = await requestReadiness();
  // Busy is queued below — only hard-fail missing extension/tab/login.
  if (!readiness.extensionAlive || !readiness.hasDeepSeekTab || !readiness.hasLogin) {
    const err = readinessToError({ ...readiness, busy: false, ready: false });
    sendJson(res, 503, { error: { message: err.message, type: err.code, code: err.code } });
    return;
  }

  const job = parsed.job;
  // FIFO queue: wait instead of hard 503 when another job is running.
  await enqueueHttpJob(async () => {
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
        lastJobMeta = { threadId: job.threadId || null, sticky: null, model: job.model, error: err.message };
        sendJson(res, 502, { error: { message: err.message, type: err.code, code: err.code } });
        return;
      }

      const text = typeof result?.text === 'string' ? result.text : '';
      const resultThreadId = result?.threadId || job.threadId || fingerprintThreadId(job);
      const resultSticky = result?.sticky === true ? 'hit' : (result?.sticky === false ? 'miss' : 'unknown');
      lastJobMeta = {
        threadId: resultThreadId,
        sticky: resultSticky,
        model: job.model,
        error: null,
      };
      // Always try to persist stream debug for first-token diagnosis
      if (result?.streamDebug) {
        try {
          const debugPath = path.join(os.homedir(), '.cursor-bridge-last-stream.json');
          fs.writeFileSync(debugPath, JSON.stringify({
            at: new Date().toISOString(),
            textPreview: typeof result.text === 'string' ? result.text.slice(0, 200) : null,
            streamDebug: result.streamDebug,
          }, null, 2));
        } catch (err) {
          process.stderr.write(`[cursor-bridge] stream debug write failed: ${err}\n`);
        }
      }

      sendJson(res, 200, {
        id: job.id,
        object: 'chat.completion',
        created: job.createdAt,
        model: job.model,
        system_fingerprint: resultThreadId || undefined,
        dpp_stream_debug: result?.streamDebug || null,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }, {
        'x-dpp-thread-id': resultThreadId || '',
        'x-dpp-sticky': resultSticky || '',
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
  });
}

const httpJobQueue = [];
let httpJobActive = false;

function enqueueHttpJob(fn) {
  return new Promise((resolve, reject) => {
    httpJobQueue.push({ fn, resolve, reject });
    void drainHttpJobQueue();
  });
}

async function drainHttpJobQueue() {
  if (httpJobActive) return;
  httpJobActive = true;
  while (httpJobQueue.length > 0) {
    const item = httpJobQueue.shift();
    activeJobStartedAt = Date.now();
    try {
      item.resolve(await item.fn());
    } catch (err) {
      item.reject(err);
    } finally {
      activeJobStartedAt = null;
    }
  }
  httpJobActive = false;
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type, x-dpp-client, x-dpp-profile, x-dpp-thread-id, x-dpp-reset-thread, x-thread-id',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        });
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/bridge-assets/')) {
        pruneBridgeAssets();
        const id = url.pathname.slice('/bridge-assets/'.length).split('/')[0];
        const asset = bridgeAssets.get(id);
        if (!asset) {
          sendJson(res, 404, { error: { message: 'Asset not found or expired', type: 'not_found', code: 'not_found' } });
          return;
        }
        res.writeHead(200, {
          'content-type': asset.mime,
          'content-length': asset.buffer.length,
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        });
        res.end(asset.buffer);
        return;
      }

      
      if (req.method === 'GET' && (url.pathname === '/v1/debug/last-stream' || url.pathname === '/debug/last-stream')) {
        const requestId = randomUUID();
        const p = waitForJob(requestId, null, 8000);
        try {
          await writeNativeMessage({ type: 'get_bridge_status', requestId });
          const result = await p;
          sendJson(res, 200, result?.status || result || { error: 'no status' });
        } catch (err) {
          sendJson(res, 503, { error: String(err) });
        }
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/v1/admin/reload-extension' || url.pathname === '/admin/reload-extension')) {
        const requestId = randomUUID();
        try {
          await writeNativeMessage({ type: 'reload_extension', requestId });
          sendJson(res, 200, { ok: true, message: 'reload requested' });
        } catch (err) {
          sendJson(res, 503, { ok: false, error: String(err) });
        }
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/v1/health')) {
        const readiness = await requestReadiness();
        const queueDepth = typeof httpJobQueue !== 'undefined' ? httpJobQueue.length : 0;
        sendJson(res, readiness.ready ? 200 : 503, {
          ok: readiness.ready,
          readiness,
          models: ['ds/octopus', 'ds/octopus-eyes', 'ds/squid'],
          features: {
            stickyThreads: true,
            deltaPrompts: true,
            eyesAsTool: true,
            eyesCache: true,
            jobQueue: true,
            contextPack: true,
          },
          host: 'cursor-bridge',
          uptimeMs: Date.now() - hostStartedAt,
          queueDepth,
          activeJobAgeMs: activeJobStartedAt ? Date.now() - activeJobStartedAt : 0,
          lastJob: lastJobMeta,
        });
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
