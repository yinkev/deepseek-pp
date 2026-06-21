const REDACTED_MEDIA_VALUE = '[redacted:media]';
const REDACTED_SECRET_VALUE = '[redacted:secret]';
const REDACTED_REF_VALUE = '[redacted:vision-ref]';
const REDACTED_URL_VALUE = '[redacted:url]';
const REDACTED_MEDIA_KEY = 'redactedMedia';
const REDACTED_SECRET_KEY = 'redactedCred';
const REDACTED_REF_KEY = 'redactedVisionRef';
const REDACTED_PAGE_KEY = 'redactedPage';

const SENSITIVE_MEDIA_KEYS = new Set([
  'base64Data',
  'dataBase64',
  'dataUrl',
  'image_url',
  'imageUrl',
]);

const SENSITIVE_SECRET_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-ds-pow-response',
  'api_key',
  'apiKey',
  'token',
  'secret',
  'signedPath',
  'signed_path',
]);

const SENSITIVE_REF_KEYS = new Set([
  'refFileId',
  'refFileIds',
  'webVisionFiles',
]);

const SENSITIVE_PAGE_KEYS = new Set([
  'url',
  'title',
]);

const DATA_URL_PATTERN = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi;
const BLOB_URL_PATTERN = /\bblob:[^\s"'<>)}\]]+/gi;
const FILESYSTEM_URL_PATTERN = /\bfilesystem:[^\s"'<>)}\]]+/gi;
const SIGNED_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)}\]]*(?:signed|token|secret|authorization|signature|x-amz-signature)[^\s"'<>)}\]]*/gi;
const SIGNED_QUERY_PATTERN = /(?:[?&]|\b)(?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|AWSAccessKeyId|Signature|access_token|refresh_token)=[^\s"'<>)}\]]+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const AUTH_HEADER_PATTERN = /\bAuthorization["']?\s*[:=]\s*["']?(?:Basic|Bearer|Digest|Token)?\s*[A-Za-z0-9._~+/=-]+/gi;
const COOKIE_HEADER_PATTERN = /\b(?:Cookie|Set-Cookie)["']?\s*[:=]\s*["']?[^"'{}\n\r]+/gi;
const API_KEY_HEADER_PATTERN = /\b(?:x-api-key|api-key|api_key|apiKey|x-ds-pow-response)["']?\s*[:=]\s*["']?[^"'\s,;}]+/gi;
const TELEGRAM_BOT_TOKEN_PATTERN = /\b\d{6,}:[A-Za-z0-9_-]{24,}\b/g;
const OPENAI_KEY_PATTERN = /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g;
const GOOGLE_API_KEY_PATTERN = /\bAIza[0-9A-Za-z_-]{20,}/g;
const VISION_REF_PATTERN = /\bfile-[A-Za-z0-9_-]{6,}\b/g;

export function redactDurableToolValue(value: unknown): unknown {
  if (typeof value === 'string') return redactDurableToolString(value);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactDurableToolValue(item));

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveMediaKey(key)) {
      redacted[REDACTED_MEDIA_KEY] = typeof item === 'string' && item.length > 0 ? REDACTED_MEDIA_VALUE : item;
      continue;
    }
    if (isSensitiveSecretKey(key)) {
      redacted[REDACTED_SECRET_KEY] = item === undefined || item === null || item === '' ? item : REDACTED_SECRET_VALUE;
      continue;
    }
    if (SENSITIVE_REF_KEYS.has(key)) {
      redacted[REDACTED_REF_KEY] = Array.isArray(item) ? item.map(() => REDACTED_REF_VALUE) : REDACTED_REF_VALUE;
      continue;
    }
    if (SENSITIVE_PAGE_KEYS.has(key) && typeof item === 'string' && item) {
      redacted[REDACTED_PAGE_KEY] = REDACTED_URL_VALUE;
      continue;
    }
    redacted[key] = redactDurableToolValue(item);
  }
  return redacted;
}

export function redactDurableToolString(value: string | undefined): string | undefined {
  return value
    ?.replace(DATA_URL_PATTERN, REDACTED_MEDIA_VALUE)
    .replace(BLOB_URL_PATTERN, REDACTED_MEDIA_VALUE)
    .replace(FILESYSTEM_URL_PATTERN, REDACTED_MEDIA_VALUE)
    .replace(SIGNED_URL_PATTERN, REDACTED_URL_VALUE)
    .replace(SIGNED_QUERY_PATTERN, REDACTED_URL_VALUE)
    .replace(AUTH_HEADER_PATTERN, REDACTED_SECRET_VALUE)
    .replace(COOKIE_HEADER_PATTERN, REDACTED_SECRET_VALUE)
    .replace(API_KEY_HEADER_PATTERN, REDACTED_SECRET_VALUE)
    .replace(TELEGRAM_BOT_TOKEN_PATTERN, REDACTED_SECRET_VALUE)
    .replace(OPENAI_KEY_PATTERN, REDACTED_SECRET_VALUE)
    .replace(GOOGLE_API_KEY_PATTERN, REDACTED_SECRET_VALUE)
    .replace(BEARER_PATTERN, REDACTED_SECRET_VALUE)
    .replace(VISION_REF_PATTERN, REDACTED_REF_VALUE);
}

function isSensitiveSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_SECRET_KEYS.has(key) || SENSITIVE_SECRET_KEYS.has(lower)) return true;
  return lower.includes('authorization') ||
    lower.includes('cookie') ||
    lower.includes('api-key') ||
    lower.includes('api_key') ||
    lower.includes('apikey') ||
    lower.includes('pow-response') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('signed');
}

function isSensitiveMediaKey(key: string): boolean {
  if (SENSITIVE_MEDIA_KEYS.has(key)) return true;
  const lower = key.toLowerCase();
  return lower === 'base64data' ||
    lower === 'database64' ||
    lower === 'dataurl' ||
    lower === 'image_url' ||
    lower === 'imageurl';
}
