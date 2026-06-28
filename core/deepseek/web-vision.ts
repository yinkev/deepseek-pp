import { DEEPSEEK_API_URL } from '../constants';
import type { ToolExecutionRecord } from '../types';

export const DEEPSEEK_WEB_FILE_UPLOAD_PATH = '/api/v0/file/upload_file';
export const DEEPSEEK_WEB_FILE_FETCH_PATH = '/api/v0/file/fetch_files';
export const DEEPSEEK_WEB_VISION_MODEL_TYPE = 'vision';
export const DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN = 4;
export const DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const DEFAULT_BASE_URL = new URL(DEEPSEEK_API_URL).origin;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_POLL_ATTEMPTS = 10;
const PENDING_FILE_STATUSES = new Set(['PENDING', 'PARSING']);
const SUCCESS_FILE_STATUS = 'SUCCESS';
const DATA_URL_BASE64_MARKER = ';base64,';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DeepSeekWebVisionUploadErrorCode =
  | 'invalid_image'
  | 'upload_failed'
  | 'file_not_ready';

export interface DeepSeekWebVisionFileMetadata {
  id: string;
  name: string | null;
  size: number | null;
  mimeType: string | null;
  status: string | null;
  modelKind: string | null;
  isImage: boolean | null;
  auditResult: string | null;
  width: number | null;
  height: number | null;
}

export interface DeepSeekWebVisionUploadResult {
  refFileId: string;
  metadata: DeepSeekWebVisionFileMetadata;
}

export interface DeepSeekWebVisionUploadInput {
  file: File;
  clientHeaders: Record<string, string>;
  createPowHeaders: (targetPath: string, signal?: AbortSignal) => Promise<Record<string, string>>;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  signal?: AbortSignal;
}

export interface DeepSeekWebVisionSerializedImage {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

export interface DeepSeekWebVisionRouteInput {
  modelType: string | null;
  refFileIds: readonly string[];
  thinkingEnabled: boolean;
  searchEnabled: boolean;
}

export interface DeepSeekWebVisionRoute {
  modelType: string | null;
  refFileIds: string[];
  thinkingEnabled: boolean;
  searchEnabled: boolean;
}

export interface DeepSeekWebVisionToolContinuationRouteInput {
  executions: readonly ToolExecutionRecord[];
  modelType: string | null;
  thinkingEnabled: boolean;
  searchEnabled: boolean;
}

export class DeepSeekWebVisionUploadError extends Error {
  readonly code: DeepSeekWebVisionUploadErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number | null;

