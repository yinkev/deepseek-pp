import type { DeepSeekWebVisionFileMetadata } from './web-vision';

export const DEEPSEEK_WEB_VISION_EVIDENCE_SCHEMA_VERSION = 1;

export type DeepSeekWebVisionEvidenceKind =
  | 'browser_capture'
  | 'browser_act_verify'
  | 'automation_monitor';

export interface DeepSeekWebVisionEvidencePack {
  schemaVersion: typeof DEEPSEEK_WEB_VISION_EVIDENCE_SCHEMA_VERSION;
  id: string;
  kind: DeepSeekWebVisionEvidenceKind;
  createdAt: number;
  storage: 'metadata_only';
  rawImageStored: false;
  refFileIds: string[];
  webVisionFiles: DeepSeekWebVisionFileMetadata[];
  source: {
    toolName?: string;
    automationId?: string;
    automationRunId?: string;
    tabId?: number;
    windowId?: number;
  };
  image: {
    name: string;
    mimeType: string;
    sizeBytes: number;
  };
  prompt?: string;
}

export function createDeepSeekWebVisionEvidencePack(input: {
  id?: string;
  kind: DeepSeekWebVisionEvidenceKind;
  createdAt: number;
  refFileIds: readonly string[];
  webVisionFiles: readonly DeepSeekWebVisionFileMetadata[];
  source?: DeepSeekWebVisionEvidencePack['source'];
  image: DeepSeekWebVisionEvidencePack['image'];
  prompt?: string;
}): DeepSeekWebVisionEvidencePack {
  return {
    schemaVersion: DEEPSEEK_WEB_VISION_EVIDENCE_SCHEMA_VERSION,
    id: normalizeEvidencePackId(input.id, input.kind, input.createdAt),
    kind: input.kind,
    createdAt: input.createdAt,
    storage: 'metadata_only',
    rawImageStored: false,
    refFileIds: input.refFileIds.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()),
    webVisionFiles: input.webVisionFiles.map(toSafeVisionMetadata),
    source: toSafeEvidenceSource(input.source ?? {}),
    image: {
      name: input.image.name,
      mimeType: input.image.mimeType,
      sizeBytes: input.image.sizeBytes,
    },
    ...(input.prompt ? { prompt: input.prompt } : {}),
  };
}

function normalizeEvidencePackId(
  value: string | undefined,
  kind: DeepSeekWebVisionEvidenceKind,
  createdAt: number,
): string {
  const normalized = typeof value === 'string'
    ? value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96)
    : '';
  if (normalized) return normalized;
  return `vision-evidence-${kind}-${createdAt}-${createShortRandomId()}`;
}

function createShortRandomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(6);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2, 14).padEnd(12, '0');
}

function toSafeVisionMetadata(
  metadata: DeepSeekWebVisionFileMetadata,
): DeepSeekWebVisionFileMetadata {
  return {
    id: metadata.id,
    name: metadata.name,
    size: metadata.size,
    mimeType: metadata.mimeType,
    status: metadata.status,
    modelKind: metadata.modelKind,
    isImage: metadata.isImage,
    auditResult: metadata.auditResult,
    width: metadata.width,
    height: metadata.height,
  };
}

function toSafeEvidenceSource(
  source: DeepSeekWebVisionEvidencePack['source'],
): DeepSeekWebVisionEvidencePack['source'] {
  return {
    ...(typeof source.toolName === 'string' ? { toolName: source.toolName } : {}),
    ...(typeof source.automationId === 'string' ? { automationId: source.automationId } : {}),
    ...(typeof source.automationRunId === 'string' ? { automationRunId: source.automationRunId } : {}),
    ...(typeof source.tabId === 'number' ? { tabId: source.tabId } : {}),
    ...(typeof source.windowId === 'number' ? { windowId: source.windowId } : {}),
  };
}
