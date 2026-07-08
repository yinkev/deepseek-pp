import {
  getAutonomousRunLedgerSnapshot,
} from '../run/store';
import type {
  AutonomousEvidenceRecord,
  AutonomousQualityGateGrade,
  AutonomousQualityGateRecord,
  AutonomousReviewLaneRecord,
  AutonomousReviewLaneRecommendation,
  AutonomousReviewLaneStatus,
  AutonomousRun,
  AutonomousRunStatus,
  AutonomousRunStep,
  AutonomousRunStorageState,
  AutonomousTargetLease,
} from '../run/types';
import type {
  RuntimeCockpitEvidencePosture,
  RuntimeCockpitMission,
  RuntimeCockpitMissionAction,
  RuntimeCockpitNextAction,
  RuntimeCockpitReview,
  RuntimeCockpitSnapshot,
  RuntimeCockpitStatus,
  RuntimeCockpitTimelineEvent,
  RuntimeCockpitTimelineStatus,
  RuntimeCockpitWorkingSet,
} from './types';

const DEFAULT_TIMELINE_LIMIT = 12;
const WORKING_SET_EVIDENCE_DETAIL_LIMIT = 4;

const GRADE_ORDER: AutonomousQualityGateGrade[] = ['F', 'D', 'C', 'B', 'A'];

export interface CreateRuntimeCockpitSnapshotOptions {
  timelineLimit?: number;
}

export async function getRuntimeCockpitSnapshot(
  now = Date.now(),
  options: CreateRuntimeCockpitSnapshotOptions = {},
): Promise<RuntimeCockpitSnapshot> {
  return createRuntimeCockpitSnapshot(await getAutonomousRunLedgerSnapshot(), now, options);
}

export function createRuntimeCockpitSnapshot(
  state: AutonomousRunStorageState,
  now = Date.now(),
  options: CreateRuntimeCockpitSnapshotOptions = {},
): RuntimeCockpitSnapshot {
  const runs = sortRunsByUpdatedAt(state.runs);
  const activeRun = selectCockpitRun(runs);
  const status = getCockpitStatus(createStatusTotals(runs));
  const runSteps = activeRun ? selectRunSteps(state.steps, activeRun) : [];
  const runEvidence = activeRun ? selectRunEvidence(state.evidence, activeRun) : [];
  const runLeases = activeRun ? selectRunTargetLeases(state.targetLeases, activeRun) : [];
  const qualityGates = activeRun ? selectRunQualityGates(state.qualityGates, activeRun) : [];
  const reviewLanes = activeRun ? selectRunReviewLanes(state.reviewLanes, activeRun) : [];
  const latestStep = runSteps[runSteps.length - 1] ?? null;

  return {
    schemaVersion: 1,
    generatedAt: now,
    status,
    totals: createStatusTotals(runs),
    mission: createMission(activeRun, status, latestStep),
    workingSet: createWorkingSet(activeRun, runEvidence, runLeases, now),
    timeline: createTimeline(activeRun, runSteps, runEvidence, qualityGates, reviewLanes, options.timelineLimit ?? DEFAULT_TIMELINE_LIMIT, now),
    review: createReview(qualityGates, reviewLanes),
  };
}

function sortRunsByUpdatedAt(runs: readonly AutonomousRun[]): AutonomousRun[] {
  return [...runs].sort((a, b) => b.updatedAt - a.updatedAt);
}

function createStatusTotals(runs: readonly AutonomousRun[]): Record<AutonomousRunStatus, number> {
  return {
    queued: countRuns(runs, 'queued'),
    running: countRuns(runs, 'running'),
    paused: countRuns(runs, 'paused'),
    blocked: countRuns(runs, 'blocked'),
    succeeded: countRuns(runs, 'succeeded'),
    failed: countRuns(runs, 'failed'),
    cancelled: countRuns(runs, 'cancelled'),
  };
}

function countRuns(runs: readonly AutonomousRun[], status: AutonomousRunStatus): number {
  return runs.filter((run) => run.status === status).length;
}

function getCockpitStatus(totals: Record<AutonomousRunStatus, number>): RuntimeCockpitStatus {
  if (totals.running > 0) return 'running';
  if (totals.blocked > 0) return 'blocked';
  if (totals.paused > 0) return 'paused';
  if (totals.queued > 0) return 'queued';
  if (totals.succeeded + totals.failed + totals.cancelled > 0) return 'complete';
  return 'idle';
}

function selectCockpitRun(runs: readonly AutonomousRun[]): AutonomousRun | null {
  return runs.find((run) => run.status === 'running') ??
    runs.find((run) => run.status === 'blocked') ??
    runs.find((run) => run.status === 'paused') ??
    runs.find((run) => run.status === 'queued') ??
    runs[0] ??
    null;
}

