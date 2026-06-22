import { describe, expect, it } from 'vitest';
import { reviewAutonomousRunCompletion } from '../core/run/review';
import type {
  AutonomousEvidenceRecord,
  AutonomousRun,
  AutonomousRunStep,
  AutonomousTargetLease,
} from '../core/run/types';
import {
  DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
  DEFAULT_AUTONOMOUS_RUN_BUDGETS,
  DEFAULT_AUTONOMOUS_RUN_POLICY,
} from '../core/run/store';

const NOW = 10_000;

describe('autonomous run completion review', () => {
  it('passes when proof criteria and fresh required evidence are present', () => {
    const run = createRun({
      proofContract: {
        ...DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
        doneCriteria: ['tests pass'],
        requiredEvidence: ['browser_screenshot'],
      },
    });
    const review = reviewAutonomousRunCompletion({
      run,
      steps: [createStep({ proofDelta: ['Tests pass'] })],
      evidence: [createEvidence()],
      targetLease: createLease(),
      liveTarget: { id: 42, windowId: 7, url: 'https://example.com/work', controllable: true },
      now: NOW,
    });

    expect(review).toMatchObject({
      decision: 'pass',
      grade: 'A',
      issueCodes: [],
      acceptedEvidenceIds: ['evidence-1'],
      error: null,
    });
  });

  it('iterates when proof criteria are missing but recovery is plausible', () => {
    const run = createRun({
      proofContract: {
        ...DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
        doneCriteria: ['compile passes'],
        requiredEvidence: ['browser_screenshot'],
      },
    });
    const review = reviewAutonomousRunCompletion({
      run,
      steps: [createStep({ proofDelta: [] })],
      evidence: [createEvidence()],
      targetLease: createLease(),
      liveTarget: { id: 42, windowId: 7, url: 'https://example.com/work', controllable: true },
      now: NOW,
    });

    expect(review.decision).toBe('iterate');
    expect(review.doneCriteriaMissing).toEqual(['compile passes']);
    expect(review.error).toMatchObject({ code: 'completion_review_iterate', retryable: true });
  });

  it('fails when required proof and evidence are absent', () => {
    const run = createRun({
      proofContract: {
        ...DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
        doneCriteria: ['compile passes', 'tests pass'],
        requiredEvidence: ['browser_screenshot', 'review_note'],
      },
    });
    const review = reviewAutonomousRunCompletion({
      run,
      steps: [],
      evidence: [],
      now: NOW,
    });

    expect(review.decision).toBe('fail');
    expect(review.grade).toBe('F');
    expect(review.issueCodes).toEqual(expect.arrayContaining([
      'done_criteria_missing',
      'required_evidence_missing',
      'fresh_evidence_missing',
      'target_lease_missing',
      'accepted_evidence_missing',
    ]));
  });

  it('rejects stale or lease-mismatched evidence and fails when no fresh evidence remains', () => {
    const run = createRun({
      proofContract: {
        ...DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
        doneCriteria: ['tests pass'],
        requiredEvidence: ['browser_screenshot'],
      },
    });
    const review = reviewAutonomousRunCompletion({
      run,
      steps: [createStep({ proofDelta: ['tests pass'] })],
      evidence: [
        createEvidence({ freshness: 'stale' }),
        createEvidence({ id: 'evidence-2', leaseId: 'other-lease' }),
      ],
      targetLease: createLease(),
      liveTarget: { id: 42, windowId: 7, url: 'https://example.com/work', controllable: true },
      now: NOW,
    });

    expect(review.decision).toBe('fail');
    expect(review.acceptedEvidenceIds).toEqual([]);
    expect(review.issueCodes).toContain('stale_evidence');
    expect(review.issueCodes).toContain('lease_mismatch');
    expect(review.issueCodes).toContain('required_evidence_missing');
  });

  it('flags target lease review failures', () => {
    const review = reviewAutonomousRunCompletion({
      run: createRun({
        proofContract: {
          ...DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
          doneCriteria: ['tests pass'],
          requiredEvidence: ['browser_screenshot'],
        },
      }),
      steps: [createStep()],
      evidence: [createEvidence()],
      targetLease: createLease(),
      liveTarget: { id: 42, windowId: 7, url: 'https://other.example/work', controllable: true },
      now: NOW,
    });

    expect(review.decision).toBe('iterate');
    expect(review.issueCodes).toContain('origin_mismatch');
  });

  it('requires the provided target lease to match the run', () => {
    const missing = reviewAutonomousRunCompletion({
      run: createRun({ targetLeaseId: 'lease-1' }),
      steps: [createStep()],
      evidence: [createEvidence()],
      now: NOW,
    });
    expect(missing.issueCodes).toContain('target_lease_missing');

    const mismatched = reviewAutonomousRunCompletion({
      run: createRun({ targetLeaseId: 'lease-1' }),
      steps: [createStep()],
      evidence: [createEvidence()],
      targetLease: createLease({ id: 'other-lease', runId: 'other-run' }),
      liveTarget: { id: 42, windowId: 7, url: 'https://example.com/work', controllable: true },
      now: NOW,
    });
    expect(mismatched.issueCodes).toContain('target_lease_id_mismatch');
    expect(mismatched.issueCodes).toContain('target_lease_run_mismatch');
  });

  it('penalizes failed steps even when evidence is present', () => {
    const review = reviewAutonomousRunCompletion({
      run: createRun(),
      steps: [createStep({ status: 'failed' })],
      evidence: [createEvidence()],
      now: NOW,
    });

    expect(review.decision).toBe('iterate');
    expect(review.issueCodes).toContain('failed_steps_present');
  });

  it('does not pass an empty proof contract with no accepted evidence', () => {
    const review = reviewAutonomousRunCompletion({
      run: createRun({ targetLeaseId: null }),
      steps: [],
      evidence: [],
      now: NOW,
    });

    expect(review.decision).toBe('fail');
    expect(review.issueCodes).toContain('proof_contract_empty');
    expect(review.issueCodes).toContain('accepted_evidence_missing');
  });

  it('ignores proof deltas from non-succeeded steps', () => {
    const run = createRun({
      targetLeaseId: null,
      proofContract: {
        ...DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
        doneCriteria: ['tests pass'],
        requiredEvidence: [],
      },
    });
    const review = reviewAutonomousRunCompletion({
      run,
      steps: [
        createStep({ status: 'running', proofDelta: ['tests pass'] }),
        createStep({ status: 'skipped', proofDelta: ['tests pass'] }),
      ],
      evidence: [createEvidence({ leaseId: null })],
      now: NOW,
    });

    expect(review.decision).toBe('iterate');
    expect(review.doneCriteriaMissing).toEqual(['tests pass']);
  });
});

