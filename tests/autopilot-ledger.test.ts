import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAutopilotRun,
  getAutopilotRunLedger,
  normalizeAutopilotRun,
} from '../core/personal-convenience/autopilot-ledger';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('autopilot run ledger', () => {
  it('stores metadata-only run summaries sorted newest first', async () => {
    const { chromeStub, storage } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);

    await appendAutopilotRun({
      id: 'run-1',
      source: 'startup',
      startedAt: 100,
      finishedAt: 120,
      ready: false,
      status: 'needs_attention',
      grade: 'C',
      blockers: ['web_auth_missing'],
      targetStatus: 'missing',
      repaired: [],
      leakIssueCount: 0,
    });
    await appendAutopilotRun({
      id: 'run-2',
      source: 'repair',
      startedAt: 200,
      finishedAt: 240,
      ready: true,
      status: 'ready',
      grade: 'A',
      blockers: [],
      targetStatus: 'ready',
      repaired: ['web_auth_refreshed', 'stale_deepseek_tabs_reloaded'],
      leakIssueCount: 0,
      Authorization: 'Bearer should-not-persist',
      url: 'https://example.com/private?token=secret',
    } as never);

    await expect(getAutopilotRunLedger()).resolves.toMatchObject([
      { id: 'run-2', source: 'repair', ready: true, repaired: ['web_auth_refreshed', 'stale_deepseek_tabs_reloaded'] },
      { id: 'run-1', source: 'startup', ready: false, blockers: ['web_auth_missing'] },
    ]);
    expect(JSON.stringify(storage.get('deepseek_pp_autopilot_run_ledger_v1'))).not.toMatch(/Bearer|should-not-persist|private|token=secret|url/);
  });

  it('rejects malformed runs and keeps only known blocker ids', () => {
    expect(normalizeAutopilotRun({
      id: 'run',
      source: 'manual',
      startedAt: 100,
      finishedAt: 90,
      ready: true,
      status: 'ready',
      grade: 'A',
      blockers: ['web_auth_missing', 'unknown_blocker'],
      targetStatus: 'ready',
      repaired: ['x'.repeat(80)],
      leakIssueCount: 2.9,
    })).toMatchObject({
      id: 'run',
      finishedAt: 100,
      blockers: ['web_auth_missing'],
      repaired: ['x'.repeat(48)],
      leakIssueCount: 2,
    });
    expect(normalizeAutopilotRun({ id: 'bad' })).toBeNull();
  });
});

function createChromeStub() {
  const storage = new Map<string, unknown>();
  return {
    storage,
    chromeStub: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) storage.set(key, value);
          }),
        },
      },
    },
  };
}
