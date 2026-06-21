import { describe, expect, it } from 'vitest';
import { scanRuntimeDoctorStorage } from '../core/chat/runtime-doctor';

describe('runtime doctor storage scan', () => {
  it('flags forbidden DeepSeek Web transient storage without returning values', () => {
    const scan = scanRuntimeDoctorStorage({
      local: {
        deepseekCachedClientHeaders: { Authorization: 'Bearer local-secret' },
        deepseek_pp_sidepanel_web_chat_session: { chatSessionId: 'session-1' },
        deepseek_pp_sidepanel_web_auth_rejected: true,
      },
      session: {
        deepseekCachedClientHeaders: { Authorization: 'Bearer session-secret' },
        pending: { dataUrl: 'data:image/png;base64,AAAA' },
      },
    });

    expect(scan.ok).toBe(false);
    expect(scan.issues).toEqual([
      { area: 'local', path: 'deepseekCachedClientHeaders', reason: 'deepseek_web_headers' },
      { area: 'local', path: 'deepseek_pp_sidepanel_web_chat_session', reason: 'session_state_in_local_storage' },
      { area: 'local', path: 'deepseek_pp_sidepanel_web_auth_rejected', reason: 'auth_marker_in_local_storage' },
      { area: 'session', path: 'pending.dataUrl', reason: 'raw_image_data' },
    ]);
    expect(JSON.stringify(scan)).not.toMatch(/Bearer|local-secret|session-secret|AAAA/);
  });

  it('allows the configured page background image but flags other durable image data', () => {
    const scan = scanRuntimeDoctorStorage({
      local: {
        deepseek_pp_background: {
          imageData: 'data:image/png;base64,AAAA',
        },
        savedVisionImage: {
          imageData: 'data:image/png;base64,BBBB',
        },
        objectUrl: 'blob:extension/object',
      },
    });

    expect(scan.issues).toEqual([
      { area: 'local', path: 'savedVisionImage.imageData', reason: 'raw_image_data' },
      { area: 'local', path: 'objectUrl', reason: 'raw_image_data' },
    ]);
  });

  it('flags nested Authorization bearer values, signed URLs, and redacts unsafe path segments', () => {
    const scan = scanRuntimeDoctorStorage({
      local: {
        'https://signed.example/private?token=abc': {
          Authorization: 'Bearer nested-secret',
          'X-DS-PoW-Response': 'pow-secret',
          'X-Api-Key': 'api-secret',
          signedUrl: 'https://files.example/signed/path?token=secret',
        },
      },
    });

    expect(scan.issues).toEqual([
      { area: 'local', path: '[redacted].[redacted].Authorization', reason: 'deepseek_web_headers' },
      { area: 'local', path: '[redacted].[redacted].X-DS-PoW-Response', reason: 'deepseek_web_headers' },
      { area: 'local', path: '[redacted].[redacted].X-Api-Key', reason: 'deepseek_web_headers' },
      { area: 'local', path: '[redacted].[redacted].[redacted]', reason: 'deepseek_web_headers' },
    ]);
    expect(JSON.stringify(scan)).not.toMatch(/signed\.example|files\.example|token=abc|nested-secret|pow-secret|api-secret|secret/);
  });

  it('flags embedded image data and base64-key markers inside longer strings', () => {
    const scan = scanRuntimeDoctorStorage({
      local: {
        note: 'prefix data:image/png;base64,AAAA suffix',
        recorder: {
          summary: 'payload mentions dataBase64 and should not be stored durably',
        },
        nested: {
          value: 'base64Data: BBBB',
        },
      },
    });

    expect(scan.ok).toBe(false);
    expect(scan.issues).toEqual([
      { area: 'local', path: 'note', reason: 'raw_image_data' },
      { area: 'local', path: 'recorder.summary', reason: 'raw_image_data' },
      { area: 'local', path: 'nested.value', reason: 'raw_image_data' },
    ]);
    expect(JSON.stringify(scan)).not.toMatch(/AAAA|BBBB|data:image/);
  });

  it('treats storage read failures as scan issues instead of clean state', () => {
    const scan = scanRuntimeDoctorStorage({
      failedAreas: ['local'],
      session: {},
    });

    expect(scan.ok).toBe(false);
    expect(scan.issues).toEqual([
      { area: 'local', path: '(unavailable)', reason: 'storage_read_failed' },
    ]);
  });

  it('allows personal last-session pointer metadata without treating it as live session state', () => {
    const scan = scanRuntimeDoctorStorage({
      local: {
        deepseek_pp_deepseek_web_session_preference: {
          lastSession: {
            chatSessionId: 'session-remembered',
            parentMessageId: 42,
            source: 'sidepanel',
            updatedAt: 1234,
          },
        },
      },
    });

    expect(scan.ok).toBe(true);
    expect(scan.issues).toEqual([]);
  });

  it('flags vision refs outside allowed automation prompt option storage', () => {
    const scan = scanRuntimeDoctorStorage({
      local: {
        deepseek_pp_automations: {
          automations: [{
            promptOptions: {
              refFileIds: ['file-allowedref'],
              webVisionFiles: [{ id: 'file-allowedref', name: 'screen.png' }],
              visualEvidencePacks: [{
                refFileIds: ['file-allowedref'],
                webVisionFiles: [{ id: 'file-allowedref', name: 'screen.png' }],
              }],
            },
          }],
          runs: [{
            request: {
              promptOptions: {
                refFileIds: ['file-allowedref'],
                webVisionFiles: [{ id: 'file-allowedref', name: 'screen.png' }],
              },
            },
            result: {
              toolExecutions: [{
                result: {
                  output: {
                    refFileIds: ['file-leakedref'],
                    webVisionFiles: [{ id: 'file-leakedref' }],
                  },
                },
              }],
            },
          }],
        },
      },
    });

    expect(scan.issues).toEqual([
      {
        area: 'local',
        path: 'deepseek_pp_automations.runs[0].result.toolExecutions[0].result.output.refFileIds',
        reason: 'vision_ref_data',
      },
      {
        area: 'local',
        path: 'deepseek_pp_automations.runs[0].result.toolExecutions[0].result.output.webVisionFiles',
        reason: 'vision_ref_data',
      },
    ]);
  });
});
