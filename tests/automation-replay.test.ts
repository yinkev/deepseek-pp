import { describe, expect, it } from 'vitest';
import { createAutomationRunReplayBrief } from '../core/automation/replay';
import type { AutomationRun } from '../core/automation/types';

describe('automation run replay brief', () => {
  it('summarizes run evidence without leaking raw media or secrets', () => {
    const brief = createAutomationRunReplayBrief(makeRun({
      trigger: 'chain',
      request: {
        runId: 'run-1',
        automationId: 'automation-1',
        prompt: 'Use Authorization: Bearer secret-token with data:image/png;base64,AAAA, then stop.',
        trigger: 'chain',
        chatSessionId: null,
        parentMessageId: null,
        promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
        preflight: {
          schemaVersion: 1,
          checkedAt: 1,
          grade: 'B',
          score: 88,
          status: 'needs_attention',
          issueCodes: ['loop_contract_weak'],
          blockingIssueCodes: [],
          autoFixedIssueCodes: ['research_without_search'],
        },
        chain: {
          parentAutomationId: 'automation-parent',
          parentRunId: 'run-parent',
          depth: 1,
          visitedAutomationIds: ['automation-parent', 'automation-1'],
        },
        requestedAt: 1,
      },
      result: {
        ok: true,
        chatSessionId: 'session-1',
        sessionUrl: null,
        parentMessageId: 2,
        assistantMessageId: 2,
        assistantText: 'Done with file-abcdefg and Cookie: sid=secret.',
        toolExecutions: [],
        history: null,
        completedAt: 2,
      },
      flightRecorder: {
        schemaVersion: 1,
        startedAt: 1,
        updatedAt: 2,
        session: {
          strategy: 'last',
          source: 'last_session',
          chatSessionIdPresent: true,
          parentMessageIdPresent: false,
        },
        auth: {
          source: 'web_headers',
          hasWebAuth: true,
        },
        visual: {
          requested: true,
          attachedRefCount: 1,
          evidencePackCount: 1,
          rawImageStored: false,
        },
        failure: null,
        retryable: null,
        events: [{
          id: 'event-1',
          at: 1,
          kind: 'runner_completed',
          status: 'success',
          label: 'Runner completed',
          summary: 'Captured data:image/png;base64,BBBB without storing raw image.',
        }],
      },
    }));

    expect(brief).toContain('Automation run replay brief');
    expect(brief).toContain('Trigger: chain');
    expect(brief).toContain('Preflight: B (88) needs_attention');
    expect(brief).toContain('Visual evidence: 1 ref(s), 1 pack(s), raw images stored: false');
    expect(brief).toContain('Chain: depth 1, parent automation-parent, parent run run-parent');
    expect(brief).not.toMatch(/secret-token|Authorization|Bearer|Cookie|sid=secret|data:image|AAAA|BBBB|file-sensitive/);
    expect(brief).toContain('[redacted:secret]');
    expect(brief).toContain('[redacted:media]');
    expect(brief).toContain('[redacted:vision-ref]');
  });
});

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1',
    automationId: 'automation-1',
    trigger: 'manual',
    status: 'succeeded',
    scheduledFor: null,
    attempt: 1,
    request: null,
    result: null,
    error: null,
    flightRecorder: null,
    createdAt: 1,
    startedAt: 1,
    completedAt: 2,
    updatedAt: 2,
    ...overrides,
  };
}
