import type { AutonomousRunStatus } from './types';
import type { AutonomousRunReviewLaneGateInput } from './worker';

export type AutonomousReviewLaneRole = 'implementer' | 'reviewer' | 'safety' | 'ux' | 'oracle';
export type AutonomousReviewLaneStatus = 'idle' | 'running' | 'passed' | 'blocked' | 'failed';
export type AutonomousReviewLaneScheduleAction = 'idle' | 'dispatch' | 'hold' | 'halt';
export type AutonomousReviewLaneBlockingPriority = 'P1' | 'P2';

export type AutonomousReviewLaneScheduleReason =
  | 'no_runnable_run'
  | 'no_pending_lanes'
  | 'at_capacity'
  | 'dispatch_lanes'
  | 'review_gate_blocked'
  | 'review_gate_p1'
  | 'review_gate_p2'
  | 'review_gate_block_recommendation';

export interface AutonomousReviewLaneSchedulerLaneInput {
  role?: AutonomousReviewLaneRole | string | null;
  status?: AutonomousReviewLaneStatus | 'active' | 'completed' | string | null;
}

export interface AutonomousReviewLaneRiskFlags {
  shell?: boolean | null;
  browser?: boolean | null;
  memory?: boolean | null;
  ui?: boolean | null;
}

export interface AutonomousReviewLaneSchedulerInput {
  runStatus?: AutonomousRunStatus | null;
  reviewLaneGate?: AutonomousRunReviewLaneGateInput | null;
  lanes?: readonly AutonomousReviewLaneSchedulerLaneInput[] | null;
  maxParallel?: number | null;
  workerAdvanced?: boolean | null;
  workerApplied?: boolean | null;
  risk?: AutonomousReviewLaneRiskFlags | null;
  oracleRequested?: boolean | null;
}

export interface AutonomousReviewLanePlan {
  action: AutonomousReviewLaneScheduleAction;
  selectedRoles: AutonomousReviewLaneRole[];
  canRunWorker: boolean;
  reason: AutonomousReviewLaneScheduleReason;
  blockingPriority: AutonomousReviewLaneBlockingPriority | null;
  blockingLaneCount: number;
  maxParallel: number;
}

interface NormalizedReviewLane {
  role: AutonomousReviewLaneRole;
  status: AutonomousReviewLaneStatus;
}

interface NormalizedGate {
  blocked: boolean;
  reason: AutonomousReviewLaneScheduleReason | null;
  blockingPriority: AutonomousReviewLaneBlockingPriority | null;
  blockingLaneCount: number;
}

const DEFAULT_MAX_PARALLEL = 2;

export function planAutonomousReviewLanes(
  input: AutonomousReviewLaneSchedulerInput = {},
): AutonomousReviewLanePlan {
  const maxParallel = normalizeMaxParallel(input.maxParallel);
  const gate = normalizeReviewLaneGate(input.reviewLaneGate);
  if (gate.blocked) {
    return createPlan('halt', [], false, gate.reason ?? 'review_gate_blocked', gate, maxParallel);
  }

  if (!isRunnableRunStatus(input.runStatus)) {
    return createPlan('idle', [], false, 'no_runnable_run', gate, maxParallel);
  }

  const lanes = normalizeLanes(input.lanes);
  const activeLaneCount = lanes.filter((lane) => lane.status === 'running').length;
  if (activeLaneCount >= maxParallel) {
    return createPlan('hold', [], true, 'at_capacity', gate, maxParallel);
  }

  const selectedRoles = selectRoles(input, lanes, maxParallel - activeLaneCount);
  if (selectedRoles.length === 0) {
    return createPlan('idle', [], true, 'no_pending_lanes', gate, maxParallel);
  }

  return createPlan('dispatch', selectedRoles, true, 'dispatch_lanes', gate, maxParallel);
}

function createPlan(
  action: AutonomousReviewLaneScheduleAction,
  selectedRoles: AutonomousReviewLaneRole[],
  canRunWorker: boolean,
  reason: AutonomousReviewLaneScheduleReason,
  gate: NormalizedGate,
  maxParallel: number,
): AutonomousReviewLanePlan {
  return {
    action,
    selectedRoles,
    canRunWorker,
    reason,
    blockingPriority: gate.blockingPriority,
    blockingLaneCount: gate.blockingLaneCount,
    maxParallel,
  };
}

