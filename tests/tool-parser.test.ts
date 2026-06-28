import { describe, expect, it } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import { createBrowserControlToolDescriptors } from '../core/browser-control/tool';
import { extractToolCalls, stripToolCalls } from '../core/interceptor/tool-parser';

describe('tool-parser XML fallback', () => {
  const descriptors = createArtifactToolDescriptors('en');

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

  it('parses and strips plain tool_calls invoke wrappers', () => {
    const browserDescriptors = createBrowserControlToolDescriptors('en');
    const text = [
      'Before ',
      '<tool_calls>',
      '<invoke name="browser_snapshot">',
      '<parameter name="targetLeaseId"></parameter>',
      '<parameter name="snapshotId"></parameter>',
      '</invoke>',
      '<invoke name="browser_evaluate_script">',
      '<parameter name="script"></parameter>',
      '</invoke>',
      '</tool_calls>',
      ' after',
    ].join('');

    const calls = extractToolCalls(text, { descriptors: browserDescriptors });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'browser_snapshot',
      payload: {},
    });
    expect(stripToolCalls(text, { descriptors: browserDescriptors })).toBe('Before  after');
  });

  it('parses non-empty plain wrapper parameters', () => {
    const browserDescriptors = createBrowserControlToolDescriptors('en');
    const text = [
      '<tool_calls>',
      '<invoke name="browser_evaluate_script">',
      '<parameter name="script" string="true">document.title</parameter>',
      '<parameter name="awaitPromise" string="false">false</parameter>',
      '</invoke>',
      '</tool_calls>',
    ].join('');

    const calls = extractToolCalls(text, { descriptors: browserDescriptors });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'browser_evaluate_script',
      payload: { script: 'document.title', awaitPromise: false },
    });
  });

  it('parses whitespace-padded plain wrappers and skips empty configurable invokes', () => {
    const browserDescriptors = createBrowserControlToolDescriptors('en');
    const text = [
      '< tool_calls >',
      '< invoke name="browser_snapshot" >',
      '</ invoke >',
      '< invoke name="browser_evaluate_script" >',
      '</ invoke >',
      '</ tool_calls >',
    ].join('');

    const calls = extractToolCalls(text, { descriptors: browserDescriptors });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'browser_snapshot',
      payload: {},
    });
    expect(stripToolCalls(text, { descriptors: browserDescriptors })).toBe('');
  });
});
