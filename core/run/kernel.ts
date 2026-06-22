import type {
  AutonomousRun,
  AutonomousRunError,
  AutonomousRunStep,
} from './types';

export interface AutonomousRunProgressReview {
  blocked: boolean;
  reason: 'no_progress' | 'same_error' | null;
  error: AutonomousRunError | null;
}

export function reviewAutonomousRunProgress(
  run: AutonomousRun,
  steps: readonly AutonomousRunStep[],
  now = Date.now(),
): AutonomousRunProgressReview {
  const ordered = [...steps]
    .filter((step) => step.runId === run.id)
    .sort((a, b) => a.seq - b.seq);
  const recentCompleted = ordered.filter((step) => step.status === 'succeeded' || step.status === 'failed');
  if (hasConsecutiveNoProgress(recentCompleted, run.budgets.maxConsecutiveNoProgress)) {
    return {
      blocked: true,
      reason: 'no_progress',
      error: createKernelError('run_no_progress', 'Run stopped after repeated steps without proof or progress delta.', now),
    };
  }
  if (hasSameErrorRepeats(recentCompleted, run.budgets.maxSameErrorRepeats)) {
    return {
      blocked: true,
      reason: 'same_error',
      error: createKernelError('run_repeated_error', 'Run stopped after the same error repeated.', now),
    };
  }
  return { blocked: false, reason: null, error: null };
}

export function shouldTransitionAutonomousRun(
  from: AutonomousRun['status'],
  to: AutonomousRun['status'],
): boolean {
  if (from === to) return true;
  if (isTerminalRunStatus(from)) return false;
  if (from === 'queued') return to === 'running' || to === 'paused' || to === 'cancelled' || to === 'blocked';
  if (from === 'running') return to === 'paused' || to === 'blocked' || to === 'succeeded' || to === 'failed' || to === 'cancelled';
  if (from === 'paused') return to === 'running' || to === 'blocked' || to === 'cancelled';
  if (from === 'blocked') return to === 'running' || to === 'failed' || to === 'cancelled';
  return false;
}

export function isTerminalRunStatus(status: AutonomousRun['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function hasConsecutiveNoProgress(steps: readonly AutonomousRunStep[], limit: number): boolean {
  if (limit <= 0) return false;
  let count = 0;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (!step) continue;
    const madeProgress = step.progressScore > 0 || step.proofDelta.length > 0 || step.evidenceRefs.length > 0;
    if (madeProgress) break;
    count += 1;
    if (count >= limit) return true;
  }
  return false;
}

function hasSameErrorRepeats(steps: readonly AutonomousRunStep[], limit: number): boolean {
  if (limit <= 0) return false;
  let code: string | null = null;
  let count = 0;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step?.status !== 'failed' || !step.error?.code) break;
    if (code === null) code = step.error.code;
    if (step.error.code !== code) break;
    count += 1;
    if (count >= limit) return true;
  }
  return false;
}

function createKernelError(code: string, message: string, now: number): AutonomousRunError {
  return {
    code,
    message,
    phase: 'policy',
    retryable: true,
    at: now,
  };
}