function selectRoles(
  input: AutonomousReviewLaneSchedulerInput,
  lanes: readonly NormalizedReviewLane[],
  availableSlots: number,
): AutonomousReviewLaneRole[] {
  const candidates: AutonomousReviewLaneRole[] = [];
  if (!hasOccupiedRole(lanes, 'implementer')) {
    candidates.push('implementer');
  }
  if ((input.workerAdvanced === true || input.workerApplied === true) && !hasOccupiedRole(lanes, 'reviewer')) {
    candidates.push('reviewer');
  }
  if (hasSafetyRisk(input.risk) && !hasOccupiedRole(lanes, 'safety')) {
    candidates.push('safety');
  }
  if (input.risk?.ui === true && !hasOccupiedRole(lanes, 'ux')) {
    candidates.push('ux');
  }
  if (input.oracleRequested === true && !hasOccupiedRole(lanes, 'oracle')) {
    candidates.push('oracle');
  }
  return candidates.slice(0, Math.max(0, availableSlots));
}

function hasOccupiedRole(
  lanes: readonly NormalizedReviewLane[],
  role: AutonomousReviewLaneRole,
): boolean {
  return lanes.some((lane) => lane.role === role && lane.status !== 'idle');
}

function hasSafetyRisk(risk: AutonomousReviewLaneRiskFlags | null | undefined): boolean {
  return risk?.shell === true || risk?.browser === true || risk?.memory === true;
}

function isRunnableRunStatus(status: AutonomousRunStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running';
}

function normalizeLanes(
  lanes: readonly AutonomousReviewLaneSchedulerLaneInput[] | null | undefined,
): NormalizedReviewLane[] {
  if (!Array.isArray(lanes)) return [];
  return lanes
    .map((lane) => ({
      role: normalizeRole(lane?.role),
      status: normalizeStatus(lane?.status),
    }))
    .filter((lane): lane is NormalizedReviewLane => lane.role !== null);
}

function normalizeRole(role: unknown): AutonomousReviewLaneRole | null {
  if (
    role === 'implementer' ||
    role === 'reviewer' ||
    role === 'safety' ||
    role === 'ux' ||
    role === 'oracle'
  ) {
    return role;
  }
  return null;
}

function normalizeStatus(status: unknown): AutonomousReviewLaneStatus {
  if (status === 'active') return 'running';
  if (status === 'completed') return 'passed';
  if (
    status === 'idle' ||
    status === 'running' ||
    status === 'passed' ||
    status === 'blocked' ||
    status === 'failed'
  ) {
    return status;
  }
  return 'idle';
}

function normalizeMaxParallel(maxParallel: unknown): number {
  if (typeof maxParallel !== 'number' || !Number.isFinite(maxParallel)) {
    return DEFAULT_MAX_PARALLEL;
  }
  return Math.max(1, Math.floor(maxParallel));
}

function normalizeReviewLaneGate(
  gate: AutonomousRunReviewLaneGateInput | null | undefined,
): NormalizedGate {
  if (!gate) {
    return {
      blocked: false,
      reason: null,
      blockingPriority: null,
      blockingLaneCount: 0,
    };
  }

  const reason = normalizeGateReason(gate.reason);
  const blockingPriority = normalizeBlockingPriority(gate.blockingPriority, reason);
  const blockingLaneCount = normalizeCount(gate.blockingLaneCount);
  if (blockingPriority === 'P1') {
    return {
      blocked: true,
      reason: 'review_gate_p1',
      blockingPriority,
      blockingLaneCount,
    };
  }
  if (blockingPriority === 'P2') {
    return {
      blocked: true,
      reason: 'review_gate_p2',
      blockingPriority,
      blockingLaneCount,
    };
  }
  if (reason === 'block_recommendation') {
    return {
      blocked: true,
      reason: 'review_gate_block_recommendation',
      blockingPriority: null,
      blockingLaneCount,
    };
  }
  if (gate.canProceed === false || gate.status === 'blocked') {
    return {
      blocked: true,
      reason: 'review_gate_blocked',
      blockingPriority: null,
      blockingLaneCount,
    };
  }
  return {
    blocked: false,
    reason: null,
    blockingPriority: null,
    blockingLaneCount,
  };
}

function normalizeGateReason(reason: unknown): string | null {
  if (
    reason === 'p1' ||
    reason === 'p2' ||
    reason === 'block_recommendation' ||
    reason === 'active_review' ||
    reason === 'failed_lane' ||
    reason === 'blocked_lane' ||
    reason === 'none'
  ) {
    return reason;
  }
  return null;
}

function normalizeBlockingPriority(
  priority: unknown,
  reason: string | null,
): AutonomousReviewLaneBlockingPriority | null {
  if (priority === 'P1' || reason === 'p1') return 'P1';
  if (priority === 'P2' || reason === 'p2') return 'P2';
  return null;
}

function normalizeCount(count: unknown): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}
