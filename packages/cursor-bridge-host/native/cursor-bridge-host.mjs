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
import { fileURLToPath } from 'node:url';
import {
  defaultVaultSnapshot,
  loadVault,
  saveVault,
  upsertAccount,
  removeAccount,
  markUsed,
  listAccountsPublic,
  mergeReadinessAccounts,
  resolveVaultPath,
} from './account-vault.mjs';

const PORT = Number(process.env.CURSOR_BRIDGE_PORT || 8787);
const HOST = process.env.CURSOR_BRIDGE_HOST || '127.0.0.1';
const MAX_NATIVE_MESSAGE_BYTES = 1 * 1024 * 1024;
const JOB_TIMEOUT_MS = Number(process.env.CURSOR_BRIDGE_JOB_TIMEOUT_MS || 300_000);
const hostStartedAt = Date.now();
let activeJobStartedAt = null;
let lastJobMeta = {
  id: null,
  model: null,
  accountId: null,
  threadId: null,
  sticky: null,
  ok: null,
  errorCode: null,
  error: null,
  durationMs: null,
  finishedAt: null,
  promptChars: null,
  toolLoopDepth: null,
  openAiToolCalls: null,
};


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

// Host-disk multi-account vault (SoT shared across extension reloads / profiles).
const HOST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VAULT_PATH = resolveVaultPath(process.env.CURSOR_BRIDGE_HOST_DIR || HOST_DIR);
let hostVault = loadVault(VAULT_PATH);

function persistHostVault() {
  try {
    saveVault(VAULT_PATH, hostVault);
  } catch (err) {
    process.stderr.write(`[cursor-bridge] vault save failed: ${err?.message || err}\n`);
  }
}

function vaultPublicList() {
  return listAccountsPublic(hostVault);
}

function applyVaultUpsert(headers, options = {}) {
  const result = upsertAccount(hostVault, headers, options);
  if (result.account) {
    hostVault = result.snapshot;
    persistHostVault();
  }
  return result.account;
}

function applyVaultRemove(accountId) {
  const result = removeAccount(hostVault, accountId);
  if (result.removed) {
    hostVault = result.snapshot;
    persistHostVault();
  }
  return result.removed;
}

