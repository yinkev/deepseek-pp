import type {
  AutonomousEvidenceFreshness,
  AutonomousQualityGateGrade,
  AutonomousQualityGateStatus,
  AutonomousReviewLanePriority,
  AutonomousReviewLaneRecommendation,
  AutonomousReviewLaneRecordRole,
  AutonomousReviewLaneStatus,
  AutonomousRunMode,
  AutonomousRunObservationKind,
  AutonomousRunPhase,
  AutonomousRunStatus,
  AutonomousRunStepStatus,
  AutonomousTargetLeaseStatus,
} from '../run/types';

export type RuntimeCockpitStatus = 'idle' | 'queued' | 'running' | 'paused' | 'blocked' | 'complete';

export type RuntimeCockpitEvidencePosture = 'none' | 'fresh' | 'stale' | 'expired' | 'mixed';

export type RuntimeCockpitMissionAction = 'pause' | 'resume' | 'stop';

export type RuntimeCockpitNextActionKey =
  | 'start_mission'
  | 'review_blocker'
  | 'resume_mission'
  | 'ready_to_begin'
  | 'watch_timeline'
  | 'review_result';

export type RuntimeCockpitTimelineKind =
  | 'mission_created'
  | 'mission_started'
  | 'mission_completed'
  | 'step'
  | 'evidence'
  | 'quality_gate'
  | 'review_lane';

export type RuntimeCockpitTimelineStatus = 'info' | 'running' | 'passed' | 'warning' | 'blocked' | 'failed';

export interface RuntimeCockpitSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  status: RuntimeCockpitStatus;
  totals: Record<AutonomousRunStatus, number>;
  mission: RuntimeCockpitMission;
  workingSet: RuntimeCockpitWorkingSet;
  timeline: RuntimeCockpitTimelineEvent[];
  review: RuntimeCockpitReview;
}

export interface RuntimeCockpitMission {
  active: boolean;
  title: string;
  status: RuntimeCockpitStatus;
  runStatus: AutonomousRunStatus | null;
  mode: 'interactive' | 'unattended' | null;
  phase: AutonomousRunPhase | 'idle';
  progress: number | null;
  startedAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  nextAction: RuntimeCockpitNextAction;
  availableActions: RuntimeCockpitMissionAction[];
  errorCode: string | null;
}

export interface RuntimeCockpitNextAction {
  key: RuntimeCockpitNextActionKey;
  target: 'automation' | 'review' | 'timeline' | 'working_set' | 'none';
}

export interface RuntimeCockpitWorkingSet {
  target: {
    status: AutonomousTargetLeaseStatus | 'none';
    locked: boolean;
    stale: boolean;
    ageMs: number | null;
    expiresInMs: number | null;
  };
  evidence: {
    posture: RuntimeCockpitEvidencePosture;
    total: number;
    fresh: number;
      stale: number;
      expired: number;
      latestAt: number | null;
      details: RuntimeCockpitEvidenceSummary[];
    };
  visibility: 'metadata_only';
}

export interface RuntimeCockpitEvidenceSummary {
  kind: AutonomousRunObservationKind;
  freshness: AutonomousEvidenceFreshness;
  capturedAt: number;
  expiresAt: number | null;
}

export interface RuntimeCockpitTimelineEvent {
  kind: RuntimeCockpitTimelineKind;
  at: number;
  title: string;
  detail: string | null;
  status: RuntimeCockpitTimelineStatus;
  phase?: AutonomousRunPhase;
  stepStatus?: AutonomousRunStepStatus;
  proofUpdateCount?: number;
  evidenceKind?: AutonomousRunObservationKind;
  evidenceFreshness?: AutonomousEvidenceFreshness;
  qualityGateGrade?: AutonomousQualityGateGrade | null;
  reviewLaneRole?: AutonomousReviewLaneRecordRole;
  reviewLaneStatus?: AutonomousReviewLaneStatus;
  missionMode?: AutonomousRunMode;
  runStatus?: AutonomousRunStatus;
}

export interface RuntimeCockpitReview {
  recorded: boolean;
  qualityGate: {
    recorded: boolean;
    status: AutonomousQualityGateStatus | 'none';
    grade: AutonomousQualityGateGrade | null;
    verificationPassed: boolean | null;
    coverageComplete: boolean | null;
    coverageRows: number;
    gapCount: number;
    conflictCount: number;
    warningCount: number;
  };
  lanes: {
    total: number;
    running: number;
    passed: number;
    blocked: number;
    failed: number;
    highestPriority: AutonomousReviewLanePriority | null;
    worstGrade: AutonomousQualityGateGrade | null;
    recommendation: AutonomousReviewLaneRecommendation | 'none';
    details: RuntimeCockpitReviewLaneSummary[];
  };
}

export interface RuntimeCockpitReviewLaneSummary {
  role: AutonomousReviewLaneRecordRole;
  status: AutonomousReviewLaneStatus;
  grade: AutonomousQualityGateGrade | null;
  recommendation: AutonomousReviewLaneRecommendation;
  highestPriority: AutonomousReviewLanePriority | null;
  issueCount: number;
  evidenceRefCount: number;
}
