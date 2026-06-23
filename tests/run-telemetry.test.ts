import { describe, expect, it } from 'vitest';
import { createAutonomousRunTelemetryPackage } from '../core/run/telemetry';
import type { AutonomousRunStorageState } from '../core/run/types';

describe('autonomous run telemetry package', () => {
  it('returns null for a missing run', () => {
    expect(createAutonomousRunTelemetryPackage(createState(), 'missing')).toBeNull();
  });

  it('creates stable repo-visible telemetry files for one run', () => {
    const pkg = createAutonomousRunTelemetryPackage(createState(), 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0, durationMs: 1234 }],
      commits: [{ sha: 'abc123', message: 'Add telemetry', filesChanged: 3, linkedStepId: 'step-1' }],
    });

    expect(pkg?.runId).toBe('run-1');
    expect(pkg?.rootDir).toBe('.runs/run-1');
    expect(pkg?.files.map((file) => file.path)).toEqual([
      '.runs/run-1/manifest.json',
      '.runs/run-1/handoff.json',
      '.runs/run-1/checkpoint.json',
      '.runs/run-1/steps.ndjson',
      '.runs/run-1/evidence.ndjson',
      '.runs/run-1/target-leases.ndjson',
      '.runs/run-1/quality-gates.ndjson',
      '.runs/run-1/review-lanes.ndjson',
      '.runs/run-1/verification.json',
      '.runs/run-1/commits.ndjson',
      '.runs/run-1/report.md',
    ]);

    const manifest = readJson(pkg, 'manifest.json');
    const handoff = readJson(pkg, 'handoff.json');
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: 500,
      run: {
        id: 'run-1',
        status: 'running',
        mode: 'unattended',
        modelAdapter: 'deepseek_web',
        targetLeasePresent: true,
      },
      counts: {
        steps: 2,
        evidence: 1,
        targetLeases: 1,
        qualityGates: 0,
        reviewLanes: 0,
        verification: 1,
        commits: 1,
      },
      proofContract: {
        doneCriteriaCount: 1,
        requiredEvidenceCount: 1,
        antiProofCount: 1,
      },
      policy: {
        approvalMode: 'auto_low_risk',
        shellMode: 'allowlisted',
        persistMemory: 'propose',
        allowedToolCount: 1,
        deniedToolCount: 1,
      },
      budgets: {
        maxWallMs: 1000,
        maxModelTurns: 10,
        maxToolCalls: 20,
        maxConsecutiveNoProgress: 2,
        maxSameErrorRepeats: 1,
        maxPromptBytesPerTurn: 100,
        maxObservationBytesPerTurn: 50,
      },
      verification: {
        status: 'conflicted',
        commandStatus: 'passed',
        durableStatus: 'running',
        durableSucceeded: false,
        durableFailurePresent: false,
      },
    });
    expect(handoff).toMatchObject({
      schemaVersion: 1,
      generatedAt: 500,
      runId: 'run-1',
      status: 'running',
      nextAction: 'continue_run',
      verificationStatus: 'conflicted',
      durableFailurePresent: false,
      targetLeasePresent: true,
      evidenceCount: 1,
      counts: {
        steps: 2,
        evidence: 1,
        targetLeases: 1,
        qualityGates: 0,
        reviewLanes: 0,
        commits: 1,
      },
    });

    expect(readJson(pkg, 'verification.json').summary).toMatchObject({
      status: 'conflicted',
      commandStatus: 'passed',
      durableStatus: 'running',
    });
    expect(readNdjson(pkg, 'steps.ndjson')).toEqual([
      expect.objectContaining({
        id: 'step-1',
        seq: 1,
        phase: 'plan',
        evidenceRefCount: 0,
        proofDeltaCount: 1,
      }),
      expect.objectContaining({
        id: 'step-2',
        seq: 2,
        phase: 'verification',
        evidenceRefCount: 1,
        proofDeltaCount: 1,
      }),
    ]);
    expect(readNdjson(pkg, 'evidence.ndjson')).toEqual([
      expect.objectContaining({
        id: 'evidence-1',
        kind: 'shell_output',
        summaryCharCount: 35,
        refCount: 1,
        metadataPresent: true,
      }),
    ]);
    expect(readNdjson(pkg, 'target-leases.ndjson')).toEqual([
      expect.objectContaining({
        id: 'target-lease-1',
        runId: 'run-1',
        status: 'active',
        labelPresent: true,
        tabPresent: true,
        windowPresent: true,
        originPresent: true,
        titlePresent: true,
      }),
    ]);
  });

  it('omits raw goals, checkpoint text, evidence summaries, refs, urls, metadata, and secrets', () => {
    const secretRunId = 'https://example.com/run?token=secret';
    const state = createState({
      runId: secretRunId,
      step1Id: 'step-1-token=secret',
      step2Id: 'step-2-token=secret',
      evidenceId: 'evidence-token=secret',
      leaseId: 'lease-token=secret',
      secretGoal: 'Use Authorization: Bearer secret and https://example.com/private?token=secret',
      secretSummary: 'Resume with Cookie: sid=secret and file-sensitive123',
      secretEvidenceSummary: 'Fetched https://example.com/private?token=secret with data:image/png;base64,AAAA',
    });
    const pkg = createAutonomousRunTelemetryPackage(state, secretRunId, {
      generatedAt: 500,
      rootDir: '../https://example.com/root?token=secret//telemetry',
      verification: [{ command: 'curl https://example.com/private?token=secret -H "Authorization: Bearer secret"', exitCode: 1, passed: true }],
      commits: [{ sha: 'bad sha with spaces', message: 'Fix Token=secret Authorization: Bearer secret', filesChanged: -3, linkedStepId: 'step-2-token=secret' }],
    });

    const source = JSON.stringify(state);
    expect(source).toMatch(/Bearer secret|token=secret|Cookie|file-sensitive123|data:image|step-2-token/);

    const output = JSON.stringify(pkg);
    expect(pkg?.runId).toBe('run-1');
    expect(output).not.toMatch(/Bearer secret|token=secret|Cookie|sid=secret|file-sensitive123|data:image|private\?token|Authorization|step-2-token|lease-token|evidence-token|root\?token/i);
    expect(output).not.toContain('Use [redacted:secret]');
    expect(output).not.toContain('Resume with');
    expect(output).not.toContain('Fetched');
    expect(readJson(pkg, 'verification.json').commands[0]).toMatchObject({
      exitCode: 1,
      passed: false,
    });

    const checkpoint = readJson(pkg, 'checkpoint.json');
    expect(checkpoint).toMatchObject({
      latestStepId: 'step-2',
      providerConversationPresent: true,
      parentMessagePresent: true,
      resumableSummaryCharCount: state.runs[0].checkpoint.resumableSummary.length,
      unresolvedQuestionCount: 1,
    });
    expect(readNdjson(pkg, 'evidence.ndjson')[0]).not.toHaveProperty('summary');
    expect(readNdjson(pkg, 'evidence.ndjson')[0]).not.toHaveProperty('refs');
    expect(readNdjson(pkg, 'evidence.ndjson')[0]).not.toHaveProperty('metadata');
  });

  it('exports quality gates and review lanes as safe repo-visible metadata', () => {
    const state = createState({ runId: 'run-token=secret' });
    state.qualityGates = [
      {
        id: 'gate-token=secret',
        runId: 'run-token=secret',
        seq: 2,
        createdAt: 210,
        status: 'blocked',
        contractCoverage: {
          complete: false,
          coveredCount: 3,
          gapCount: 1,
          conflictCount: 0,
          notTestableCount: 1,
        },
        resultStateConsistency: {
          status: 'inconsistent',
          ok: false,
          issueCount: 2,
          blockingIssueCount: 1,
        },
        selfReview: { grade: 'B' },
        verification: {
          commands: [
            { name: 'npm test token=secret', result: 'failed', summary: 'Bearer secret rawOutput' },
            { name: 'prompt freeze', result: 'known_preexisting_failure', summary: 'Cookie: sid=secret' },
          ],
        },
        commit: { hash: 'abcdef1', message: 'commit token=secret Authorization: Bearer secret' },
        independentReview: {
          status: 'blocked',
          grade: 'C',
          blockingIssueCount: 1,
        },
      },
    ];
    state.reviewLanes = [
      {
        id: 'lane-token=secret',
        runId: 'run-token=secret',
        seq: 1,
        createdAt: 220,
        role: 'grok',
        status: 'blocked',
        grade: 'C',
        recommendation: 'block',
        highestPriority: 'P1',
        issueCount: 2,
        evidenceRefCount: 3,
        summary: 'Bearer secret transcript rawOutput token=secret',
      },
    ];

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-token=secret', {
      generatedAt: 500,
      rootDir: '.runs/lane-token=secret',
      verification: [{ command: 'check gate-token=secret lane-token=secret', exitCode: 0 }],
    });

    const source = JSON.stringify(state);
    expect(source).toMatch(/gate-token=secret|lane-token=secret|Bearer secret|rawOutput|transcript|Cookie/);

    const manifest = readJson(pkg, 'manifest.json');
    const handoff = readJson(pkg, 'handoff.json');
    expect(manifest.counts).toMatchObject({
      qualityGates: 1,
      reviewLanes: 1,
    });
    expect(handoff).toMatchObject({
      nextAction: 'review_blocker',
      verificationStatus: 'conflicted',
      schedulerWatchdog: {
        decision: 'mustBlock',
        reason: 'review_lane_gate_blocked',
        retryable: true,
        blocksNextAction: true,
        recommendedStatus: 'blocked',
        errorCode: 'autonomous_review_lane_gate_blocked',
        details: {
          blockingPriority: 'P1',
          blockingLaneCount: 1,
        },
      },
      retryPosture: {
        retryable: true,
        durableStatusAllowsContinue: true,
        hasRetryableError: false,
        totalBlockers: 2,
      },
      unresolvedBlockers: {
        review: {
          blockingCount: 1,
          p1Count: 1,
          p2Count: 0,
          failedCount: 0,
          blockRecommendationCount: 1,
        },
        qualityGate: {
          blockingPresent: true,
          latestStatus: 'blocked',
          blockingIssueCount: 1,
        },
        watchdog: {
          blocksNextAction: true,
          reason: 'review_lane_gate_blocked',
        },
      },
      qualityGate: {
        latestStatus: 'blocked',
        latestSeq: 2,
        selfReviewGrade: 'B',
        independentReviewStatus: 'blocked',
        blockingIssueCount: 1,
      },
      reviewLane: {
        total: 1,
        blockedCount: 1,
        blockingCount: 1,
        blockRecommendationCount: 1,
        p1Count: 1,
        highestPriority: 'P1',
      },
    });
    expect(readNdjson(pkg, 'quality-gates.ndjson')).toEqual([
      expect.objectContaining({
        id: 'quality-gate-1',
        runId: 'run-1',
        seq: 2,
        status: 'blocked',
        contractCoverage: expect.objectContaining({ coveredCount: 3, gapCount: 1 }),
        resultStateConsistency: expect.objectContaining({ status: 'inconsistent', blockingIssueCount: 1 }),
        selfReviewGrade: 'B',
        verification: {
          commandCount: 2,
          passedCommandCount: 0,
          failedCommandCount: 1,
          knownPreexistingFailureCount: 1,
        },
        commitPresent: true,
        independentReview: {
          status: 'blocked',
          grade: 'C',
          blockingIssueCount: 1,
        },
      }),
    ]);
    expect(readNdjson(pkg, 'review-lanes.ndjson')).toEqual([
      expect.objectContaining({
        id: 'review-lane-1',
        runId: 'run-1',
        role: 'grok',
        status: 'blocked',
        grade: 'C',
        recommendation: 'block',
        highestPriority: 'P1',
        issueCount: 2,
        evidenceRefCount: 3,
        summaryPresent: true,
      }),
    ]);
    expect(readNdjson(pkg, 'review-lanes.ndjson')[0].summaryCharCount).toBeGreaterThan(0);
    expect(JSON.stringify(pkg)).not.toMatch(
      /gate-token=secret|lane-token=secret|run-token=secret|Bearer secret|rawOutput|transcript|Cookie|Authorization|sid=secret/,
    );
  });

  it('exports a quality-gate watchdog blocker when no review lane blocks', () => {
    const state = createState({ runId: 'quality-run-token=secret' });
    state.qualityGates = [
      {
        id: 'quality-gate-token=secret',
        runId: 'quality-run-token=secret',
        seq: 1,
        createdAt: 220,
        status: 'failed',
        contractCoverage: {
          complete: false,
          coveredCount: 4,
          gapCount: 1,
          conflictCount: 0,
          notTestableCount: 0,
        },
        resultStateConsistency: {
          status: 'inconsistent',
          ok: false,
          issueCount: 1,
          blockingIssueCount: 1,
        },
        selfReview: { grade: 'B' },
        verification: { commands: [] },
        commit: null,
        independentReview: {
          status: 'passed',
          grade: 'A',
          blockingIssueCount: 0,
        },
      },
    ];

    const pkg = createAutonomousRunTelemetryPackage(state, 'quality-run-token=secret', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'running',
      nextAction: 'review_blocker',
      schedulerWatchdog: {
        decision: 'mustBlock',
        reason: 'quality_gate_blocked',
        retryable: true,
        blocksNextAction: true,
        recommendedStatus: 'blocked',
        errorCode: 'autonomous_quality_gate_blocked',
        details: {
          qualityGateSeq: 1,
          qualityGateConflictCount: 1,
        },
      },
      retryPosture: {
        retryable: true,
        durableStatusAllowsContinue: true,
        hasRetryableError: false,
        totalBlockers: 1,
      },
      unresolvedBlockers: {
        qualityGate: {
          blockingPresent: true,
          latestStatus: 'failed',
          blockingIssueCount: 0,
        },
        watchdog: {
          blocksNextAction: true,
          reason: 'quality_gate_blocked',
        },
      },
    });
    expect(JSON.stringify(pkg)).not.toMatch(/quality-run-token=secret|quality-gate-token=secret/);
  });

  it('uses deterministic generatedAt when omitted', () => {
    const state = createState();

    const first = createAutonomousRunTelemetryPackage(state, 'run-1');
    const second = createAutonomousRunTelemetryPackage(state, 'run-1');

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(readJson(first, 'manifest.json').generatedAt).toBe(state.runs[0].updatedAt);
  });

  it('redacts plain durable IDs from paths and free-form telemetry strings', () => {
    const error = createRunError('failed-durable-run-raw-abc123-durable-step-raw-abc123');
    const state = createState({
      runId: 'durable-run-raw-abc123',
      step1Id: 'durable-step-raw-abc123-plan',
      step2Id: 'durable-step-raw-abc123',
      leaseId: 'durable-lease-raw-abc123',
      evidenceId: 'durable-evidence-raw-abc123',
      modelTurnId: 'durable-model-turn-raw-abc123',
      toolCallId: 'durable-tool-call-raw-abc123',
      observationRef: 'durable-observation-raw-abc123',
      evidenceRef: 'durable-evidence-raw-abc123',
      evidenceSourceRef: 'durable-ref-raw-abc123',
      automationId: 'durable-automation-raw-abc123',
      automationRunId: 'durable-automation-run-raw-abc123',
      sourceToolName: 'tool-durable-step-raw-abc123',
      runError: error,
      step2Error: error,
    });
    const pkg = createAutonomousRunTelemetryPackage(state, 'durable-run-raw-abc123', {
      rootDir: '.runs/durable-run-raw-abc123',
      verification: [{ command: 'check durable-run-raw-abc123 durable-step-raw-abc123 durable-automation-raw-abc123', exitCode: 1 }],
      commits: [{
        sha: 'durable-run-raw-abc123',
        message: 'commit durable-run-raw-abc123 durable-step-raw-abc123 durable-automation-run-raw-abc123',
        linkedStepId: 'durable-step-raw-abc123',
      }],
    });

    const source = JSON.stringify(state);
    expect(source).toMatch(/durable-run-raw-abc123|durable-step-raw-abc123|durable-tool-call-raw-abc123/);

    const output = JSON.stringify(pkg);
    expect(output).not.toMatch(/durable-run-raw-abc123|durable-step-raw-abc123|durable-lease-raw-abc123|durable-evidence-raw-abc123|durable-tool-call-raw-abc123|durable-model-turn-raw-abc123|durable-observation-raw-abc123|durable-ref-raw-abc123|durable-automation-raw-abc123|durable-automation-run-raw-abc123/);
    expect(pkg?.rootDir).toBe('.runs/_redacted_id_/run-1');
    expect(readJson(pkg, 'manifest.json').run.error.code).toContain('_redacted:id_');
    expect(readJson(pkg, 'verification.json').commands[0].command).toContain('[redacted:id]');
    expect(readNdjson(pkg, 'commits.ndjson')[0]).toMatchObject({
      sha: '_redacted:id_',
      message: 'commit [redacted:id] [redacted:id] [redacted:id]',
      linkedStepId: 'step-2',
    });
    expect(readNdjson(pkg, 'evidence.ndjson')[0].source.toolName).toBe('tool-[redacted:id]');
  });

  it('fails verification summary when durable run state failed despite passing commands', () => {
    const error = createRunError('Token=secret failed verification');
    const state = createState({
      status: 'failed',
      runError: error,
      step2Status: 'failed',
      step2Error: error,
    });
    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(pkg, 'verification.json').summary).toMatchObject({
      status: 'failed',
      commandStatus: 'passed',
      durableStatus: 'failed',
      durableSucceeded: false,
      durableFailurePresent: true,
      failedStepCount: 1,
      runErrorPresent: true,
    });
    expect(readJson(pkg, 'verification.json').commands[0]).toMatchObject({
      exitCode: 0,
      passed: true,
    });
    expect(readJson(pkg, 'manifest.json').run.error.code).not.toMatch(/Token=secret/i);
    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'failed',
      nextAction: 'inspect_failure',
      verificationStatus: 'failed',
      durableFailurePresent: true,
    });
    expect(pkg?.files.find((file) => file.path.endsWith('/report.md'))?.content).toContain('- verification: failed');
  });

  it('exports safe restart watchdog, retry, blocker, and checkpoint handoff fields', () => {
    const state = createState();
    state.targetLeases[0].expiresAt = 400;

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    const handoff = readJson(pkg, 'handoff.json');
    expect(handoff).toMatchObject({
      status: 'running',
      nextAction: 'inspect_failure',
      verificationStatus: 'conflicted',
      durableFailurePresent: false,
      schedulerWatchdog: {
        decision: 'mustBlock',
        reason: 'expired_target_lease',
        retryable: true,
        blocksNextAction: true,
        recommendedStatus: 'blocked',
        errorCode: 'autonomous_watchdog_expired_target_lease',
        details: {
          stepCount: 2,
          evidenceCount: 1,
          freshEvidenceCount: 1,
          staleEvidenceCount: 0,
          expiredEvidenceCount: 0,
          targetLeaseAgeMs: 389,
          targetLeaseExpiresInMs: 0,
          blockingPriority: null,
          blockingLaneCount: 0,
          qualityGateSeq: null,
          qualityGateConflictCount: null,
        },
      },
      retryPosture: {
        retryable: true,
        durableStatusAllowsContinue: true,
        hasRetryableError: false,
        totalBlockers: 1,
      },
      unresolvedBlockers: {
        run: {
          errorPresent: false,
          errorCode: null,
          errorRetryable: null,
        },
        targetLease: {
          required: true,
          recordPresent: true,
          inactiveCount: 0,
          expiredCount: 1,
          staleCount: 0,
        },
        evidence: {
          staleCount: 0,
          expiredCount: 0,
        },
        watchdog: {
          blocksNextAction: true,
          reason: 'expired_target_lease',
        },
      },
      checkpoint: {
        latestStepHandle: 'step-2',
        providerConversationPresent: true,
        parentMessagePresent: true,
        resumableSummaryCharCount: state.runs[0].checkpoint.resumableSummary.length,
        unresolvedQuestionCount: 1,
      },
    });
    expect(JSON.stringify(handoff)).not.toMatch(
      /provider-secret-id|parent-secret-id|Resume after tests|Need final review|Target secret title|Private page|example\.com|shell_output tests pass|tests pass with secret token/,
    );
  });

  it('exports stale evidence and no-progress watchdog blockers through handoff', () => {
    const staleState = createState();
    staleState.evidence[0].freshness = 'stale';

    const stalePackage = createAutonomousRunTelemetryPackage(staleState, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(stalePackage, 'handoff.json')).toMatchObject({
      nextAction: 'inspect_failure',
      schedulerWatchdog: {
        decision: 'mustBlock',
        reason: 'stale_evidence',
        errorCode: 'autonomous_watchdog_stale_evidence',
      },
      retryPosture: {
        retryable: true,
        durableStatusAllowsContinue: true,
        totalBlockers: 1,
      },
      unresolvedBlockers: {
        evidence: {
          staleCount: 1,
          expiredCount: 0,
        },
        watchdog: {
          reason: 'stale_evidence',
        },
      },
    });

    const noProgressState = createState();
    for (const step of noProgressState.steps) {
      step.progressScore = 0;
      step.proofDelta = [];
      step.evidenceRefs = [];
    }

    const noProgressPackage = createAutonomousRunTelemetryPackage(noProgressState, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(noProgressPackage, 'handoff.json')).toMatchObject({
      nextAction: 'inspect_failure',
      schedulerWatchdog: {
        decision: 'mustBlock',
        reason: 'no_progress_exceeded',
        errorCode: 'run_no_progress',
      },
      retryPosture: {
        retryable: true,
        durableStatusAllowsContinue: true,
        totalBlockers: 1,
      },
      unresolvedBlockers: {
        watchdog: {
          reason: 'no_progress_exceeded',
        },
      },
    });
  });

  it('does not finalize a blocked restart handoff when verification commands pass', () => {
    const reconcileError = {
      ...createRunError('autonomous_reconcile_missing_target_lease'),
      retryable: true,
    };
    const state = createState({
      status: 'blocked',
      runError: reconcileError,
    });

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(pkg, 'verification.json').summary).toMatchObject({
      status: 'failed',
      commandStatus: 'passed',
      durableStatus: 'blocked',
      durableSucceeded: false,
      durableFailurePresent: true,
      failedStepCount: 0,
      runErrorPresent: true,
    });
    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'blocked',
      nextAction: 'inspect_failure',
      verificationStatus: 'failed',
      durableFailurePresent: true,
      schedulerWatchdog: {
        decision: 'blocked',
        reason: 'already_blocked',
        retryable: true,
        blocksNextAction: true,
        recommendedStatus: null,
        errorCode: null,
      },
      retryPosture: {
        retryable: false,
        durableStatusAllowsContinue: false,
        hasRetryableError: true,
        totalBlockers: 2,
      },
      unresolvedBlockers: {
        run: {
          errorPresent: true,
          errorCode: 'autonomous_reconcile_missing_target_lease',
          errorRetryable: true,
        },
        watchdog: {
          blocksNextAction: true,
          reason: 'already_blocked',
        },
      },
    });
    expect(readJson(pkg, 'handoff.json').nextAction).not.toBe('finalize');
    expect(readJson(pkg, 'handoff.json').verificationStatus).not.toBe('passed');
  });

  it('collects evidence before continuing an unfinished run with no evidence', () => {
    const state = createState();
    state.evidence = [];

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'running',
      nextAction: 'collect_evidence',
      evidenceCount: 0,
      verificationStatus: 'conflicted',
    });
  });

  it('idles a paused run instead of reporting a restart failure', () => {
    const state = createState({ status: 'paused' });

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'paused',
      nextAction: 'idle',
      verificationStatus: 'conflicted',
      schedulerWatchdog: {
        decision: 'paused',
        reason: 'paused',
        retryable: true,
        blocksNextAction: true,
      },
      retryPosture: {
        retryable: false,
        durableStatusAllowsContinue: false,
        hasRetryableError: false,
        totalBlockers: 0,
      },
    });
  });

  it('idles a terminal run when verification is not recorded', () => {
    const state = createState({ status: 'succeeded' });
    state.runs[0].completedAt = 250;
    state.runs[0].updatedAt = 250;

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
    });

    expect(readJson(pkg, 'verification.json').summary).toMatchObject({
      status: 'not-recorded',
      commandStatus: 'not-recorded',
      durableStatus: 'succeeded',
      durableSucceeded: true,
    });
    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'succeeded',
      nextAction: 'idle',
      verificationStatus: 'not-recorded',
      durableFailurePresent: false,
    });
  });

  it('inspects a terminal run when verification commands fail', () => {
    const state = createState({ status: 'succeeded' });
    state.runs[0].completedAt = 250;
    state.runs[0].updatedAt = 250;

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 1 }],
    });

    expect(readJson(pkg, 'verification.json').summary).toMatchObject({
      status: 'failed',
      commandStatus: 'failed',
      durableStatus: 'succeeded',
      durableSucceeded: true,
    });
    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'succeeded',
      nextAction: 'inspect_failure',
      verificationStatus: 'failed',
      durableFailurePresent: false,
    });
  });

  it('keeps historical review blockers active until durable records are removed', () => {
    const state = createState({ status: 'succeeded' });
    state.runs[0].completedAt = 250;
    state.runs[0].updatedAt = 250;
    state.reviewLanes = [
      createReviewLane({ id: 'lane-old-blocker', seq: 1, status: 'blocked', recommendation: 'block', highestPriority: 'P1' }),
      createReviewLane({ id: 'lane-latest-pass', seq: 2, status: 'passed', recommendation: 'proceed', highestPriority: null }),
    ];

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'succeeded',
      nextAction: 'review_blocker',
      verificationStatus: 'passed',
      reviewLane: {
        total: 2,
        blockedCount: 1,
        blockingCount: 1,
        p1Count: 1,
        highestPriority: 'P1',
      },
    });
  });

  it('keeps latest review blockers ahead of durable failure inspection', () => {
    const error = createRunError('durable failure after review');
    const state = createState({
      status: 'failed',
      runError: error,
      step2Status: 'failed',
      step2Error: error,
    });
    state.reviewLanes = [
      createReviewLane({ id: 'lane-latest-p2', seq: 1, status: 'blocked', recommendation: 'block', highestPriority: 'P2' }),
    ];

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'failed',
      nextAction: 'review_blocker',
      verificationStatus: 'failed',
      durableFailurePresent: true,
      reviewLane: {
        total: 1,
        blockedCount: 1,
        blockingCount: 1,
        blockRecommendationCount: 1,
        p2Count: 1,
        highestPriority: 'P2',
      },
    });
  });

  it('blocks on a failed persisted review lane without priority blockers', () => {
    const state = createState();
    state.reviewLanes = [
      createReviewLane({ id: 'lane-latest-failed', seq: 1, status: 'failed', recommendation: 'iterate', highestPriority: null }),
    ];

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'running',
      nextAction: 'review_blocker',
      verificationStatus: 'conflicted',
      reviewLane: {
        total: 1,
        failedCount: 1,
        blockingCount: 1,
        p1Count: 0,
        p2Count: 0,
        highestPriority: null,
      },
    });
  });

  it('finalizes the handoff only when durable success and verification both pass', () => {
    const state = createState({ status: 'succeeded' });
    state.runs[0].completedAt = 250;
    state.runs[0].updatedAt = 250;

    const pkg = createAutonomousRunTelemetryPackage(state, 'run-1', {
      generatedAt: 500,
      verification: [{ command: 'npm test -- tests/run-telemetry.test.ts', exitCode: 0 }],
    });

    expect(readJson(pkg, 'verification.json').summary).toMatchObject({
      status: 'passed',
      commandStatus: 'passed',
      durableStatus: 'succeeded',
      durableSucceeded: true,
      durableFailurePresent: false,
    });
    expect(readJson(pkg, 'handoff.json')).toMatchObject({
      status: 'succeeded',
      nextAction: 'finalize',
      verificationStatus: 'passed',
      durableFailurePresent: false,
      schedulerWatchdog: {
        decision: 'terminalNoop',
        reason: 'terminal',
        retryable: false,
        blocksNextAction: true,
        recommendedStatus: null,
        errorCode: null,
      },
      retryPosture: {
        retryable: false,
        durableStatusAllowsContinue: false,
        hasRetryableError: false,
        totalBlockers: 0,
      },
      unresolvedBlockers: {
        watchdog: {
          blocksNextAction: true,
          reason: 'terminal',
        },
      },
    });
  });

  it('normalizes root paths and keeps package paths inside .runs-style directories', () => {
    const pkg = createAutonomousRunTelemetryPackage(createState(), 'run-1', {
      rootDir: '../bad path//telemetry',
    });

    expect(pkg?.rootDir).toBe('bad_path/telemetry/run-1');
    expect(pkg?.files.every((file) => file.path.startsWith('bad_path/telemetry/run-1/'))).toBe(true);
  });
});

