export type RuntimeDoctorStorageArea = 'local' | 'session';

export interface RuntimeDoctorStorageIssue {
  area: RuntimeDoctorStorageArea;
  path: string;
  reason:
    | 'deepseek_web_headers'
    | 'session_state_in_local_storage'
    | 'auth_marker_in_local_storage'
    | 'raw_image_data'
    | 'vision_ref_data'
    | 'storage_read_failed';
}

export interface RuntimeDoctorStorageScan {
  ok: boolean;
  issues: RuntimeDoctorStorageIssue[];
}

export interface RuntimeDoctorReport {
  ok: true;
  generatedAt: number;
  chatEnabled: boolean;
  chatBusy: boolean;
  provider: 'deepseek-web' | 'official-api' | null;
  hasApiKey: boolean;
  hasWebAuth: boolean;
  webAuthRejected: boolean;
  deepSeekTabCount: number;
  sidepanelSession: {
    active: boolean;
    source: 'memory' | 'session' | 'none';
    parentMessageId: number | null;
  };
  personalConvenience: {
    enabled: boolean;
    autoReadyCheckBeforeRun: boolean;
    autoRefreshWebAuth: boolean;
    sameSessionStrategy: 'current' | 'last' | 'new';
    visualMonitorDefault: boolean;
    reducedConfirmations: boolean;
    lastSessionRemembered: boolean;
    lastSessionSource: 'sidepanel' | 'automation' | null;
    lastSessionUpdatedAt: number | null;
  };
  vision: {
    maxImagesPerTurn: number;
    rawImagesStoredDurably: boolean;
  };
  browserControl: {
    enabled: boolean;
    targetSelected: boolean;
    targetLock: RuntimeDoctorTargetLockStatus;
    visualCaptureAllowed: boolean;
    actVerifyEnabled: boolean;
    evidencePacksEnabled: boolean;
    debugDistillerEnabled: boolean;
    monitorReady: boolean;
  };
  contentScripts: RuntimeDoctorContentScriptHealth;
  automation: {
    maxAttempts: number;
    retryableFailure: RuntimeDoctorAutomationFailure | null;
  };
  autopilot: RuntimeDoctorAutopilotStatus;
  humanEval: RuntimeDoctorHumanEval;
  leakSentry: RuntimeDoctorLeakSentry;
  leakQuarantine: RuntimeDoctorLeakQuarantine;
  debugDistiller: {
    enabled: boolean;
    suggestions: RuntimeDoctorDebugSuggestion[];
  };
  readiness: RuntimeDoctorReadiness;
  failureExplanations: RuntimeDoctorFailureExplanation[];
  storage: RuntimeDoctorStorageScan;
}

export interface RuntimeDoctorReadiness {
  ready: boolean;
  status: 'ready' | 'needs_attention' | 'blocked';
  blockers: RuntimeDoctorReadinessBlocker[];
  lastPreparedAt: number | null;
  preparing: boolean;
  targetStatus: 'ready' | 'reacquired' | 'selected_active' | 'missing' | 'unsupported' | 'not_controllable' | null;
  noLeak: boolean;
}

export type RuntimeDoctorReadinessBlocker =
  | 'chat_busy'
  | 'web_auth_missing'
  | 'web_auth_rejected'
  | 'deepseek_content_script_stale'
  | 'browser_control_disabled'
  | 'browser_target_missing'
  | 'browser_target_not_controllable'
  | 'browser_vision_capture_disabled'
  | 'act_verify_disabled'
  | 'evidence_packs_disabled'
  | 'storage_leak'
  | 'storage_scan_failed';

export interface RuntimeDoctorAutomationFailure {
  automationId: string;
  automationName: string;
  runId: string | null;
  code: string;
  message: string;
  phase: string;
  at: number;
}

export interface RuntimeDoctorAutopilotRun {
  id: string;
  source: 'startup' | 'manual' | 'repair';
  startedAt: number;
  finishedAt: number;
  ready: boolean;
  status: RuntimeDoctorReadiness['status'];
  grade: RuntimeDoctorHumanEval['grade'];
  blockers: RuntimeDoctorReadinessBlocker[];
  targetStatus: RuntimeDoctorReadiness['targetStatus'];
  repaired: string[];
  leakIssueCount: number;
}

export interface RuntimeDoctorAutopilotStatus {
  inFlightSource: RuntimeDoctorAutopilotRun['source'] | null;
  latestRun: RuntimeDoctorAutopilotRun | null;
  recentRuns: RuntimeDoctorAutopilotRun[];
}

export interface RuntimeDoctorTargetLockStatus {
  enabled: boolean;
  label: string | null;
  origin: string | null;
  updatedAt: number | null;
}

export interface RuntimeDoctorContentScriptHealth {
  checked: boolean;
  totalTabs: number;
  healthyTabs: number;
  staleTabs: number;
  staleTabIds: number[];
}

