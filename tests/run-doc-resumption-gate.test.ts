import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateAutonomousDocResumptionGate } from '../core/run/doc-resumption-gate';

const REQUIRED_MARKERS = [
  'runtime_authorization_required',
  'background_file_frozen',
  'step_10_blocked',
  'contract_coverage_required',
  'false_positive_probe_required',
  'self_review_grade_required',
  'independent_p1p2_review_required',
  'verification_ladder_required',
];

describe('autonomous doc resumption gate', () => {
  it('passes when repo-visible docs contain the autonomous resume contract', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: readResumptionDocs(),
    });

    expect(decision).toEqual({
      status: 'passed',
      canResumeFromDocs: true,
      reason: 'passed',
      documentCount: 3,
      checkedMarkerCodes: REQUIRED_MARKERS,
      presentMarkerCodes: REQUIRED_MARKERS,
      missingMarkerCodes: [],
    });
  });

  it('passes a minimal self-contained structured contract without relying on plan prose', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{ text: createStructuredContract() }],
    });

    expect(decision.status).toBe('passed');
    expect(decision.missingMarkerCodes).toEqual([]);
  });

  it('blocks when the structured contract status is stale', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: createStructuredContract({ status: 'superseded' }),
      }],
    });

    expect(decision).toMatchObject({
      status: 'blocked',
      reason: 'missing_required_markers',
      presentMarkerCodes: [],
      missingMarkerCodes: REQUIRED_MARKERS,
    });
  });

  it('blocks denial phrasing that contains the right keywords without structured markers', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: [
          'Step 10 runtime wiring is not blocked.',
          'entrypoints/background.ts is not frozen.',
          'Step 10 does not require explicit durable chrome_runtime authorization.',
          ...createStructuredContract({
            omit: [
              'runtime_authorization_required',
              'background_file_frozen',
              'step_10_blocked',
            ],
          }).split('\n'),
        ].join('\n'),
      }],
    });

    expect(decision).toMatchObject({
      status: 'blocked',
      reason: 'missing_required_markers',
    });
    expect(decision.missingMarkerCodes).toEqual([
      'runtime_authorization_required',
      'background_file_frozen',
      'step_10_blocked',
    ]);
  });

  it('blocks embedded quotes that repeat the contract words while denying current posture', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: [
          'Step 10 runtime wiring remains blocked is incorrect.',
          'The runtime slice requires explicit durable chrome_runtime authorization is outdated.',
          'entrypoints/background.ts is frozen and do not touch entrypoints/background.ts but that is no longer the case.',
          ...createStructuredContract({
            omit: [
              'runtime_authorization_required',
              'background_file_frozen',
              'step_10_blocked',
            ],
          }).split('\n'),
        ].join('\n'),
      }],
    });

    expect(decision.status).toBe('blocked');
    expect(decision.missingMarkerCodes).toEqual([
      'runtime_authorization_required',
      'background_file_frozen',
      'step_10_blocked',
    ]);
  });

  it('blocks separate-sentence stale posture denials after otherwise valid prose claims', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: [
          'Step 10 runtime wiring remains blocked.',
          'entrypoints/background.ts is frozen and do not touch entrypoints/background.ts.',
          'The runtime slice requires explicit durable chrome_runtime authorization.',
          'However, that posture is outdated and no longer applies.',
          ...createStructuredContract({
            omit: [
              'runtime_authorization_required',
              'background_file_frozen',
              'step_10_blocked',
            ],
          }).split('\n'),
        ].join('\n'),
      }],
    });

    expect(decision.status).toBe('blocked');
    expect(decision.missingMarkerCodes).toEqual([
      'runtime_authorization_required',
      'background_file_frozen',
      'step_10_blocked',
    ]);
  });

  it('blocks historical framing that repeats the frozen posture as past state', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: [
          'Previously, Step 10 runtime wiring was blocked.',
          'Previously, entrypoints/background.ts was frozen.',
          'The prior requirement was explicit durable chrome_runtime authorization.',
          ...createStructuredContract({
            omit: [
              'runtime_authorization_required',
              'background_file_frozen',
              'step_10_blocked',
            ],
          }).split('\n'),
        ].join('\n'),
      }],
    });

    expect(decision.status).toBe('blocked');
    expect(decision.missingMarkerCodes).toContain('runtime_authorization_required');
    expect(decision.missingMarkerCodes).toContain('background_file_frozen');
    expect(decision.missingMarkerCodes).toContain('step_10_blocked');
  });

  it('blocks when no documents are supplied', () => {
    expect(evaluateAutonomousDocResumptionGate()).toMatchObject({
      status: 'blocked',
      canResumeFromDocs: false,
      reason: 'no_documents',
      documentCount: 0,
      missingMarkerCodes: REQUIRED_MARKERS,
    });
  });

  it('blocks incomplete docs with exact missing marker codes', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: createStructuredContract({
          omit: [
            'contract_coverage_required',
            'false_positive_probe_required',
            'self_review_grade_required',
            'independent_p1p2_review_required',
            'verification_ladder_required',
          ],
        }),
      }],
    });

    expect(decision).toMatchObject({
      status: 'blocked',
      reason: 'missing_required_markers',
      presentMarkerCodes: [
        'runtime_authorization_required',
        'background_file_frozen',
        'step_10_blocked',
      ],
      missingMarkerCodes: [
        'contract_coverage_required',
        'false_positive_probe_required',
        'self_review_grade_required',
        'independent_p1p2_review_required',
        'verification_ladder_required',
      ],
    });
  });

  it('privacy probe: decision exposes only marker codes and counts, not document text', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: [
          createStructuredContract({
            omit: [
              'contract_coverage_required',
              'false_positive_probe_required',
              'self_review_grade_required',
              'independent_p1p2_review_required',
              'verification_ladder_required',
            ],
          }),
          'Authorization: Bearer secret-token',
          'https://example.com/private?token=abc123',
        ].join('\n'),
      }],
    });

    const json = JSON.stringify(decision);
    expect(json).not.toMatch(/secret-token|abc123|Authorization: Bearer|example\.com|private/);
  });
});

function readResumptionDocs() {
  return [
    'docs/plan/autonomous-worker-roadmap.md',
    'docs/plan/controlled-runtime-resume-gate.md',
    'docs/plan/autonomous-doc-resumption-gate.md',
  ].map((path) => ({
    text: readFileSync(join(process.cwd(), path), 'utf8'),
  }));
}

function createStructuredContract(options: {
  status?: 'current' | 'stale' | 'superseded' | 'obsolete';
  omit?: string[];
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
