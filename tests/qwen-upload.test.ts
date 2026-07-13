import { describe, expect, it, vi } from 'vitest';
import {
  createQwenImageUploader,
  createQwenOssHeaders,
} from '../core/qwen/upload';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe('Qwen web image upload', () => {
  it('reproduces the Qwen OSS v4 signature fields', async () => {
    const headers = await createQwenOssHeaders('PUT', '20260712T123456Z', {
      bucketname: 'qwen-webui-prod',
      file_path: 'uploads/cat.png',
      access_key_id: 'AKID',
      access_key_secret: 'secret',
      security_token: 'sts-token',
    }, 'image/png');

    expect(headers.authorization).toBe(
      'OSS4-HMAC-SHA256 Credential=AKID/20260712/ap-southeast-1/oss/aliyun_v4_request,'
      + 'Signature=b1ca75bf242f3351c09ee3a8dd0a7fb450930f0f2e6252e683f09d3b4acdfa91',
    );
    expect(headers['x-oss-security-token']).toBe('sts-token');
  });

  it('initializes, uploads, confirms, and returns the exact completion file object', async () => {
    const fetchImpl = vi.fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: {
          bucketname: 'qwen-webui-prod',
          file_path: 'uploads/cat.png',
          access_key_id: 'AKID',
          access_key_secret: 'secret',
          security_token: 'sts-token',
          file_url: 'https://qwen-webui-prod.oss-ap-southeast-1.aliyuncs.com/uploads/cat.png?signed=1',
          file_id: 'file-qwen-1',
        },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    const upload = createQwenImageUploader({
      fetchImpl,
      loadAuth: async () => ({ authorization: 'Bearer token', version: '0.2.63' }),
      randomUUID: sequenceUuid('request-init', 'request-confirm', 'item-1', 'task-1'),
      now: () => Date.UTC(2026, 6, 12, 12, 34, 56),
    });

    const uploaded = await upload({
      data: new Uint8Array([1, 2, 3]),
      filename: 'cat.png',
      contentType: 'image/png',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://chat.qwen.ai/api/v2/files/getstsToken');
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      filename: 'cat.png',
      filesize: 3,
      filetype: 'image/png',
    });
    expect(String(fetchImpl.mock.calls[1][0])).toBe(
      'https://qwen-webui-prod.oss-ap-southeast-1.aliyuncs.com/uploads/cat.png',
    );
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: new Uint8Array([1, 2, 3]) });
    expect(String(fetchImpl.mock.calls[2][0])).toBe('https://chat.qwen.ai/api/v2/files/confirm');
    expect(uploaded).toMatchObject({
      id: 'file-qwen-1',
      type: 'image',
      name: 'cat.png',
      status: 'uploaded',
      file_type: 'image/png',
      showType: 'image',
      file_class: 'vision',
      itemId: 'item-1',
      uploadTaskId: 'task-1',
      file: {
        id: 'file-qwen-1',
        filename: 'cat.png',
        meta: { name: 'cat.png', size: 3, content_type: 'image/png' },
      },
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sequenceUuid(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `uuid-${index}`;
}
