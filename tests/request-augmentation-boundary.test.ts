import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Content request augmentation boundary', () => {
  it('decodes the body before correlation state or privileged work begins', () => {
    const source = readFileSync('entrypoints/content.ts', 'utf8');
    const start = source.indexOf('async function handleAugmentRequestBody');
    const end = source.indexOf('\nasync function resolveProjectContextForRequestBody', start);
    const handler = source.slice(start, end);
    const decodeIndex = handler.indexOf('decodeDeepSeekRequestBody(data.body)');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(decodeIndex).toBeGreaterThanOrEqual(0);
    for (const privilegedOperation of [
      'pendingToolAuthorizationCorrelations.begin',
      'consumePendingMultimodalMediaForRequest',
      'createContentToolAuthorization',
      'resolveProjectContextForRequestBody',
      "type: 'TOUCH_MEMORIES'",
    ]) {
      expect(handler.indexOf(privilegedOperation), privilegedOperation).toBeGreaterThan(decodeIndex);
    }
  });
});
