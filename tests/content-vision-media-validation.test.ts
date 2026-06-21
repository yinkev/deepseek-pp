import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('content DeepSeek Web Vision media validation', () => {
  it('uses the shared Vision upload limits instead of legacy multimodal limits', () => {
    const source = readFileSync(join(process.cwd(), 'entrypoints/content.ts'), 'utf8');

    expect(source).toContain('DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES');
    expect(source).toContain('DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES');
    expect(source).toContain('DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN');
    expect(source).toContain('existing + mediaFiles.length > DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN');
    expect(source).toContain('!DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES.has(file.type)');
    expect(source).toContain('formatMultimodalMediaBytes(DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES)');
    expect(source).not.toContain('MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN');
    expect(source).not.toContain('MULTIMODAL_MEDIA_IMAGE_MAX_BYTES');
  });
});
