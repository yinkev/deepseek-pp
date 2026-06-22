import type {
  AutonomousEvidenceRecord,
  AutonomousRun,
  AutonomousRunError,
  AutonomousRunStep,
  AutonomousTargetLease,
} from './types';
import {
  reviewAutonomousEvidenceFreshness,
  reviewAutonomousTargetLease,
} from './target';
import type { BrowserControlTarget } from '../browser-control/types';

export type AutonomousRunCompletionDecision = 'pass' | 'iterate' | 'fail';

export type AutonomousRunCompletionGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface AutonomousRunCompletionReview {
  decision: AutonomousRunCompletionDecision;
  grade: AutonomousRunCompletionGrade;
  score: number;
  issueCodes: string[];
  requiredEvidenceMissing: string[];
  doneCriteriaMissing: string[];
  acceptedEvidenceIds: string[];
  error: AutonomousRunError | null;
}

export interface AutonomousRunCompletionReviewInput {
  run: AutonomousRun;
  steps: readonly AutonomousRunStep[];
  evidence: readonly AutonomousEvidenceRecord[];
  targetLease?: AutonomousTargetLease | null;
  liveTarget?: Pick<BrowserControlTarget, 'id' | 'windowId' | 'url' | 'controllable'> | null;
  now?: number;
}

export function reviewAutonomousRunCompletion(
  input: AutonomousRunCompletionReviewInput,
): AutonomousRunCompletionReview {
  const now = input.now ?? Date.now();
  const runSteps = input.steps.filter((step) => step.runId === input.run.id);
  const runEvidence = input.evidence.filter((record) => record.runId === input.run.id);
  const issueCodes: string[] = [];
  const targetLease = input.targetLease ?? null;

  const doneCriteriaMissing = missingItems(input.run.proofContract.doneCriteria, collectProofTokens(runSteps));
  if (doneCriteriaMissing.length > 0) issueCodes.push('done_criteria_missing');

  const acceptedEvidence = collectAcceptedEvidence(runEvidence, targetLease, now, issueCodes);
  const requiredEvidenceMissing = missingItems(input.run.proofContract.requiredEvidence, collectEvidenceTokens(acceptedEvidence));
  if (requiredEvidenceMissing.length > 0) issueCodes.push('required_evidence_missing');

  const acceptedEvidenceIds = acceptedEvidence.map((record) => record.id);
  if (input.run.proofContract.requiredEvidence.length > 0 && acceptedEvidenceIds.length === 0) {
    issueCodes.push('fresh_evidence_missing');
  }

  if (input.run.targetLeaseId && !targetLease) issueCodes.push('target_lease_missing');
  if (targetLease) {
    if (targetLease.id !== input.run.targetLeaseId) issueCodes.push('target_lease_id_mismatch');
    if (targetLease.runId !== input.run.id) issueCodes.push('target_lease_run_mismatch');
    const leaseReview = reviewAutonomousTargetLease(targetLease, input.liveTarget ?? null, now);
    if (!leaseReview.ok && leaseReview.reason) issueCodes.push(leaseReview.reason);
  }

  const failedSteps = runSteps.filter((step) => step.status === 'failed').length;
  if (failedSteps > 0) issueCodes.push('failed_steps_present');

  if (input.run.proofContract.doneCriteria.length === 0 && input.run.proofContract.requiredEvidence.length === 0) {
    issueCodes.push('proof_contract_empty');
  }
  if (acceptedEvidenceIds.length === 0) issueCodes.push('accepted_evidence_missing');

  const uniqueIssueCodes = unique(issueCodes);
  const score = scoreCompletionReview({
    criteriaCount: input.run.proofContract.doneCriteria.length,
    criteriaMissing: doneCriteriaMissing.length,
    evidenceCount: input.run.proofContract.requiredEvidence.length,
    evidenceMissing: requiredEvidenceMissing.length,
    acceptedEvidenceCount: acceptedEvidenceIds.length,
    failedSteps,
    issueCount: uniqueIssueCodes.length,
  });
  const grade = gradeScore(score);
  const decision = decideCompletion({
    grade,
    issueCodes: uniqueIssueCodes,
    acceptedEvidenceCount: acceptedEvidenceIds.length,
    criteriaMissing: doneCriteriaMissing.length,
    evidenceMissing: requiredEvidenceMissing.length,
  });
  return {
    decision,
    grade,
    score,
    issueCodes: uniqueIssueCodes,
    requiredEvidenceMissing,
    doneCriteriaMissing,
    acceptedEvidenceIds,
    error: decision === 'pass'
      ? null
      : {
        code: `completion_review_${decision}`,
        message: decision === 'iterate'
          ? 'Autonomous run needs another implementation or verification iteration.'
          : 'Autonomous run failed completion review.',
        phase: 'review',
        retryable: decision === 'iterate',
        at: now,
        details: {
          grade,
          issueCodes: uniqueIssueCodes,
        },
      },
  };
}