function selectRunSteps(steps: readonly AutonomousRunStep[], run: AutonomousRun): AutonomousRunStep[] {
  return steps.filter((step) => step.runId === run.id).sort((a, b) => a.seq - b.seq);
}

function selectRunEvidence(evidence: readonly AutonomousEvidenceRecord[], run: AutonomousRun): AutonomousEvidenceRecord[] {
  return evidence.filter((record) => record.runId === run.id).sort((a, b) => b.capturedAt - a.capturedAt);
}

function selectRunTargetLeases(leases: readonly AutonomousTargetLease[], run: AutonomousRun): AutonomousTargetLease[] {
  return leases.filter((lease) => lease.runId === run.id).sort((a, b) => b.acquiredAt - a.acquiredAt);
}

function selectRunQualityGates(gates: readonly AutonomousQualityGateRecord[], run: AutonomousRun): AutonomousQualityGateRecord[] {
  return gates.filter((gate) => gate.runId === run.id).sort((a, b) => a.seq - b.seq);
}

function selectRunReviewLanes(lanes: readonly AutonomousReviewLaneRecord[], run: AutonomousRun): AutonomousReviewLaneRecord[] {
  return lanes.filter((lane) => lane.runId === run.id).sort((a, b) => a.seq - b.seq);
}

function createMission(
  run: AutonomousRun | null,
  status: RuntimeCockpitStatus,
  latestStep: AutonomousRunStep | null,
): RuntimeCockpitMission {
  if (!run) {
    return {
      active: false,
      title: 'No active mission',
      status: 'idle',
      runStatus: null,
      mode: null,
      phase: 'idle',
      progress: null,
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      nextAction: { key: 'start_mission', target: 'none' },
      availableActions: [],
      errorCode: null,
    };
  }
  return {
    active: true,
    title: run.goal,
    status,
    runStatus: run.status,
    mode: run.mode,
    phase: latestStep?.phase ?? 'idle',
    progress: latestStep ? latestStep.progressScore : null,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    nextAction: getNextAction(status, run.status),
    availableActions: getAvailableMissionActions(run.status),
    errorCode: run.error?.code ?? null,
  };
}

function getAvailableMissionActions(status: AutonomousRunStatus): RuntimeCockpitMissionAction[] {
  if (status === 'queued' || status === 'running') return ['pause', 'stop'];
  if (status === 'paused' || status === 'blocked') return ['resume', 'stop'];
  return [];
}

function getNextAction(status: RuntimeCockpitStatus, runStatus: AutonomousRunStatus): RuntimeCockpitNextAction {
  if (status === 'blocked' || runStatus === 'blocked') return { key: 'review_blocker', target: 'review' };
  if (status === 'paused' || runStatus === 'paused') return { key: 'resume_mission', target: 'none' };
  if (status === 'queued' || runStatus === 'queued') return { key: 'ready_to_begin', target: 'none' };
  if (status === 'running' || runStatus === 'running') return { key: 'watch_timeline', target: 'timeline' };
  if (status === 'complete') return { key: 'review_result', target: 'review' };
  return { key: 'start_mission', target: 'none' };
}

function createWorkingSet(
  run: AutonomousRun | null,
  evidence: readonly AutonomousEvidenceRecord[],
  targetLeases: readonly AutonomousTargetLease[],
  now: number,
): RuntimeCockpitWorkingSet {
  const selectedLease = run?.targetLeaseId
    ? targetLeases.find((lease) => lease.id === run.targetLeaseId) ?? null
    : targetLeases[0] ?? null;
  const targetStatus = getTargetStatus(selectedLease, now);
  const evidenceFreshness = evidence.map((record) => getEffectiveEvidenceFreshness(record, now));
  const fresh = evidenceFreshness.filter((freshness) => freshness === 'fresh').length;
  const expired = evidenceFreshness.filter((freshness) => freshness === 'expired').length;
  const stale = evidenceFreshness.filter((freshness) => freshness === 'stale').length;
  const latestAt = evidence.reduce<number | null>(
    (latest, record) => latest === null ? record.capturedAt : Math.max(latest, record.capturedAt),
    null,
  );
  return {
    target: {
      status: targetStatus,
      locked: targetStatus === 'active',
      stale: targetStatus === 'stale' || targetStatus === 'expired' || targetStatus === 'released',
      ageMs: selectedLease ? Math.max(0, now - selectedLease.acquiredAt) : null,
      expiresInMs: selectedLease ? Math.max(0, selectedLease.expiresAt - now) : null,
    },
    evidence: {
      posture: getEvidencePosture(evidence.length, fresh, stale, expired),
      total: evidence.length,
      fresh,
      stale,
      expired,
      latestAt,
      details: evidence.slice(0, WORKING_SET_EVIDENCE_DETAIL_LIMIT).map((record) => ({
        kind: record.kind,
        freshness: getEffectiveEvidenceFreshness(record, now),
        capturedAt: record.capturedAt,
        expiresAt: record.expiresAt,
      })),
    },
    visibility: 'metadata_only',
  };
}

