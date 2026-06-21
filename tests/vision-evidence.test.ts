import { describe, expect, it } from 'vitest';
import { createDeepSeekWebVisionEvidencePack } from '../core/deepseek/vision-evidence';

describe('DeepSeek Web Vision evidence packs', () => {
  it('stores metadata-only visual evidence without raw media or auth fields', () => {
    const pack = createDeepSeekWebVisionEvidencePack({
      kind: 'browser_act_verify',
      createdAt: 123,
      refFileIds: ['file-1'],
      webVisionFiles: [{
        id: 'file-1',
        name: 'screen.png',
        size: 100,
        mimeType: 'image/png',
        status: 'SUCCESS',
        modelKind: 'VISION',
        isImage: true,
        auditResult: 'pass',
        width: 10,
        height: 20,
      }],
      source: {
        toolName: 'browser_click',
        tabId: 12,
        windowId: 1,
      },
      image: {
        name: 'screen.png',
        mimeType: 'image/png',
        sizeBytes: 100,
      },
      prompt: 'I just clicked Save. Check whether the page looks saved before deciding the next step.',
    });

    const json = JSON.stringify(pack);

    expect(pack).toMatchObject({
      schemaVersion: 1,
      id: expect.stringMatching(/^vision-evidence-browser_act_verify-123-/),
      kind: 'browser_act_verify',
      storage: 'metadata_only',
      rawImageStored: false,
      refFileIds: ['file-1'],
    });
    expect(json).not.toMatch(/data:image|base64|blob:|Authorization|Bearer|Cookie|signedPath|signed_path/);
  });
});
