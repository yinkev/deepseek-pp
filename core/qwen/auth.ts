import type { QwenCachedAuth } from './transport';

export const QWEN_AUTH_STORAGE_KEY = 'qwenCachedAuth';
export const DEFAULT_QWEN_WEB_VERSION = '0.2.63';

export interface QwenRequestHeader {
  name: string;
  value?: string;
}

export type QwenAuthCapture = Partial<QwenCachedAuth>;

export interface QwenBrowserCookie {
  name: string;
  value: string;
}

export interface RefreshQwenAuthDeps {
  readPageCapture: () => Promise<QwenAuthCapture | null>;
  readCookies: () => Promise<readonly QwenBrowserCookie[]>;
}

export interface QwenBrowserAuthResult {
  auth: QwenCachedAuth | null;
  cookieCount: number;
  hasBaxiaCookies: boolean;
}

export function qwenAuthCaptureFromHeaders(headers: readonly QwenRequestHeader[]): QwenAuthCapture {
  const values = new Map<string, string>();
  for (const header of headers) {
    const name = header.name.trim().toLowerCase();
    const value = header.value?.trim();
    if (name && value) values.set(name, value);
  }
  return compactCapture({
    authorization: values.get('authorization'),
    version: values.get('version'),
    bxUmidToken: values.get('bx-umidtoken'),
    bxUa: values.get('bx-ua'),
  });
}

export function mergeQwenAuthCapture(
  current: QwenCachedAuth | null,
  capture: QwenAuthCapture,
): QwenCachedAuth | null {
  const authorization = normalizeAuthorization(capture.authorization ?? current?.authorization);
  if (!authorization) return null;
  return {
    authorization,
    version: clean(capture.version) ?? current?.version ?? DEFAULT_QWEN_WEB_VERSION,
    ...(clean(capture.bxUmidToken) ?? current?.bxUmidToken
      ? { bxUmidToken: clean(capture.bxUmidToken) ?? current?.bxUmidToken }
      : {}),
    ...(clean(capture.bxUa) ?? current?.bxUa
      ? { bxUa: clean(capture.bxUa) ?? current?.bxUa }
      : {}),
  };
}

export async function saveQwenCachedAuth(auth: QwenCachedAuth): Promise<void> {
  const normalized = mergeQwenAuthCapture(null, auth);
  if (!normalized) return;
  await chrome.storage.local.set({ [QWEN_AUTH_STORAGE_KEY]: normalized });
}

export async function mergeAndSaveQwenAuth(capture: QwenAuthCapture): Promise<QwenCachedAuth | null> {
  const current = await loadQwenCachedAuth();
  const merged = mergeQwenAuthCapture(current, capture);
  if (merged) await saveQwenCachedAuth(merged);
  return merged;
}

export async function refreshQwenAuthFromBrowser(
  deps: RefreshQwenAuthDeps,
): Promise<QwenBrowserAuthResult> {
  const [current, pageCapture, cookies] = await Promise.all([
    loadQwenCachedAuth(),
    deps.readPageCapture(),
    deps.readCookies(),
  ]);
  const tokenCookie = cookies.find((cookie) => cookie.name.toLowerCase() === 'token')?.value;
  const capture: QwenAuthCapture = {
    ...(tokenCookie ? { authorization: tokenCookie } : {}),
    ...(pageCapture ?? {}),
  };
  const auth = mergeQwenAuthCapture(current, capture);
  if (auth) await saveQwenCachedAuth(auth);
  return {
    auth,
    cookieCount: cookies.length,
    hasBaxiaCookies: cookies.some((cookie) => cookie.name.toLowerCase().startsWith('ssxmod_')),
  };
}

export async function loadQwenCachedAuth(): Promise<QwenCachedAuth | null> {
  const data = await chrome.storage.local.get(QWEN_AUTH_STORAGE_KEY);
  return mergeQwenAuthCapture(null, readCapture(data[QWEN_AUTH_STORAGE_KEY]));
}

function readCapture(value: unknown): QwenAuthCapture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return compactCapture({
    authorization: typeof record.authorization === 'string' ? record.authorization : undefined,
    version: typeof record.version === 'string' ? record.version : undefined,
    bxUmidToken: typeof record.bxUmidToken === 'string' ? record.bxUmidToken : undefined,
    bxUa: typeof record.bxUa === 'string' ? record.bxUa : undefined,
  });
}

function compactCapture(capture: QwenAuthCapture): QwenAuthCapture {
  return Object.fromEntries(
    Object.entries(capture).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0),
  );
}

function normalizeAuthorization(value: string | undefined): string | null {
  const token = clean(value);
  if (!token) return null;
  return /^Bearer\s+/i.test(token) ? `Bearer ${token.replace(/^Bearer\s+/i, '').trim()}` : `Bearer ${token}`;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