  constructor(code: DeepSeekWebVisionUploadErrorCode, message: string, options?: { retryable?: boolean; httpStatus?: number | null }) {
    super(message);
    this.name = 'DeepSeekWebVisionUploadError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.httpStatus = options?.httpStatus ?? null;
  }
}

export async function uploadDeepSeekWebVisionImage(
  input: DeepSeekWebVisionUploadInput,
): Promise<DeepSeekWebVisionUploadResult> {
  validateVisionImage(input.file);
  throwIfVisionUploadAborted(input.signal);

  const fetchImpl = input.fetchImpl ?? ((resource, init) => fetch(resource, init));
  const baseUrl = input.baseUrl ?? DEFAULT_BASE_URL;
  const powHeaders = await input.createPowHeaders(DEEPSEEK_WEB_FILE_UPLOAD_PATH, input.signal);
  throwIfVisionUploadAborted(input.signal);
  const form = new FormData();
  form.append('file', input.file);

  const uploadResponse = await fetchImpl(createDeepSeekWebUrl(baseUrl, DEEPSEEK_WEB_FILE_UPLOAD_PATH), {
    method: 'POST',
    credentials: 'include',
    signal: input.signal,
    headers: {
      ...input.clientHeaders,
      ...powHeaders,
      'x-thinking-enabled': '0',
      'x-model-type': DEEPSEEK_WEB_VISION_MODEL_TYPE,
      'x-file-size': String(input.file.size),
    },
    body: form,
  });
  throwIfVisionUploadAborted(input.signal);
  const uploadJson = await readJsonResponse(uploadResponse, 'DeepSeek Vision upload');
  const uploadData = uploadJson?.data;
  const refFileId = firstString(
    uploadData?.biz_data?.id,
    uploadData?.biz_data?.file_id,
    uploadData?.biz_data?.file?.id,
    uploadData?.biz_data?.file?.file_id,
    uploadData?.id,
    uploadJson?.file_id,
  );

  if (!uploadResponse.ok || uploadData?.biz_code !== 0 || !refFileId) {
    throw new DeepSeekWebVisionUploadError(
      'upload_failed',
      `DeepSeek Vision upload failed with HTTP ${uploadResponse.status}.`,
      { retryable: uploadResponse.status >= 500, httpStatus: uploadResponse.status },
    );
  }

  const metadata = await waitForVisionFile({
    ...input,
    baseUrl,
    fetchImpl,
    refFileId,
  });

  return { refFileId, metadata };
}

export function createDeepSeekWebVisionRoute(input: DeepSeekWebVisionRouteInput): DeepSeekWebVisionRoute {
  const refFileIds = normalizeDeepSeekWebVisionRefFileIds(input.refFileIds);
  const shouldUseVisionRoute = refFileIds.length > 0 || input.modelType === DEEPSEEK_WEB_VISION_MODEL_TYPE;
  if (!shouldUseVisionRoute) {
    return {
      modelType: input.modelType,
      refFileIds,
      thinkingEnabled: input.thinkingEnabled,
      searchEnabled: input.searchEnabled,
    };
  }

  return {
    modelType: DEEPSEEK_WEB_VISION_MODEL_TYPE,
    refFileIds,
    thinkingEnabled: false,
    searchEnabled: false,
  };
}

export function createDeepSeekWebVisionContinuationRoute(): DeepSeekWebVisionRoute {
  return {
    modelType: null,
    refFileIds: [],
    thinkingEnabled: false,
    searchEnabled: false,
  };
}

export function createDeepSeekWebVisionToolContinuationRoute(
  input: DeepSeekWebVisionToolContinuationRouteInput,
): DeepSeekWebVisionRoute {
  const refFileIds = extractDeepSeekWebVisionRefFileIdsFromToolExecutions(input.executions);
  return refFileIds.length > 0
    ? createDeepSeekWebVisionRoute({
      modelType: input.modelType,
      refFileIds,
      thinkingEnabled: input.thinkingEnabled,
      searchEnabled: input.searchEnabled,
    })
    : createDeepSeekWebVisionContinuationRoute();
}

export function extractDeepSeekWebVisionRefFileIdsFromToolExecutions(
  executions: readonly ToolExecutionRecord[],
): string[] {
  const values: unknown[] = [];
  for (const execution of executions) {
    const output = readToolExecutionOutputObject(execution.result.output);
    if (!output || typeof output !== 'object' || Array.isArray(output)) continue;
    const refs = (output as { refFileIds?: unknown }).refFileIds;
    if (Array.isArray(refs)) values.push(...refs);
  }
  return normalizeDeepSeekWebVisionRefFileIds(values).slice(0, DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN);
}

function readToolExecutionOutputObject(output: unknown): Record<string, unknown> | null {
  if (!output) return null;
  if (typeof output === 'object' && !Array.isArray(output)) return output as Record<string, unknown>;
  if (typeof output !== 'string') return null;
  try {
    const parsed = JSON.parse(output);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function normalizeDeepSeekWebVisionRefFileIds(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function normalizeDeepSeekWebVisionSerializedImages(value: unknown): DeepSeekWebVisionSerializedImage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw invalidSerializedImage('DeepSeek Web Vision image payload must be an array.');
  }
  if (value.length > DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN) {
    throw invalidSerializedImage(`DeepSeek Web Vision accepts at most ${DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN} images per turn.`);
  }
  return value.map(normalizeSerializedImage);
}

export function createDeepSeekWebVisionFileFromSerializedImage(input: DeepSeekWebVisionSerializedImage): File {
  const normalized = normalizeSerializedImage(input);
  const dataUrlPrefix = `data:${normalized.mimeType};base64,`;
  if (!normalized.dataUrl.startsWith(dataUrlPrefix)) {
    throw invalidSerializedImage('DeepSeek Web Vision image payload has an invalid data URL.');
  }

  const base64 = normalized.dataUrl.slice(dataUrlPrefix.length);
  if (!isPlausibleBase64PayloadSize(base64, normalized.sizeBytes)) {
    throw invalidSerializedImage('DeepSeek Web Vision image payload size does not match its metadata.');
  }
  const bytes = base64ToBytes(base64);
  if (bytes.byteLength !== normalized.sizeBytes) {
    throw invalidSerializedImage('DeepSeek Web Vision image payload size does not match its metadata.');
  }

  const fileBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fileBuffer).set(bytes);
  const file = new File([fileBuffer], normalized.name || 'image', { type: normalized.mimeType });
  validateVisionImage(file);
  return file;
}

export function serializeDeepSeekWebVisionFile(file: File): Promise<DeepSeekWebVisionSerializedImage> {
  validateVisionImage(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new DeepSeekWebVisionUploadError(
      'invalid_image',
      `DeepSeek Web Vision could not read ${file.name || 'image'}.`,
    ));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new DeepSeekWebVisionUploadError(
          'invalid_image',
          `DeepSeek Web Vision could not read ${file.name || 'image'}.`,
        ));
        return;
      }
      resolve({
        name: file.name || 'image',
        mimeType: file.type.toLowerCase(),
        sizeBytes: file.size,
        dataUrl: reader.result,
      });
    };
    reader.readAsDataURL(file);
  });
}