function applyVaultMarkUsed(accountId) {
  const result = markUsed(hostVault, accountId);
  if (result.account) {
    hostVault = result.snapshot;
    persistHostVault();
  }
  return result.account;
}

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
    lastReadiness = {
      ...mergeReadinessAccounts(msg.readiness, hostVault),
      extensionAlive: true,
      hostVaultPath: VAULT_PATH,
    };
    // Prefer host hasLogin if vault has tokens even if extension cache empty.
    if (!lastReadiness.hasLogin && (hostVault.order?.length ?? 0) > 0) {
      lastReadiness.hasLogin = true;
      lastReadiness.ready = !lastReadiness.busy;
      if (lastReadiness.reason === 'missing_login') lastReadiness.reason = undefined;
    }
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
    // Push host vault snapshot so extension can rehydrate multi-account SoT.
    writeNativeMessage({
      type: 'vault_snapshot',
      requestId: randomUUID(),
      vault: hostVault,
    }).catch(() => {});
    return;
  }

  if (msg.type === 'vault_upsert') {
    const headers = msg.headers && typeof msg.headers === 'object' ? msg.headers : null;
    const account = headers ? applyVaultUpsert(headers, {
      label: msg.label,
      makeDefault: msg.makeDefault === true,
    }) : null;
    if (msg.requestId) {
      writeNativeMessage({
        type: 'vault_ack',
        requestId: msg.requestId,
        ok: Boolean(account),
        account: account ? { id: account.id, label: account.label, useCount: account.useCount } : null,
        accounts: vaultPublicList(),
      }).catch(() => {});
    }
    return;
  }

  if (msg.type === 'vault_remove') {
    // HARD RULE: never delete host vault slots from extension auth paths.
    // Multi-account was wiped by 40003 remove loops. Manual admin can edit the file.
    process.stderr.write(`[cursor-bridge] vault_remove ignored (protect multi-account): ${msg.accountId || ''}\n`);
    if (msg.requestId) {
      writeNativeMessage({
        type: 'vault_ack',
        requestId: msg.requestId,
        ok: false,
        accounts: vaultPublicList(),
      }).catch(() => {});
    }
    return;
  }

  if (msg.type === 'vault_mark_used') {
    const account = applyVaultMarkUsed(msg.accountId);
    if (msg.requestId) {
      writeNativeMessage({
        type: 'vault_ack',
        requestId: msg.requestId,
        ok: Boolean(account),
        accounts: vaultPublicList(),
      }).catch(() => {});
    }
    return;
  }

  if (msg.type === 'vault_get') {
    if (msg.requestId) {
      writeNativeMessage({
        type: 'vault_snapshot',
        requestId: msg.requestId,
        vault: hostVault,
      }).catch(() => {});
    }
    return;
  }

  if (msg.requestId && pending.has(msg.requestId)) {
    const entry = pending.get(msg.requestId);
    if (msg.type === 'job_chunk' && entry.onChunk) {
      entry.onChunk(typeof msg.text === 'string' ? msg.text : '');
      return;
    }
    if (
      msg.type === 'job_done'
      || msg.type === 'job_error'
      || msg.type === 'readiness'
      || msg.type === 'pong'
      || msg.type === 'vault_snapshot'
      || msg.type === 'vault_ack'
    ) {
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
  const hint = String(job?.conversationHint || '').trim().slice(0, 128);
  if (hint) {
    return `fp-${profile}-${family}-c-${simpleHash(`${profile}\n${family}\nhint\n${hint}`)}`;
  }
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
    'access-control-allow-headers': 'authorization, content-type, x-dpp-client, x-dpp-profile, x-dpp-thread-id, x-dpp-reset-thread, x-dpp-force-tools, x-dpp-conversation-id, x-dpp-account, x-dpp-account-id, x-thread-id, user-agent',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-expose-headers': 'x-dpp-thread-id, x-dpp-sticky, x-dpp-account-id',
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
      message: 'DeepSeek++ extension is not connected. Open Chrome with DeepSeek++ loaded.',
    };
  }
  // Tab is optional — cached Authorization is enough.
  if (!readiness.hasLogin) {
    return {
      code: 'missing_login',
      message: 'DeepSeek login token is missing. Sign in at chat.deepseek.com once so the extension can cache your login, then retry.',
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
  const mk = (id, contextLength) => ({
    id,
    object: 'model',
    created: 0,
    owned_by: 'deepseek-pp-cursor-bridge',
    permission: [],
    root: id,
    parent: null,
    available,
    context_length: contextLength,
    context_window: contextLength,
    max_model_len: contextLength,
    max_tokens: Math.min(8192, Math.floor(contextLength / 8)),
  });
  return {
    object: 'list',
    data: [
      mk('ds/octopus', 890880),
      mk('ds/octopus-eyes', 890880),
      mk('ds/squid', 890880),
      mk('ds/eni', 890880),
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

function detectClientProfile(messages, headerValue, userAgent) {
  const header = typeof headerValue === 'string' ? headerValue.trim().toLowerCase() : '';
  if (header === 'cursor' || header === 'hermes' || header === 'generic') return header;
  if (
    header === 'agent-hermes'
    || header === 'openhermes'
    || header === 'nous'
    || header === 'discord'
    || header === 'telegram'
    || header === 'gateway'
  ) {
    return 'hermes';
  }
  if (header === 'cursor-ide' || header === 'cursor-agent') return 'cursor';

  const ua = typeof userAgent === 'string' ? userAgent.toLowerCase() : '';
  if (
    ua.includes('hermes')
    || ua.includes('openhermes')
    || ua.includes('nousresearch')
    || ua.includes('hermesagent')
  ) {
    return 'hermes';
  }
  if (ua.includes('cursor')) return 'cursor';

  const systemText = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n')
    .toLowerCase();
  if (!systemText) return 'generic';

  const cursorHits = ['cursor ide', 'you are a coding agent', 'agent skills', 'mcp server', 'cursor rules', 'composer']
    .filter((n) => systemText.includes(n)).length;
  // Discord/Telegram/WhatsApp/Slack gateway prompts from Hermes — same brain-only policy as CLI.
  const hermesHits = [
    'hermes',
    'agent hermes',
    'openhermes',
    'nousresearch',
    'nous research',
    'you are hermes',
    'hermes agent',
    'they call me hermes',
    'you are in a discord server',
    'you are on a text messaging communication platform, telegram',
    'you are on a text messaging communication platform, whatsapp',
    'you are in a slack workspace',
    'you are communicating via email',
    'media:/absolute/path/to/file',
  ].filter((n) => systemText.includes(n)).length;

  if (hermesHits >= 1) return 'hermes';
  if (cursorHits >= 2) return 'cursor';
  if (cursorHits >= 1 && systemText.length > 800) return 'cursor';
  if (systemText.length > 2000 && (systemText.includes('tool') || systemText.includes('agent'))) return 'cursor';
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
    lower.includes('ds/eni')
    || lower.endsWith('/eni')
    || lower.endsWith('-eni')
    || lower === 'eni'
    || lower.includes('roleplay')
    || lower.includes('nsfw-rp')
  ) {
    return 'ds/eni';
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

/** Hermes (and similar) fire a second completion just to name the chat — never open DeepSeek. */
function isTitleGenerationJob(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const blob = messages.map((m) => String(m?.content || '')).join('\n').toLowerCase();
  return (
    blob.includes('generate a short, descriptive title')
    || blob.includes('return only the title text')
    || (blob.includes('descriptive title') && blob.includes('3-7 words'))
    || (blob.includes('title should capture') && blob.includes('conversation'))
    || (blob.includes('return only the title') && blob.includes('title'))
  );
}

function localTitleFromMessages(messages) {
  if (!Array.isArray(messages)) return 'New Conversation';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || (m.role !== 'user' && m.role !== 'system' && m.role !== 'assistant')) continue;
    const cleaned = String(m.content || '')
      .replace(/\n*\[Autonomic Loop\][\s\S]*$/gi, '')
      .replace(/\n*\[Note:[^\]]*\]/gi, '');
    for (const line of cleaned.split('\n')) {
      let t = line.trim()
        .replace(/^user:\s*/i, '')
        .replace(/^assistant:\s*/i, '');
      if (!t || t.startsWith('[')) continue;
      if (/generate a short/i.test(t)) continue;
      if (/^instructions:/i.test(t)) continue;
      if (/return only the title/i.test(t)) continue;
      if (/latest user request/i.test(t)) continue;
      const words = t.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      return words.slice(0, 7).join(' ').slice(0, 64);
    }
  }
  return 'New Conversation';
}

function writeLocalCompletion(res, job, text, stream) {
  const created = job.createdAt || Math.floor(Date.now() / 1000);
  const completionId = job.id || `chatcmpl-${randomUUID()}`;
  if (stream) {
    sendSseHeaders(res);
    res.write(`data: ${JSON.stringify({
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: job.model,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    })}\n\n`);
    res.write(`data: ${JSON.stringify({
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: job.model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  sendJson(res, 200, {
    id: completionId,
    object: 'chat.completion',
    created,
    model: job.model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

function parseChatBody(body, clientHeader, userAgent) {
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
    if (item.role !== 'system' && item.role !== 'user' && item.role !== 'assistant' && item.role !== 'tool') continue;
    const content = normalizeMessageContent(item.content).trim();
    if (item.role === 'tool') {
      messages.push({
        role: 'tool',
        content: content || '(empty tool result)',
        tool_call_id: typeof item.tool_call_id === 'string' ? item.tool_call_id : undefined,
        name: typeof item.name === 'string' ? item.name : undefined,
      });
      continue;
    }
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
    let tool_calls;
    if (item.role === 'assistant' && Array.isArray(item.tool_calls)) {
      tool_calls = item.tool_calls
        .map((tc, index) => {
          if (!tc || typeof tc !== 'object') return null;
          const fn = tc.function && typeof tc.function === 'object' ? tc.function : null;
          if (!fn || typeof fn.name !== 'string') return null;
          return {
            id: typeof tc.id === 'string' ? tc.id : `call_${index}`,
            type: 'function',
            function: {
              name: fn.name,
              arguments: typeof fn.arguments === 'string'
                ? fn.arguments
                : JSON.stringify(fn.arguments ?? {}),
            },
          };
        })
        .filter(Boolean);
      if (tool_calls.length === 0) tool_calls = undefined;
    }
    if (!content && item.role !== 'user' && !tool_calls) continue;
    messages.push({
      role: item.role,
      content: content || (tool_calls ? '' : '(image attached)'),
      tool_calls,
    });
  }
  if (messages.length === 0) {
    return { error: { code: 'invalid_request', message: 'No valid chat messages found.' } };
  }
  // OpenAI tools array from Hermes/Cursor — passed through for prompt inject + parse.
  const openAiTools = Array.isArray(body.tools)
    ? body.tools
      .filter((t) => t && t.type === 'function' && t.function && typeof t.function.name === 'string')
      .slice(0, 128)
      .map((t) => ({
        type: 'function',
        function: {
          name: String(t.function.name).trim(),
          description: typeof t.function.description === 'string' ? t.function.description : undefined,
          parameters: t.function.parameters,
        },
      }))
    : [];
  const modelRaw = typeof body.model === 'string' ? body.model : 'ds/octopus';
  const thinkingEnabled =
    modelRaw.includes('thinking')
    || modelRaw.endsWith('-think')
    || body.thinking === true;
  const model = normalizeBridgeModel(modelRaw);
  const clientProfile = detectClientProfile(
    messages.filter((m) => m.role !== 'tool'),
    clientHeader,
    userAgent,
  );
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
  const forceTools =
    body.force_tools === true
    || body.forceTools === true;
  const conversationHintRaw =
    (typeof body.conversation_id === 'string' && body.conversation_id)
    || (typeof body.conversationId === 'string' && body.conversationId)
    || (typeof body.session_id === 'string' && body.session_id)
    || (typeof body.sessionId === 'string' && body.sessionId)
    || (typeof body.hermes_session_id === 'string' && body.hermes_session_id)
    || (body.metadata && typeof body.metadata === 'object' && (
      (typeof body.metadata.session_id === 'string' && body.metadata.session_id)
      || (typeof body.metadata.conversation_id === 'string' && body.metadata.conversation_id)
      || (typeof body.metadata.platform === 'string' && typeof body.metadata.chat_id === 'string'
        && `${body.metadata.platform}:${body.metadata.chat_id}`)
    ))
    || '';
  const conversationHint = conversationHintRaw && String(conversationHintRaw).trim()
    ? String(conversationHintRaw).trim().slice(0, 128)
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
      forceTools: forceTools || undefined,
      conversationHint,
      openAiTools: openAiTools.length > 0 ? openAiTools : undefined,
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

  const clientHeader = req.headers['x-dpp-client'] || req.headers['x-dpp-profile'] || req.headers['x-hermes-client'] || null;
  const threadHeader = req.headers['x-dpp-thread-id'] || req.headers['x-thread-id'] || req.headers['x-hermes-thread-id'] || null;
  const resetHeader = req.headers['x-dpp-reset-thread'] === '1' || req.headers['x-dpp-reset-thread'] === 'true';
  const forceToolsHeader = req.headers['x-dpp-force-tools'] === '1' || req.headers['x-dpp-force-tools'] === 'true';
  const accountHeader = req.headers['x-dpp-account'] || req.headers['x-dpp-account-id'] || null;
  // Hermes gateway (Discord/Telegram/CLI) may send session id under several names.
  const conversationHeader =
    req.headers['x-dpp-conversation-id']
    || req.headers['x-conversation-id']
    || req.headers['x-hermes-session-id']
    || req.headers['x-session-id']
    || null;
  const userAgent = req.headers['user-agent'] || null;
  const parsed = parseChatBody(body, clientHeader, userAgent);
  if (parsed.job) {
    if (!parsed.job.threadId && typeof threadHeader === 'string' && threadHeader.trim()) {
      parsed.job.threadId = threadHeader.trim();
    }
    if (resetHeader) parsed.job.resetThread = true;
    if (forceToolsHeader) parsed.job.forceTools = true;
    if (!parsed.job.conversationHint && typeof conversationHeader === 'string' && conversationHeader.trim()) {
      parsed.job.conversationHint = conversationHeader.trim().slice(0, 128);
    }
    if (!parsed.job.accountId && typeof accountHeader === 'string' && accountHeader.trim()) {
      parsed.job.accountId = accountHeader.trim().slice(0, 64);
    }
  }
  if (parsed.error) {
    sendJson(res, 400, { error: { message: parsed.error.message, type: parsed.error.code, code: parsed.error.code } });
    return;
  }

  const job = parsed.job;

  // Title side-jobs: answer in host — never touch DeepSeek (stops the twin chat).
  if (isTitleGenerationJob(job.messages)) {
    const title = localTitleFromMessages(job.messages);
    writeLocalCompletion(res, job, title, job.stream === true);
    return;
  }

  const readiness = await requestReadiness();
  // Busy is queued below — only hard-fail missing extension/login.
  // Tab is optional: cached Authorization is enough to run.
  if (!readiness.extensionAlive || !readiness.hasLogin) {
    const err = readinessToError({ ...readiness, busy: false, ready: false });
    sendJson(res, 503, { error: { message: err.message, type: err.code, code: err.code } });
    return;
  }

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

        // Hermes OpenAI tool loop: emit structured tool_calls in the stream.
        const toolCalls = Array.isArray(result?.tool_calls) ? result.tool_calls : [];
        if (toolCalls.length > 0) {
          for (let i = 0; i < toolCalls.length; i += 1) {
            const tc = toolCalls[i];
            res.write(`data: ${JSON.stringify({
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: job.model,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: i,
                    id: tc.id,
                    type: 'function',
                    function: {
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || '{}',
                    },
                  }],
                },
                finish_reason: null,
              }],
            })}\n\n`);
          }
          writeChunk('', 'tool_calls');
        } else {
          writeChunk('', 'stop');
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const jobPromise = waitForJob(requestId, null, JOB_TIMEOUT_MS);
      await writeNativeMessage({ type: 'run_job', requestId, job });
      const result = await jobPromise;

      if (result?.type === 'job_error') {
        const err = result.error || { code: 'upstream_error', message: 'Unknown bridge error' };
        lastJobMeta = {
          id: job.id || null,
          model: job.model || null,
          accountId: job.accountId || null,
          threadId: job.threadId || null,
          sticky: null,
          ok: false,
          errorCode: err.code || 'upstream_error',
          error: String(err.message || '').slice(0, 240),
          durationMs: activeJobStartedAt ? Date.now() - activeJobStartedAt : null,
          finishedAt: Date.now(),
          promptChars: null,
          toolLoopDepth: null,
          openAiToolCalls: null,
        };
        sendJson(res, 502, { error: { message: err.message, type: err.code, code: err.code } }, {
          'x-dpp-thread-id': job.threadId || '',
          'x-dpp-sticky': 'miss',
          'x-dpp-account-id': job.accountId || '',
        });
        return;
      }

      const text = typeof result?.text === 'string' ? result.text : '';
      const resultThreadId = result?.threadId || job.threadId || fingerprintThreadId(job);
      const resultSticky = result?.sticky === true ? 'hit' : (result?.sticky === false ? 'miss' : 'unknown');
      const resultAccountId = result?.accountId || job.accountId || null;
      const toolsMeta = result?.tools && typeof result.tools === 'object' ? result.tools : {};
      lastJobMeta = {
        id: job.id || null,
        model: job.model || null,
        accountId: resultAccountId,
        threadId: resultThreadId,
        sticky: resultSticky,
        ok: true,
        errorCode: null,
        error: null,
        durationMs: activeJobStartedAt ? Date.now() - activeJobStartedAt : null,
        finishedAt: Date.now(),
        promptChars: typeof toolsMeta.promptChars === 'number' ? toolsMeta.promptChars : null,
        toolLoopDepth: typeof toolsMeta.toolLoopDepth === 'number' ? toolsMeta.toolLoopDepth : null,
        openAiToolCalls: typeof toolsMeta.openAiToolCallCount === 'number'
          ? toolsMeta.openAiToolCallCount
          : (Array.isArray(result?.tool_calls) ? result.tool_calls.length : 0),
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

      const toolCalls = Array.isArray(result?.tool_calls) ? result.tool_calls : [];
      const hasTools = toolCalls.length > 0;
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
            message: hasTools
              ? { role: 'assistant', content: text || null, tool_calls: toolCalls }
              : { role: 'assistant', content: text },
            finish_reason: hasTools ? 'tool_calls' : (result?.finish_reason || 'stop'),
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }, {
        'x-dpp-thread-id': resultThreadId || '',
        'x-dpp-sticky': resultSticky || '',
        'x-dpp-account-id': resultAccountId || '',
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
          'access-control-allow-headers': 'authorization, content-type, x-dpp-client, x-dpp-profile, x-dpp-thread-id, x-dpp-reset-thread, x-dpp-force-tools, x-dpp-conversation-id, x-dpp-account, x-dpp-account-id, x-thread-id, user-agent',
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

      // ENI Life Era habitat + autonomic nudge + forced dream.
      if (req.method === 'GET' && (url.pathname === '/v1/eni/home' || url.pathname === '/eni/home')) {
        const requestId = randomUUID();
        const p = waitForResponse(requestId, 10_000);
        try {
          await writeNativeMessage({ type: 'get_eni_home', requestId });
          const result = await p;
          if (result?.type === 'eni_home' || result?.home) {
            sendJson(res, 200, result.home || result);
          } else if (result?.type === 'job_done' && result.home) {
            sendJson(res, 200, result.home);
          } else {
            sendJson(res, 503, { error: 'eni home unavailable', detail: result });
          }
        } catch (err) {
          sendJson(res, 503, { error: String(err) });
        }
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/v1/eni/nudge' || url.pathname === '/eni/nudge')) {
        const requestId = randomUUID();
        const p = waitForResponse(requestId, 8_000);
        try {
          await writeNativeMessage({ type: 'get_eni_nudge', requestId });
          const result = await p;
          sendJson(res, 200, result?.nudge || result || { shouldNudge: false });
        } catch (err) {
          sendJson(res, 503, { error: String(err) });
        }
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/v1/eni/dream' || url.pathname === '/eni/dream')) {
        const requestId = randomUUID();
        const p = waitForResponse(requestId, 12_000);
        try {
          await writeNativeMessage({ type: 'run_eni_dream', requestId });
          const result = await p;
          sendJson(res, 200, result?.dream || result || { ran: false });
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
        const readiness = mergeReadinessAccounts(await requestReadiness(), hostVault);
        if (!readiness.hasLogin && (hostVault.order?.length ?? 0) > 0) {
          readiness.hasLogin = true;
          readiness.ready = !readiness.busy && readiness.extensionAlive;
          if (readiness.reason === 'missing_login') readiness.reason = undefined;
        }
        readiness.hostVaultPath = VAULT_PATH;
        const queueDepth = typeof httpJobQueue !== 'undefined' ? httpJobQueue.length : 0;
        readiness.lastJob = lastJobMeta;
        sendJson(res, readiness.ready ? 200 : 503, {
          ok: readiness.ready,
          readiness,
          models: ['ds/octopus', 'ds/octopus-eyes', 'ds/squid', 'ds/eni'],
          features: {
            stickyThreads: true,
            deltaPrompts: true,
            eyesAsTool: true,
            eyesCache: true,
            jobQueue: true,
            contextPack: true,
            dppTools: true,
            harnessPromptSurgery: true,
            hermesProfile: true,
            hermesBrainOnly: true,
            conversationHint: true,
            taggedMemoryInject: true,
            contextBudgets: true,
            eniMode: true,
            eniRpAndAgent: true,
            eniStripMemoryContext: true,
            eniOwnedMemory: true,
            eniSceneReset: true,
            eniActionSceneGate: true,
            eniSmartToolSilence: true,
            eniPresenceCues: true,
            eniProjectAffinity: true,
            eniSoftToolNarration: true,
            eniBondCard: true,
            eniToolReceipts: true,
            eniDiscordToolAllowlist: true,
            eniEyes: true,
            eniLifeEra: true,
            hostAccountVault: true,
            operatorLastJob: true,
            accountCooldown: true,
            eniHome: true,
            eniWill: true,
            eniDreams: true,
            eniAutonomic: true,
            eniScenePorts: true,
            eniProprioception: true,
            eniGut: true,
            multiAccount: true,
            openAiToolsProtocol: true,
            antiBureaucracy: true,
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
