import type { AutonomousRunOrchestratorCycleResult } from './orchestrator';
import type { AutonomousRunCycleResult } from './worker';
import type {
  AutonomousRun,
  AutonomousRunId,
  AutonomousRunStatus,
  AutonomousRunStorageState,
} from './types';

export type AutonomousResultStateConsistencyScope = 'worker' | 'orchestrator';
export type AutonomousResultStateConsistencyStatus = 'consistent' | 'inconsistent' | 'not_applicable';
export type AutonomousResultStateConsistencySeverity = 'P1' | 'P2';

export type AutonomousResultStateConsistencyIssueCode =
  | 'durable_run_missing'
  | 'final_status_mismatch'
  | 'claimed_success_without_durable_success'
  | 'completion_pass_without_durable_success'
  | 'iteration_succeed_without_durable_success'
  | 'block_action_without_blocked_status'
  | 'fail_action_claims_success'
  | 'selected_run_missing'
  | 'worker_result_missing_for_selected_run'
  | 'worker_result_present_without_selected_run'
  | 'selected_worker_run_mismatch'
  | 'after_snapshot_status_mismatch';

export interface AutonomousResultStateConsistencyIssue {
  code: AutonomousResultStateConsistencyIssueCode;
  severity: AutonomousResultStateConsistencySeverity;
  expectedStatus?: AutonomousRunStatus | null;
  actualStatus?: AutonomousRunStatus | null;
}

export interface AutonomousResultStateConsistencyReview {
  ok: boolean;
  scope: AutonomousResultStateConsistencyScope;
  status: AutonomousResultStateConsistencyStatus;
  issueCodes: AutonomousResultStateConsistencyIssueCode[];
  issues: AutonomousResultStateConsistencyIssue[];
  checked: {
    resultPresent: boolean;
    durableRunPresent: boolean;
    workerResultPresent?: boolean;
    selectedRunPresent?: boolean;
    afterSnapshotChecked?: boolean;
  };
  resultStatus: AutonomousRunStatus | null;
  durableStatus: AutonomousRunStatus | null;
}

export interface AutonomousWorkerResultStateConsistencyInput {
  result: AutonomousRunCycleResult | null | undefined;
  state: Pick<AutonomousRunStorageState, 'runs'>;
}

export interface AutonomousOrchestratorResultStateConsistencyInput {
  result: AutonomousRunOrchestratorCycleResult | null | undefined;
  state: Pick<AutonomousRunStorageState, 'runs'>;
}

export function reviewAutonomousWorkerResultStateConsistency(
  input: AutonomousWorkerResultStateConsistencyInput,
): AutonomousResultStateConsistencyReview {
  if (!input.result) {
    return createReview({
      scope: 'worker',
      notApplicable: true,
      checked: { resultPresent: false, durableRunPresent: false },
      resultStatus: null,
      durableStatus: null,
      issues: [],
    });
  }

  const result = input.result;
  const durableRun = findRun(input.state, result.runId);
  const issues = durableRun
    ? reviewWorkerAgainstDurableRun(result, durableRun)
    : reviewWorkerWithoutDurableRun(result);

  return createReview({
    scope: 'worker',
    checked: {
      resultPresent: true,
      durableRunPresent: Boolean(durableRun),
    },
    resultStatus: result.finalStatus,
    durableStatus: durableRun?.status ?? null,
    issues,
  });
}

export function reviewAutonomousOrchestratorResultStateConsistency(
  input: AutonomousOrchestratorResultStateConsistencyInput,
): AutonomousResultStateConsistencyReview {
  const result = input.result;
  if (!result) {
    return createReview({
      scope: 'orchestrator',
      notApplicable: true,
      checked: {
        resultPresent: false,
        durableRunPresent: false,
        workerResultPresent: false,
        selectedRunPresent: false,
        afterSnapshotChecked: false,
      },
      resultStatus: null,
      durableStatus: null,
      issues: [],
    });
  }

  if (!result.selectedRunId) {
    const workerReview = result.workerResult
      ? reviewAutonomousWorkerResultStateConsistency({
        result: result.workerResult,
        state: input.state,
      })
      : null;
    const issues = result.workerResult
      ? [
        createIssue('worker_result_present_without_selected_run', 'P2'),
        ...(workerReview?.issues ?? []),
      ]
      : [];
    return createReview({
      scope: 'orchestrator',
      notApplicable: issues.length === 0,
      checked: {
        resultPresent: true,
        durableRunPresent: workerReview?.checked.durableRunPresent ?? false,
        workerResultPresent: Boolean(result.workerResult),
        selectedRunPresent: false,
        afterSnapshotChecked: false,
      },
      resultStatus: result.workerResult?.finalStatus ?? null,
      durableStatus: workerReview?.durableStatus ?? null,
      issues,
    });
  }

  const selectedRun = findRun(input.state, result.selectedRunId);
  const issues: AutonomousResultStateConsistencyIssue[] = [];

  if (!selectedRun) {
    issues.push(createIssue('selected_run_missing', 'P1'));
  }

  if (!result.workerResult) {
    issues.push(createIssue('worker_result_missing_for_selected_run', 'P1'));
  } else {
    if (result.workerResult.runId !== result.selectedRunId) {
      issues.push(createIssue('selected_worker_run_mismatch', 'P1'));
    }
    issues.push(...reviewAutonomousWorkerResultStateConsistency({
      result: result.workerResult,
      state: input.state,
    }).issues);
  }

  const workerResult = result.workerResult;
  const afterSnapshotStatus = getAfterSnapshotSelectedStatus(result);
  if (
    afterSnapshotStatus !== null &&
    workerResult &&
    workerResult.finalStatus !== null &&
    afterSnapshotStatus !== workerResult.finalStatus
  ) {
    issues.push(createIssue('after_snapshot_status_mismatch', 'P2', workerResult.finalStatus, afterSnapshotStatus));
  }

  return createReview({
    scope: 'orchestrator',
    checked: {
      resultPresent: true,
      durableRunPresent: Boolean(selectedRun),
      workerResultPresent: Boolean(result.workerResult),
      selectedRunPresent: Boolean(selectedRun),
      afterSnapshotChecked: afterSnapshotStatus !== null,
    },
    resultStatus: result.workerResult?.finalStatus ?? null,
    durableStatus: selectedRun?.status ?? null,
    issues,
  });
}

