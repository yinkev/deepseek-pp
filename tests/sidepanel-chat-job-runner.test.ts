import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runSidepanelChatSubmitJobWithTimeout,
  throwIfSidepanelChatJobAborted,
} from '../core/chat/sidepanel-job-runner';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sidepanel chat job runner', () => {
  it('aborts timed-out jobs and suppresses late terminal errors', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const broadcastTerminalError = vi.fn();
    const markChatLoopFinished = vi.fn();
    const lateFinal = vi.fn();
    let releaseJob!: () => void;

    const job = (async () => {
      await new Promise<void>((resolve) => {
        releaseJob = resolve;
      });
      throwIfSidepanelChatJobAborted(controller.signal);
      lateFinal();
    })();

    const run = runSidepanelChatSubmitJobWithTimeout({
      job,
      excludeTabId: 7,
      streamId: 'stream-1',
      controller,
      timeoutMs: 10,
      timeoutError: 'timeout',
      broadcastTerminalError,
      markChatLoopFinished,
    });

    await vi.advanceTimersByTimeAsync(10);
    await run;

    expect(controller.signal.aborted).toBe(true);
    expect(broadcastTerminalError).toHaveBeenCalledTimes(1);
    expect(broadcastTerminalError).toHaveBeenCalledWith('timeout', 7, 'stream-1', 'timeout');
    expect(markChatLoopFinished).toHaveBeenCalledTimes(1);
    expect(markChatLoopFinished).toHaveBeenCalledWith('stream-1');

    releaseJob();
    await Promise.resolve();

    expect(lateFinal).not.toHaveBeenCalled();
    expect(broadcastTerminalError).toHaveBeenCalledTimes(1);
  });

  it('waits for timeout cleanup before resolving the runner', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const broadcastTerminalError = vi.fn();
    let resolveCleanup!: () => void;
    let runnerSettled = false;

    const run = runSidepanelChatSubmitJobWithTimeout({
      job: new Promise(() => undefined),
      excludeTabId: undefined,
      streamId: 'stream-1',
      controller,
      timeoutMs: 10,
      timeoutError: 'timeout',
      broadcastTerminalError,
      markChatLoopFinished: vi.fn(() => new Promise<void>((resolve) => {
        resolveCleanup = resolve;
      })),
    }).then(() => {
      runnerSettled = true;
    });

    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();

    expect(controller.signal.aborted).toBe(true);
    expect(runnerSettled).toBe(false);

    resolveCleanup();
    await run;

    expect(runnerSettled).toBe(true);
  });

  it('suppresses timeout cleanup failures after emitting the terminal error', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const broadcastTerminalError = vi.fn();

    const run = runSidepanelChatSubmitJobWithTimeout({
      job: new Promise(() => undefined),
      excludeTabId: 7,
      streamId: 'stream-1',
      controller,
      timeoutMs: 10,
      timeoutError: 'timeout',
      broadcastTerminalError,
      markChatLoopFinished: vi.fn(async () => {
        throw new Error('storage failed');
      }),
    });

    await vi.advanceTimersByTimeAsync(10);
    await run;

    expect(broadcastTerminalError).toHaveBeenCalledTimes(1);
    expect(broadcastTerminalError).toHaveBeenCalledWith('timeout', 7, 'stream-1', 'timeout');
  });

  it('reports job failures before the timeout fires', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const broadcastTerminalError = vi.fn();

    await runSidepanelChatSubmitJobWithTimeout({
      job: Promise.reject(new Error('model failed')),
      excludeTabId: undefined,
      streamId: 'stream-2',
      controller,
      timeoutMs: 10,
      timeoutError: 'timeout',
      broadcastTerminalError,
      markChatLoopFinished: vi.fn(),
    });

    expect(controller.signal.aborted).toBe(false);
    expect(broadcastTerminalError).toHaveBeenCalledTimes(1);
    expect(broadcastTerminalError).toHaveBeenCalledWith('model failed', undefined, 'stream-2', 'model failed');
  });
});