function collectAcceptedEvidence(
  evidence: readonly AutonomousEvidenceRecord[],
  lease: AutonomousTargetLease | null,
  now: number,
  issueCodes: string[],
): AutonomousEvidenceRecord[] {
  const accepted: AutonomousEvidenceRecord[] = [];
  for (const record of evidence) {
    const review = reviewAutonomousEvidenceFreshness(record, lease, now);
    if (review.ok) {
      accepted.push(record);
    } else if (review.reason) {
      issueCodes.push(review.reason);
    }
  }
  return accepted;
}

function collectProofTokens(steps: readonly AutonomousRunStep[]): string[] {
  return unique(steps.filter((step) => step.status === 'succeeded').flatMap((step) => step.proofDelta));
}

function collectEvidenceTokens(evidence: readonly AutonomousEvidenceRecord[]): string[] {
  return unique(evidence.flatMap((record) => [
    record.kind,
    record.summary,
    ...record.refs,
  ]));
}

function missingItems(required: readonly string[], available: readonly string[]): string[] {
  const normalizedAvailable = available.map(normalizeComparable);
  return required.filter((item) => {
    const normalized = normalizeComparable(item);
    return normalized.length > 0 && !normalizedAvailable.some((availableItem) => availableItem.includes(normalized));
  });
}

function scoreCompletionReview(input: {
  criteriaCount: number;
  criteriaMissing: number;
  evidenceCount: number;
  evidenceMissing: number;
  acceptedEvidenceCount: number;
  failedSteps: number;
  issueCount: number;
}): number {
  let score = 100;
  if (input.criteriaCount > 0) score -= Math.round((input.criteriaMissing / input.criteriaCount) * 40);
  if (input.evidenceCount > 0) score -= Math.round((input.evidenceMissing / input.evidenceCount) * 35);
  if (input.evidenceCount > 0 && input.acceptedEvidenceCount === 0) score -= 20;
  score -= Math.min(25, input.failedSteps * 10);
  score -= Math.min(20, input.issueCount * 3);
  return Math.max(0, Math.min(100, score));
}

function gradeScore(score: number): AutonomousRunCompletionGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function decideCompletion(input: {
  grade: AutonomousRunCompletionGrade;
  issueCodes: readonly string[];
  acceptedEvidenceCount: number;
  criteriaMissing: number;
  evidenceMissing: number;
}): AutonomousRunCompletionDecision {
  const { grade, issueCodes, acceptedEvidenceCount, criteriaMissing, evidenceMissing } = input;
  if (issueCodes.length === 0 && (grade === 'A' || grade === 'B')) return 'pass';
  if (issueCodes.includes('proof_contract_empty') && acceptedEvidenceCount === 0) return 'fail';
  if (grade === 'F' && (acceptedEvidenceCount === 0 || criteriaMissing + evidenceMissing >= 3)) return 'fail';
  return 'iterate';
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function unique(values: readonly string[]): string[] {
  const output: string[] = [];
  for (const value of values) {
    if (value && !output.includes(value)) output.push(value);
  }
  return output;
}
