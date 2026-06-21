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

  it('routes image-only attachments through DeepSeek Web Vision instead of legacy MCP analysis', () => {
    const source = readFileSync(join(process.cwd(), 'entrypoints/content.ts'), 'utf8');
    const requestBlock = extractFunction(source, 'consumePendingMultimodalMediaForRequest');
    const visionBlock = extractFunction(source, 'consumePendingDeepSeekWebVisionImages');

    expect(requestBlock).toContain('media.every((item) => item.kind === \'image\')');
    expect(requestBlock).toContain('consumePendingDeepSeekWebVisionImages(body, media, options)');

    expect(visionBlock).toContain('uploadDeepSeekWebVisionImage');
    expect(visionBlock).toContain('createDeepSeekWebVisionRoute');
    expect(visionBlock).toContain('body.model_type = route.modelType');
    expect(visionBlock).toContain('body.ref_file_ids = route.refFileIds');
    expect(visionBlock).toContain('body.thinking_enabled = route.thinkingEnabled');
    expect(visionBlock).toContain('body.search_enabled = route.searchEnabled');
    expect(visionBlock).not.toContain('ANALYZE_MULTIMODAL_MEDIA');
    expect(visionBlock).not.toContain('buildMultimodalAnalysisPrompt');
  });
});

function extractFunction(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  const bodyStart = source.indexOf(' {\n', start);
  expect(bodyStart).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = bodyStart + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`Could not extract ${name}.`);
}
