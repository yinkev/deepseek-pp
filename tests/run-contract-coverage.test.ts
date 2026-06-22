import { describe, expect, it } from 'vitest';
import { createAutonomousContractCoverageTable } from '../core/run/contract-coverage';
import { reviewAutonomousRunCompletion } from '../core/run/review';
import {
  DEFAULT_AUTONOMOUS_RUN_BUDGETS,
  DEFAULT_AUTONOMOUS_RUN_POLICY,
} from '../core/run/store';
import type {
  AutonomousEvidenceRecord,
  AutonomousRun,
  AutonomousRunStep,
  AutonomousTargetLease,
} from '../core/run/types';

const NOW = 10_000;

describe('autonomous contract coverage table', () => {
  it('maps done criteria, required evidence, and anti-proof rows to covered status', () => {
    const run = createRun();
    const step = createStep({ proofDelta: ['Compile passes', 'Tests pass'] });
    const evidence = createEvidence();

    const table = createAutonomousContractCoverageTable({
      run,
      steps: [step],
      evidence: [evidence],
      acceptedEvidenceIds: ['evidence-1'],
    });

    expect(table.complete).toBe(true);
    expect(table).toMatchObject({
      coveredCount: 4,
      gapCount: 0,
      conflictCount: 0,
      notTestableCount: 0,
    });
    expect(table.rows).toEqual([
      {
        kind: 'done_criterion',
        requirement: 'compile passes',
        status: 'covered',
        matchedBy: ['step-1'],
      },
      {
        kind: 'done_criterion',
        requirement: 'tests pass',
        status: 'covered',
        matchedBy: ['step-1'],
      },
      {
        kind: 'required_evidence',
        requirement: 'shell_output',
        status: 'covered',
        matchedBy: ['evidence-1:kind', 'evidence-1:ref'],
      },
      {
        kind: 'anti_proof',
        requirement: 'no hallucinated success',
        status: 'covered',
        matchedBy: [],
      },
    ]);
  });

  it('reports gaps for missing criteria and missing accepted evidence', () => {
    const table = createAutonomousContractCoverageTable({
      run: createRun(),
      steps: [createStep({ proofDelta: ['compile passes'] })],
      evidence: [createEvidence({ id: 'stale-evidence' })],
      acceptedEvidenceIds: [],
    });

    expect(table.complete).toBe(false);
    expect(table.gapCount).toBe(2);
    expect(table.rows).toContainEqual({
      kind: 'done_criterion',
      requirement: 'tests pass',
      status: 'gap',
      matchedBy: [],
    });
    expect(table.rows).toContainEqual({
      kind: 'required_evidence',
      requirement: 'shell_output',
      status: 'gap',
      matchedBy: [],
    });
  });

  it('does not accept evidence when acceptedEvidenceIds is omitted by an untyped caller', () => {
    const table = createAutonomousContractCoverageTable({
      run: createRun(),
      steps: [createStep({ proofDelta: ['compile passes', 'tests pass'] })],
      evidence: [createEvidence()],
    } as any);

    expect(table.rows).toContainEqual({
      kind: 'required_evidence',
      requirement: 'shell_output',
      status: 'gap',
      matchedBy: [],
    });
    expect(table.complete).toBe(false);
  });

  it('marks anti-proof conflicts when forbidden evidence appears in proof or accepted evidence', () => {
    const table = createAutonomousContractCoverageTable({
      run: createRun(),
      steps: [createStep({ proofDelta: ['compile passes', 'tests pass', 'no hallucinated success'] })],
      evidence: [createEvidence()],
      acceptedEvidenceIds: ['evidence-1'],
    });

    expect(table.complete).toBe(false);
    expect(table.conflictCount).toBe(1);
    expect(table.rows).toContainEqual({
      kind: 'anti_proof',
      requirement: 'no hallucinated success',
      status: 'conflict',
      matchedBy: ['step-1'],
    });
  });

  it('anti-proof conflict wins over not-testable declarations', () => {
    const table = createAutonomousContractCoverageTable({
      run: createRun(),
      steps: [createStep({ proofDelta: ['compile passes', 'tests pass', 'no hallucinated success'] })],
      evidence: [createEvidence()],
      acceptedEvidenceIds: ['evidence-1'],
      notTestable: {
        anti_proof: ['no hallucinated success'],
      },
    });

    expect(table.complete).toBe(false);
    expect(table.conflictCount).toBe(1);
    expect(table.notTestableCount).toBe(0);
    expect(table.rows).toContainEqual({
      kind: 'anti_proof',
      requirement: 'no hallucinated success',
      status: 'conflict',
      matchedBy: ['step-1'],
    });
  });

  it('deduplicates blank and repeated requirements and can mark explicit not-testable rows', () => {
    const run = createRun({
      proofContract: {
        doneCriteria: ['tests pass', ' Tests   pass ', ''],
        requiredEvidence: ['browser_screenshot'],
        antiProof: ['external deployment'],
      },
    });

    const table = createAutonomousContractCoverageTable({
      run,
      steps: [],
      evidence: [],
      acceptedEvidenceIds: [],
      notTestable: {
        done_criterion: ['tests pass'],
        anti_proof: ['external deployment'],
      },
    });

    expect(table.rows).toEqual([
      {
        kind: 'done_criterion',
        requirement: 'tests pass',
        status: 'not_testable',
        matchedBy: [],
      },
      {
        kind: 'required_evidence',
        requirement: 'browser_screenshot',
        status: 'gap',
        matchedBy: [],
      },
      {
        kind: 'anti_proof',
        requirement: 'external deployment',
        status: 'not_testable',
        matchedBy: [],
      },
    ]);
    expect(table.notTestableCount).toBe(2);
    expect(table.gapCount).toBe(1);
    expect(table.complete).toBe(false);
  });

  it('privacy probe: coverage rows expose only step/evidence handles, not raw evidence summaries or refs', () => {
    const run = createRun({
      proofContract: {
        doneCriteria: ['compile passes with Authorization: Bearer secret-token'],
        requiredEvidence: ['shell_output?X-Amz-Signature=abc123'],
        antiProof: ['Cookie: sid=secret-session'],
      },
    });
    const step = createStep({ proofDelta: ['compile passes with Authorization: Bearer secret-token'] });
    const evidence = createEvidence({
      summary: 'shell_output?X-Amz-Signature=abc123',
      refs: ['shell_output?X-Amz-Signature=abc123', 'signed_url=https://example.com?X-Amz-Signature=abc123'],
    });
    const table = createAutonomousContractCoverageTable({
      run,
      steps: [step],
      evidence: [evidence],
      acceptedEvidenceIds: ['evidence-1'],
    });

    const json = JSON.stringify(table);
    expect(table.rows).toContainEqual({
      kind: 'done_criterion',
      requirement: 'compile passes with Authorization: [REDACTED]',
      status: 'covered',
      matchedBy: ['step-1'],
    });
    expect(json).toContain('evidence-1:summary');
    expect(json).toContain('evidence-1:ref');
    expect(json).toContain('X-Amz-Signature=[REDACTED]');
    expect(json).not.toMatch(/secret-token|abc123|secret-session|signed_url/);
  });

  it('privacy probe: matchedBy handles never expose durable step or evidence ids', () => {
    const table = createAutonomousContractCoverageTable({
      run: createRun(),
      steps: [createStep({ id: 'SECRET_STEP_ID', proofDelta: ['compile passes', 'tests pass'] })],
      evidence: [createEvidence({ id: 'SECRET_EVIDENCE_ID' })],
      acceptedEvidenceIds: ['SECRET_EVIDENCE_ID'],
    });

    const json = JSON.stringify(table);
    expect(table.rows).toContainEqual({
      kind: 'done_criterion',
      requirement: 'compile passes',
      status: 'covered',
      matchedBy: ['step-1'],
    });
    expect(table.rows).toContainEqual({
      kind: 'required_evidence',
      requirement: 'shell_output',
      status: 'covered',
      matchedBy: ['evidence-1:kind', 'evidence-1:ref'],
    });
    expect(json).not.toMatch(/SECRET_STEP_ID|SECRET_EVIDENCE_ID/);
  });

  it('privacy probe: requirement sanitizer redacts generic URLs and common non-sk tokens', () => {
    const run = createRun({
      proofContract: {
        doneCriteria: [
          'check https://private.example.com/path?case=123 and ghp_abcdefghijklmnopqrstuvwxyz1234567890 plus github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890abcdef x-api-key: leaked-header-secret token: leaked-token-secret',
        ],
        requiredEvidence: [],
        antiProof: [],
      },
    });
    const table = createAutonomousContractCoverageTable({
      run,
      steps: [],
      evidence: [],
      acceptedEvidenceIds: [],
    });

    expect(table.rows).toEqual([
      {
        kind: 'done_criterion',
        requirement: 'check [REDACTED_URL] and gh[REDACTED] plus github_pat_[REDACTED] x-api-key: [REDACTED] token: [REDACTED]',
        status: 'gap',
        matchedBy: [],
      },
    ]);
    expect(JSON.stringify(table)).not.toMatch(/private\.example|case=123|ghp_abcdefghijklmnopqrstuvwxyz|github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ|leaked-header-secret|leaked-token-secret/);
  });

  it('false-positive success probe: coverage gaps agree with completion review missing lists', () => {
    const run = createRun();
    const steps = [createStep({ proofDelta: ['compile passes'] })];
    const evidence: AutonomousEvidenceRecord[] = [];
    const review = reviewAutonomousRunCompletion({
      run,
      steps,
      evidence,
      targetLease: createLease(),
      liveTarget: { id: 42, windowId: 7, url: 'https://example.com/work', controllable: true },
      now: NOW,
    });
    const table = createAutonomousContractCoverageTable({
      run,
      steps,
      evidence,
      acceptedEvidenceIds: review.acceptedEvidenceIds,
    });

    const gapRequirements = table.rows
      .filter((row) => row.status === 'gap')
      .map((row) => row.requirement);
    expect(review.decision).not.toBe('pass');
    expect(review.doneCriteriaMissing).toEqual(['tests pass']);
    expect(review.requiredEvidenceMissing).toEqual(['shell_output']);
    expect(gapRequirements).toEqual(['tests pass', 'shell_output']);
    expect(table.complete).toBe(false);
  });

  it('ignores proof deltas from non-succeeded or wrong-run steps', () => {
    const table = createAutonomousContractCoverageTable({
      run: createRun(),
      steps: [
        createStep({ status: 'failed', proofDelta: ['compile passes', 'tests pass'] }),
        createStep({ runId: 'other-run', proofDelta: ['compile passes', 'tests pass'] }),
      ],
      evidence: [createEvidence()],
      acceptedEvidenceIds: ['evidence-1'],
    });

    expect(table.rows.filter((row) => row.kind === 'done_criterion')).toEqual([
      {
        kind: 'done_criterion',
        requirement: 'compile passes',
        status: 'gap',
        matchedBy: [],
      },
      {
        kind: 'done_criterion',
        requirement: 'tests pass',
        status: 'gap',
        matchedBy: [],
      },
    ]);
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
    proofContract: {
      doneCriteria: ['compile passes', 'tests pass'],
      requiredEvidence: ['shell_output'],
      antiProof: ['no hallucinated success'],
    },
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
    proofDelta: ['compile passes', 'tests pass'],
    error: null,
    startedAt: NOW - 100,
    endedAt: NOW,
    ...overrides,
  };
}

function createEvidence(overrides: Partial<AutonomousEvidenceRecord> = {}): AutonomousEvidenceRecord {
  return {
    id: 'evidence-1',
    runId: 'run-1',
    leaseId: 'lease-1',
    kind: 'shell_output',
    freshness: 'fresh',
    capturedAt: NOW - 100,
    expiresAt: NOW + 1_000,
    summary: 'Shell output captured',
    refs: ['shell_output'],
    source: { toolName: 'shell' },
    metadata: null,
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
