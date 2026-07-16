import {
  createChatAdmissionCoordinator,
  type ChatAdmissionCoordinator,
  type ChatAdmissionLease,
} from './chat-admission-coordinator';

export interface ProviderChatTurnContext {
  readonly signal: AbortSignal;
  assertActive(): void;
}

export interface ProviderChatTurnCoordinatorDependencies<TRequest extends { text: string }> {
  admissionCoordinator?: ChatAdmissionCoordinator;
  beforeSubmit?(): Promise<void>;
  getChatEnabled(): Promise<boolean>;
  runTurn(
    request: TRequest,
    context: ProviderChatTurnContext,
    excludeTabId?: number,
  ): Promise<void>;
  handleTurnError(request: TRequest, error: unknown, excludeTabId?: number): void | Promise<void>;
  reportError?(code: string, error: unknown): void;
  resetState(): void | Promise<void>;
}

export interface ProviderChatTurnCoordinator<TRequest extends { text: string }> {
  submit(
    request: TRequest,
    excludeTabId?: number,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  resetSession(): Promise<void>;
}

interface ActiveProviderTurn {
  generation: number;
  controller: AbortController;
  settled: Promise<void>;
  admissionLease: ChatAdmissionLease;
}

interface PendingProviderAdmission {
  generation: number;
  admissionLease: ChatAdmissionLease;
}

export function createProviderChatTurnCoordinator<TRequest extends { text: string }>(
  dependencies: ProviderChatTurnCoordinatorDependencies<TRequest>,
): ProviderChatTurnCoordinator<TRequest> {
  let generation = 0;
  let activeTurn: ActiveProviderTurn | null = null;
  let pendingAdmission: PendingProviderAdmission | null = null;
  let resetOperation: Promise<void> | null = null;
  const admissionCoordinator = dependencies.admissionCoordinator
    ?? createChatAdmissionCoordinator();

  const assertTurnActive = (turn: ActiveProviderTurn): void => {
    if (
      activeTurn === turn
      && turn.generation === generation
      && !turn.controller.signal.aborted
    ) return;
    if (turn.controller.signal.reason instanceof Error) throw turn.controller.signal.reason;
    throw new DOMException('Provider chat turn was cancelled.', 'AbortError');
  };

  const runTurn = async (
    turn: ActiveProviderTurn,
    request: TRequest,
    excludeTabId?: number,
  ): Promise<void> => {
    try {
      await dependencies.runTurn(request, {
        signal: turn.controller.signal,
        assertActive: () => assertTurnActive(turn),
      }, excludeTabId);
    } catch (error) {
      if (!isExpectedCancellation(turn, activeTurn, generation)) {
        try {
          await dependencies.handleTurnError(request, error, excludeTabId);
        } catch (reportingError) {
          dependencies.reportError?.(
            'provider_chat_turn_error_handler_failed',
            reportingError,
          );
        }
      }
    } finally {
      if (activeTurn === turn) activeTurn = null;
      admissionCoordinator.release(turn.admissionLease);
    }
  };

  const submit: ProviderChatTurnCoordinator<TRequest>['submit'] = async (
    request,
    excludeTabId,
  ) => {
    if (dependencies.beforeSubmit) await dependencies.beforeSubmit();
    if (activeTurn || pendingAdmission || resetOperation) {
      return { ok: false, error: 'chat_already_running' };
    }

    const admissionLease = admissionCoordinator.acquire();
    if (!admissionLease) return { ok: false, error: 'chat_already_running' };

    const admission: PendingProviderAdmission = { generation, admissionLease };
    pendingAdmission = admission;
    let enabled: boolean;
    try {
      enabled = await dependencies.getChatEnabled();
    } catch (error) {
      if (pendingAdmission !== admission || admission.generation !== generation) {
        admissionCoordinator.release(admissionLease);
        return { ok: false, error: 'chat_already_running' };
      }
      pendingAdmission = null;
      admissionCoordinator.release(admissionLease);
      throw error;
    }
    if (
      pendingAdmission !== admission
      || admission.generation !== generation
      || resetOperation
    ) {
      admissionCoordinator.release(admissionLease);
      return { ok: false, error: 'chat_already_running' };
    }
    if (!enabled) {
      pendingAdmission = null;
      admissionCoordinator.release(admissionLease);
      return { ok: false, error: 'chat_disabled' };
    }
    if (!request.text.trim()) {
      pendingAdmission = null;
      admissionCoordinator.release(admissionLease);
      return { ok: false, error: 'empty_prompt' };
    }

    const turn: ActiveProviderTurn = {
      generation,
      controller: new AbortController(),
      settled: Promise.resolve(),
      admissionLease,
    };
    activeTurn = turn;
    pendingAdmission = null;
    turn.settled = runTurn(turn, request, excludeTabId);
    return { ok: true };
  };

  const performReset = async (): Promise<void> => {
    const resetLease = admissionCoordinator.beginReset();
    try {
      generation += 1;
      if (pendingAdmission) {
        admissionCoordinator.release(pendingAdmission.admissionLease);
        pendingAdmission = null;
      }
      const turn = activeTurn;
      turn?.controller.abort(new DOMException(
        'Provider chat session was reset.',
        'AbortError',
      ));
      await (turn?.settled ?? Promise.resolve());
      await dependencies.resetState();
    } finally {
      admissionCoordinator.endReset(resetLease);
    }
  };

  const resetSession = (): Promise<void> => {
    if (resetOperation) return resetOperation;
    resetOperation = performReset().finally(() => {
      resetOperation = null;
    });
    return resetOperation;
  };

  return Object.freeze({ submit, resetSession });
}

function isExpectedCancellation(
  turn: ActiveProviderTurn,
  activeTurn: ActiveProviderTurn | null,
  generation: number,
): boolean {
  return turn.controller.signal.aborted
    || activeTurn !== turn
    || turn.generation !== generation;
}

export type ProviderTransportKind =
  | 'deepseek-web'
  | 'deepseek-official'
  | 'qwen-web';

export function getProviderAttachmentTransportError(
  transportKind: ProviderTransportKind,
  hasAttachments: boolean,
): string | null {
  return transportKind === 'deepseek-official' && hasAttachments
    ? 'attachments_unsupported_for_official_api'
    : null;
}

export interface ProviderImageUploadContext {
  readonly signal: AbortSignal;
  assertActive(): void;
}

export interface ProviderImageUploadCoordinatorDependencies<TRequest, TResponse> {
  isResetting?(): boolean;
  getChatEnabled(): Promise<boolean>;
  runUpload(
    request: TRequest,
    context: ProviderImageUploadContext,
    excludeTabId?: number,
  ): Promise<TResponse>;
}

export interface ProviderImageUploadCoordinator<TRequest, TResponse> {
  upload(
    request: TRequest,
    excludeTabId?: number,
  ): Promise<TResponse | { ok: false; error: string }>;
  resetSession(): Promise<void>;
}

interface ActiveProviderImageUpload {
  generation: number;
  controller: AbortController;
  settled: Promise<void>;
}

export function createProviderImageUploadCoordinator<TRequest, TResponse>(
  dependencies: ProviderImageUploadCoordinatorDependencies<TRequest, TResponse>,
): ProviderImageUploadCoordinator<TRequest, TResponse> {
  let generation = 0;
  let resetOperation: Promise<void> | null = null;
  const activeUploads = new Set<ActiveProviderImageUpload>();

  const assertUploadActive = (upload: ActiveProviderImageUpload): void => {
    if (
      activeUploads.has(upload)
      && upload.generation === generation
      && !upload.controller.signal.aborted
    ) return;
    if (upload.controller.signal.reason instanceof Error) {
      throw upload.controller.signal.reason;
    }
    throw new DOMException('Provider image upload was cancelled.', 'AbortError');
  };

  const runUpload = async (
    upload: ActiveProviderImageUpload,
    request: TRequest,
    excludeTabId?: number,
  ): Promise<TResponse | { ok: false; error: string }> => {
    try {
      const enabled = await dependencies.getChatEnabled();
      assertUploadActive(upload);
      if (!enabled) return { ok: false, error: 'chat_disabled' };
      return await dependencies.runUpload(request, {
        signal: upload.controller.signal,
        assertActive: () => assertUploadActive(upload),
      }, excludeTabId);
    } catch (error) {
      if (
        upload.controller.signal.aborted
        || !activeUploads.has(upload)
        || upload.generation !== generation
      ) {
        assertUploadActive(upload);
      }
      throw error;
    }
  };

  const upload: ProviderImageUploadCoordinator<TRequest, TResponse>['upload'] = async (
    request,
    excludeTabId,
  ) => {
    if (resetOperation || dependencies.isResetting?.()) {
      return { ok: false, error: 'chat_already_running' };
    }
    const entry: ActiveProviderImageUpload = {
      generation,
      controller: new AbortController(),
      settled: Promise.resolve(),
    };
    activeUploads.add(entry);
    const operation = runUpload(entry, request, excludeTabId);
    entry.settled = operation.then(() => undefined, () => undefined);
    try {
      return await operation;
    } finally {
      activeUploads.delete(entry);
    }
  };

  const performReset = async (): Promise<void> => {
    generation += 1;
    const uploads = [...activeUploads];
    for (const upload of uploads) {
      upload.controller.abort(new DOMException(
        'Provider image upload was reset.',
        'AbortError',
      ));
    }
    await Promise.all(uploads.map((upload) => upload.settled));
  };

  const resetSession = (): Promise<void> => {
    if (resetOperation) return resetOperation;
    resetOperation = performReset().finally(() => {
      resetOperation = null;
    });
    return resetOperation;
  };

  return Object.freeze({ upload, resetSession });
}
