import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/skill/registry', () => ({
  getAllSkillSources: vi.fn(async () => []),
  getGitHubSkillSourceById: vi.fn(),
  getSkillLibrary: vi.fn(async () => []),
  saveGitHubSkillSource: vi.fn(),
  upsertGitHubSkillSource: vi.fn(async (_source, incomingSkills) => ({
    imported: incomingSkills,
    replaced: 0,
    renamed: 0,
  })),
}));

import { importGitHubSkillSource, previewGitHubSkillSource } from '../core/skill/github-importer';

const API = 'https://api.github.com';

describe('GitHub Skill importer', () => {
  let fetchCalls: string[];

  beforeEach(() => {
    fetchCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      return createGitHubResponse(url);
    }));
    vi.stubGlobal('atob', (value: string) => Buffer.from(value, 'base64').toString('binary'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('previews supporting file metadata without fetching every resource body', async () => {
    const preview = await previewGitHubSkillSource('https://github.com/acme/skills');

    expect(preview.skills).toHaveLength(2);
    expect(preview.skills[0]).toMatchObject({
      path: 'alpha/SKILL.md',
      importName: 'alpha',
      includedFiles: [{ path: 'alpha/references/guide.md', bytes: 18 }],
    });
    expect(fetchCalls).toContain(`${API}/repos/acme/skills/contents/alpha/SKILL.md?ref=main`);
    expect(fetchCalls).toContain(`${API}/repos/acme/skills/contents/beta/SKILL.md?ref=main`);
    expect(fetchCalls).not.toContain(`${API}/repos/acme/skills/contents/alpha/references/guide.md?ref=main`);
    expect(fetchCalls).not.toContain(`${API}/repos/acme/skills/contents/beta/references/guide.md?ref=main`);
  });

  it('fetches resource bodies only for selected imported Skills', async () => {
    const result = await importGitHubSkillSource({
      url: 'https://github.com/acme/skills',
      selectedPaths: ['alpha/SKILL.md'],
    });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].instructions).toContain('### alpha/references/guide.md');
    expect(result.imported[0].instructions).toContain('Alpha guide text.');
    expect(fetchCalls).toContain(`${API}/repos/acme/skills/contents/alpha/references/guide.md?ref=main`);
    expect(fetchCalls).not.toContain(`${API}/repos/acme/skills/contents/beta/SKILL.md?ref=main`);
    expect(fetchCalls).not.toContain(`${API}/repos/acme/skills/contents/beta/references/guide.md?ref=main`);
  });
});

function createGitHubResponse(url: string): Response {
  const path = url.startsWith(API) ? url.slice(API.length) : url;
  if (path === '/repos/acme/skills') {
    return json({
      full_name: 'acme/skills',
      html_url: 'https://github.com/acme/skills',
      default_branch: 'main',
      description: 'Skill library',
      license: { spdx_id: 'MIT', name: 'MIT' },
    });
  }
  if (path === '/repos/acme/skills/commits/main') {
    return json({ sha: 'commit-main' });
  }
  if (path === '/repos/acme/skills/git/trees/main?recursive=1') {
    return json({
      sha: 'tree-main',
      truncated: false,
      tree: [
        { type: 'blob', path: 'alpha/SKILL.md', size: 89, mode: '100644', sha: 'a', url: '' },
        { type: 'blob', path: 'alpha/references/guide.md', size: 18, mode: '100644', sha: 'b', url: '' },
        { type: 'blob', path: 'beta/SKILL.md', size: 87, mode: '100644', sha: 'c', url: '' },
        { type: 'blob', path: 'beta/references/guide.md', size: 17, mode: '100644', sha: 'd', url: '' },
      ],
    });
  }
  if (path === '/repos/acme/skills/contents/alpha/SKILL.md?ref=main') {
    return content('alpha/SKILL.md', [
      '---',
      'name: alpha',
      'description: Alpha Skill',
      '---',
      '',
      '# Alpha',
      '',
      'Read alpha/references/guide.md.',
    ].join('\n'));
  }
  if (path === '/repos/acme/skills/contents/beta/SKILL.md?ref=main') {
    return content('beta/SKILL.md', [
      '---',
      'name: beta',
      'description: Beta Skill',
      '---',
      '',
      '# Beta',
      '',
      'Read beta/references/guide.md.',
    ].join('\n'));
  }
  if (path === '/repos/acme/skills/contents/alpha/references/guide.md?ref=main') {
    return content('alpha/references/guide.md', 'Alpha guide text.');
  }
  if (path === '/repos/acme/skills/contents/beta/references/guide.md?ref=main') {
    return content('beta/references/guide.md', 'Beta guide text.');
  }
  return new Response('not found', { status: 404 });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function content(path: string, body: string): Response {
  return json({
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(body, 'utf8').toString('base64'),
    size: Buffer.byteLength(body, 'utf8'),
    path,
    name: path.split('/').pop() ?? path,
  });
}
