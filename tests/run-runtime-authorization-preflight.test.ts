import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTONOMOUS_DOC_RESUMPTION_MARKERS,
  type AutonomousDocResumptionMarkerCode,
} from '../core/run/doc-resumption-gate';
import { evaluateAutonomousRuntimeAuthorizationPreflight } from '../core/run/runtime-authorization-preflight';

const NOW = 10_000;
const REQUIRED_MARKERS = [...AUTONOMOUS_DOC_RESUMPTION_MARKERS];

describe('runtime authorization preflight', () => {
  it('blocks before trusting runtime resume when doc resumption gate is blocked', () => {
    const decision = evaluateAutonomousRuntimeAuthorizationPreflight({
      documents: [{ text: createStructuredContract({ omit: ['step_10_blocked'] }) }],
      runtime: createAuthorizedRuntimeInput(),
    });

    expect(decision).toEqual({
      status: 'blocked',
      canStartRuntimeSlice: false,
      reason: 'missing_required_markers',
      docGateStatus: 'blocked',
      docGateReason: 'missing_required_markers',
      docMissingMarkerCodes: ['step_10_blocked'],
      runtimeGateStatus: 'authorized',
      runtimeGateReason: 'authorized',
      checkedMarkerCount: REQUIRED_MARKERS.length,
      missingMarkerCount: 1,
      openP1Count: 0,
      openP2Count: 0,
      runtimeFilesChanged: false,
      authorizationPresent: true,
      authorizationExplicit: true,
      authorizationIdPresent: true,
      authorizationFresh: true,
      authorizationScope: 'chrome_runtime',
    });
  });

  it('blocks with missing_authorization in the default repo posture after docs pass', () => {
    const decision = evaluateAutonomousRuntimeAuthorizationPreflight({
      documents: [{ text: createStructuredContract() }],
      runtime: { now: NOW },
    });

    expect(decision).toMatchObject({
      status: 'blocked',
      canStartRuntimeSlice: false,
      reason: 'missing_authorization',
      docGateStatus: 'passed',
      docGateReason: 'passed',
      docMissingMarkerCodes: [],
      runtimeGateStatus: 'blocked',
      runtimeGateReason: 'missing_authorization',
      checkedMarkerCount: REQUIRED_MARKERS.length,
      missingMarkerCount: 0,
      authorizationPresent: false,
      authorizationExplicit: false,
      authorizationIdPresent: false,
      authorizationFresh: true,
      authorizationScope: null,
    });
  });

  it('reports the current repo-visible default as blocked without durable chrome runtime authorization', () => {
    const decision = evaluateAutonomousRuntimeAuthorizationPreflight({
      documents: readResumptionDocs(),
      runtime: { now: NOW },
    });

    expect(decision).toMatchObject({
      status: 'blocked',
      canStartRuntimeSlice: false,
      reason: 'missing_authorization',
      docGateStatus: 'passed',
      runtimeGateStatus: 'blocked',
      runtimeGateReason: 'missing_authorization',
      authorizationPresent: false,
    });
  });

  it('authorizes Step 10 only when docs pass and runtime resume gate authorizes', () => {
    const decision = evaluateAutonomousRuntimeAuthorizationPreflight({
      documents: [{ text: createStructuredContract() }],
      runtime: createAuthorizedRuntimeInput(),
    });

    expect(decision).toMatchObject({
      status: 'authorized',
      canStartRuntimeSlice: true,
      reason: 'authorized',
      docGateStatus: 'passed',
      docGateReason: 'passed',
      runtimeGateStatus: 'authorized',
      runtimeGateReason: 'authorized',
      checkedMarkerCount: REQUIRED_MARKERS.length,
      missingMarkerCount: 0,
      openP1Count: 0,
      openP2Count: 0,
      runtimeFilesChanged: false,
    });
  });

  it.each([
    ['no documents', undefined, 'no_documents'],
    ['stale documents', [{ text: createStructuredContract({ status: 'superseded' }) }], 'missing_required_markers'],
    ['incomplete documents', [{ text: createStructuredContract({ omit: ['runtime_authorization_required'] }) }], 'missing_required_markers'],
  ] as const)('fails closed for %s', (_label, documents, reason) => {
    const decision = evaluateAutonomousRuntimeAuthorizationPreflight({
      documents: documents ? [...documents] : undefined,
      runtime: createAuthorizedRuntimeInput(),
    });

    expect(decision).toMatchObject({
      status: 'blocked',
      canStartRuntimeSlice: false,
      reason,
      docGateStatus: 'blocked',
    });
  });

  it('passes open P1/P2 and runtime file changes through the runtime resume gate as blockers', () => {
    const p1p2Decision = evaluateAutonomousRuntimeAuthorizationPreflight({
      documents: [{ text: createStructuredContract() }],
      runtime: {
        ...createAuthorizedRuntimeInput(),
        independentReview: { status: 'passed', openP1Count: 1.7, openP2Count: 2.3 },
      },
    });
    const runtimeFileDecision = evaluateAutonomousRuntimeAuthorizationPreflight({
      documents: [{ text: createStructuredContract() }],
      runtime: {
        ...createAuthorizedRuntimeInput(),
        runtimeFilesChanged: true,
      },
    });

    expect(p1p2Decision).toMatchObject({
      status: 'blocked',
      canStartRuntimeSlice: false,
      reason: 'independent_review_blocked',
      runtimeGateReason: 'independent_review_blocked',
      openP1Count: 1,
      openP2Count: 2,
    });
    expect(runtimeFileDecision).toMatchObject({
      status: 'blocked',
      canStartRuntimeSlice: false,
      reason: 'runtime_files_changed_before_authorization',
      runtimeGateReason: 'runtime_files_changed_before_authorization',
      runtimeFilesChanged: true,
    });
  });

  it('false-positive probe: contradictory gate inputs cannot produce success', () => {
    const docBlockedRuntimeAuthorized = evaluateAutonomousRuntimeAuthorizationPreflight({
      documents: [{ text: createStructuredContract({ omit: ['background_file_frozen'] }) }],
      runtime: createAuthorizedRuntimeInput(),
    });
    const docsPassedRuntimeBlocked = evaluateAutonomousRuntimeAuthorizationPreflight({
      documents: [{ text: createStructuredContract() }],
      runtime: { now: NOW },
    });

    expect(docBlockedRuntimeAuthorized.docGateStatus).toBe('blocked');
    expect(docBlockedRuntimeAuthorized.runtimeGateStatus).toBe('authorized');
    expect(docBlockedRuntimeAuthorized.canStartRuntimeSlice).toBe(false);
    expect(docBlockedRuntimeAuthorized.status).toBe('blocked');
    expect(docsPassedRuntimeBlocked.docGateStatus).toBe('passed');
    expect(docsPassedRuntimeBlocked.runtimeGateStatus).toBe('blocked');
    expect(docsPassedRuntimeBlocked.canStartRuntimeSlice).toBe(false);
    expect(docsPassedRuntimeBlocked.status).toBe('blocked');
  });

  it('exposes only safe metadata and never leaks raw docs, authorization ids, prose, urls, tokens, or transcripts', () => {
    const decision = evaluateAutonomousRuntimeAuthorizationPreflight({
      documents: [{
        text: [
          createStructuredContract(),
          'raw document secret-token https://example.com/private?token=abc123',
        ].join('\n'),
      }],
      runtime: {
        now: NOW,
        authorization: {
          id: 'resume-auth-private-id',
          explicit: true,
          scope: 'chrome_runtime',
          authorizedAt: NOW - 10,
          expiresAt: NOW + 10,
          rawPrompt: 'PRIVATE_PROMPT_TEXT',
        },
        checklist: createCompleteChecklist(),
        independentReview: {
          status: 'blocked',
          openP1Count: 0,
          openP2Count: 0,
          rawReviewerProse: 'SECRET_REVIEW_TRANSCRIPT',
        },
      } as any,
    });

    expect(JSON.stringify(decision)).not.toMatch(
      /secret-token|abc123|resume-auth-private-id|SECRET_REVIEW_TRANSCRIPT|rawPrompt|rawReviewerProse|https:\/\/example\.com/,
    );
  });
});

function createStructuredContract(options: {
  status?: 'current' | 'stale' | 'superseded' | 'obsolete';
  omit?: AutonomousDocResumptionMarkerCode[];
} = {}) {
  const omitted = new Set(options.omit ?? []);
  return [
    'autonomous_doc_resumption_contract_v1',
    `contract_status: ${options.status ?? 'current'}`,
    ...REQUIRED_MARKERS
      .filter((marker) => !omitted.has(marker))
      .map((marker) => `${marker}: true`),
  ].join('\n');
}

function createAuthorizedRuntimeInput() {
  return {
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
    runtimeFilesChanged: false,
  };
}

function readResumptionDocs() {
  return [
    'docs/plan/autonomous-worker-roadmap.md',
    'docs/plan/controlled-runtime-resume-gate.md',
    'docs/plan/autonomous-doc-resumption-gate.md',
    'docs/plan/autonomous-runtime-authorization-preflight.md',
  ].map((path) => ({
    text: readFileSync(join(process.cwd(), path), 'utf8'),
  }));
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
