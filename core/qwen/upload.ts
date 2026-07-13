import type { QwenCachedAuth } from './transport';
import { QwenWebError } from './transport';

const QWEN_ORIGIN = 'https://chat.qwen.ai';
const QWEN_UPLOAD_INIT_URL = `${QWEN_ORIGIN}/api/v2/files/getstsToken`;
const QWEN_UPLOAD_CONFIRM_URL = `${QWEN_ORIGIN}/api/v2/files/confirm`;
const OSS_REGION = 'ap-southeast-1';
const OSS_USER_AGENT = 'aliyun-sdk-js/6.23.0 Chrome 132.0.0.0 on Windows 10 64-bit';

export interface QwenStsData {
  bucketname: string;
  file_path: string;
  access_key_id: string;
  access_key_secret: string;
  security_token: string;
  file_url?: string;
  upload_url?: string;
  file_id?: string;
}

export interface QwenCompletionFile {
  type: 'image';
  file: {
    created_at: number;
    data: Record<string, never>;
    filename: string;
    hash: null;
    id: string;
    meta: { name: string; size: number; content_type: string };
    update_at: number;
  };
  id: string;
  url: string;
  name: string;
  collection_name: string;
  progress: number;
  status: 'uploaded';
  greenNet: 'success';
  size: number;
  error: string;
  itemId: string;
  file_type: string;
  showType: 'image';
  file_class: 'vision';
  uploadTaskId: string;
}

export interface QwenImageUploadInput {
  data: Uint8Array;
  filename: string;
  contentType: string;
  signal?: AbortSignal;
}

export interface QwenImageUploaderDeps {
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  loadAuth: () => Promise<QwenCachedAuth | null>;
  randomUUID?: () => string;
  now?: () => number;
}

export async function createQwenOssHeaders(
  method: string,
  date: string,
  sts: QwenStsData,
  contentType: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-oss-date': date,
    'x-oss-security-token': sts.security_token,
    'x-oss-user-agent': OSS_USER_AGENT,
  };
  const canonicalHeaders = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}\n`)
    .join('');
  const canonicalUri = `/${sts.bucketname}/${encodeOssPath(sts.file_path)}`;
  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n\nUNSIGNED-PAYLOAD`;
  const datePart = date.split('T')[0];
  const scope = `${datePart}/${OSS_REGION}/oss/aliyun_v4_request`;
  const stringToSign = [
    'OSS4-HMAC-SHA256',
    date,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const dateKey = await hmacSha256(textBytes(`aliyun_v4${sts.access_key_secret}`), datePart);
  const regionKey = await hmacSha256(dateKey, OSS_REGION);
  const serviceKey = await hmacSha256(regionKey, 'oss');
  const signingKey = await hmacSha256(serviceKey, 'aliyun_v4_request');
  const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));
  headers.authorization = `OSS4-HMAC-SHA256 Credential=${sts.access_key_id}/${scope},Signature=${signature}`;
  return headers;
}

export function createQwenImageUploader(
  deps: QwenImageUploaderDeps,
): (input: QwenImageUploadInput) => Promise<QwenCompletionFile> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => Date.now());

  return async (input) => {
    const auth = await deps.loadAuth();
    if (!auth?.authorization) {
      throw new QwenWebError('missing_auth', 'Qwen login is missing. Sign in at chat.qwen.ai once, then retry.');
    }
    const initResponse = await fetchImpl(QWEN_UPLOAD_INIT_URL, {
      method: 'POST',
      credentials: 'include',
      referrer: `${QWEN_ORIGIN}/`,
      signal: input.signal,
      headers: createQwenHeaders(auth, randomUUID()),
      body: JSON.stringify({
        filename: input.filename,
        filesize: input.data.byteLength,
        filetype: input.contentType,
      }),
    });
    await throwForUploadFailure(initResponse, 'image upload initialization');
    const initPayload = readRecord(await initResponse.json());
    const sts = normalizeStsData(readRecord(initPayload.data));
    const fileUrl = sts.file_url ?? sts.upload_url;
    if (!fileUrl || !sts.file_id) {
      throw new QwenWebError('invalid_response', 'Qwen image upload initialization returned incomplete data.');
    }
    const timestamp = now();
    const ossDate = formatOssDate(timestamp);
    const uploadResponse = await fetchImpl(fileUrl.split('?')[0], {
      method: 'PUT',
      signal: input.signal,
      headers: await createQwenOssHeaders('PUT', ossDate, sts, input.contentType),
      body: input.data as BodyInit,
    });
    await throwForUploadFailure(uploadResponse, 'image upload');
    await fetchImpl(QWEN_UPLOAD_CONFIRM_URL, {
      method: 'POST',
      credentials: 'include',
      referrer: `${QWEN_ORIGIN}/`,
      signal: input.signal,
      headers: createQwenHeaders(auth, randomUUID()),
      body: JSON.stringify({ fileUrl, file_id: sts.file_id }),
    }).catch(() => undefined);

    return {
      type: 'image',
      file: {
        created_at: timestamp,
        data: {},
        filename: input.filename,
        hash: null,
        id: sts.file_id,
        meta: { name: input.filename, size: input.data.byteLength, content_type: input.contentType },
        update_at: timestamp,
      },
      id: sts.file_id,
      url: fileUrl,
      name: input.filename,
      collection_name: '',
      progress: 0,
      status: 'uploaded',
      greenNet: 'success',
      size: input.data.byteLength,
      error: '',
      itemId: randomUUID(),
      file_type: input.contentType,
      showType: 'image',
      file_class: 'vision',
      uploadTaskId: randomUUID(),
    };
  };
}

function createQwenHeaders(auth: QwenCachedAuth, requestId: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: auth.authorization,
    Version: auth.version,
    source: 'web',
    'X-Source': 'web',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Request-Id': requestId,
  };
  if (auth.bxUmidToken) headers['bx-umidtoken'] = auth.bxUmidToken;
  if (auth.bxUa) headers['bx-ua'] = auth.bxUa;
  return headers;
}

function normalizeStsData(value: Record<string, unknown>): QwenStsData {
  const required = ['bucketname', 'file_path', 'access_key_id', 'access_key_secret', 'security_token'] as const;
  for (const key of required) {
    if (typeof value[key] !== 'string' || !value[key]) {
      throw new QwenWebError('invalid_response', `Qwen image upload initialization omitted ${key}.`);
    }
  }
  return {
    bucketname: value.bucketname as string,
    file_path: value.file_path as string,
    access_key_id: value.access_key_id as string,
    access_key_secret: value.access_key_secret as string,
    security_token: value.security_token as string,
    ...(typeof value.file_url === 'string' ? { file_url: value.file_url } : {}),
    ...(typeof value.upload_url === 'string' ? { upload_url: value.upload_url } : {}),
    ...(typeof value.file_id === 'string' ? { file_id: value.file_id } : {}),
  };
}

async function throwForUploadFailure(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new QwenWebError('auth_rejected', 'Qwen rejected the cached login.', response.status);
  }
  if (response.status === 429) {
    throw new QwenWebError('rate_limited', 'Qwen daily or request rate limit reached.', response.status);
  }
  throw new QwenWebError('upstream_error', `Qwen ${operation} failed with HTTP ${response.status}.`, response.status);
}

function formatOssDate(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function encodeOssPath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(textBytes(value)));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, toArrayBuffer(textBytes(value))));
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
