import {
  createAutonomousRun,
  getAutonomousRunLedgerSnapshot,
  transitionAutonomousRun,
} from '../run/store';
import type { AutonomousRun, AutonomousRunMode, AutonomousRunStatus } from '../run/types';
import type { RuntimeCockpitMissionAction } from './types';

export interface RuntimeCockpitMissionStartInput {
  objective: string;
  doneCriteria?: string[];
  requiredEvidence?: string[];
  mode?: AutonomousRunMode;
}

export interface RuntimeCockpitMissionStartResult {
  ok: boolean;
  status: AutonomousRunStatus | null;
  reason: 'created' | 'objective_required';
}

export interface RuntimeCockpitMissionActionResult {
  ok: boolean;
  action: RuntimeCockpitMissionAction;
  status: AutonomousRunStatus | null;
  reason: 'applied' | 'no_active_mission' | 'not_available';
}

export async function startRuntimeCockpitMission(
  input: RuntimeCockpitMissionStartInput,
  now = Date.now(),
): Promise<RuntimeCockpitMissionStartResult> {
  const objective = normalizeMissionText(input.objective);
  if (!objective) return { ok: false, status: null, reason: 'objective_required' };
  const run = await createAutonomousRun({
    goal: objective,
    mode: input.mode === 'interactive' ? 'interactive' : 'unattended',
    proofContract: {
      doneCriteria: normalizeMissionLines(input.doneCriteria),
      requiredEvidence: normalizeMissionLines(input.requiredEvidence),
    },
  }, now);
  return { ok: true, status: run.status, reason: 'created' };
}

export async function applyRuntimeCockpitMissionAction(
  action: RuntimeCockpitMissionAction,
  now = Date.now(),
): Promise<RuntimeCockpitMissionActionResult> {
  const run = selectActionRun((await getAutonomousRunLedgerSnapshot()).runs);
  if (!run) return { ok: false, action, status: null, reason: 'no_active_mission' };
  const nextStatus = getActionTargetStatus(run.status, action);
  if (!nextStatus) return { ok: false, action, status: run.status, reason: 'not_available' };
  const updated = await transitionAutonomousRun(run.id, nextStatus, null, now);
  return {
    ok: updated?.status === nextStatus,
    action,
    status: updated?.status ?? run.status,
    reason: updated?.status === nextStatus ? 'applied' : 'not_available',
  };
}

function selectActionRun(runs: readonly AutonomousRun[]): AutonomousRun | null {
  const sorted = [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted.find((run) => run.status === 'running') ??
    sorted.find((run) => run.status === 'blocked') ??
    sorted.find((run) => run.status === 'paused') ??
    sorted.find((run) => run.status === 'queued') ??
    null;
}

function getActionTargetStatus(
  status: AutonomousRunStatus,
  action: RuntimeCockpitMissionAction,
): AutonomousRunStatus | null {
  if (action === 'pause' && (status === 'queued' || status === 'running')) return 'paused';
  if (action === 'resume' && (status === 'paused' || status === 'blocked')) return 'running';
  if (action === 'stop' && (status === 'queued' || status === 'running' || status === 'paused' || status === 'blocked')) return 'cancelled';
  return null;
}

function normalizeMissionText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeMissionLines(value: string[] | undefined): string[] {
  return (value ?? [])
    .map((item) => item.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}