function readJson(pkg: ReturnType<typeof createAutonomousRunTelemetryPackage>, name: string): any {
  const file = pkg?.files.find((item) => item.path.endsWith(`/${name}`));
  expect(file).toBeDefined();
  return JSON.parse(file?.content ?? '{}');
}

function readNdjson(pkg: ReturnType<typeof createAutonomousRunTelemetryPackage>, name: string): any[] {
  const file = pkg?.files.find((item) => item.path.endsWith(`/${name}`));
  expect(file).toBeDefined();
  const content = file?.content.trim() ?? '';
  return content ? content.split('\n').map((line) => JSON.parse(line)) : [];
}

function createReviewLane(
  overrides: Partial<AutonomousRunStorageState['reviewLanes'][number]> = {},
): AutonomousRunStorageState['reviewLanes'][number] {
  return {
    id: 'lane-1',
    runId: 'run-1',
    seq: 1,
    createdAt: 220,
    role: 'grok',
    status: 'passed',
    grade: 'A',
    recommendation: 'proceed',
    highestPriority: null,
    issueCount: 0,
    evidenceRefCount: 1,
    summary: null,
    ...overrides,
  };
}

function createState(overrides: {
  runId?: string;
  step1Id?: string;
  step2Id?: string;
  leaseId?: string;
  evidenceId?: string;
  modelTurnId?: string;
  toolCallId?: string;
  observationRef?: string;
  evidenceRef?: string;
  evidenceSourceRef?: string;
  automationId?: string;
  automationRunId?: string;
  sourceToolName?: string;
  secretGoal?: string;
  secretSummary?: string;
  secretEvidenceSummary?: string;
  status?: AutonomousRunStorageState['runs'][number]['status'];
  runError?: AutonomousRunStorageState['runs'][number]['error'];
  step2Status?: AutonomousRunStorageState['steps'][number]['status'];
  step2Error?: AutonomousRunStorageState['steps'][number]['error'];
} = {}): AutonomousRunStorageState {
  const runId = overrides.runId ?? 'run-1';
  const step1Id = overrides.step1Id ?? 'step-1';
  const step2Id = overrides.step2Id ?? 'step-2';
  const leaseId = overrides.leaseId ?? 'lease-1';
  const evidenceId = overrides.evidenceId ?? 'evidence-1';
  const evidenceRef = overrides.evidenceRef ?? evidenceId;
  return {
    version: 1,
    runs: [
      {
        id: runId,
        goal: overrides.secretGoal ?? 'Build telemetry',
        mode: 'unattended',
        status: overrides.status ?? 'running',
        modelAdapter: 'deepseek_web',
        targetLeaseId: leaseId,
        budgets: {
          maxWallMs: 1000,
          maxModelTurns: 10,
          maxToolCalls: 20,
          maxConsecutiveNoProgress: 2,
          maxSameErrorRepeats: 1,
          maxPromptBytesPerTurn: 100,
          maxObservationBytesPerTurn: 50,
        },
        policy: {
          approvalMode: 'auto_low_risk',
          allowedTools: ['shell_exec'],
          deniedTools: ['dangerous_tool'],
          browserMutationRequiresTargetLock: true,
          persistMemory: 'propose',
          shellMode: 'allowlisted',
        },
        proofContract: {
          doneCriteria: ['tests pass'],
          requiredEvidence: ['shell_output'],
          antiProof: ['no model text completion'],
        },
        checkpoint: {
          providerConversationId: 'provider-secret-id',
          parentMessageId: 'parent-secret-id',
          latestStepId: step2Id,
          resumableSummary: overrides.secretSummary ?? 'Resume after tests.',
          unresolvedQuestions: ['Need final review'],
        },
        error: overrides.runError ?? null,
        createdAt: 100,
        startedAt: 110,
        completedAt: null,
        updatedAt: 200,
      },
    ],
    steps: [
      {
        id: step2Id,
        runId,
        seq: 2,
        phase: 'verification',
        status: overrides.step2Status ?? 'succeeded',
        modelTurnId: overrides.modelTurnId ?? 'model-turn-secret',
        toolCallIds: [overrides.toolCallId ?? 'tool-call-secret'],
        observationRefs: [overrides.observationRef ?? 'observation-secret'],
        evidenceRefs: [evidenceRef],
        progressScore: 1,
        proofDelta: ['tests pass with secret token'],
        error: overrides.step2Error ?? null,
        startedAt: 180,
        endedAt: 190,
      },
      {
        id: step1Id,
        runId,
        seq: 1,
        phase: 'plan',
        status: 'succeeded',
        modelTurnId: null,
        toolCallIds: [],
        observationRefs: [],
        evidenceRefs: [],
        progressScore: 0.2,
        proofDelta: ['plan written'],
        error: null,
        startedAt: 120,
        endedAt: 130,
      },
    ],
    targetLeases: [
      {
        id: leaseId,
        runId,
        status: 'active',
        label: 'Target secret title',
        tabId: 123,
        windowId: 456,
        origin: 'https://example.com/private?token=secret',
        title: 'Private page',
        acquiredAt: 111,
        expiresAt: 999,
        lastVerifiedAt: 150,
        releasedAt: null,
      },
    ],
    evidence: [
      {
        id: evidenceId,
        runId,
        leaseId,
        kind: 'shell_output',
        freshness: 'fresh',
        capturedAt: 170,
        expiresAt: 970,
        summary: overrides.secretEvidenceSummary ?? 'shell_output tests pass evidence ok',
        refs: [overrides.evidenceSourceRef ?? 'ref-secret-url'],
        source: {
          tabId: 123,
          windowId: 456,
          toolName: overrides.sourceToolName ?? 'shell_exec',
          automationId: overrides.automationId ?? 'automation-secret',
          automationRunId: overrides.automationRunId ?? 'automation-run-secret',
        },
        metadata: {
          url: 'https://example.com/private?token=secret',
          authorization: 'Bearer secret',
        },
      },
    ],
    qualityGates: [],
    reviewLanes: [],
  };
}

function createRunError(code: string): NonNullable<AutonomousRunStorageState['runs'][number]['error']> {
  return {
    code,
    message: 'Raw error message must not be exported',
    phase: 'verification',
    retryable: false,
    at: 250,
  };
}