async function waitForVisionFile(input: DeepSeekWebVisionUploadInput & {
  baseUrl: string;
  fetchImpl: FetchImpl;
  refFileId: string;
}): Promise<DeepSeekWebVisionFileMetadata> {
  const maxPollAttempts = input.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let lastMetadata: DeepSeekWebVisionFileMetadata | null = null;

  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    throwIfVisionUploadAborted(input.signal);
    const response = await input.fetchImpl(createFileFetchUrl(input.baseUrl, input.refFileId), {
      method: 'GET',
      credentials: 'include',
      signal: input.signal,
      headers: {
        accept: 'application/json',
        ...input.clientHeaders,
      },
    });
    throwIfVisionUploadAborted(input.signal);
    const json = await readJsonResponse(response, 'DeepSeek Vision file status');
    const data = json?.data;

    if (!response.ok || data?.biz_code !== 0) {
      throw new DeepSeekWebVisionUploadError(
        'file_not_ready',
        `DeepSeek Vision file status check failed with HTTP ${response.status}.`,
        { retryable: response.status >= 500, httpStatus: response.status },
      );
    }

    lastMetadata = findFileMetadata(json, input.refFileId, input.file);
    const status = lastMetadata?.status?.toUpperCase() ?? null;
    const modelKind = lastMetadata?.modelKind?.toUpperCase() ?? null;
    if (lastMetadata && status === SUCCESS_FILE_STATUS && modelKind === 'VISION') return lastMetadata;

    if (
      status &&
      (!PENDING_FILE_STATUSES.has(status) || (modelKind !== null && modelKind !== 'VISION'))
    ) {
      throw new DeepSeekWebVisionUploadError(
        'file_not_ready',
        `DeepSeek Vision file ${input.refFileId} did not become usable: ${status}.`,
      );
    }

    if (attempt < maxPollAttempts - 1 && pollIntervalMs > 0) {
      await delay(pollIntervalMs, input.signal);
    }
  }

  throw new DeepSeekWebVisionUploadError(
    'file_not_ready',
    `DeepSeek Vision file ${input.refFileId} was not ready after ${maxPollAttempts} checks. Last status: ${lastMetadata?.status ?? 'unknown'}.`,
    { retryable: true },
  );
}

function validateVisionImage(file: File): void {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const supportedType = DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES.has(mimeType)
    || (!mimeType && /\.(png|jpe?g|webp|gif)$/.test(name));

  if (!supportedType || file.size <= 0 || file.size > DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES) {
    throw new DeepSeekWebVisionUploadError(
      'invalid_image',
      `DeepSeek Web Vision only accepts non-empty PNG, JPEG, WebP, or GIF images up to ${formatBytes(DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES)}. Received ${file.name || 'unnamed file'}.`,
    );
  }
}

