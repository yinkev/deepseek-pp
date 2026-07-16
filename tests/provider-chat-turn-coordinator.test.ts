import { describe, expect, it, vi } from 'vitest';
import { createChatAdmissionCoordinator } from '../entrypoints/background/chat-admission-coordinator';
import {
  createProviderChatTurnCoordinator,
  createProviderImageUploadCoordinator,
  getProviderAttachmentTransportError,
  type ProviderChatTurnContext,
  type ProviderImageUploadContext,
} from '../entrypoints/background/provider-chat-turn-coordinator';

describe('provider chat turn coordinator', () => {
  it('aborts and awaits the active provider turn before New Session resets state', async () => {
    const firstTurn = deferred<void>();
    let firstContext: ProviderChatTurnContext | undefined;
    const writes: string[] = [];
    const resetState = vi.fn(async () => {
      writes.push('reset');
    });
    const runTurn = vi.fn(async (request: { text: string }, context: ProviderChatTurnContext) => {
      if (request.text === 'old') {
        firstContext = context;
        await firstTurn.promise;
        context.assertActive();
        writes.push('old-completed');
        return;
      }
      context.assertActive();
      writes.push(request.text);
    });
    const handleTurnError = vi.fn();
    const coordinator = createProviderChatTurnCoordinator({
      getChatEnabled: vi.fn(async () => true),
      runTurn,
      handleTurnError,
      resetState,
    });

    await expect(coordinator.submit({ text: 'old' })).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledOnce());
    await expect(coordinator.submit({ text: 'overlap' })).resolves.toEqual({
      ok: false,
      error: 'chat_already_running',
    });

    let resetSettled = false;
    const reset = coordinator.resetSession().then(() => {
      resetSettled = true;
    });
    expect(firstContext?.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(resetSettled).toBe(false);
    expect(resetState).not.toHaveBeenCalled();

    firstTurn.resolve();
    await reset;
    expect(handleTurnError).not.toHaveBeenCalled();
    expect(writes).toEqual(['reset']);

    await expect(coordinator.submit({ text: 'fresh' })).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(writes).toEqual(['reset', 'fresh']));
  });

  it('waits for wake reconciliation before provider admission', async () => {
    const wake = deferred<void>();
    const getChatEnabled = vi.fn(async () => true);
    const runTurn = vi.fn(async () => undefined);
    const coordinator = createProviderChatTurnCoordinator({
      beforeSubmit: vi.fn(() => wake.promise),
      getChatEnabled,
      runTurn,
      handleTurnError: vi.fn(),
      resetState: vi.fn(),
    });

    const submission = coordinator.submit({ text: 'fresh' });
    await Promise.resolve();
    expect(getChatEnabled).not.toHaveBeenCalled();
    expect(runTurn).not.toHaveBeenCalled();

    wake.resolve();
    await expect(submission).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledOnce());
  });

  it('invalidates a pending admission when reset wins the feature-gate race', async () => {
    const gate = deferred<boolean>();
    const runTurn = vi.fn(async () => undefined);
    const resetState = vi.fn(async () => undefined);
    const coordinator = createProviderChatTurnCoordinator({
      getChatEnabled: vi.fn()
        .mockReturnValueOnce(gate.promise)
        .mockResolvedValue(true),
      runTurn,
      handleTurnError: vi.fn(),
      resetState,
    });

    const stale = coordinator.submit({ text: 'stale' });
    await coordinator.resetSession();
    await expect(coordinator.submit({ text: 'fresh' })).resolves.toEqual({ ok: true });
    gate.resolve(true);

    await expect(stale).resolves.toEqual({ ok: false, error: 'chat_already_running' });
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledOnce());
    expect(runTurn).toHaveBeenCalledWith(
      { text: 'fresh' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      undefined,
    );
  });

  it('suppresses a stale feature-gate failure after reset invalidates admission', async () => {
    const gate = deferred<boolean>();
    const coordinator = createProviderChatTurnCoordinator({
      getChatEnabled: vi.fn(() => gate.promise),
      runTurn: vi.fn(async () => undefined),
      handleTurnError: vi.fn(),
      resetState: vi.fn(),
    });

    const stale = coordinator.submit({ text: 'stale' });
    await coordinator.resetSession();
    gate.reject(new Error('stale storage failure'));

    await expect(stale).resolves.toEqual({ ok: false, error: 'chat_already_running' });
  });

  it('holds the shared reset lease until provider state clearing settles', async () => {
    const admissionCoordinator = createChatAdmissionCoordinator();
    const resetState = deferred<void>();
    const coordinator = createProviderChatTurnCoordinator({
      admissionCoordinator,
      getChatEnabled: vi.fn(async () => true),
      runTurn: vi.fn(async () => undefined),
      handleTurnError: vi.fn(),
      resetState: vi.fn(() => resetState.promise),
    });

    const reset = coordinator.resetSession();
    await Promise.resolve();
    expect(admissionCoordinator.acquire()).toBeNull();
    resetState.resolve();
    await reset;
    expect(admissionCoordinator.acquire()).not.toBeNull();
  });

  it('contains a rejected detached error handler and reports it', async () => {
    const reportError = vi.fn();
    const coordinator = createProviderChatTurnCoordinator({
      getChatEnabled: vi.fn(async () => true),
      runTurn: vi.fn(async () => {
        throw new Error('provider failed');
      }),
      handleTurnError: vi.fn(async () => {
        throw new Error('notification failed');
      }),
      reportError,
      resetState: vi.fn(),
    });

    await expect(coordinator.submit({ text: 'run' })).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(
      'provider_chat_turn_error_handler_failed',
      expect.objectContaining({ message: 'notification failed' }),
    ));
    await expect(coordinator.submit({ text: 'next' })).resolves.toEqual({ ok: true });
  });

  it('preserves disabled-before-empty validation and reports only active failures', async () => {
    const handleTurnError = vi.fn();
    const coordinator = createProviderChatTurnCoordinator({
      getChatEnabled: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true),
      runTurn: vi.fn(async () => {
        throw new Error('provider failed');
      }),
      handleTurnError,
      resetState: vi.fn(),
    });

    await expect(coordinator.submit({ text: '' })).resolves.toEqual({
      ok: false,
      error: 'chat_disabled',
    });
    await expect(coordinator.submit({ text: '' })).resolves.toEqual({
      ok: false,
      error: 'empty_prompt',
    });
    await expect(coordinator.submit({ text: 'run' }, 17)).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(handleTurnError).toHaveBeenCalledWith(
      { text: 'run' },
      expect.objectContaining({ message: 'provider failed' }),
      17,
    ));
  });
});

