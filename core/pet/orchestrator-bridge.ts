import {
  createPetReviewLaneGate,
  mergePetReviewLanesIntoSnapshot,
  mergeAutonomousQualityGateDecisionIntoSnapshot,
  mergeAutonomousWorkerCycleResultIntoSnapshot,
  mergeCockpitProjectionIntoPetSnapshot,
  mergeOrchestratorTelemetryResultIntoSnapshot,
  type PetControlSnapshot,
  type PetReviewLaneInput,
  type PetReviewLanePriority,
  type PetReviewLaneRecommendation,
  type PetReviewLaneRole,
  type PetReviewLaneStatus,
  type PetReviewLaneSummary,
} from './control';
import type {
  AutonomousRunOrchestratorCycleOptions,
  AutonomousRunOrchestratorCycleResult,
} from '../run/orchestrator';
import type { AutonomousReviewLaneRiskFlags } from '../run/review-scheduler';

const MAX_PROJECTED_REVIEW_LANE_PLAN_COUNT = 500;

export type PetOrchestratorReviewLaneOptions = Pick<
  AutonomousRunOrchestratorCycleOptions,
  'reviewLaneGate' | 'reviewLaneScheduler'
>;

export interface PetOrchestratorReviewLaneBridgeOptions {
  maxParallel?: number | null;
  risk?: AutonomousReviewLaneRiskFlags | null;
  oracleRequested?: boolean | null;
  grokRequested?: boolean | null;
}

export function createPetOrchestratorReviewLaneOptions(
  snapshot: PetControlSnapshot,
  options: PetOrchestratorReviewLaneBridgeOptions = {},
): PetOrchestratorReviewLaneOptions {
  const reviewLanes = sanitizeReviewLanes(snapshot.reviewLanes?.lanes);
  const schedulerLanes = reviewLanes.slice(0, 4);
  const reviewLaneGate = createPetReviewLaneGate(createReviewLaneAggregate(reviewLanes));
  return {
    reviewLaneGate: {
      status: reviewLaneGate.status,
      reason: reviewLaneGate.reason,
      canProceed: reviewLaneGate.canProceed,
      blockingPriority: reviewLaneGate.blockingPriority,
      blockingLaneCount: reviewLaneGate.blockingLaneCount,
    },
    reviewLaneScheduler: {
      lanes: schedulerLanes.map((lane) => ({
        role: lane.role,
        status: lane.status,
      })),
      maxParallel: options.maxParallel ?? null,
      workerAdvanced: snapshot.workerCycle?.advanced === true,
      workerApplied: snapshot.workerCycle?.applied === true,
      risk: createRiskFlags(snapshot, options.risk),
      oracleRequested: options.oracleRequested === true,
      grokRequested: options.grokRequested === true,
    },
  };
}

export function mergeAutonomousOrchestratorCycleResultIntoSnapshot(
  snapshot: PetControlSnapshot,
  result: AutonomousRunOrchestratorCycleResult | null | undefined,
): PetControlSnapshot {
  if (!result) {
    return snapshot;
  }

  let next = mergeCockpitProjectionIntoPetSnapshot(snapshot, result.afterSnapshot, 'orchestrator_cycle');
  if (result.workerResult) {
    next = mergeAutonomousWorkerCycleResultIntoSnapshot(next, result.workerResult);
  }
  if (result.telemetryResult) {
    next = mergeOrchestratorTelemetryResultIntoSnapshot(next, result.telemetryResult);
  }
  if (result.qualityGateDecision) {
    next = mergeAutonomousQualityGateDecisionIntoSnapshot(next, result.qualityGateDecision);
  }
  next = mergeAutonomousReviewLanePlanIntoSnapshot(next, result.reviewLanePlan);
  next = mergeCockpitProjectionIntoPetSnapshot(next, result.afterSnapshot, 'orchestrator_cycle');
  return next;
}

export function mergeAutonomousReviewLanePlanIntoSnapshot(
  snapshot: PetControlSnapshot,
  plan: AutonomousRunOrchestratorCycleResult['reviewLanePlan'] | null | undefined,
): PetControlSnapshot {
  if (!plan) {
    return snapshot;
  }
  return mergePetReviewLanesIntoSnapshot(snapshot, createReviewLaneInputsFromPlan(plan));
}

function createRiskFlags(
  snapshot: PetControlSnapshot,
  overrides: AutonomousReviewLaneRiskFlags | null | undefined,
): AutonomousReviewLaneRiskFlags {
  return {
    shell: overrides?.shell === true,
    browser: overrides?.browser === true || snapshot.safety?.highRiskArmed === true,
    memory: overrides?.memory === true || isMemoryRisk(snapshot),
    ui: overrides?.ui === true,
  };
}

