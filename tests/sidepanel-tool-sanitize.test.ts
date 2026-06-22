import { describe, expect, it } from 'vitest';
import type { ToolExecutionRecord } from '../core/types';
import {
  formatSidepanelToolResultsForContinuation,
  sanitizeSidepanelToolResultForContinuation,
} from '../core/tool/sidepanel';

describe('sidepanel tool result sanitization', () => {
  it('redacts sensitive object keys and values before continuation prompts', () => {
    const output = {
      'authorization: Bearer sk-proj-secret1234567890': 'raw secret value',
      'https://example.com/path?access_token=raw-token': 'page key value',
      'https://example.com/plain-page': 'page key value',
      'data:image/png;base64,AAAA': 'raw media value',
      nested: {
        cookie: 'session=raw-cookie',
      },
    };

    const result = sanitizeSidepanelToolResultForContinuation({
      ok: true,
      summary: 'ok',
      output,
    });
    const serialized = JSON.stringify(result);

    expect(serialized).toContain('[redacted:secret-key]');
    expect(serialized).toContain('[redacted:page-key]');
    expect(serialized).toContain('[redacted:media-key]');
    expect(serialized).not.toContain('sk-proj-secret');
    expect(serialized).not.toContain('access_token=raw-token');
    expect(serialized).not.toContain('data:image/png');
    expect(serialized).not.toContain('raw-cookie');
  });

  it('budgets oversized keys and handles circular output without throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    cyclic['long-key-' + 'x'.repeat(80_000)] = 'value';

    const result = sanitizeSidepanelToolResultForContinuation({
      ok: true,
      summary: 'ok',
      output: cyclic as never,
    });
    const serialized = JSON.stringify(result);

    expect(serialized.length).toBeLessThan(20_000);
    expect(serialized).toContain('"truncated":true');
    expect(serialized).not.toContain('x'.repeat(20_000));
  });

  it('formats continuation envelopes with sanitized result payloads', () => {
    const execution: ToolExecutionRecord = {
      name: 'browser_snapshot',
      result: {
        ok: true,
        summary: 'ok',
        output: {
          'https://example.com/plain-page': 'page key value',
        },
      },
    };

    const continuation = formatSidepanelToolResultsForContinuation([execution]);

    expect(continuation).toContain('<browser_snapshot_result>');
    expect(continuation).toContain('[redacted:page-key]');
    expect(continuation).not.toContain('https://example.com/plain-page');
  });
});
