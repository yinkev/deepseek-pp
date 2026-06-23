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
      documentCount: 3,
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

  it('passes a minimal self-contained contract without relying on existing plan wording', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: [
          'Step 10 runtime wiring remains blocked.',
          'entrypoints/background.ts is frozen and do not touch entrypoints/background.ts.',
          'The runtime slice requires explicit durable chrome_runtime authorization.',
          'The contract coverage table maps each required behavior to a test assertion or marks it not testable.',
          'The false-positive probe proves result object and durable stored state agree.',
          'Self-review assigns a grade before commit.',
          'Independent P1/P2 review blocks the next step.',
          'Verification ladder: npm test, npm run compile, git diff --check, git diff --name-only HEAD -- entrypoints/background.ts.',
        ].join('\n'),
      }],
    });

    expect(decision.status).toBe('passed');
    expect(decision.missingMarkerCodes).toEqual([]);
  });

  it('blocks denial phrasing that contains the right keywords in the wrong claim', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: [
          'Step 10 runtime wiring is not blocked.',
          'entrypoints/background.ts is not frozen.',
          'Step 10 does not require explicit durable chrome_runtime authorization.',
          'The contract coverage table maps each required behavior to a test assertion or marks it not testable.',
          'The false-positive probe proves result object and durable stored state agree.',
          'Self-review assigns a grade before commit.',
          'Independent P1/P2 review blocks the next step.',
          'Verification ladder: npm test, npm run compile, git diff --check, git diff --name-only HEAD -- entrypoints/background.ts.',
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
          'The contract coverage table maps each required behavior to a test assertion or marks it not testable.',
          'The false-positive probe proves result object and durable stored state agree.',
          'Self-review assigns a grade before commit.',
          'Independent P1/P2 review blocks the next step.',
          'Verification ladder: npm test, npm run compile, git diff --check, git diff --name-only HEAD -- entrypoints/background.ts.',
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

  it('blocks separate-sentence stale posture denials after otherwise valid claims', () => {
    const decision = evaluateAutonomousDocResumptionGate({
      documents: [{
        text: [
          'Step 10 runtime wiring remains blocked.',
          'entrypoints/background.ts is frozen and do not touch entrypoints/background.ts.',
          'The runtime slice requires explicit durable chrome_runtime authorization.',
          'However, that posture is outdated and no longer applies.',
          'The contract coverage table maps each required behavior to a test assertion or marks it not testable.',
          'The false-positive probe proves result object and durable stored state agree.',
          'Self-review assigns a grade before commit.',
          'Independent P1/P2 review blocks the next step.',
          'Verification ladder: npm test, npm run compile, git diff --check, git diff --name-only HEAD -- entrypoints/background.ts.',
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
          'The contract coverage table maps each required behavior to a test assertion or marks it not testable.',
          'The false-positive probe proves result object and durable stored state agree.',
          'Self-review assigns a grade before commit.',
          'Independent P1/P2 review blocks the next step.',
          'Verification ladder: npm test, npm run compile, git diff --check, git diff --name-only HEAD -- entrypoints/background.ts.',
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
    'docs/plan/autonomous-doc-resumption-gate.md',
  ].map((path) => ({
    text: readFileSync(join(process.cwd(), path), 'utf8'),
  }));
}
