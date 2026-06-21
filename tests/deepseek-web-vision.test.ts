import { describe, expect, it, vi } from 'vitest';
import {
  DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES,
  DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES,
  DEEPSEEK_WEB_FILE_FETCH_PATH,
  DEEPSEEK_WEB_FILE_UPLOAD_PATH,
  DeepSeekWebVisionUploadError,
  createDeepSeekWebVisionFileFromSerializedImage,
  createDeepSeekWebVisionContinuationRoute,
  createDeepSeekWebVisionRoute,
  createDeepSeekWebVisionToolContinuationRoute,
  normalizeDeepSeekWebVisionSerializedImages,
  uploadDeepSeekWebVisionImage,
} from '../core/deepseek/web-vision';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe('DeepSeek Web Vision upload', () => {
  it('uploads an image with Vision headers and returns safe metadata after polling success', async () => {
    const powTargets: string[] = [];
    const fetchImpl = vi.fn<FetchImpl>(async (input, init) => {
      const url = String(input);

      if (url.endsWith(DEEPSEEK_WEB_FILE_UPLOAD_PATH)) {
        expect(init?.method).toBe('POST');
        expect(init?.credentials).toBe('include');
        expect(init?.body).toBeInstanceOf(FormData);
        expect(Object.fromEntries(new Headers(init?.headers))).toMatchObject({
          authorization: 'Bearer token',
          'x-ds-pow-response': 'pow-/api/v0/file/upload_file',
          'x-file-size': '5',
          'x-model-type': 'vision',
          'x-thinking-enabled': '0',
        });
        expect(new Headers(init?.headers).has('content-type')).toBe(false);
        return jsonResponse({
          code: 0,
          data: {
            biz_code: 0,
            biz_data: {
              id: 'file-vision',
              status: 'PENDING',
              file_name: 'probe.png',
              file_size: 5,
              model_kind: 'VISION',
              is_image: true,
              audit_result: 'unknown',
            },
          },
        });
      }

      if (url.includes(DEEPSEEK_WEB_FILE_FETCH_PATH)) {
        expect(url).toContain('file_ids=file-vision');
        return jsonResponse({
          code: 0,
          data: {
            biz_code: 0,
            biz_data: {
              files: [{
                id: 'file-vision',
                status: 'SUCCESS',
                file_name: 'probe.png',
                file_size: 5,
                model_kind: 'VISION',
                is_image: true,
                audit_result: 'pass',
                width: 10,
                height: 8,
              }],
            },
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const result = await uploadDeepSeekWebVisionImage({
      file: new File(['probe'], 'probe.png', { type: 'image/png' }),
      clientHeaders: { Authorization: 'Bearer token' },
      createPowHeaders: async (targetPath) => {
        powTargets.push(targetPath);
        return { 'X-DS-PoW-Response': `pow-${targetPath}` };
      },
      fetchImpl,
      pollIntervalMs: 0,
    });

    expect(powTargets).toEqual([DEEPSEEK_WEB_FILE_UPLOAD_PATH]);
    expect(result).toEqual({
      refFileId: 'file-vision',
      metadata: {
        id: 'file-vision',
        name: 'probe.png',
        size: 5,
        mimeType: 'image/png',
        status: 'SUCCESS',
        modelKind: 'VISION',
        isImage: true,
        auditResult: 'pass',
        width: 10,
        height: 8,
      },
    });
  });

  it('rejects non-image files before uploading', async () => {
    const fetchImpl = vi.fn<FetchImpl>();

    await expect(uploadDeepSeekWebVisionImage({
      file: new File(['hello'], 'notes.txt', { type: 'text/plain' }),
      clientHeaders: {},
      createPowHeaders: async () => ({}),
      fetchImpl,
    })).rejects.toMatchObject({
      name: 'DeepSeekWebVisionUploadError',
      code: 'invalid_image',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects unsupported image types and oversized images before uploading', async () => {
    const fetchImpl = vi.fn<FetchImpl>();

    await expect(uploadDeepSeekWebVisionImage({
      file: new File(['image'], 'probe.svg', { type: 'image/svg+xml' }),
      clientHeaders: {},
      createPowHeaders: async () => ({}),
      fetchImpl,
    })).rejects.toMatchObject({
      code: 'invalid_image',
    });

    await expect(uploadDeepSeekWebVisionImage({
      file: new File([new Blob([new Uint8Array(DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES + 1)])], 'large.png', { type: 'image/png' }),
      clientHeaders: {},
      createPowHeaders: async () => ({}),
      fetchImpl,
    })).rejects.toMatchObject({
      code: 'invalid_image',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails when the uploaded file reaches a terminal non-success status', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (input) => {
      const url = String(input);
      if (url.endsWith(DEEPSEEK_WEB_FILE_UPLOAD_PATH)) {
        return jsonResponse({
          code: 0,
          data: {
            biz_code: 0,
            biz_data: {
              id: 'file-normal',
              status: 'PENDING',
              file_name: 'probe.png',
              file_size: 5,
              model_kind: 'VISION',
              is_image: true,
            },
          },
        });
      }
      return jsonResponse({
        code: 0,
        data: {
          biz_code: 0,
          biz_data: {
            files: [{
              id: 'file-normal',
              status: 'CONTENT_EMPTY',
              file_name: 'probe.png',
              file_size: 5,
              model_kind: 'NORMAL',
              is_image: true,
            }],
          },
        },
      });
    });

    await expect(uploadDeepSeekWebVisionImage({
      file: new File(['probe'], 'probe.png', { type: 'image/png' }),
      clientHeaders: {},
      createPowHeaders: async () => ({}),
      fetchImpl,
      pollIntervalMs: 0,
    })).rejects.toBeInstanceOf(DeepSeekWebVisionUploadError);

    await expect(uploadDeepSeekWebVisionImage({
      file: new File(['probe'], 'probe.png', { type: 'image/png' }),
      clientHeaders: {},
      createPowHeaders: async () => ({}),
      fetchImpl,
      pollIntervalMs: 0,
    })).rejects.toMatchObject({
      code: 'file_not_ready',
    });
  });

  it('does not accept file status for a different file id', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (input) => {
      const url = String(input);
      if (url.endsWith(DEEPSEEK_WEB_FILE_UPLOAD_PATH)) {
        return jsonResponse({
          code: 0,
          data: {
            biz_code: 0,
            biz_data: {
              id: 'file-requested',
              status: 'PENDING',
              file_name: 'probe.png',
              file_size: 5,
              model_kind: 'VISION',
              is_image: true,
            },
          },
        });
      }
      return jsonResponse({
        code: 0,
        data: {
          biz_code: 0,
          biz_data: {
            files: [{
              id: 'file-other',
              status: 'SUCCESS',
              file_name: 'other.png',
              file_size: 5,
              model_kind: 'VISION',
              is_image: true,
            }],
          },
        },
      });
    });

    await expect(uploadDeepSeekWebVisionImage({
      file: new File(['probe'], 'probe.png', { type: 'image/png' }),
      clientHeaders: {},
      createPowHeaders: async () => ({}),
      fetchImpl,
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    })).rejects.toMatchObject({
      code: 'file_not_ready',
    });
  });

  it('does not expose raw upload response details in errors', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({
      code: 0,
      data: {
        biz_code: 9,
        biz_data: {
          signed_path: 'https://signed.example/private',
          authorization: 'Bearer secret',
        },
      },
    }, { status: 400 }));

    await expect(uploadDeepSeekWebVisionImage({
      file: new File(['probe'], 'probe.png', { type: 'image/png' }),
      clientHeaders: {},
      createPowHeaders: async () => ({}),
      fetchImpl,
      pollIntervalMs: 0,
    })).rejects.toMatchObject({
      code: 'upload_failed',
      message: 'DeepSeek Vision upload failed with HTTP 400.',
      httpStatus: 400,
    });
  });

  it('keeps polling pending files until model kind is known or the file succeeds', async () => {
    let statusPolls = 0;
    const fetchImpl = vi.fn<FetchImpl>(async (input) => {
      const url = String(input);
      if (url.endsWith(DEEPSEEK_WEB_FILE_UPLOAD_PATH)) {
        return jsonResponse({
          code: 0,
          data: {
            biz_code: 0,
            biz_data: {
              id: 'file-pending',
              status: 'PENDING',
              file_name: 'probe.png',
              file_size: 5,
              is_image: true,
            },
          },
        });
      }
      statusPolls += 1;
      return jsonResponse({
        code: 0,
        data: {
          biz_code: 0,
          biz_data: {
            files: [{
              id: 'file-pending',
              status: statusPolls === 1 ? 'PENDING' : 'SUCCESS',
              file_name: 'probe.png',
              file_size: 5,
              model_kind: statusPolls === 1 ? undefined : 'VISION',
              is_image: true,
            }],
          },
        },
      });
    });

    const result = await uploadDeepSeekWebVisionImage({
      file: new File(['probe'], 'probe.png', { type: 'image/png' }),
      clientHeaders: {},
      createPowHeaders: async () => ({}),
      fetchImpl,
      pollIntervalMs: 0,
      maxPollAttempts: 2,
    });

    expect(result.refFileId).toBe('file-pending');
    expect(statusPolls).toBe(2);
  });
});

describe('DeepSeek Web Vision routing', () => {
  it('forces Vision routing and disables incompatible flags when file refs are present', () => {
    expect(createDeepSeekWebVisionRoute({
      modelType: null,
      refFileIds: ['file-1'],
      thinkingEnabled: true,
      searchEnabled: true,
    })).toEqual({
      modelType: 'vision',
      refFileIds: ['file-1'],
      thinkingEnabled: false,
      searchEnabled: false,
    });
  });

  it('disables incompatible flags for explicit Vision mode before file refs exist', () => {
    expect(createDeepSeekWebVisionRoute({
      modelType: 'vision',
      refFileIds: [],
      thinkingEnabled: true,
      searchEnabled: true,
    })).toEqual({
      modelType: 'vision',
      refFileIds: [],
      thinkingEnabled: false,
      searchEnabled: false,
    });
  });

  it('preserves text-only routing when no file refs are present', () => {
    expect(createDeepSeekWebVisionRoute({
      modelType: 'expert',
      refFileIds: [],
      thinkingEnabled: true,
      searchEnabled: false,
    })).toEqual({
      modelType: 'expert',
      refFileIds: [],
      thinkingEnabled: true,
      searchEnabled: false,
    });
  });

  it('drops Vision file refs for text-only continuation turns', () => {
    expect(createDeepSeekWebVisionContinuationRoute()).toEqual({
      modelType: null,
      refFileIds: [],
      thinkingEnabled: false,
      searchEnabled: false,
    });
  });

  it('routes tool continuations through Vision when act-verify output includes refs', () => {
    expect(createDeepSeekWebVisionToolContinuationRoute({
      modelType: null,
      thinkingEnabled: true,
      searchEnabled: true,
      executions: [{
        name: 'browser_click',
        result: {
          ok: true,
          summary: 'Clicked',
          output: {
            refFileIds: ['file-actverify', 'file-actverify'],
            actVerify: { ok: true },
          },
        },
      }],
    })).toEqual({
      modelType: 'vision',
      refFileIds: ['file-actverify'],
      thinkingEnabled: false,
      searchEnabled: false,
    });
  });
});

describe('DeepSeek Web Vision serialized sidepanel images', () => {
  it('normalizes and decodes a serialized image payload into a transient File', () => {
    const payload = {
      name: 'probe.PNG',
      mimeType: 'image/png',
      sizeBytes: 5,
      dataUrl: `data:image/png;base64,${btoa('probe')}`,
    };

    expect(normalizeDeepSeekWebVisionSerializedImages([payload])).toEqual([payload]);

    const file = createDeepSeekWebVisionFileFromSerializedImage(payload);
    expect(file.name).toBe('probe.PNG');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(5);
  });

  it('rejects serialized images with unsupported types, invalid data URLs, or size mismatches', () => {
    expect(DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES.has('image/svg+xml')).toBe(false);
    expect(() => normalizeDeepSeekWebVisionSerializedImages({
      name: 'probe.png',
      mimeType: 'image/png',
      sizeBytes: 5,
      dataUrl: `data:image/png;base64,${btoa('probe')}`,
    })).toThrow(DeepSeekWebVisionUploadError);

    expect(() => normalizeDeepSeekWebVisionSerializedImages([{
      name: 'probe.svg',
      mimeType: 'image/svg+xml',
      sizeBytes: 5,
      dataUrl: `data:image/svg+xml;base64,${btoa('probe')}`,
    }])).toThrow(DeepSeekWebVisionUploadError);

    expect(() => createDeepSeekWebVisionFileFromSerializedImage({
      name: 'probe.png',
      mimeType: 'image/png',
      sizeBytes: 5,
      dataUrl: `data:image/jpeg;base64,${btoa('probe')}`,
    })).toThrow(DeepSeekWebVisionUploadError);

    expect(() => createDeepSeekWebVisionFileFromSerializedImage({
      name: 'probe.png',
      mimeType: 'image/png',
      sizeBytes: 6,
      dataUrl: `data:image/png;base64,${btoa('probe')}`,
    })).toThrow(DeepSeekWebVisionUploadError);

    expect(() => normalizeDeepSeekWebVisionSerializedImages([{
      name: 'large.png',
      mimeType: 'image/png',
      sizeBytes: DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES + 1,
      dataUrl: 'data:image/png;base64,AA==',
    }])).toThrow(DeepSeekWebVisionUploadError);

    expect(() => normalizeDeepSeekWebVisionSerializedImages(Array.from({ length: 5 }, (_, index) => ({
      name: `probe-${index}.png`,
      mimeType: 'image/png',
      sizeBytes: 5,
      dataUrl: `data:image/png;base64,${btoa('probe')}`,
    })))).toThrow(DeepSeekWebVisionUploadError);

    expect(() => normalizeDeepSeekWebVisionSerializedImages([{
      name: 'probe.png',
      mimeType: 'image/png',
      sizeBytes: 1,
      dataUrl: `data:image/png;base64,${btoa('x'.repeat(1024))}`,
    }])).toThrow(DeepSeekWebVisionUploadError);
  });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
}
