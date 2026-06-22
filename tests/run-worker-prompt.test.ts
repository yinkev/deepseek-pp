import { describe, expect, it } from 'vitest';
import {
  AUTONOMOUS_WORKER_PROMPT_REQUIRED_MARKERS,
  AUTONOMOUS_WORKER_QUALITY_GATE_XML,
  buildAutonomousWorkerPrompt,
  reviewAutonomousWorkerPromptContract,
} from '../core/run/worker-prompt';

const EXPECTED_QUALITY_GATE_XML = `<quality_gate>
  <item>Before committing, build a contract coverage table: each required behavior must map to at least one test assertion or be explicitly marked not testable in this slice.</item>
  <item>Run one adversarial probe for false-positive success: prove the result object and durable stored state agree.</item>
  <item>Self-review after verification and assign grade A-F.</item>
  <item>If grade is below A, iterate once before committing.</item>
  <item>After commit, expect an independent adversarial review; do not start the next slice if a P1/P2 is found.</item>
</quality_gate>`;

const EXPECTED_REPORT_FIELDS = [
  'status',
  'changed_files',
  'contract_coverage_table',
  'adversarial_probe',
  'verification',
  'self_review',
  'grade',
  'commit',
  'blockers',
  'next_step_recommendation',
];

describe('autonomous worker prompt contract', () => {
  it('builds a deterministic worker prompt with the required quality gate and XML report contract', () => {
    const prompt = buildAutonomousWorkerPrompt({
      stepNumber: 1,
      title: 'Prompt Contract Gate',
      objective: 'Freeze the autonomous worker prompt contract.',
      worktree: '/Users/kyin/Projects/deepseek-pp-pet',
      branch: 'codex/deepseek-pet',
      scope: ['Create pure prompt builder', 'Add contract tests'],
      likelyFiles: [
        'core/run/worker-prompt.ts',
        'tests/run-worker-prompt.test.ts',
      ],
      verificationCommands: [
        'npm test -- tests/run-worker-prompt.test.ts',
        'npm run compile',
        'git diff --check',
      ],
    });

    expect(prompt).toContain('Evaluate, Review, Grade, Iterate');
    expect(prompt).toContain(AUTONOMOUS_WORKER_QUALITY_GATE_XML);
    expect(AUTONOMOUS_WORKER_QUALITY_GATE_XML).toBe(EXPECTED_QUALITY_GATE_XML);
    expect(prompt).toContain('commit after implementation');
    expect(prompt).toContain('Do not touch Chrome/runtime work unless explicitly resumed.');
    expect(prompt).toContain('Do not touch entrypoints/background.ts.');
    expect(prompt).toContain('<step_report>');
    for (const field of EXPECTED_REPORT_FIELDS) {
      expect(prompt).toContain(`<${field}>`);
      expect(prompt).toContain(`</${field}>`);
    }
    expect(prompt).toContain('npm test -- tests/run-worker-prompt.test.ts');
    expect(prompt).toContain('<file>core/run/worker-prompt.ts</file>');
    expect(reviewAutonomousWorkerPromptContract(prompt)).toEqual({
      ok: true,
      missingMarkers: [],
    });
  });

  it('keeps the required marker list aligned with the quality gate text', () => {
    for (const marker of AUTONOMOUS_WORKER_PROMPT_REQUIRED_MARKERS) {
      expect(buildAutonomousWorkerPrompt({
        stepNumber: 2,
        title: 'Marker check',
        objective: 'Check marker coverage.',
        worktree: '/repo',
      })).toContain(marker);
    }
  });

  it('reviewAutonomousWorkerPromptContract flags missing contract markers', () => {
    const review = reviewAutonomousWorkerPromptContract('Evaluate, Review, Grade, Iterate\n<step_report></step_report>');

    expect(review.ok).toBe(false);
    expect(review.missingMarkers).toContain('<quality_gate>');
    expect(review.missingMarkers).toContain('contract coverage table');
    expect(review.missingMarkers).toContain('P1/P2');
  });

  it('adversarial privacy probe: redacts sensitive prompt inputs without weakening required contract markers', () => {
    const prompt = buildAutonomousWorkerPrompt({
      stepNumber: Number.POSITIVE_INFINITY,
      title: 'Use Authorization: Bearer secret-token',
      objective: 'Inspect https://example.com/file?X-Amz-Signature=abc123 and sk-proj-1234567890abcdef1234567890abcdef.',
      worktree: '/repo?token=secret-token',
      branch: 'branch&access_token=secret',
      scope: ['Cookie: sid=secret-session', 'data:image/png;base64,AAAA'],
      likelyFiles: ['core/run/worker-prompt.ts?secret=path-token'],
      verificationCommands: ['npm test -- token=secret'],
      extraInstructions: ['Set-Cookie: auth=secret-value', 'Bearer bearer-only-secret'],
    });

    expect(prompt).toContain('step 0');
    expect(prompt).toContain('Bearer [REDACTED]');
    expect(prompt).toContain('Authorization: [REDACTED]');
    expect(prompt).toContain('Cookie: [REDACTED]');
    expect(prompt).toContain('Set-Cookie: [REDACTED]');
    expect(prompt).toContain('sk-[REDACTED]');
    expect(prompt).toContain('X-Amz-Signature=[REDACTED]');
    expect(prompt).toContain('access_token=[REDACTED]');
    expect(prompt).toContain('token=[REDACTED]');
    expect(prompt).toContain('secret=[REDACTED]');
    expect(prompt).toContain('[REDACTED_INLINE_MEDIA]');
    expect(prompt).not.toMatch(/secret-token|abc123|1234567890abcdef|secret-session|AAAA|path-token|secret-value/);
    expect(reviewAutonomousWorkerPromptContract(prompt)).toEqual({
      ok: true,
      missingMarkers: [],
    });
  });

  it('deduplicates defaults and escapes XML-significant text', () => {
    const prompt = buildAutonomousWorkerPrompt({
      stepNumber: 3.8,
      title: 'Title with <tag> & value',
      objective: 'Objective with <xml> & chars',
      worktree: '/repo',
      forbiddenFiles: ['entrypoints/background.ts', 'core/runtime.ts'],
      verificationCommands: ['npm run compile', 'npm run compile'],
      scope: ['same', 'same'],
    });

    expect(prompt).toContain('step 3');
    expect(prompt).toContain('Title with &lt;tag&gt; &amp; value');
    expect(prompt).toContain('Objective with &lt;xml&gt; &amp; chars');
    expect(prompt.match(/Do not touch entrypoints\/background\.ts\./g)).toHaveLength(1);
    expect(prompt.match(/<command>npm run compile<\/command>/g)).toHaveLength(1);
    expect(prompt.match(/<item>same<\/item>/g)).toHaveLength(1);
    expect(prompt).toContain('Do not touch core/runtime.ts.');
  });
});
