// Tracks an in-flight sidepanel chat tool loop so a service-worker restart
// can be reconciled: if the SW dies mid-loop, the loop never emits a final
// `done:true` chunk and the sidepanel hangs. `reconcileInterruptedChatLoop`
// (called on every SW wake) detects a stale marker and lets the caller emit
// a terminating chunk.
//
// `chrome.storage.session` is used intentionally — it is cleared when the
// browser session ends, mirroring the lifetime of an in-flight chat turn.

const SESSION_STORAGE_KEY = 'deepseek_pp_active_chat_loop';
const STALE_THRESHOLD_MS = 15_000;

export type ChatLoopProvider = 'web' | 'official-api';

export interface ActiveChatLoop {
  active: boolean;
  id?: string;
  startedAt: number;
  provider: ChatLoopProvider;
  streamId?: string;
}

export interface InterruptedChatLoop {
  provider: ChatLoopProvider;
  startedAt: number;
  interruptedAt: number;
  streamId?: string;
}

async function readMarker(): Promise<ActiveChatLoop | null> {
  const data = await chrome.storage.session
    .get(SESSION_STORAGE_KEY) as Record<string, unknown>;
  const value = data[SESSION_STORAGE_KEY];
  if (!value || typeof value !== 'object') return null;
  const marker = value as Partial<ActiveChatLoop>;
  if (marker.active !== true || typeof marker.startedAt !== 'number') return null;
  return {
    active: true,
    id: typeof marker.id === 'string' && marker.id ? marker.id : undefined,
    startedAt: marker.startedAt,
    provider: marker.provider === 'official-api' ? 'official-api' : 'web',
    streamId: typeof marker.streamId === 'string' && marker.streamId ? marker.streamId : undefined,
  };
}

export async function markChatLoopStarted(
  provider: ChatLoopProvider,
  loopId: string = `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  streamId?: string,
): Promise<string> {
  const marker: ActiveChatLoop = {
    active: true,
    id: loopId,
    startedAt: Date.now(),
    provider,
    ...(streamId ? { streamId } : {}),
  };
  await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: marker });
  return loopId;
}

export async function markChatLoopFinished(loopId?: string): Promise<boolean> {
  if (loopId) {
    const marker = await readMarker();
    if (marker?.id && marker.id !== loopId) return false;
  }
  await chrome.storage.session.remove(SESSION_STORAGE_KEY);
  return true;
}

export async function getActiveChatLoop(): Promise<ActiveChatLoop | null> {
  return readMarker();
}

/**
 * Detects a chat loop that was interrupted by a service-worker termination.
 * Returns the interrupted loop descriptor when the marker is stale (i.e. the
 * SW was likely killed while the loop was still running), and clears the
 * marker. Returns `null` when there is no marker or it is still fresh, in
 * which case the loop may simply be running in the current SW instance.
 *
 * Callers should emit a final `done:true` chunk and reset in-memory state
 * when this returns a non-null value.
 */
export async function reconcileInterruptedChatLoop(
  now: number = Date.now(),
): Promise<InterruptedChatLoop | null> {
  const marker = await readMarker();
  if (!marker) return null;
  if (now - marker.startedAt < STALE_THRESHOLD_MS) return null;

  await markChatLoopFinished(marker.id);
  return {
    provider: marker.provider,
    startedAt: marker.startedAt,
    interruptedAt: now,
    streamId: marker.streamId,
  };
}