function isMemoryRisk(snapshot: PetControlSnapshot): boolean {
  const memoryPressure = snapshot.memoryPressure;
  return memoryPressure?.enabled === true &&
    (memoryPressure.level === 'medium' || memoryPressure.level === 'high' || memoryPressure.truncated === true);
}

function createReviewLaneInputsFromPlan(
  plan: AutonomousRunOrchestratorCycleResult['reviewLanePlan'],
): PetReviewLaneInput[] {
  const record = toRecord(plan);

  if (record.action === 'halt') {
    const count = normalizeProjectedLaneCount(record.blockingLaneCount) || 1;
    return Array.from({ length: count }, () => ({
      role: 'other',
      status: 'blocked',
      grade: null,
      recommendation: 'block',
      highestPriority: normalizePriority(record.blockingPriority),
      issueCount: 0,
      updatedAt: null,
    }));
  }

  if (record.action === 'dispatch') {
    const selectedRoles = Array.isArray(record.selectedRoles)
      ? record.selectedRoles.slice(0, MAX_PROJECTED_REVIEW_LANE_PLAN_COUNT)
      : [];
    return selectedRoles.map((role) => ({
      role: normalizeRole(role),
      status: 'idle',
      grade: null,
      recommendation: 'unknown',
      highestPriority: null,
      issueCount: 0,
      updatedAt: null,
    }));
  }

  return [];
}

function normalizeProjectedLaneCount(count: unknown): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 0;
  return Math.min(MAX_PROJECTED_REVIEW_LANE_PLAN_COUNT, Math.max(0, Math.floor(count)));
}

function sanitizeReviewLanes(lanes: readonly unknown[] | null | undefined): PetReviewLaneSummary[] {
  if (!Array.isArray(lanes)) return [];
  return lanes.map((lane) => {
    const record = toRecord(lane);
    return {
      role: normalizeRole(record.role),
      status: normalizeStatus(record.status),
      grade: null,
      recommendation: normalizeRecommendation(record.recommendation),
      highestPriority: normalizePriority(record.highestPriority),
      issueCount: normalizeCount(record.issueCount),
      updatedAt: null,
    };
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function createReviewLaneAggregate(
  lanes: PetReviewLaneSummary[],
): PetControlSnapshot['reviewLanes'] {
  return {
    total: lanes.length,
    activeCount: lanes.filter((lane) => lane.status === 'running').length,
    passedCount: lanes.filter((lane) => lane.status === 'passed').length,
    blockedCount: lanes.filter((lane) => lane.status === 'blocked').length,
    failedCount: lanes.filter((lane) => lane.status === 'failed').length,
    highestPriority: pickHighestPriority(lanes),
    worstGrade: null,
    proceedCount: lanes.filter((lane) => lane.recommendation === 'proceed').length,
    iterateCount: lanes.filter((lane) => lane.recommendation === 'iterate').length,
    blockCount: lanes.filter((lane) => lane.recommendation === 'block').length,
    unknownCount: lanes.filter((lane) => lane.recommendation === 'unknown').length,
    lanes,
  };
}

function normalizeRole(role: unknown): PetReviewLaneRole {
  if (
    role === 'implementer' ||
    role === 'reviewer' ||
    role === 'safety' ||
    role === 'ux' ||
    role === 'oracle' ||
    role === 'grok'
  ) {
    return role;
  }
  return 'other';
}

function normalizeStatus(status: unknown): PetReviewLaneStatus {
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

function normalizeRecommendation(recommendation: unknown): PetReviewLaneRecommendation {
  if (
    recommendation === 'proceed' ||
    recommendation === 'iterate' ||
    recommendation === 'block' ||
    recommendation === 'unknown'
  ) {
    return recommendation;
  }
  return 'unknown';
}

function normalizePriority(priority: unknown): PetReviewLanePriority | null {
  if (priority === 'P1' || priority === 'P2' || priority === 'P3') {
    return priority;
  }
  return null;
}

function normalizeCount(count: unknown): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

function pickHighestPriority(lanes: readonly PetReviewLaneSummary[]): PetReviewLanePriority | null {
  if (lanes.some((lane) => lane.highestPriority === 'P1')) return 'P1';
  if (lanes.some((lane) => lane.highestPriority === 'P2')) return 'P2';
  if (lanes.some((lane) => lane.highestPriority === 'P3')) return 'P3';
  return null;
}
