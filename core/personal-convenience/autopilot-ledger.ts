import type {
  RuntimeDoctorAutopilotRun,
  RuntimeDoctorReadiness,
  RuntimeDoctorReadinessBlocker,
} from '../chat/runtime-doctor';

const STORAGE_KEY = 'deepseek_pp_autopilot_run_ledger_v1';
const MAX_RUNS = 30;

export async function getAutopilotRunLedger(): Promise<RuntimeDoctorAutopilotRun[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  const raw = data[STORAGE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeAutopilotRun(item))
    .filter((item): item is RuntimeDoctorAutopilotRun => item !== null)
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, MAX_RUNS);
}

export async function appendAutopilotRun(
  input: Omit<RuntimeDoctorAutopilotRun, 'id'> & { id?: string },
): Promise<RuntimeDoctorAutopilotRun> {
  const run = normalizeAutopilotRun({
    ...input,
    id: input.id ?? createRunId(input.finishedAt),
  });
  if (!run) throw new Error('Invalid autopilot run ledger entry.');
  const runs = await getAutopilotRunLedger();
  const next = [run, ...runs.filter((item) => item.id !== run.id)]
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, MAX_RUNS);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return run;
}

export function normalizeAutopilotRun(value: unknown): RuntimeDoctorAutopilotRun | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<RuntimeDoctorAutopilotRun>;
  const id = normalizeString(raw.id, 80);
  const startedAt = normalizeTimestamp(raw.startedAt);
  const finishedAt = normalizeTimestamp(raw.finishedAt);
  if (!id || startedAt === null || finishedAt === null) return null;
  const source = normalizeSource(raw.source);
  if (!source) return null;
  const status = normalizeStatus(raw.status);
  const grade = normalizeGrade(raw.grade);
  return {
    id,
    source,
    startedAt,
    finishedAt: Math.max(finishedAt, startedAt),
    ready: raw.ready === true,
    status,
    grade,
    blockers: normalizeBlockers(raw.blockers),
    targetStatus: normalizeTargetStatus(raw.targetStatus),
    repaired: normalizeStringList(raw.repaired, 12, 48),
    leakIssueCount: normalizeNonNegativeInteger(raw.leakIssueCount),
  };
}

function normalizeSource(value: unknown): RuntimeDoctorAutopilotRun['source'] | null {
  return value === 'startup' || value === 'manual' || value === 'repair' ? value : null;
}

function normalizeStatus(value: unknown): RuntimeDoctorReadiness['status'] {
  return value === 'ready' || value === 'blocked' || value === 'needs_attention'
    ? value
    : 'needs_attention';
}

function normalizeGrade(value: unknown): RuntimeDoctorAutopilotRun['grade'] {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'F'
    ? value
    : 'F';
}

function normalizeTargetStatus(value: unknown): RuntimeDoctorReadiness['targetStatus'] {
  return value === 'ready' ||
    value === 'reacquired' ||
    value === 'selected_active' ||
    value === 'missing' ||
    value === 'unsupported' ||
    value === 'not_controllable'
    ? value
    : null;
}

function normalizeBlockers(value: unknown): RuntimeDoctorReadinessBlocker[] {
  const allowed = new Set<RuntimeDoctorReadinessBlocker>([
    'chat_busy',
    'web_auth_missing',
    'web_auth_rejected',
    'deepseek_content_script_stale',
    'browser_control_disabled',
    'browser_target_missing',
    'browser_target_not_controllable',
    'browser_vision_capture_disabled',
    'act_verify_disabled',
    'evidence_packs_disabled',
    'storage_leak',
    'storage_scan_failed',
  ]);
  if (!Array.isArray(value)) return [];
  const blockers: RuntimeDoctorReadinessBlocker[] = [];
  for (const item of value) {
    if (allowed.has(item as RuntimeDoctorReadinessBlocker) && !blockers.includes(item as RuntimeDoctorReadinessBlocker)) {
      blockers.push(item as RuntimeDoctorReadinessBlocker);
    }
  }
  return blockers;
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const item of value) {
    const normalized = normalizeString(item, maxLength);
    if (normalized && !items.includes(normalized)) items.push(normalized);
    if (items.length >= maxItems) break;
  }
  return items;
}

function normalizeString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function createRunId(finishedAt: number): string {
  return `autopilot-${Math.max(0, Math.floor(finishedAt)).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