export interface RuntimeDoctorHumanEvalCheck {
  id: 'ready_loop' | 'same_session' | 'browser_vision' | 'tool_loop' | 'leak_sentry';
  label: string;
  prompt: string;
  status: 'pass' | 'warn' | 'fail';
  evidence: string;
}

export interface RuntimeDoctorHumanEval {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  checks: RuntimeDoctorHumanEvalCheck[];
}

export interface RuntimeDoctorLeakSentry {
  ok: boolean;
  grade: 'A' | 'F';
  issueCount: number;
  checkedAreas: RuntimeDoctorStorageArea[];
}

export interface RuntimeDoctorLeakQuarantineGroup {
  area: RuntimeDoctorStorageArea;
  reason: RuntimeDoctorStorageIssue['reason'];
  count: number;
  samplePaths: string[];
  cleanupEligible: boolean;
}

export interface RuntimeDoctorLeakQuarantine {
  issueCount: number;
  cleanupEligibleCount: number;
  groups: RuntimeDoctorLeakQuarantineGroup[];
}

export interface RuntimeDoctorFailureExplanation {
  blocker: RuntimeDoctorReadinessBlocker;
  severity: 'blocked' | 'attention';
  cause: string;
  action: string;
}

export interface RuntimeDoctorDebugSuggestion {
  id: string;
  kind: 'memory' | 'skill';
  title: string;
  preview: string;
  reason: string;
}

const CLIENT_HEADERS_KEY = 'deepseekCachedClientHeaders';
const SIDEPANEL_WEB_SESSION_KEY = 'deepseek_pp_sidepanel_web_chat_session';
const SIDEPANEL_WEB_AUTH_REJECTED_KEY = 'deepseek_pp_sidepanel_web_auth_rejected';
const ALLOWED_LOCAL_IMAGE_DATA_PATHS = new Set([
  'deepseek_pp_background.imageData',
]);

