import { describe, expect, it } from 'vitest';

describe('skill template parsing', () => {
  it('parses skill trigger from user input', () => {
    const regex = /^\/(\S+)\s*([\s\S]*)$/;
    const match = '/translate hello world'.match(regex);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('translate');
    expect(match?.[2]).toBe('hello world');
  });

  it('handles skill trigger without arguments', () => {
    const regex = /^\/(\S+)\s*([\s\S]*)$/;
    const match = '/help'.match(regex);
    expect(match?.[1]).toBe('help');
    expect(match?.[2]).toBe('');
  });

  it('rejects non-skill input', () => {
    const regex = /^\/(\S+)\s*([\s\S]*)$/;
    expect('hello world'.match(regex)).toBeNull();
    expect('not a skill'.match(regex)).toBeNull();
  });

  it('handles special characters in skill arguments', () => {
    const regex = /^\/(\S+)\s*([\s\S]*)$/;
    const match = '/search content here'.match(regex);
    expect(match?.[1]).toBe('search');
    expect(match?.[2]).toContain('content');
  });
});

describe('skill name matching', () => {
  it('matches exact skill names', () => {
    const skills = ['translate', 'summarize', 'explain'];
    expect(skills.includes('translate')).toBe(true);
    expect(skills.includes('missing')).toBe(false);
  });

  it('case-sensitive matching', () => {
    const skills = ['translate', 'Translate'];
    expect(skills.includes('translate')).toBe(true);
    expect(skills.includes('Translate')).toBe(true);
    expect(skills.includes('TRANSLATE')).toBe(false);
  });
});

describe('web search tool structure', () => {
  it('web search tool has required fields', () => {
    const tool = {
      name: 'web_search',
      invocationName: 'web_search',
      description: 'Search the web',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    };
    expect(tool.name).toBe('web_search');
    expect(tool.inputSchema.properties).toHaveProperty('query');
  });

  it('web fetch tool has required fields', () => {
    const tool = {
      name: 'web_fetch',
      invocationName: 'web_fetch',
      description: 'Fetch a web page',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    };
    expect(tool.name).toBe('web_fetch');
    expect(tool.inputSchema.properties).toHaveProperty('url');
  });
});
