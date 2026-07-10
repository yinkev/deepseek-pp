import {
  buildDeepSeekSessionUrl,
  createChatSession,
  createClientHeaders,
  createPowHeaders,
  createPowHeadersForPath,
  DEEPSEEK_FILE_UPLOAD_PATH,
  DeepSeekAuthError,
  readHistorySnapshot,
  submitPromptStreaming,
  uploadDeepSeekFile,
  type DeepSeekUploadedFile,
} from '../deepseek/adapter';
import type {
  CursorBridgeError,
  CursorBridgeImagePart,
  CursorBridgeJobRequest,
  CursorBridgeReadiness,
} from './protocol';
import {
  bridgeModelSearchEnabled,
  bridgeModelToDeepSeekType,
  bridgeModelUsesNativeVision,
  EYES_SUBCALL_PROMPT,
  formatEyesNotes,
  isEyesModel,
  isSquidModel,
  messagesToPrompt,
  normalizeMessageContent,
  repairOpeningTruncation,
} from './protocol';
import {
  deleteThread,
  getEyesCache,
  getThread,
  MAX_THREAD_TURNS,
  modelFamilyFromBridgeModel,
  putThread,
  recordEyesCacheHit,
  recordStickyOutcome,
  resolveThreadId,
  setBridgeLastError,
  setEyesCache,
  simpleHash,
  type BridgeThreadRecord,
} from './thread-store';

const DEEPSEEK_TAB_URL_PATTERN = '*://chat.deepseek.com/*';
const MAX_EYES_IMAGES = 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface CursorBridgeWorkerDeps {
  loadClientHeaders: () => Promise<Record<string, string> | null>;
  refreshClientHeadersFromTabs?: () => Promise<boolean>;
  queryDeepSeekTabs?: () => Promise<Array<{ id?: number }>>;
  createSession?: typeof createChatSession;
  createPow?: typeof createPowHeaders;
  createUploadPow?: typeof createPowHeadersForPath;
  submitStreaming?: typeof submitPromptStreaming;
  uploadFile?: typeof uploadDeepSeekFile;
  readHistory?: typeof readHistorySnapshot;
  /** Resolve image part to a Blob for upload (data URL / http / host asset). */
  resolveImageBlob?: (image: CursorBridgeImagePart, signal?: AbortSignal) => Promise<{ blob: Blob; filename: string }>;
}

export async function probeCursorBridgeReadiness(
  deps: CursorBridgeWorkerDeps,
  busy: boolean,
): Promise<CursorBridgeReadiness> {
  const queryTabs = deps.queryDeepSeekTabs ?? defaultQueryDeepSeekTabs;
  const tabs = await queryTabs();
  const hasDeepSeekTab = tabs.length > 0;

  let headers = await deps.loadClientHeaders();
  if (!headers && deps.refreshClientHeadersFromTabs) {
    await deps.refreshClientHeadersFromTabs();
    headers = await deps.loadClientHeaders();
  }
  const hasLogin = Boolean(headers?.Authorization);

  const ready = hasDeepSeekTab && hasLogin && !busy;
  let reason: string | undefined;
  if (!hasDeepSeekTab) reason = 'missing_tab';
  else if (!hasLogin) reason = 'missing_login';
  else if (busy) reason = 'busy';

  return {
    ready,
    extensionAlive: true,
    hasDeepSeekTab,
    hasLogin,
    busy,
    reason,
  };
}

