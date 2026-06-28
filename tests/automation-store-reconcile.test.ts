import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutomationRun,
  createAutomation,
  createAutomationRun,
  getAutomationRunById,
  getAllAutomations,
  reconcileStaleRuns,
  updateAutomationRun,
} from '../core/automation/store';
import type { AutomationRun } from '../core/automation/types';

const STORAGE_KEY = 'deepseek_pp_automations';

function createChromeStub() {
  const storage = new Map<string, unknown>();
  return {
    storage,
    chromeStub: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
          set: vi.fn(async (value: Record<string, unknown>) => {
            for (const [key, storedValue] of Object.entries(value)) storage.set(key, storedValue);
          }),
        },
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedRun(run: AutomationRun): Promise<void> {
  await appendAutomationRun(run);
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  const now = Date.now();
  return {
    id: 'run-1',
    automationId: 'auto-1',
    trigger: 'schedule',
    status: 'running',
    scheduledFor: now,
    attempt: 1,
    request: null,
    result: null,
    error: null,
    flightRecorder: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

describe('reconcileStaleRuns', () => {
  it('sanitizes automation prompt options before durable storage', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.stubGlobal('crypto', { randomUUID: () => 'auto-1' });

    await createAutomation({
      name: 'Vision monitor',
      prompt: 'check',
      schedule: { kind: 'manual', expression: null, timezone: 'UTC', enabled: false, minimumIntervalMinutes: 0 },
      promptOptions: {
        modelType: 'vision',
        searchEnabled: false,
        thinkingEnabled: false,
        refFileIds: ['file-allowedref'],
        webVisionFiles: [{
          id: 'file-allowedref',
          name: 'screen.png https://signed.example/file?token=secret',
          size: 100,
          mimeType: 'image/png',
          status: 'SUCCESS',
          modelKind: 'VISION',
          isImage: true,
          auditResult: 'pass',
          width: 10,
          height: 10,
          dataUrl: 'data:image/png;base64,AAAA',
        }],
        visualEvidencePacks: [{
          schemaVersion: 1,
          id: 'pack-1',
          kind: 'automation_monitor',
          createdAt: 123,
          storage: 'metadata_only',
          rawImageStored: false,
          refFileIds: ['file-allowedref'],
          webVisionFiles: [{
            id: 'file-allowedref',
            name: 'screen.png',
            size: 100,
            mimeType: 'image/png',
            status: 'SUCCESS',
            modelKind: 'VISION',
            isImage: true,
            auditResult: 'pass',
            dataBase64: 'BBBB',
          }],
          source: { toolName: 'browser_click Authorization: Basic abc123' },
          image: {
            name: 'Cookie: sid=secret',
            mimeType: 'image/png',
            sizeBytes: 100,
          },
          prompt: 'Cookie: sid=secret',
          dataUrl: 'data:image/png;base64,CCCC',
        }],
        extra: 'data:image/png;base64,DDDD',
      } as never,
    });

    const [automation] = await getAllAutomations();
    const json = JSON.stringify(automation.promptOptions);

    expect(automation.promptOptions.refFileIds).toEqual(['file-allowedref']);
    expect(json).not.toMatch(/AAAA|BBBB|CCCC|DDDD|signed\.example|token=secret|sid=secret|Basic abc123|extra|dataUrl|dataBase64/);
    expect(json).toContain('[redacted:secret]');
    expect(json).toContain('[redacted:url]');
  });

  it('sanitizes automation run results before durable storage', async () => {
    const { storage, chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);

    await createAutomationRun({
      id: 'run-secret',
      automationId: 'auto-1',
      trigger: 'manual',
      scheduledFor: null,
      request: {
        runId: 'run-secret',
        automationId: 'auto-1',
        prompt: 'check',
        trigger: 'manual',
        chatSessionId: null,
        parentMessageId: null,
        promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
        requestedAt: 1,
      },
    });

    await updateAutomationRun('run-secret', {
      status: 'succeeded',
      result: {
        ok: true,
        chatSessionId: 'session-1',
        sessionUrl: 'https://chat.deepseek.com/a/chat/s/session-1?token=secret',
        parentMessageId: 2,
        assistantMessageId: 2,
        assistantText: 'done file-sensitive1',
        toolExecutions: [{
          name: 'browser_click',
          result: {
            ok: true,
            summary: 'captured file-sensitive2',
            detail: 'data:image/png;base64,AAAA Cookie: sid=secret',
            output: JSON.stringify({
              refFileIds: ['file-sensitive3'],
              webVisionFiles: [{ id: 'file-sensitive3', name: 'screen.png' }],
              dataUrl: 'data:image/png;base64,BBBB',
              headers: { Authorization: 'Basic abc123' },
            }),
          },
        }],
        history: {
          chatSessionId: 'session-1',
          parentMessageId: 1,
          assistantMessageId: 2,
          assistantText: 'history file-sensitive4 Cookie: sid=history data:image/png;base64,CCCC',
          messageCount: 2,
          verifiedAt: 2,
        },
        completedAt: 2,
      },
      completedAt: 2,
    });

    const rawJson = JSON.stringify(storage.get(STORAGE_KEY));
    const json = JSON.stringify(await getAutomationRunById('run-secret'));

    expect(rawJson).not.toMatch(/file-sensitive|AAAA|BBBB|sid=secret|abc123|token=secret|Authorization|data:image|dataUrl/);
    expect(rawJson).not.toMatch(/sid=history|CCCC/);
    expect(json).not.toMatch(/file-sensitive|AAAA|BBBB|sid=secret|abc123|token=secret|sid=history|CCCC/);
    expect(json).not.toContain('chat.deepseek.com/a/chat/s/session-1?token');
    expect(json).toContain('[redacted:vision-ref]');
    expect(json).toContain('[redacted:media]');
    expect(json).toContain('[redacted:secret]');
  });

  it('sanitizes automation run requests and flight recorder details before durable storage', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);

    await createAutomationRun({
      id: 'run-flight',
      automationId: 'auto-1',
      trigger: 'manual',
      scheduledFor: null,
      request: {
        runId: 'run-flight',
        automationId: 'auto-1',
        prompt: 'Check this Cookie: sid=secret data:image/png;base64,AAAA',
        trigger: 'manual',
        chatSessionId: 'session-1',
        parentMessageId: 7,
        promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
        requestedAt: 1,
      },
    });

    await updateAutomationRun('run-flight', {
      flightRecorder: {
        schemaVersion: 1,
        startedAt: 1,
        updatedAt: 2,
        session: {
          strategy: 'last',
          source: 'last_session',
          chatSessionIdPresent: true,
          parentMessageIdPresent: true,
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
        failure: {
          code: 'automation_executor_failed',
          message: 'Authorization: Bearer secret-token',
          phase: 'runner',
          retryable: true,
          at: 2,
          details: {
            url: 'https://chat.deepseek.com/a/chat/s/session-1?token=secret',
            dataUrl: 'data:image/png;base64,BBBB',
            refFileIds: ['file-secretref'],
          },
        },
        retryable: true,
        events: [{
          id: 'event-1',
          at: 2,
          kind: 'visual_monitor_attached',
          status: 'success',
          label: 'Captured Cookie: sid=secret',
          summary: 'Attached file-secretref data:image/png;base64,CCCC',
          details: {
            headers: { Authorization: 'Bearer secret-token' },
            webVisionFiles: [{ id: 'file-secretref', name: 'screen.png' }],
          },
        }],
      },
    });

    const json = JSON.stringify(await getAutomationRunById('run-flight'));

    expect(json).not.toMatch(/sid=secret|secret-token|AAAA|BBBB|CCCC|token=secret|file-secretref|data:image/);
    expect(json).toContain('[redacted:secret]');
    expect(json).toContain('[redacted:media]');
    expect(json).toContain('[redacted:vision-ref]');
  });

  it('does not let late executor patches mutate terminal automation runs', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    const completedAt = 2_000;
    await seedRun(makeRun({
      id: 'run-timeout',
      status: 'timeout',
      completedAt,
      error: {
        code: 'automation_run_timeout',
        message: 'Automation run timed out.',
        phase: 'runner',
        retryable: true,
        at: completedAt,
      },
    }));

    const before = await getAutomationRunById('run-timeout');
    const setCallsBefore = (chromeStub.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;
    const updated = await updateAutomationRun('run-timeout', {
      status: 'succeeded',
      result: {
        ok: true,
        chatSessionId: 'late-session',
        sessionUrl: null,
        parentMessageId: 1,
        assistantMessageId: 2,
        assistantText: 'late result',
        toolExecutions: [],
        history: null,
        completedAt: completedAt + 1000,
      },
      completedAt: completedAt + 1000,
    });

    expect(updated).toEqual(before);
    expect(await getAutomationRunById('run-timeout')).toEqual(before);
    expect((chromeStub.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setCallsBefore);
  });

  it('marks a stale running run as failed with an interrupted error', async () => {
    const { storage, chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    // Seed an automation so the run has a parent, then the run.
    await createAutomation({
      name: 'A',
      prompt: 'p',
      schedule: { kind: 'cron', expression: '* * * * *', timezone: 'UTC', enabled: true, minimumIntervalMinutes: 0 },
      promptOptions: { modelType: null, searchEnabled: false, thinkingEnabled: false, refFileIds: [] },
    });
    const startedAt = 1_000_000;
    await seedRun(makeRun({ id: 'run-stale', startedAt }));

    const thresholdMs = 180_000;
    const reconciled = await reconcileStaleRuns(thresholdMs, startedAt + thresholdMs + 1);

    expect(reconciled).toBe(1);
    const run = await getAutomationRunById('run-stale');
    expect(run?.status).toBe('failed');
    expect(run?.error).toMatchObject({
      code: 'automation_run_interrupted',
      phase: 'runner',
      retryable: true,
    });
    expect(run?.completedAt).toBe(startedAt + thresholdMs);
  });

  it('leaves a fresh running run untouched', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    const startedAt = 1_000_000;
    await seedRun(makeRun({ id: 'run-fresh', startedAt }));

    const reconciled = await reconcileStaleRuns(180_000, startedAt + 5_000);

    expect(reconciled).toBe(0);
    const run = await getAutomationRunById('run-fresh');
    expect(run?.status).toBe('running');
    expect(run?.error).toBeNull();
  });

  it('does not touch already-finished runs', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    const oldStartedAt = 1_000_000;
    await seedRun(makeRun({ id: 'run-done', status: 'succeeded', startedAt: oldStartedAt, completedAt: oldStartedAt + 1000 }));
    await seedRun(makeRun({ id: 'run-failed', status: 'failed', startedAt: oldStartedAt }));

    const reconciled = await reconcileStaleRuns(180_000, oldStartedAt + 1_000_000);

    expect(reconciled).toBe(0);
    expect((await getAutomationRunById('run-done'))?.status).toBe('succeeded');
    expect((await getAutomationRunById('run-failed'))?.status).toBe('failed');
  });

  it('ignores running runs with a null startedAt', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    await seedRun(makeRun({ id: 'run-no-start', startedAt: null }));

    const reconciled = await reconcileStaleRuns(180_000, Date.now());

    expect(reconciled).toBe(0);
    expect((await getAutomationRunById('run-no-start'))?.status).toBe('running');
  });

  it('writes nothing when there are no stale runs', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    const freshStartedAt = Date.now();
    await seedRun(makeRun({ id: 'run-fresh2', startedAt: freshStartedAt }));

    const setCallsBefore = (chromeStub.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;
    await reconcileStaleRuns(180_000, freshStartedAt + 1_000);
    const setCallsAfter = (chromeStub.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(setCallsAfter).toBe(setCallsBefore); // reconcile wrote nothing
  });
});
