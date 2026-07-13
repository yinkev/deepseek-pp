import { describe, expect, it } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import { createSandboxToolDescriptors } from '../core/sandbox';
import { extractToolCalls, stripToolCalls } from '../core/interceptor/tool-parser';

describe('tool-parser XML fallback', () => {
  const descriptors = createArtifactToolDescriptors('en');
  const sandboxXml = [
    '<sandbox_run>',
    JSON.stringify({
      language: 'javascript',
      code: 'const xs = [3, 1, 4, 1, 5, 9, 2, 6]; return xs.reduce((a, b) => a + b, 0);',
    }),
    '</sandbox_run>',
  ].join('');

  it('parses and strips whitespace-padded direct tool tags', () => {
    const text = [
      'Before ',
      '< artifact_create >',
      JSON.stringify({ filename: 'demo.html', content: '<canvas></canvas>' }),
      '</ artifact_create >',
      ' after',
    ].join('');

    const calls = extractToolCalls(text, { descriptors });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'artifact_create',
      payload: { filename: 'demo.html', content: '<canvas></canvas>' },
    });
    expect(stripToolCalls(text, { descriptors })).toBe('Before  after');
  });

  it('ignores sandbox_run XML without a sandbox descriptor and parses it when present', () => {
    expect(extractToolCalls(sandboxXml, { descriptors })).toEqual([]);
    expect(stripToolCalls(`Visible ${sandboxXml} end`, { descriptors })).toBe(`Visible ${sandboxXml} end`);

    const withSandbox = extractToolCalls(sandboxXml, {
      descriptors: createSandboxToolDescriptors('en'),
    });
    expect(withSandbox).toHaveLength(1);
    expect(withSandbox[0]).toMatchObject({
      name: 'sandbox_run',
      payload: {
        language: 'javascript',
        code: 'const xs = [3, 1, 4, 1, 5, 9, 2, 6]; return xs.reduce((a, b) => a + b, 0);',
      },
    });
  });
});