export async function runCursorBridgeJob(
  job: CursorBridgeJobRequest,
  deps: CursorBridgeWorkerDeps,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; threadId?: string; sticky?: boolean } | { error: CursorBridgeError }> {
  try {
    let headers = await deps.loadClientHeaders();
    if (!headers && deps.refreshClientHeadersFromTabs) {
      await deps.refreshClientHeadersFromTabs();
      headers = await deps.loadClientHeaders();
    }
    if (!headers?.Authorization) {
      await setBridgeLastError('missing_login');
      return {
        error: {
          code: 'missing_login',
          message: 'DeepSeek login token is missing. Sign in at chat.deepseek.com and refresh the page.',
        },
      };
    }

    const queryTabs = deps.queryDeepSeekTabs ?? defaultQueryDeepSeekTabs;
    const tabs = await queryTabs();
    if (tabs.length === 0) {
      await setBridgeLastError('missing_tab');
      return {
        error: {
          code: 'missing_tab',
          message: 'Open a logged-in chat.deepseek.com tab with DeepSeek++ active, then retry.',
        },
      };
    }

    const createSession = deps.createSession ?? createChatSession;
    const createPow = deps.createPow ?? createPowHeaders;
    const createUploadPow = deps.createUploadPow
      ?? ((clientHeaders: Record<string, string>) => createPowHeadersForPath(clientHeaders, DEEPSEEK_FILE_UPLOAD_PATH));
    const submitStreaming = deps.submitStreaming ?? submitPromptStreaming;
    const uploadFile = deps.uploadFile ?? uploadDeepSeekFile;
    const readHistory = deps.readHistory ?? readHistorySnapshot;
    const resolveImage = deps.resolveImageBlob ?? defaultResolveImageBlob;

    const images = (job.images ?? []).slice(0, MAX_EYES_IMAGES);
    const wantsEyesModel = isEyesModel(job.model);
    const usesSquid = isSquidModel(job.model);
    const useNativeVisionMain = bridgeModelUsesNativeVision(job.model);
    const needsEyesSubcall = !useNativeVisionMain && images.length > 0;

    const modelType = wantsEyesModel ? 'vision' : bridgeModelToDeepSeekType(job.model);
    const modelFamily = modelFamilyFromBridgeModel(job.model);

    const normalizedForThread = job.messages.map((m) => ({
      role: m.role,
      content: normalizeMessageContent(m.content).trim(),
    }));
    const threadId = resolveThreadId({
      explicitThreadId: job.threadId,
      model: typeof job.model === 'string' ? job.model : 'ds/octopus',
      messages: normalizedForThread,
      reset: job.resetThread === true,
      clientProfile: job.clientProfile ?? 'generic',
    });

    if (job.resetThread) {
      await deleteThread(threadId);
    }

    let existing = job.resetThread ? null : await getThread(threadId);
    if (existing && existing.modelFamily !== modelFamily) {
      // Different product surface — do not reuse expert session for squid/eyes.
      existing = null;
    }
    if (existing && existing.turnCount >= MAX_THREAD_TURNS) {
      await deleteThread(threadId);
      existing = null;
    }

    const sticky = Boolean(existing?.chatSessionId);
    let chatSessionId = existing?.chatSessionId ?? '';
    let parentMessageId: number | null = existing?.parentMessageId ?? null;

    let eyesNotes: string | null = null;
    let visionFileIds: string[] = [];

    // P4: eyes notes cache by image hash (skip vision subcall when hit).
    const imageHash = images.length > 0 ? hashImages(images) : null;
    if (needsEyesSubcall && imageHash) {
      const cached = await getEyesCache(imageHash);
      if (cached) {
        eyesNotes = cached;
        await recordEyesCacheHit();
      }
    }

    if (images.length > 0 && !(needsEyesSubcall && eyesNotes)) {
      const uploaded: DeepSeekUploadedFile[] = [];
      for (let i = 0; i < images.length; i += 1) {
        const image = images[i];
        const { blob, filename } = await resolveImage(image, signal);
        if (blob.size > MAX_IMAGE_BYTES) {
          return {
            error: {
              code: 'invalid_request',
              message: `Image ${filename} exceeds the 8MB upload limit.`,
            },
          };
        }
        const uploadPowHeaders = await createUploadPow(headers);
        const file = await uploadFile(
          {
            file: blob,
            filename,
            modelType: usesSquid ? 'default' : 'vision',
            clientHeaders: headers,
            powHeaders: uploadPowHeaders,
          },
          signal,
        );
        uploaded.push(file);
      }
      visionFileIds = uploaded.map((f) => f.id).filter(Boolean);
    }

    if (needsEyesSubcall && !eyesNotes && visionFileIds.length > 0) {
      // Eyes sessions stay ephemeral (one-shot vision chat).
      const eyesSessionId = await createSession(headers);
      const eyesPow = await createPow(headers);
      let eyesText = '';
      const eyesTurn = await submitStreaming(
        {
          chatSessionId: eyesSessionId,
          parentMessageId: null,
          modelType: 'vision',
          prompt: EYES_SUBCALL_PROMPT,
          refFileIds: visionFileIds,
          thinkingEnabled: false,
          searchEnabled: false,
          clientHeaders: headers,
          powHeaders: eyesPow,
        },
        {
          onTextChunk(_newText, full) {
            eyesText = full;
          },
        },
        signal,
      );
      eyesNotes = formatEyesNotes(eyesText || eyesTurn.assistantText || '', visionFileIds.length);
      if (imageHash && eyesNotes) {
        await setEyesCache(imageHash, eyesNotes);
      }
    }

    const prompt = messagesToPrompt(job.messages, {
      clientProfile: job.clientProfile ?? 'generic',
      eyesNotes,
      deltaOnly: sticky,
      dppContext: job.dppContext,
    });
    if (!prompt && visionFileIds.length === 0) {
      return { error: { code: 'invalid_request', message: 'Prompt is empty.' } };
    }

    if (!chatSessionId) {
      chatSessionId = await createSession(headers);
      parentMessageId = null;
    }

    const powHeaders = await createPow(headers);
    let fullText = '';
    let streamedAny = false;

    const mainPrompt =
      prompt
      || (useNativeVisionMain
        ? 'Describe the attached image(s) carefully and answer any visible question.'
        : '');

    const turn = await submitStreaming(
      {
        chatSessionId,
        parentMessageId,
        modelType,
        prompt: mainPrompt,
        refFileIds: useNativeVisionMain ? visionFileIds : [],
        thinkingEnabled: job.thinkingEnabled,
        searchEnabled: bridgeModelSearchEnabled(job.model),
        clientHeaders: headers,
        powHeaders,
      },
      {
        onTextChunk(newText, full) {
          fullText = full;
          if (newText) {
            streamedAny = true;
            onChunk(newText);
          }
        },
      },
      signal,
    );

    let text = fullText || turn.assistantText || '';

    // History fallback: recover full assistant text if stream missed opening tokens.
    if (turn.responseMessageId != null) {
      try {
        const snapshot = await readHistory(chatSessionId, turn.responseMessageId, headers);
        const historyText = snapshot?.assistantText?.trim() ?? '';
        if (historyText) {
          const repaired = repairOpeningTruncation(text, historyText);
          if (repaired !== text) {
            if (!streamedAny) {
              onChunk(repaired);
            } else if (repaired.startsWith(text) && repaired.length > text.length) {
              // Emit only the missing prefix if stream opened mid-word.
              const missing = repaired.slice(0, repaired.length - text.length);
              // Only emit prefix when history is prefix+stream (classic chop).
              if (repaired.endsWith(text) || historyText.endsWith(text)) {
                const prefix = repaired.slice(0, Math.max(0, repaired.length - text.length));
                if (prefix && prefix.length <= 12) onChunk(prefix);
              }
            }
            text = repaired;
          }
        }
        if (snapshot?.parentMessageId != null || snapshot?.assistantMessageId != null) {
          parentMessageId = snapshot.parentMessageId ?? snapshot.assistantMessageId;
        } else if (turn.responseMessageId != null) {
          parentMessageId = turn.responseMessageId;
        }
      } catch {
        if (turn.responseMessageId != null) parentMessageId = turn.responseMessageId;
      }
    } else if (turn.responseMessageId != null) {
      parentMessageId = turn.responseMessageId;
    }

    const now = Date.now();
    const record: BridgeThreadRecord = {
      id: threadId,
      modelFamily,
      chatSessionId,
      parentMessageId,
      modelType,
      sessionUrl: buildDeepSeekSessionUrl(chatSessionId),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      turnCount: (existing?.turnCount ?? 0) + 1,
    };
    // Final safety: if opening still looks chopped, prefer any longer history-backed text already applied;
    // if we never got history content, leave text as-is (SSE root cause).
    if (looksLikeMissingOpening(text) && text.length > 0) {
      // no-op marker for tests/debug — sticky path already tried history
    }

    await putThread(record);
    await recordStickyOutcome(sticky, { promptChars: mainPrompt.length });
    await setBridgeLastError(null);

    return { text, threadId, sticky };
  } catch (err) {
    if (err instanceof DeepSeekAuthError) {
      await setBridgeLastError(err.message);
      return {
        error: {
          code: 'missing_login',
          message: err.message,
        },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    await setBridgeLastError(message);
    if (signal?.aborted) {
      return { error: { code: 'aborted', message: 'Request aborted.' } };
    }
    return { error: { code: 'upstream_error', message } };
  }
}

/** Used by tests / hosts that only need header construction without chrome. */
export function createClientHeadersSafe(): Record<string, string> | null {
  try {
    return createClientHeaders();
  } catch {
    return null;
  }
}

function hashImages(images: CursorBridgeImagePart[]): string {
  const seed = images
    .map((img) => `${img.mimeType ?? ''}|${img.url.slice(0, 120)}|${img.url.length}|${img.assetPath ?? ''}`)
    .join('\n');
  return simpleHash(seed);
}

function looksLikeMissingOpening(text: string): boolean {
  if (!text) return true;
  // Leading space or mid-word lowercase after a cut (" are three", "-turn", "icky ")
  if (text.startsWith(' ') || text.startsWith("'") || text.startsWith('-')) return true;
  if (/^[a-z]{2,}/.test(text) && !/^(https?|e\.g|i\.e)/i.test(text)) {
    // Many full answers start with capital; lowercase start often means chop
    return true;
  }
  return false;
}

function looksTruncatedOpening(streamed: string, history: string): boolean {
  if (!streamed || !history) return false;
  if (history === streamed) return false;
  if (history.endsWith(streamed) && history.length - streamed.length <= 4) return true;
  if (history.includes(streamed) && history.length > streamed.length) return true;
  return false;
}

async function defaultQueryDeepSeekTabs(): Promise<Array<{ id?: number }>> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return [];
  return chrome.tabs.query({ url: DEEPSEEK_TAB_URL_PATTERN });
}

export async function defaultResolveImageBlob(
  image: CursorBridgeImagePart,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const url = image.url;
  if (url.startsWith('data:')) {
    const blob = dataUrlToBlob(url);
    const ext = extensionForMime(blob.type || image.mimeType || 'image/png');
    return { blob, filename: `image.${ext}` };
  }

  if (image.assetPath || url.includes('/bridge-assets/')) {
    const fetchUrl = image.assetPath
      ? image.assetPath.startsWith('http')
        ? image.assetPath
        : `http://127.0.0.1:8787${image.assetPath.startsWith('/') ? '' : '/'}${image.assetPath}`
      : url;
    const response = await fetch(fetchUrl, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch bridge image asset: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const mime = blob.type || image.mimeType || 'image/png';
    const ext = extensionForMime(mime);
    return { blob: blob.type ? blob : new Blob([blob], { type: mime }), filename: `image.${ext}` };
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch image URL: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const mime = blob.type || image.mimeType || 'image/png';
    const ext = extensionForMime(mime);
    return { blob: blob.type ? blob : new Blob([blob], { type: mime }), filename: `image.${ext}` };
  }

  throw new Error('Unsupported image reference (need data URL, https URL, or bridge asset).');
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URL');
  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  const mimeMatch = /data:([^;]+)/i.exec(header);
  const mime = mimeMatch?.[1] || 'application/octet-stream';
  const isBase64 = /;base64/i.test(header);
  if (isBase64) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
}

function extensionForMime(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('png')) return 'png';
  return 'png';
}