describe('provider image upload coordinator', () => {
  it('rejects attachments for the official transport only', () => {
    expect(getProviderAttachmentTransportError('deepseek-official', true))
      .toBe('attachments_unsupported_for_official_api');
    expect(getProviderAttachmentTransportError('deepseek-official', false)).toBeNull();
    expect(getProviderAttachmentTransportError('deepseek-web', true)).toBeNull();
    expect(getProviderAttachmentTransportError('qwen-web', true)).toBeNull();
  });

  it('rejects uploads while the shared chat reset lease is active', async () => {
    let resetting = true;
    const runUpload = vi.fn(async () => ({ ok: true as const }));
    const coordinator = createProviderImageUploadCoordinator({
      isResetting: () => resetting,
      getChatEnabled: vi.fn(async () => true),
      runUpload,
    });

    await expect(coordinator.upload({ id: 'blocked' })).resolves.toEqual({
      ok: false,
      error: 'chat_already_running',
    });
    expect(runUpload).not.toHaveBeenCalled();

    resetting = false;
    await expect(coordinator.upload({ id: 'fresh' })).resolves.toEqual({ ok: true });
    expect(runUpload).toHaveBeenCalledOnce();
  });

  it('applies the chat-disabled gate before decoding or provider work', async () => {
    const runUpload = vi.fn(async () => ({ ok: true as const }));
    const coordinator = createProviderImageUploadCoordinator({
      getChatEnabled: vi.fn(async () => false),
      runUpload,
    });

    await expect(coordinator.upload({ malformed: true })).resolves.toEqual({
      ok: false,
      error: 'chat_disabled',
    });
    expect(runUpload).not.toHaveBeenCalled();
  });

  it('aborts and awaits active uploads before session reset settles', async () => {
    const provider = deferred<void>();
    let context: ProviderImageUploadContext | undefined;
    const coordinator = createProviderImageUploadCoordinator({
      getChatEnabled: vi.fn(async () => true),
      runUpload: vi.fn(async (_request: { id: string }, uploadContext) => {
        context = uploadContext;
        await provider.promise;
        uploadContext.assertActive();
        return { ok: true as const };
      }),
    });

    const upload = coordinator.upload({ id: 'old' });
    await vi.waitFor(() => expect(context).toBeDefined());
    let resetSettled = false;
    const reset = coordinator.resetSession().then(() => {
      resetSettled = true;
    });
    expect(context?.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(resetSettled).toBe(false);

    provider.resolve();
    await reset;
    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('suppresses a stale feature-gate rejection after reset aborts the upload', async () => {
    const gate = deferred<boolean>();
    const coordinator = createProviderImageUploadCoordinator({
      getChatEnabled: vi.fn(() => gate.promise),
      runUpload: vi.fn(async () => ({ ok: true as const })),
    });

    const upload = coordinator.upload({ id: 'stale' });
    const reset = coordinator.resetSession();
    gate.reject(new Error('stale storage failure'));
    await reset;

    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