function getEffectiveEvidenceFreshness(
  record: AutonomousEvidenceRecord,
  now: number,
): RuntimeCockpitWorkingSet['evidence']['details'][number]['freshness'] {
  if (record.freshness === 'expired' || record.expiresAt <= now) return 'expired';
  return record.freshness;
}

function getTargetStatus(
  lease: AutonomousTargetLease | null,
  now: number,
): RuntimeCockpitWorkingSet['target']['status'] {
  if (!lease) return 'none';
  if (lease.status === 'active' && lease.expiresAt <= now) return 'expired';
  return lease.status;
}

function getEvidencePosture(
  total: number,
  fresh: number,
  stale: number,
  expired: number,
): RuntimeCockpitEvidencePosture {
  if (total === 0) return 'none';
  const buckets = [fresh > 0, stale > 0, expired > 0].filter(Boolean).length;
  if (buckets > 1) return 'mixed';
  if (fresh > 0) return 'fresh';
  if (stale > 0) return 'stale';
  return 'expired';
}

function createTimeline(
  run: AutonomousRun | null,
  steps: readonly AutonomousRunStep[],
  evidence: readonly AutonomousEvidenceRecord[],
  gates: readonly AutonomousQualityGateRecord[],
  lanes: readonly AutonomousReviewLaneRecord[],
  limit: number,
  now: number,
): RuntimeCockpitTimelineEvent[] {
  if (!run) return [];
  const events: RuntimeCockpitTimelineEvent[] = [
    {
      kind: 'mission_created',
      at: run.createdAt,
      title: 'Mission recorded',
      detail: run.mode === 'unattended' ? 'Unattended run' : 'Interactive run',
      status: 'info',
      missionMode: run.mode,
      runStatus: run.status,
    },
  ];
  if (run.startedAt !== null) {
    events.push({
      kind: 'mission_started',
      at: run.startedAt,
      title: 'Mission started',
      detail: null,
      status: 'running',
      missionMode: run.mode,
      runStatus: run.status,
    });
  }
  if (run.completedAt !== null) {
    events.push({
      kind: 'mission_completed',
      at: run.completedAt,
      title: run.status === 'succeeded' ? 'Mission completed' : 'Mission stopped',
      detail: run.status,
      status: mapRunStatusToTimelineStatus(run.status),
      missionMode: run.mode,
      runStatus: run.status,
    });
  }
  for (const step of steps) {
    events.push({
      kind: 'step',
      at: step.endedAt ?? step.startedAt,
      title: formatPhaseTitle(step.phase),
      detail: step.proofDelta.length > 0 ? `${step.proofDelta.length} proof update${step.proofDelta.length === 1 ? '' : 's'}` : null,
      status: mapStepStatus(step.status),
      phase: step.phase,
      stepStatus: step.status,
      proofUpdateCount: step.proofDelta.length,
    });
  }
  for (const record of evidence) {
    const freshness = getEffectiveEvidenceFreshness(record, now);
    events.push({
      kind: 'evidence',
      at: record.capturedAt,
      title: 'Evidence captured',
      detail: formatEvidenceKind(record.kind),
      status: mapEvidenceStatus(freshness),
      evidenceKind: record.kind,
      evidenceFreshness: freshness,
    });
  }
  for (const gate of gates) {
    events.push({
      kind: 'quality_gate',
      at: gate.createdAt,
      title: 'Quality gate recorded',
      detail: gate.selfReview.grade ? `Self-review ${gate.selfReview.grade}` : null,
      status: mapQualityGateStatus(gate.status),
      qualityGateGrade: gate.selfReview.grade,
    });
  }
  for (const lane of lanes) {
    events.push({
      kind: 'review_lane',
      at: lane.createdAt,
      title: 'Review lane recorded',
      detail: `${lane.role} · ${lane.status}`,
      status: mapReviewLaneStatus(lane.status),
      reviewLaneRole: lane.role,
      reviewLaneStatus: lane.status,
    });
  }
  return events.sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit));
}

