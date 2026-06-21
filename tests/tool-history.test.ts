import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendToolCallHistory,
  getToolCallHistory,
} from '../core/tool/history';
import type { ToolCall, ToolResult } from '../core/tool/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tool call history', () => {
  it('redacts raw media payloads before durable storage', async () => {
    const storage = new Map<string, unknown>();
    vi.stubGlobal('chrome', createChromeStub(storage));
    vi.stubGlobal('crypto', { randomUUID: () => 'history-id' });

    const call: ToolCall = {
      name: 'analyze_images',
      payload: {
        images: [{
          image_url: 'data:image/png;base64,AAAA',
          dataUrl: 'data:image/png;base64,BBBB',
          nested: {
            base64Data: 'raw-video-base64',
            dataBase64: 'raw-image-base64',
            Authorization: 'Bearer nested-secret',
            'X-DS-PoW-Response': 'pow-object-secret',
          },
        }],
      },
      raw: '<tool_call>{"image_url":"data:image/png;base64,CCCC","url":"https://signed.example/private?token=secret","Authorization":"Basic raw-basic","x-api-key":"raw-key","refFileId":"file-rawsecret"}</tool_call>',
    };
    const result: ToolResult = {
      ok: true,
      summary: 'ok',
      detail: 'saw data:image/png;base64,DDDD and blob:extension/object and https://signed.example/private?token=secret Cookie: sid=detail-secret file-detailsecret',
      output: {
        echo: 'data:image/png;base64,EEEE',
        dataUrl: 'data:image/png;base64,FFFF',
        refFileIds: ['file-sensitive'],
        webVisionFiles: [{ id: 'file-sensitive', name: 'screen.png' }],
        tab: {
          title: 'Private dashboard',
          url: 'https://example.com/private?token=secret',
        },
      },
      error: {
        code: 'failed',
        message: 'Authorization=Bearer result-secret x-ds-pow-response=pow-secret',
        retryable: true,
        details: {
          Cookie: 'session=secret',
          'X-Api-Key': 'api-object-secret',
          signedPath: 'https://signed.example/file?token=secret',
        },
      },
    };

    await appendToolCallHistory(call, result, 'manual_chat');

    const json = JSON.stringify(await getToolCallHistory());
    expect(json).not.toContain('AAAA');
    expect(json).not.toContain('BBBB');
    expect(json).not.toContain('CCCC');
    expect(json).not.toContain('DDDD');
    expect(json).not.toContain('EEEE');
    expect(json).not.toContain('FFFF');
    expect(json).not.toContain('file-sensitive');
    expect(json).not.toContain('Private dashboard');
    expect(json).not.toContain('example.com/private');
    expect(json).not.toContain('signed.example');
    expect(json).not.toContain('raw-secret');
    expect(json).not.toContain('raw-basic');
    expect(json).not.toContain('raw-key');
    expect(json).not.toContain('file-rawsecret');
    expect(json).not.toContain('file-detailsecret');
    expect(json).not.toContain('detail-secret');
    expect(json).not.toContain('nested-secret');
    expect(json).not.toContain('result-secret');
    expect(json).not.toContain('pow-secret');
    expect(json).not.toContain('pow-object-secret');
    expect(json).not.toContain('api-object-secret');
    expect(json).not.toContain('session=secret');
    expect(json).not.toContain('raw-video-base64');
    expect(json).not.toContain('raw-image-base64');
    expect(json).toContain('[redacted:media]');
    expect(json).toContain('[redacted:vision-ref]');
    expect(json).toContain('[redacted:secret]');
  });
});

function createChromeStub(storage: Map<string, unknown>) {
  return {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          for (const [key, storedValue] of Object.entries(value)) {
            storage.set(key, storedValue);
          }
        }),
        remove: vi.fn(async (key: string) => {
          storage.delete(key);
        }),
      },
    },
  };
}
