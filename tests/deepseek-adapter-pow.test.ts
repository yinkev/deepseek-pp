import { afterEach, describe, expect, it, vi } from 'vitest';

const powMocks = vi.hoisted(() => ({
  solvePowChallengeLocally: vi.fn(async (challenge: any) => ({
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    answer: 42,
    signature: challenge.signature,
  })),
}));

vi.mock('../core/deepseek/pow', () => ({
  solvePowChallengeLocally: powMocks.solvePowChallengeLocally,
}));

import { createPowHeaders } from '../core/deepseek/adapter';

describe('DeepSeek web adapter PoW headers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    powMocks.solvePowChallengeLocally.mockClear();
  });

  it('builds PoW headers for non-completion target paths', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        target_path: '/api/v0/file/upload_file',
      });
      return jsonResponse({
        code: 0,
        data: {
          biz_code: 0,
          biz_data: {
            challenge: {
              algorithm: 'DeepSeekHashV1',
              challenge: 'a'.repeat(64),
              salt: 'salt',
              difficulty: 144000,
              signature: 'signature',
              expire_at: 1781948243138,
              expire_after: 300000,
            },
          },
        },
      });
    }));

    const headers = await createPowHeaders(
      { Authorization: 'Bearer token' },
      { targetPath: '/api/v0/file/upload_file' },
    );
    const decoded = JSON.parse(atob(headers['X-DS-PoW-Response']));

    expect(decoded).toMatchObject({
      algorithm: 'DeepSeekHashV1',
      answer: 42,
      target_path: '/api/v0/file/upload_file',
    });
  });

  it('preserves abort errors from cancelled PoW work', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      code: 0,
      data: {
        biz_code: 0,
        biz_data: {
          challenge: {
            algorithm: 'DeepSeekHashV1',
            challenge: 'a'.repeat(64),
            salt: 'salt',
            difficulty: 144000,
            signature: 'signature',
            expire_at: 1781948243138,
            expire_after: 300000,
          },
        },
      },
    })));
    powMocks.solvePowChallengeLocally.mockImplementationOnce(async (challenge: any) => {
      controller.abort();
      return {
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        salt: challenge.salt,
        answer: 42,
        signature: challenge.signature,
      };
    });

    await expect(createPowHeaders(
      { Authorization: 'Bearer token' },
      { targetPath: '/api/v0/file/upload_file', signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}