function createReview(
  gates: readonly AutonomousQualityGateRecord[],
  lanes: readonly AutonomousReviewLaneRecord[],
): RuntimeCockpitReview {
  const latestGate = gates[gates.length - 1] ?? null;
  const laneRecommendation = selectDominantRecommendation(lanes);
  return {
    recorded: !!latestGate || lanes.length > 0,
    qualityGate: latestGate
      ? {
          recorded: true,
          status: latestGate.status,
          grade: latestGate.selfReview.grade,
          verificationPassed: latestGate.verification.commands.length === 0
            ? null
            : latestGate.verification.commands.every((command) => command.result === 'passed' || command.result === 'known_preexisting_failure'),
          coverageComplete: latestGate.contractCoverage.complete,
          coverageRows: latestGate.contractCoverage.rows.length,
          gapCount: latestGate.contractCoverage.gapCount,
          conflictCount: latestGate.contractCoverage.conflictCount,
          warningCount: latestGate.contractCoverage.notTestableCount,
        }
      : {
          recorded: false,
          status: 'none',
          grade: null,
          verificationPassed: null,
          coverageComplete: null,
          coverageRows: 0,
          gapCount: 0,
          conflictCount: 0,
          warningCount: 0,
        },
    lanes: {
      total: lanes.length,
      running: countLanes(lanes, 'running'),
      passed: countLanes(lanes, 'passed'),
      blocked: countLanes(lanes, 'blocked'),
      failed: countLanes(lanes, 'failed'),
      highestPriority: selectHighestPriority(lanes),
      worstGrade: selectWorstGrade(lanes),
      recommendation: laneRecommendation,
      details: lanes.map(createReviewLaneSummary),
    },
  };
}

function createReviewLaneSummary(lane: AutonomousReviewLaneRecord): RuntimeCockpitReview['lanes']['details'][number] {
  return {
    role: lane.role,
    status: lane.status,
    grade: lane.grade,
    recommendation: lane.recommendation,
    highestPriority: lane.highestPriority,
    issueCount: lane.issueCount,
    evidenceRefCount: lane.evidenceRefCount,
  };
}

function countLanes(lanes: readonly AutonomousReviewLaneRecord[], status: AutonomousReviewLaneStatus): number {
  return lanes.filter((lane) => lane.status === status).length;
}

function selectHighestPriority(lanes: readonly AutonomousReviewLaneRecord[]): RuntimeCockpitReview['lanes']['highestPriority'] {
  if (lanes.some((lane) => lane.highestPriority === 'P1')) return 'P1';
  if (lanes.some((lane) => lane.highestPriority === 'P2')) return 'P2';
  if (lanes.some((lane) => lane.highestPriority === 'P3')) return 'P3';
  return null;
}

function selectWorstGrade(lanes: readonly AutonomousReviewLaneRecord[]): AutonomousQualityGateGrade | null {
  const grades = lanes.map((lane) => lane.grade).filter((grade): grade is AutonomousQualityGateGrade => !!grade);
  if (grades.length === 0) return null;
  return grades.sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b))[0] ?? null;
}

function selectDominantRecommendation(
  lanes: readonly AutonomousReviewLaneRecord[],
): AutonomousReviewLaneRecommendation | 'none' {
  if (lanes.some((lane) => lane.recommendation === 'block')) return 'block';
  if (lanes.some((lane) => lane.recommendation === 'iterate')) return 'iterate';
  if (lanes.some((lane) => lane.recommendation === 'proceed')) return 'proceed';
  if (lanes.some((lane) => lane.recommendation === 'unknown')) return 'unknown';
  return 'none';
}

function mapRunStatusToTimelineStatus(status: AutonomousRunStatus): RuntimeCockpitTimelineStatus {
  if (status === 'succeeded') return 'passed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'paused') return 'warning';
  if (status === 'running') return 'running';
  return 'info';
}

function mapStepStatus(status: AutonomousRunStep['status']): RuntimeCockpitTimelineStatus {
  if (status === 'succeeded') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'info';
}

function mapEvidenceStatus(freshness: RuntimeCockpitWorkingSet['evidence']['details'][number]['freshness']): RuntimeCockpitTimelineStatus {
  if (freshness === 'expired') return 'warning';
  if (freshness === 'stale') return 'warning';
  return 'passed';
}

function mapQualityGateStatus(status: AutonomousQualityGateRecord['status']): RuntimeCockpitTimelineStatus {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  return 'warning';
}

function mapReviewLaneStatus(status: AutonomousReviewLaneRecord['status']): RuntimeCockpitTimelineStatus {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'running') return 'running';
  return 'info';
}

function formatPhaseTitle(phase: AutonomousRunStep['phase']): string {
  return phase.split('_').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

function formatEvidenceKind(kind: AutonomousEvidenceRecord['kind']): string {
  return kind.split('_').join(' ');
}
