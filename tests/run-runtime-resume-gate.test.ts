import { describe, expect, it } from 'vitest';
import { evaluateAutonomousRuntimeResumeGate } from '../core/run/runtime-resume-gate';

const NOW = 10_000;

describe('controlled runtime resume gate', () => {
  it('blocks by default without explicit durable user authorization', () => {
    expect(evaluateAutonomousRuntimeResumeGate({ now: NOW })).toEqual({
      status: 'blocked',
      canResumeRuntime: false,
      reason: 'missing_authorization',
      requestedScope: 'chrome_runtime',
      authorizationPresent: false,
      authorizationIdPresent: false,
      authorizationExplicit: false,
      authorizationScope: null,
      authorizationFresh: true,
      runtimeFilesChanged: false,
      missingChecklistItems: [
        'commandsDocumented',
        'runtimeSmokeDocumented',
        'chromeSafetyChecksDocumented',
        'manualAuthorizationRecordDocumented',
        'rollbackPathDocumented',
        'p1p2ReviewRequired',
      ],
      openP1Count: 0,
      openP2Count: 0,
    });
  });

  it('authorizes only when scope, durable authorization, checklist, and review gate all pass', () => {
    expect(evaluateAutonomousRuntimeResumeGate({
      now: NOW,
      authorization: {
        id: 'resume-auth-1',
        explicit: true,
        scope: 'chrome_runtime',
        authorizedAt: NOW - 10,
        expiresAt: NOW + 10,
      },
      checklist: createCompleteChecklist(),
      independentReview: {
        status: 'passed',
        openP1Count: 0,
        openP2Count: 0,
      },
    })).toMatchObject({
      status: 'authorized',
      canResumeRuntime: true,
      reason: 'authorized',
      authorizationPresent: true,
      authorizationIdPresent: true,
      authorizationExplicit: true,
      authorizationScope: 'chrome_runtime',
      authorizationFresh: true,
      missingChecklistItems: [],
      openP1Count: 0,
      openP2Count: 0,
    });
  });

  it.each([
    ['authorization_not_explicit', { id: 'resume-auth-1', explicit: false, scope: 'chrome_runtime', authorizedAt: NOW }],
    ['authorization_not_durable', { explicit: true, scope: 'chrome_runtime', authorizedAt: NOW }],
    ['authorization_not_durable', { id: 'resume-auth-1', explicit: true, scope: 'chrome_runtime' }],
    ['scope_mismatch', { id: 'resume-auth-1', explicit: true, scope: 'sidepanel_only', authorizedAt: NOW }],
    ['authorization_expired', { id: 'resume-auth-1', explicit: true, scope: 'chrome_runtime', authorizedAt: NOW - 20, expiresAt: NOW - 1 }],
  ] as const)('blocks invalid authorization: %s', (reason, authorization) => {
    expect(evaluateAutonomousRuntimeResumeGate({
      now: NOW,
      authorization,
      checklist: createCompleteChecklist(),
      independentReview: { status: 'passed' },
    })).toMatchObject({
      status: 'blocked',
      canResumeRuntime: false,
      reason,
    });
  });

  it('blocks when runtime files changed before the authorized resume slice', () => {
    expect(evaluateAutonomousRuntimeResumeGate({
      now: NOW,
      authorization: createAuthorization(),
      checklist: createCompleteChecklist(),
      independentReview: { status: 'passed' },
      runtimeFilesChanged: true,
    })).toMatchObject({
      status: 'blocked',
      canResumeRuntime: false,
      reason: 'runtime_files_changed_before_authorization',
      runtimeFilesChanged: true,
    });
  });

  it('blocks incomplete resume checklist even with authorization', () => {
    const decision = evaluateAutonomousRuntimeResumeGate({
      now: NOW,
      authorization: createAuthorization(),
      checklist: {
        commandsDocumented: true,
        runtimeSmokeDocumented: true,
      },
      independentReview: { status: 'passed' },
    });

    expect(decision).toMatchObject({
      status: 'blocked',
      canResumeRuntime: false,
      reason: 'checklist_incomplete',
    });
    expect(decision.missingChecklistItems).toEqual([
      'chromeSafetyChecksDocumented',
      'manualAuthorizationRecordDocumented',
      'rollbackPathDocumented',
      'p1p2ReviewRequired',
    ]);
  });

  it('blocks when independent review evidence is missing', () => {
    expect(evaluateAutonomousRuntimeResumeGate({
      now: NOW,
      authorization: createAuthorization(),
      checklist: createCompleteChecklist(),
    })).toMatchObject({
      status: 'blocked',
      canResumeRuntime: false,
      reason: 'independent_review_missing',
      openP1Count: 0,
      openP2Count: 0,
    });
  });

  it('blocks unresolved independent P1/P2 review findings', () => {
    expect(evaluateAutonomousRuntimeResumeGate({
      now: NOW,
      authorization: createAuthorization(),
      checklist: createCompleteChecklist(),
      independentReview: {
        status: 'passed',
        openP1Count: 1.8,
        openP2Count: 2.2,
      },
    })).toMatchObject({
      status: 'blocked',
      canResumeRuntime: false,
      reason: 'independent_review_blocked',
      openP1Count: 1,
      openP2Count: 2,
    });
  });

  it('does not leak arbitrary authorization or review fields into the decision', () => {
    const decision = evaluateAutonomousRuntimeResumeGate({
      now: NOW,
      authorization: {
        ...createAuthorization(),
        id: 'resume-auth-secret-token',
        rawUserMessage: 'Authorization: Bearer secret',
      },
      checklist: createCompleteChecklist(),
      independentReview: {
        status: 'blocked',
        rawReviewerProse: 'SECRET_REVIEWER_TEXT',
        openP1Count: 0,
        openP2Count: 0,
      },
    } as any);

    expect(decision.reason).toBe('independent_review_blocked');
    expect(JSON.stringify(decision)).not.toMatch(/secret-token|Bearer secret|SECRET_REVIEWER_TEXT|rawUserMessage|rawReviewerProse/);
  });
});

function createAuthorization() {
  return {
    id: 'resume-auth-1',
    explicit: true,
    scope: 'chrome_runtime',
    authorizedAt: NOW - 10,
    expiresAt: NOW + 10,
  };
}

function createCompleteChecklist() {
  return {
    commandsDocumented: true,
    runtimeSmokeDocumented: true,
    chromeSafetyChecksDocumented: true,
    manualAuthorizationRecordDocumented: true,
    rollbackPathDocumented: true,
    p1p2ReviewRequired: true,
  };
}
