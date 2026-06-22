export type AutonomousRunId = string;
export type AutonomousRunStepId = string;

export type AutonomousRunMode = 'interactive' | 'unattended';

export type AutonomousRunStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type AutonomousRunPhase =
  | 'plan'
  | 'model_turn'
  | 'tool_selection'
  | 'tool_execution'
  | 'observation'
  | 'verification'
  | 'review'
  | 'checkpoint'
  | 'finish';

export type AutonomousRunStepStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

export type AutonomousRunObservationKind =
  | 'tool_result'
  | 'browser_snapshot'
  | 'browser_screenshot'
  | 'file'
  | 'shell_output'
  | 'web'
  | 'memory'
  | 'model_text';

export type AutonomousTargetLeaseId = string;
export type AutonomousEvidenceId = string;

export type AutonomousTargetLeaseStatus = 'active' | 'released' | 'expired' | 'stale';

export type AutonomousEvidenceFreshness = 'fresh' | 'stale' | 'expired';

export interface AutonomousRunBudgets {
  maxWallMs: number;
  maxModelTurns: number;
  maxToolCalls: number;
  maxConsecutiveNoProgress: number;
  maxSameErrorRepeats: number;
  maxPromptBytesPerTurn: number;
  maxObservationBytesPerTurn: number;
}

export interface AutonomousRunPolicy {
  approvalMode: 'auto_low_risk' | 'confirm_high_risk' | 'manual_all';
  allowedTools: string[];
  deniedTools: string[];
  browserMutationRequiresTargetLock: true;
  persistMemory: 'off' | 'propose' | 'auto_pinned_only';
  shellMode: 'disabled' | 'allowlisted' | 'manual' | 'unrestricted_local';
}

export interface AutonomousRunProofContract {
  doneCriteria: string[];
  requiredEvidence: string[];
  antiProof: string[];
}

export interface AutonomousRunCheckpoint {
  providerConversationId: string | null;
  parentMessageId: string | null;
  latestStepId: AutonomousRunStepId | null;
  resumableSummary: string;
  unresolvedQuestions: string[];
}

export interface AutonomousRunError {
  code: string;
  message: string;
  phase: AutonomousRunPhase | 'storage' | 'policy' | 'unknown';
  retryable: boolean;
  at: number;
  details?: Record<string, unknown>;
}

export interface AutonomousRun {
  id: AutonomousRunId;
  goal: string;
  mode: AutonomousRunMode;
  status: AutonomousRunStatus;
  modelAdapter: 'deepseek_web' | 'deepseek_api';
  targetLeaseId: string | null;
  budgets: AutonomousRunBudgets;
  policy: AutonomousRunPolicy;
  proofContract: AutonomousRunProofContract;
  checkpoint: AutonomousRunCheckpoint;
  error: AutonomousRunError | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface AutonomousTargetLease {
  id: AutonomousTargetLeaseId;
  runId: AutonomousRunId;
  status: AutonomousTargetLeaseStatus;
  label: string;
  tabId: number;
  windowId: number;
  origin: string;
  title: string;
  acquiredAt: number;
  expiresAt: number;
  lastVerifiedAt: number | null;
  releasedAt: number | null;
}

export interface AutonomousEvidenceSource {
  tabId?: number;
  windowId?: number;
  toolName?: string;
  automationId?: string;
  automationRunId?: string;
}

export interface AutonomousEvidenceRecord {
  id: AutonomousEvidenceId;
  runId: AutonomousRunId;
  leaseId: AutonomousTargetLeaseId | null;
  kind: AutonomousRunObservationKind;
  freshness: AutonomousEvidenceFreshness;
  capturedAt: number;
  expiresAt: number;
  summary: string;
  refs: string[];
  source: AutonomousEvidenceSource;
  metadata: Record<string, unknown> | null;
}

export interface AutonomousRunStep {
  id: AutonomousRunStepId;
  runId: AutonomousRunId;
  seq: number;
  phase: AutonomousRunPhase;
  status: AutonomousRunStepStatus;
  modelTurnId: string | null;
  toolCallIds: string[];
  observationRefs: string[];
  evidenceRefs: string[];
  progressScore: number;
  proofDelta: string[];
  error: AutonomousRunError | null;
  startedAt: number;
  endedAt: number | null;
}

export interface AutonomousRunCreateInput {
  id?: AutonomousRunId;
  goal: string;
  mode?: AutonomousRunMode;
  modelAdapter?: AutonomousRun['modelAdapter'];
  targetLeaseId?: string | null;
  budgets?: Partial<AutonomousRunBudgets>;
  policy?: Partial<AutonomousRunPolicy>;
  proofContract?: Partial<AutonomousRunProofContract>;
  checkpoint?: Partial<AutonomousRunCheckpoint>;
}

export interface AutonomousRunUpdateInput {
  status?: AutonomousRunStatus;
  targetLeaseId?: string | null;
  budgets?: Partial<AutonomousRunBudgets>;
  policy?: Partial<AutonomousRunPolicy>;
  proofContract?: Partial<AutonomousRunProofContract>;
  checkpoint?: Partial<AutonomousRunCheckpoint>;
  error?: AutonomousRunError | null;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface AutonomousTargetLeaseCreateInput {
  id?: AutonomousTargetLeaseId;
  runId: AutonomousRunId;
  label?: string;
  tabId: number;
  windowId: number;
  origin: string;
  title?: string;
  ttlMs?: number;
  acquiredAt?: number;
}

export interface AutonomousEvidenceCreateInput {
  id?: AutonomousEvidenceId;
  leaseId?: AutonomousTargetLeaseId | null;
  kind: AutonomousRunObservationKind;
  capturedAt?: number;
  ttlMs?: number;
  summary?: string;
  refs?: string[];
  source?: AutonomousEvidenceSource;
  metadata?: Record<string, unknown> | null;
}

export interface AutonomousRunStepCreateInput {
  id?: AutonomousRunStepId;
  phase: AutonomousRunPhase;
  status?: AutonomousRunStepStatus;
  modelTurnId?: string | null;
  toolCallIds?: string[];
  observationRefs?: string[];
  evidenceRefs?: string[];
  progressScore?: number;
  proofDelta?: string[];
  error?: AutonomousRunError | null;
  startedAt?: number;
  endedAt?: number | null;
}

export interface AutonomousRunStorageState {
  version: 1;
  runs: AutonomousRun[];
  steps: AutonomousRunStep[];
  targetLeases: AutonomousTargetLease[];
  evidence: AutonomousEvidenceRecord[];
}
