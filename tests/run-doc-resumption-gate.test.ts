import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateAutonomousDocResumptionGate } from '../core/run/doc-resumption-gate';

describe('autonomous doc resumption gate', () => {
  it('passes when repo-visible docs contain the autonomous resume contract', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: readResumptionDocs(),
    });

    expect(decision).toEqual({
      status: 'passed',
      canResumeFromDocs: true,
      reason: 'passed',
      documentCount: 2,
      checkedMarkerCodes: [
        'runtime_authorization_required',
        'background_file_frozen',
        'step_10_blocked',
        'contract_coverage_required',
        'false_positive_probe_required',
        'self_review_grade_required',
        'independent_p1p2_review_required',
        'verification_ladder_required',
      ],
      presentMarkerCodes: [
        'runtime_authorization_required',
        'background_file_frozen',
        'step_10_blocked',
        'contract_coverage_required',
        'false_positive_probe_required',
        'self_review_grade_required',
        'independent_p1p2_review_required',
        'verification_ladder_required',
      ],
      missingMarkerCodes: [],
    });
  });

  it('blocks when no documents are supplied', () => {
    expect(evaluateAutonomousDocResumptionGate()).toMatchObject({
      status: 'blocked',
      canResumeFromDocs: false,
      reason: 'no_documents',
      documentCount: 0,
      missingMarkerCodes: [
        'runtime_authorization_required',
        'background_file_frozen',
        'step_10_blocked',
        'contract_coverage_required',
        'false_positive_probe_required',
        'self_review_grade_required',
        'independent_p1p2_review_required',
        'verification_ladder_required',
      ],
    });
  });

  it('blocks incomplete docs with exact missing marker codes', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: [
          'Step 10 runtime wiring is blocked.',
          'Do not touch entrypoints/background.ts while the runtime freeze is active.',
          'Require explicit durable chrome_runtime authorization.',
        ].join('\n'),
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
          'Step 10 runtime wiring is blocked.',
          'Do not touch entrypoints/background.ts while the runtime freeze is active.',
          'Require explicit durable chrome_runtime authorization.',
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
  ].map((path) => ({
    text: readFileSync(join(process.cwd(), path), 'utf8'),
  }));
}
