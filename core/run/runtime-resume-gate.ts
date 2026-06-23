export type AutonomousRuntimeResumeScope = 'chrome_runtime';

export type AutonomousRuntimeResumeGateStatus = 'blocked' | 'authorized';

export type AutonomousRuntimeResumeGateReason =
  | 'authorized'
  | 'missing_authorization'
  | 'authorization_not_explicit'
  | 'authorization_not_durable'
  | 'scope_mismatch'
  | 'authorization_expired'
  | 'runtime_files_changed_before_authorization'
  | 'checklist_incomplete'
  | 'independent_review_missing'
  | 'independent_review_blocked';

export interface AutonomousRuntimeResumeAuthorization {
  id?: unknown;
  explicit?: unknown;
  scope?: unknown;
  authorizedAt?: unknown;
  expiresAt?: unknown;
}

export interface AutonomousRuntimeResumeChecklist {
  commandsDocumented?: unknown;
  runtimeSmokeDocumented?: unknown;
  chromeSafetyChecksDocumented?: unknown;
  manualAuthorizationRecordDocumented?: unknown;
  rollbackPathDocumented?: unknown;
  p1p2ReviewRequired?: unknown;
}

export interface AutonomousRuntimeResumeReviewGate {
  status?: unknown;
  openP1Count?: unknown;
  openP2Count?: unknown;
}

export interface AutonomousRuntimeResumeGateInput {
  requestedScope?: AutonomousRuntimeResumeScope;
  authorization?: AutonomousRuntimeResumeAuthorization | null;
  checklist?: AutonomousRuntimeResumeChecklist | null;
  independentReview?: AutonomousRuntimeResumeReviewGate | null;
  runtimeFilesChanged?: unknown;
  now?: number;
}

export interface AutonomousRuntimeResumeGateDecision {
  status: AutonomousRuntimeResumeGateStatus;
  canResumeRuntime: boolean;
  reason: AutonomousRuntimeResumeGateReason;
  requestedScope: AutonomousRuntimeResumeScope;
  authorizationPresent: boolean;
  authorizationIdPresent: boolean;
  authorizationExplicit: boolean;
  authorizationScope: AutonomousRuntimeResumeScope | null;
  authorizationFresh: boolean;
  runtimeFilesChanged: boolean;
  missingChecklistItems: string[];
  openP1Count: number;
  openP2Count: number;
}

interface NormalizedRuntimeResumeAuthorization {
  present: boolean;
  idPresent: boolean;
  explicit: boolean;
  scope: AutonomousRuntimeResumeScope | null;
  authorizedAt: number | null;
  expiresAt: number | null;
}

const REQUIRED_CHECKLIST_ITEMS: Array<keyof AutonomousRuntimeResumeChecklist> = [
  'commandsDocumented',
  'runtimeSmokeDocumented',
  'chromeSafetyChecksDocumented',
  'manualAuthorizationRecordDocumented',
  'rollbackPathDocumented',
  'p1p2ReviewRequired',
];

export function evaluateAutonomousRuntimeResumeGate(
  input: AutonomousRuntimeResumeGateInput = {},
): AutonomousRuntimeResumeGateDecision {
  const requestedScope = input.requestedScope ?? 'chrome_runtime';
  const authorization = normalizeAuthorization(input.authorization);
  const missingChecklistItems = collectMissingChecklistItems(input.checklist);
  const openP1Count = normalizeCount(input.independentReview?.openP1Count);
  const openP2Count = normalizeCount(input.independentReview?.openP2Count);
  const runtimeFilesChanged = input.runtimeFilesChanged === true;
  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
  const authorizationFresh = authorization.expiresAt === null || authorization.expiresAt > now;

  let reason: AutonomousRuntimeResumeGateReason = 'authorized';
  if (!authorization.present) {
    reason = 'missing_authorization';
  } else if (!authorization.explicit) {
    reason = 'authorization_not_explicit';
  } else if (!authorization.idPresent || authorization.authorizedAt === null) {
    reason = 'authorization_not_durable';
  } else if (authorization.scope !== requestedScope) {
    reason = 'scope_mismatch';
  } else if (!authorizationFresh) {
    reason = 'authorization_expired';
  } else if (runtimeFilesChanged) {
    reason = 'runtime_files_changed_before_authorization';
  } else if (missingChecklistItems.length > 0) {
    reason = 'checklist_incomplete';
  } else if (openP1Count > 0 || openP2Count > 0 || input.independentReview?.status === 'blocked') {
    reason = 'independent_review_blocked';
  } else if (!input.independentReview || input.independentReview.status !== 'passed') {
    reason = 'independent_review_missing';
  }

  const canResumeRuntime = reason === 'authorized';
  return {
    status: canResumeRuntime ? 'authorized' : 'blocked',
    canResumeRuntime,
    reason,
    requestedScope,
    authorizationPresent: authorization.present,
    authorizationIdPresent: authorization.idPresent,
    authorizationExplicit: authorization.explicit,
    authorizationScope: authorization.scope,
    authorizationFresh,
    runtimeFilesChanged,
    missingChecklistItems,
    openP1Count,
    openP2Count,
  };
}

function normalizeAuthorization(
  input: AutonomousRuntimeResumeAuthorization | null | undefined,
): NormalizedRuntimeResumeAuthorization {
  if (!input || typeof input !== 'object') {
    return {
      present: false,
      idPresent: false,
      explicit: false,
      scope: null,
      authorizedAt: null,
      expiresAt: null,
    };
  }
  return {
    present: true,
    idPresent: typeof input.id === 'string' && input.id.trim().length > 0,
    explicit: input.explicit === true,
    scope: input.scope === 'chrome_runtime' ? input.scope : null,
    authorizedAt: normalizeTimestamp(input.authorizedAt),
    expiresAt: normalizeTimestamp(input.expiresAt),
  };
}

function collectMissingChecklistItems(
  checklist: AutonomousRuntimeResumeChecklist | null | undefined,
): string[] {
  const record = checklist && typeof checklist === 'object' ? checklist : {};
  return REQUIRED_CHECKLIST_ITEMS.filter((item) => record[item] !== true);
}

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}