export function scanRuntimeDoctorStorage(input: {
  local?: Record<string, unknown>;
  session?: Record<string, unknown>;
  failedAreas?: RuntimeDoctorStorageArea[];
}): RuntimeDoctorStorageScan {
  const issues: RuntimeDoctorStorageIssue[] = [];
  const local = input.local ?? {};
  const session = input.session ?? {};
  for (const area of input.failedAreas ?? []) {
    issues.push({
      area,
      path: '(unavailable)',
      reason: 'storage_read_failed',
    });
  }

  if (Object.prototype.hasOwnProperty.call(local, CLIENT_HEADERS_KEY)) {
    issues.push({
      area: 'local',
      path: sanitizeStorageIssuePath(CLIENT_HEADERS_KEY),
      reason: 'deepseek_web_headers',
    });
  }
  if (Object.prototype.hasOwnProperty.call(local, SIDEPANEL_WEB_SESSION_KEY)) {
    issues.push({
      area: 'local',
      path: sanitizeStorageIssuePath(SIDEPANEL_WEB_SESSION_KEY),
      reason: 'session_state_in_local_storage',
    });
  }
  if (Object.prototype.hasOwnProperty.call(local, SIDEPANEL_WEB_AUTH_REJECTED_KEY)) {
    issues.push({
      area: 'local',
      path: sanitizeStorageIssuePath(SIDEPANEL_WEB_AUTH_REJECTED_KEY),
      reason: 'auth_marker_in_local_storage',
    });
  }

  collectRawImageIssues('local', local, issues);
  collectRawImageIssues('session', session, issues);
  collectAuthHeaderIssues('local', local, issues);
  collectAuthHeaderIssues('session', session, issues);
  collectVisionRefIssues('local', local, issues);
  collectVisionRefIssues('session', session, issues);

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function createRuntimeDoctorLeakQuarantine(
  storage: RuntimeDoctorStorageScan,
): RuntimeDoctorLeakQuarantine {
  const groups = new Map<string, RuntimeDoctorLeakQuarantineGroup>();
  for (const issue of storage.issues) {
    const key = `${issue.area}:${issue.reason}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.samplePaths.length < 3) existing.samplePaths.push(issue.path);
      continue;
    }
    groups.set(key, {
      area: issue.area,
      reason: issue.reason,
      count: 1,
      samplePaths: [issue.path],
      cleanupEligible: issue.reason !== 'storage_read_failed',
    });
  }
  const items = [...groups.values()];
  return {
    issueCount: storage.issues.length,
    cleanupEligibleCount: items
      .filter((group) => group.cleanupEligible)
      .reduce((total, group) => total + group.count, 0),
    groups: items,
  };
}

function collectRawImageIssues(
  area: RuntimeDoctorStorageArea,
  value: unknown,
  issues: RuntimeDoctorStorageIssue[],
  path = '',
): void {
  if (typeof value === 'string') {
    if (isForbiddenDurableMediaString(value) && !isAllowedLocalImagePath(area, path)) {
      issues.push({
        area,
        path: sanitizeStorageIssuePath(path),
        reason: 'raw_image_data',
      });
    }
    return;
  }

  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectRawImageIssues(area, entry, issues, `${path}[${index}]`));
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    collectRawImageIssues(area, entry, issues, nextPath);
  }
}

function collectVisionRefIssues(
  area: RuntimeDoctorStorageArea,
  value: unknown,
  issues: RuntimeDoctorStorageIssue[],
  path = '',
): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectVisionRefIssues(area, entry, issues, `${path}[${index}]`));
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (isVisionRefKey(key) && !isAllowedVisionRefPath(nextPath)) {
      issues.push({
        area,
        path: sanitizeStorageIssuePath(nextPath),
        reason: 'vision_ref_data',
      });
      continue;
    }
    collectVisionRefIssues(area, entry, issues, nextPath);
  }
}

function collectAuthHeaderIssues(
  area: RuntimeDoctorStorageArea,
  value: unknown,
  issues: RuntimeDoctorStorageIssue[],
  path = '',
): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectAuthHeaderIssues(area, entry, issues, `${path}[${index}]`));
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (!path && key === CLIENT_HEADERS_KEY) continue;
    if (isAllowedNonSecretScalarPath(nextPath, entry)) continue;
    if (
      typeof entry === 'string' &&
      entry &&
      (isForbiddenDurableSecretKey(key) || (key.toLowerCase() === 'authorization' && /^Bearer\s+/i.test(entry)))
    ) {
      issues.push({
        area,
        path: sanitizeStorageIssuePath(nextPath),
        reason: 'deepseek_web_headers',
      });
      continue;
    }
    if (typeof entry === 'string' && isForbiddenDurableSecretString(entry)) {
      issues.push({
        area,
        path: sanitizeStorageIssuePath(nextPath),
        reason: 'deepseek_web_headers',
      });
      continue;
    }
    collectAuthHeaderIssues(area, entry, issues, nextPath);
  }
}

function isVisionRefKey(key: string): boolean {
  return key === 'refFileId' || key === 'refFileIds' || key === 'webVisionFiles';
}

function isAllowedVisionRefPath(path: string): boolean {
  return /^deepseek_pp_automations\.(automations|runs)\[\d+\]\.(request\.)?promptOptions\.(refFileIds|webVisionFiles|visualEvidencePacks)(?:\.|\[|$)/.test(path);
}

function isForbiddenDurableMediaString(value: string): boolean {
  return /data:image\/[a-z0-9.+-]+;base64,/i.test(value) ||
    /\b(?:dataUrl|dataBase64|base64Data)\b/i.test(value) ||
    value.startsWith('blob:') ||
    value.startsWith('filesystem:');
}

function isForbiddenDurableSecretString(value: string): boolean {
  return /^Bearer\s+/i.test(value) ||
    /\b\d{6,}:[A-Za-z0-9_-]{24,}\b/.test(value) ||
    /https?:\/\/\S*(?:signed|token|secret|authorization|signature|x-amz-signature)\S*/i.test(value);
}

function isForbiddenDurableSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === 'authorization' ||
    lower === 'cookie' ||
    lower === 'set-cookie' ||
    lower === 'x-ds-pow-response' ||
    lower === 'x-api-key' ||
    lower === 'api-key' ||
    lower === 'api_key' ||
    lower === 'apikey' ||
    lower.includes('authorization') ||
    lower.includes('cookie') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('signed');
}

function isAllowedNonSecretScalarPath(path: string, value: unknown): boolean {
  return /^deepseek_pp_usage_turns_v1\[\d+\]\.tokenSource$/.test(path) &&
    (value === 'server' || value === 'estimated');
}

function isAllowedLocalImagePath(area: RuntimeDoctorStorageArea, path: string): boolean {
  return area === 'local' && ALLOWED_LOCAL_IMAGE_DATA_PATHS.has(path);
}

const SAFE_STORAGE_PATH_SEGMENTS = new Set([
  CLIENT_HEADERS_KEY,
  SIDEPANEL_WEB_SESSION_KEY,
  SIDEPANEL_WEB_AUTH_REJECTED_KEY,
  'deepseek_pp_background',
  'imageData',
  'dataUrl',
  'Authorization',
  'authorization',
  'deepseek_pp_automations',
  'automations',
  'runs',
  'request',
  'promptOptions',
  'refFileId',
  'refFileIds',
  'webVisionFiles',
  'visualEvidencePacks',
]);

function sanitizeStorageIssuePath(path: string): string {
  if (!path) return '(root)';
  const parts = path.split('.').map((part) => sanitizeStoragePathSegment(part));
  return parts.join('.').slice(0, 160);
}

function sanitizeStoragePathSegment(segment: string): string {
  if (/^\[\d+\]$/.test(segment)) return segment;
  if (SAFE_STORAGE_PATH_SEGMENTS.has(segment)) return segment;
  if (
    segment.length <= 48
    && /^[a-zA-Z0-9_-]+(?:\[\d+\])?$/.test(segment)
    && !/(bearer|token|secret|signed|https?)/i.test(segment)
  ) {
    return segment;
  }
  return '[redacted]';
}
