export type SidepanelChatTerminalErrorBroadcaster = (
  message: string,
  excludeTabId: number | undefined,
  streamId: string,
  statusSummary?: string,
) => void;

export interface RunSidepanelChatSubmitJobInput {
  job: Promise<void>;
  excludeTabId: number | undefined;
  streamId: string;
  controller: AbortController;
  timeoutMs: number;
  timeoutError: string;
  broadcastTerminalError: SidepanelChatTerminalErrorBroadcaster;
  markChatLoopFinished: (loopId?: string) => Promise<unknown> | unknown;
}

export async function runSidepanelChatSubmitJobWithTimeout(input: RunSidepanelChatSubmitJobInput): Promise<void> {
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timeoutCleanup: Promise<void> | null = null;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      input.controller.abort();
      input.broadcastTerminalError(input.timeoutError, input.excludeTabId, input.streamId, input.timeoutError);
      timeoutCleanup = (async () => {
        try {
          await input.markChatLoopFinished(input.streamId);
        } catch {
          // The terminal timeout event has already been emitted; do not surface cleanup failures as late UI errors.
        }
      })();
      void timeoutCleanup.then(resolve);
    }, input.timeoutMs);
  });
  const guardedJob = input.job.catch((err) => {
    if (timedOut) return;
    const msg = err instanceof Error ? err.message : String(err);
    input.broadcastTerminalError(msg, input.excludeTabId, input.streamId, msg);
  });
  try {
    await Promise.race([guardedJob, timeout]);
    if (timedOut && timeoutCleanup) {
      await timeoutCleanup;
    }
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export function throwIfSidepanelChatJobAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DOMException('Sidepanel chat job aborted.', 'AbortError');
}

export function isSidepanelChatJobAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
    || err instanceof Error && err.name === 'AbortError';
}
