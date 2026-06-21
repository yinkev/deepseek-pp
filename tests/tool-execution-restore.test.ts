import { describe, expect, it } from 'vitest';
import {
  normalizeRestoredToolExecution,
  sanitizeToolExecutionForRestoreStorage,
} from '../core/tool/execution-restore';
import type { ToolExecutionRecord } from '../core/types';

describe('tool execution restore storage', () => {
  it('keeps structured artifact output as an object when persisting restore data', () => {
    const execution: ToolExecutionRecord = {
      name: 'artifact_create',
      result: {
        ok: true,
        summary: 'File ready',
        detail: 'demo.html (32 bytes)',
        output: {
          kind: 'artifact',
          artifactId: 'artifact-1',
          artifactKind: 'file',
          filename: 'demo.html',
          mimeType: 'text/html',
          sizeBytes: 32,
          view: { previewMode: 'html', language: 'html' },
        },
      },
    };

    const stored = sanitizeToolExecutionForRestoreStorage(execution);

    expect(stored.result.output).toMatchObject({
      kind: 'artifact',
      filename: 'demo.html',
      view: { previewMode: 'html', language: 'html' },
    });
    expect(typeof stored.result.output).toBe('object');
  });

  it('rehydrates legacy JSON-stringified artifact outputs for rich renderers', () => {
    const execution: ToolExecutionRecord = {
      name: 'artifact_create',
      result: {
        ok: true,
        summary: 'File ready',
        detail: 'demo.html (32 bytes)',
        output: JSON.stringify({
          kind: 'artifact',
          artifactId: 'artifact-legacy',
          artifactKind: 'file',
          filename: 'demo.html',
          mimeType: 'text/html',
          sizeBytes: 32,
          view: { previewMode: 'html', language: 'html' },
        }),
      },
    };

    const restored = normalizeRestoredToolExecution(execution);

    expect(restored.result.output).toMatchObject({
      kind: 'artifact',
      artifactId: 'artifact-legacy',
      filename: 'demo.html',
    });
  });

  it('does not parse ordinary JSON-looking string outputs into fake rich results', () => {
    const execution: ToolExecutionRecord = {
      name: 'web_fetch',
      result: {
        ok: true,
        summary: 'Fetched',
        output: '{"title":"plain text output"}',
      },
    };

    const restored = normalizeRestoredToolExecution(execution);

    expect(restored.result.output).toBe('{"title":"plain text output"}');
  });

  it('redacts visual refs, media URLs, and secrets before persisting restore data', () => {
    const execution: ToolExecutionRecord = {
      name: 'browser_click',
      result: {
        ok: true,
        summary: 'Clicked',
        detail: 'Captured data:image/png;base64,AAAA from https://signed.example/file?token=secret',
        output: {
          refFileIds: ['file-secret'],
          dataUrl: 'data:image/png;base64,BBBB',
          tab: {
            title: 'Private dashboard',
            url: 'https://example.com/private?token=secret',
          },
          headers: {
            Authorization: 'Bearer secret',
            Cookie: 'sid=secret',
          },
        },
        error: {
          code: 'probe',
          message: 'blob:extension/object Authorization=Bearer error-secret',
          retryable: true,
          details: {
            signedPath: 'https://signed.example/private?token=secret',
          },
        },
      },
    };

    const json = JSON.stringify(sanitizeToolExecutionForRestoreStorage(execution));

    expect(json).not.toContain('AAAA');
    expect(json).not.toContain('BBBB');
    expect(json).not.toContain('file-secret');
    expect(json).not.toContain('Private dashboard');
    expect(json).not.toContain('example.com/private');
    expect(json).not.toContain('signed.example');
    expect(json).not.toContain('Bearer secret');
    expect(json).not.toContain('sid=secret');
    expect(json).toContain('[redacted:media]');
    expect(json).toContain('[redacted:vision-ref]');
    expect(json).toContain('[redacted:secret]');
  });
});
