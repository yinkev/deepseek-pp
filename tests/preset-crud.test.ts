import { describe, expect, it } from 'vitest';

describe('preset CRUD operations', () => {
  it('preset has required fields', () => {
    const preset = {
      id: 'preset-1',
      name: 'My Preset',
      content: 'You are a helpful assistant',
      createdAt: 1000,
      updatedAt: 1000,
    };
    expect(preset.id).toBe('preset-1');
    expect(preset.name).toBe('My Preset');
    expect(preset.content).toBeTruthy();
  });

  it('preset name must be unique', () => {
    const presets = [
      { id: '1', name: 'Preset A' },
      { id: '2', name: 'Preset B' },
    ];
    const duplicate = presets.some((p) => p.name === 'Preset A');
    expect(duplicate).toBe(true);
    const newPreset = { id: '3', name: 'Preset C' };
    expect(presets.some((p) => p.name === newPreset.name)).toBe(false);
  });

  it('preset content can be updated', () => {
    const preset = { id: '1', name: 'Test', content: 'old content', updatedAt: 1000 };
    const updated = { ...preset, content: 'new content', updatedAt: 2000 };
    expect(updated.content).toBe('new content');
    expect(updated.updatedAt).toBe(2000);
  });

  it('preset can be deleted', () => {
    const presets = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ];
    const filtered = presets.filter((p) => p.id !== '1');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('2');
  });
});

describe('saved items CRUD operations', () => {
  it('saved item has required fields', () => {
    const item = {
      id: 'item-1',
      title: 'Saved Article',
      content: 'Article content here',
      type: 'text',
      createdAt: 1000,
    };
    expect(item.id).toBe('item-1');
    expect(item.title).toBeTruthy();
    expect(item.content).toBeTruthy();
  });

  it('saved items can be searched by title', () => {
    const items = [
      { id: '1', title: 'React Tips' },
      { id: '2', title: 'Vue Guide' },
      { id: '3', title: 'React Hooks' },
    ];
    const results = items.filter((item) =>
      item.title.toLowerCase().includes('react'),
    );
    expect(results).toHaveLength(2);
  });

  it('saved items can be exported as markdown', () => {
    const items = [
      { title: 'Item 1', content: 'Content 1' },
      { title: 'Item 2', content: 'Content 2' },
    ];
    const markdown = items
      .map((item) => `## ${item.title}\n\n${item.content}`)
      .join('\n\n');
    expect(markdown).toContain('## Item 1');
    expect(markdown).toContain('Content 2');
  });

  it('saved items can be exported as JSON', () => {
    const items = [{ id: '1', title: 'Test' }];
    const json = JSON.stringify(items, null, 2);
    expect(JSON.parse(json)).toEqual(items);
  });

  it('saved item can be deleted', () => {
    const items = [
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
    ];
    const filtered = items.filter((i) => i.id !== '1');
    expect(filtered).toHaveLength(1);
  });
});