function createRun(overrides: Partial<AutonomousRun> = {}): AutonomousRun {
  return {
    id: 'run-1',
    goal: 'Autonomous worker',
    mode: 'unattended',
    status: 'running',
    modelAdapter: 'deepseek_web',
    targetLeaseId: 'lease-1',
    budgets: DEFAULT_AUTONOMOUS_RUN_BUDGETS,
    policy: DEFAULT_AUTONOMOUS_RUN_POLICY,
    proofContract: DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
    checkpoint: {
      providerConversationId: null,
      parentMessageId: null,
      latestStepId: null,
      resumableSummary: '',
      unresolvedQuestions: [],
    },
    error: null,
    createdAt: NOW,
    startedAt: NOW,
    completedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function createStep(overrides: Partial<AutonomousRunStep> = {}): AutonomousRunStep {
  return {
    id: 'step-1',
    runId: 'run-1',
    seq: 1,
    phase: 'verification',
    status: 'succeeded',
    modelTurnId: null,
    toolCallIds: [],
    observationRefs: [],
    evidenceRefs: ['evidence-1'],
    progressScore: 1,
    proofDelta: ['tests pass'],
    error: null,
    startedAt: NOW - 100,
    endedAt: NOW,
    ...overrides,
  };
}

function createLease(overrides: Partial<AutonomousTargetLease> = {}): AutonomousTargetLease {
  return {
    id: 'lease-1',
    runId: 'run-1',
    status: 'active',
    label: 'Dev++',
    tabId: 42,
    windowId: 7,
    origin: 'https://example.com',
    title: 'Work',
    acquiredAt: NOW - 1_000,
    expiresAt: NOW + 1_000,
    lastVerifiedAt: NOW - 100,
    releasedAt: null,
    ...overrides,
  };
}

function createEvidence(overrides: Partial<AutonomousEvidenceRecord> = {}): AutonomousEvidenceRecord {
  return {
    id: 'evidence-1',
    runId: 'run-1',
    leaseId: 'lease-1',
    kind: 'browser_screenshot',
    freshness: 'fresh',
    capturedAt: NOW - 100,
    expiresAt: NOW + 1_000,
    summary: 'Browser screenshot captured',
    refs: ['browser_screenshot'],
    source: { tabId: 42, windowId: 7 },
    metadata: null,
    ...overrides,
  };
}
