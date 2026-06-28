import { describe, expect, it } from 'vitest';
import {
  evaluateChromeRuntimePreflight,
  formatChromeRuntimePreflightReport,
  parsePsOutput,
} from '../scripts/chrome-runtime-preflight.mjs';

describe('chrome runtime preflight', () => {
  it('blocks live smoke when Chrome page and extension renderers are hot', () => {
    const processes = parsePsOutput(`
23997     1 114.5  8.6 8639808 07:47:56 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
43969 23997 108.8  1.7 1664064    23:04 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/149.0.7827.116/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --lang=en-US
54368 23997  31.3  1.6 1636592    22:27 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/149.0.7827.116/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --extension-process --lang=en-US
24004 23997   0.1  0.2 174528 07:47:56 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/149.0.7827.116/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --type=utility
`);

    const result = evaluateChromeRuntimePreflight(processes);

    expect(result.status).toBe('no-go');
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      'chrome_main_cpu_hot',
      'chrome_page_renderer_cpu_hot',
      'chrome_extension_renderer_cpu_hot',
    ]);
    expect(result.warnings.map((warning) => warning.code)).toContain('chrome_main_rss_high');
    expect(result.topProcesses[0]).toMatchObject({
      pid: 23997,
      kind: 'browser',
      pcpu: 114.5,
    });
  });

  it('returns go when Chrome renderers are below smoke thresholds', () => {
    const processes = parsePsOutput(`
23997     1  12.0  8.6 8639808 07:47:56 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
43969 23997  14.8  1.7 1664064    23:04 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/149.0.7827.116/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --lang=en-US
54368 23997   4.3  1.6 1636592    22:27 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/149.0.7827.116/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --extension-process --lang=en-US
`);

    const result = evaluateChromeRuntimePreflight(processes);

    expect(result.status).toBe('go');
    expect(result.blockers).toEqual([]);
  });

  it('reports high RSS as warnings without blocking live-smoke eligibility', () => {
    const processes = parsePsOutput(`
23997     1  12.0  8.6 9437184 07:47:56 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
43969 23997  14.8  1.7 3145728    23:04 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/149.0.7827.116/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --lang=en-US
54368 23997   4.3  1.6 1572864    22:27 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/149.0.7827.116/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --extension-process --lang=en-US
`);

    const result = evaluateChromeRuntimePreflight(processes);

    expect(result.status).toBe('go');
    expect(result.blockers).toEqual([]);
    expect(result.warnings.map((warning) => warning.code).sort()).toEqual([
      'chrome_extension_renderer_rss_high',
      'chrome_main_rss_high',
      'chrome_page_renderer_rss_high',
    ].sort());
    expect(result.warnings.find((warning) => warning.code === 'chrome_main_rss_high')).toMatchObject({
      pid: 23997,
      rssMb: 9216,
      threshold: 8192,
    });
  });

  it('formats no-go output with a non-automation warning', () => {
    const result = evaluateChromeRuntimePreflight(parsePsOutput(''));
    const report = formatChromeRuntimePreflightReport(result);

    expect(report).toContain('Chrome runtime preflight: NO-GO');
    expect(report).toContain('Memory warnings: browser >=');
    expect(report).toContain('Do not attach DevTools, automate Chrome, or run the live sidepanel smoke');
  });
});