function reviewWorkerAgainstDurableRun(
  result: AutonomousRunCycleResult,
  durableRun: AutonomousRun,
): AutonomousResultStateConsistencyIssue[] {
  const issues: AutonomousResultStateConsistencyIssue[] = [];

  if (result.finalStatus !== durableRun.status) {
    issues.push(createIssue('final_status_mismatch', 'P1', durableRun.status, result.finalStatus));
  }
  if (result.finalStatus === 'succeeded' && durableRun.status !== 'succeeded') {
    issues.push(createIssue('claimed_success_without_durable_success', 'P1', 'succeeded', durableRun.status));
  }
  if (result.reviewSummary?.completionDecision === 'pass' && durableRun.status !== 'succeeded') {
    issues.push(createIssue('completion_pass_without_durable_success', 'P1', 'succeeded', durableRun.status));
  }
  if (
    (result.iterationAction === 'succeed' || result.reviewSummary?.action === 'succeed') &&
    durableRun.status !== 'succeeded'
  ) {
    issues.push(createIssue('iteration_succeed_without_durable_success', 'P1', 'succeeded', durableRun.status));
  }
  if (result.action === 'block' && result.finalStatus !== 'blocked') {
    issues.push(createIssue('block_action_without_blocked_status', 'P1', 'blocked', result.finalStatus));
  }
  if (result.action === 'fail' && result.finalStatus === 'succeeded') {
    issues.push(createIssue('fail_action_claims_success', 'P1', null, 'succeeded'));
  }

  return issues;
}

function reviewWorkerWithoutDurableRun(
  result: AutonomousRunCycleResult,
): AutonomousResultStateConsistencyIssue[] {
  const issues = reviewSuccessClaimsWithoutDurableRun(result);
  if (result.action === 'noop' && result.finalStatus === null && issues.length === 0) {
    return [];
  }
  return [
    createIssue('durable_run_missing', 'P1'),
    ...issues,
  ];
}

function reviewSuccessClaimsWithoutDurableRun(
  result: AutonomousRunCycleResult,
): AutonomousResultStateConsistencyIssue[] {
  const issues: AutonomousResultStateConsistencyIssue[] = [];
  if (result.finalStatus === 'succeeded') {
    issues.push(createIssue('claimed_success_without_durable_success', 'P1', 'succeeded', null));
  }
  if (result.reviewSummary?.completionDecision === 'pass') {
    issues.push(createIssue('completion_pass_without_durable_success', 'P1', 'succeeded', null));
  }
  if (result.iterationAction === 'succeed' || result.reviewSummary?.action === 'succeed') {
    issues.push(createIssue('iteration_succeed_without_durable_success', 'P1', 'succeeded', null));
  }
  return issues;
}

function createReview(input: {
  scope: AutonomousResultStateConsistencyScope;
  notApplicable?: boolean;
  checked: AutonomousResultStateConsistencyReview['checked'];
  resultStatus: AutonomousRunStatus | null;
  durableStatus: AutonomousRunStatus | null;
  issues: AutonomousResultStateConsistencyIssue[];
}): AutonomousResultStateConsistencyReview {
  const issueCodes = [...new Set(input.issues.map((issue) => issue.code))];
  const status: AutonomousResultStateConsistencyStatus = input.issues.length > 0
    ? 'inconsistent'
    : input.notApplicable
      ? 'not_applicable'
      : 'consistent';
  return {
    ok: input.issues.length === 0,
    scope: input.scope,
    status,
    issueCodes,
    issues: input.issues,
    checked: input.checked,
    resultStatus: input.resultStatus,
    durableStatus: input.durableStatus,
  };
}

function createIssue(
  code: AutonomousResultStateConsistencyIssueCode,
  severity: AutonomousResultStateConsistencySeverity,
  expectedStatus?: AutonomousRunStatus | null,
  actualStatus?: AutonomousRunStatus | null,
): AutonomousResultStateConsistencyIssue {
  return {
    code,
    severity,
    ...(expectedStatus !== undefined ? { expectedStatus } : {}),
    ...(actualStatus !== undefined ? { actualStatus } : {}),
  };
}

function findRun(state: Pick<AutonomousRunStorageState, 'runs'>, runId: AutonomousRunId): AutonomousRun | null {
  return state.runs.find((run) => run.id === runId) ?? null;
}

function getAfterSnapshotSelectedStatus(
  result: AutonomousRunOrchestratorCycleResult,
): AutonomousRunStatus | null {
  if (!result.selectedRunId || result.afterSnapshot.activeRun?.id !== result.selectedRunId) {
    return null;
  }
  return result.afterSnapshot.activeRun.status;
}