function findFileMetadata(json: any, refFileId: string, file: File): DeepSeekWebVisionFileMetadata | null {
  const data = json?.data?.biz_data ?? json?.data ?? json?.biz_data ?? json;
  const files = Array.isArray(data?.files) ? data.files : Array.isArray(data) ? data : [];
  const raw = files.find((item: any) => firstString(item?.id, item?.file_id) === refFileId);
  if (!raw) return null;
  return normalizeFileMetadata(raw, file);
}

function normalizeFileMetadata(raw: any, file: File): DeepSeekWebVisionFileMetadata {
  return {
    id: firstString(raw?.id, raw?.file_id) ?? '',
    name: firstString(raw?.file_name, raw?.fileName, raw?.name),
    size: firstNumber(raw?.file_size, raw?.fileSize, raw?.size),
    mimeType: firstString(raw?.mime_type, raw?.mimeType, file.type),
    status: firstString(raw?.status, raw?.parse_status, raw?.parseStatus),
    modelKind: firstString(raw?.model_kind, raw?.modelKind),
    isImage: firstBoolean(raw?.is_image, raw?.isImage),
    auditResult: firstString(raw?.audit_result, raw?.auditResult),
    width: firstNumber(raw?.width),
    height: firstNumber(raw?.height),
  };
}

async function readJsonResponse(response: Response, label: string): Promise<any> {
  const text = await response.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    throw new DeepSeekWebVisionUploadError(
      'upload_failed',
      `${label} returned non-JSON HTTP ${response.status}.`,
      { retryable: response.status >= 500, httpStatus: response.status },
    );
  }
}

function createFileFetchUrl(baseUrl: string, refFileId: string): string {
  const url = new URL(DEEPSEEK_WEB_FILE_FETCH_PATH, baseUrl);
  url.searchParams.set('file_ids', refFileId);
  return url.href;
}

function createDeepSeekWebUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).href;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfVisionUploadAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(createVisionUploadAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfVisionUploadAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createVisionUploadAbortError();
}

function createVisionUploadAbortError(): DOMException {
  return new DOMException('DeepSeek Vision upload was cancelled.', 'AbortError');
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MiB`;
}

function normalizeSerializedImage(value: unknown): DeepSeekWebVisionSerializedImage {
  if (!value || typeof value !== 'object') {
    throw invalidSerializedImage('DeepSeek Web Vision image payload must be an object.');
  }
  const raw = value as Partial<DeepSeekWebVisionSerializedImage>;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'image';
  const mimeType = typeof raw.mimeType === 'string' ? raw.mimeType.toLowerCase() : '';
  const sizeBytes = typeof raw.sizeBytes === 'number' ? raw.sizeBytes : NaN;
  const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl : '';

  if (
    !DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES.has(mimeType) ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES ||
    !dataUrl
  ) {
    throw invalidSerializedImage('DeepSeek Web Vision image payload is invalid.');
  }
  if (!hasValidDataUrlEnvelope(dataUrl, mimeType, sizeBytes)) {
    throw invalidSerializedImage('DeepSeek Web Vision image payload has an invalid data URL.');
  }

  return { name, mimeType, sizeBytes, dataUrl };
}

function hasValidDataUrlEnvelope(dataUrl: string, mimeType: string, sizeBytes: number): boolean {
  const prefix = `data:${mimeType}${DATA_URL_BASE64_MARKER}`;
  if (!dataUrl.startsWith(prefix)) return false;
  const base64Length = dataUrl.length - prefix.length;
  return isPlausibleBase64PayloadSizeByLength(base64Length, sizeBytes);
}

function isPlausibleBase64PayloadSize(base64: string, sizeBytes: number): boolean {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return false;
  return isPlausibleBase64PayloadSizeByLength(base64.length, sizeBytes);
}

function isPlausibleBase64PayloadSizeByLength(base64Length: number, sizeBytes: number): boolean {
  const expectedMaxLength = Math.ceil(sizeBytes / 3) * 4;
  return base64Length > 0 && base64Length <= expectedMaxLength + 4;
}

function base64ToBytes(base64: string): Uint8Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    throw invalidSerializedImage('DeepSeek Web Vision image payload is not valid base64.');
  }
}

function invalidSerializedImage(message: string): DeepSeekWebVisionUploadError {
  return new DeepSeekWebVisionUploadError('invalid_image', message);
}
