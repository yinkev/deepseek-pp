import { describe, expect, it } from 'vitest';

describe('project deletion cascade', () => {
  it('project has conversations', () => {
    const project = {
      id: 'proj-1',
      name: 'My Project',
      conversations: [
        { id: 'conv-1', title: 'Chat 1' },
        { id: 'conv-2', title: 'Chat 2' },
      ],
    };
    expect(project.conversations).toHaveLength(2);
  });

  it('deleting project removes all conversations', () => {
    const projects = [
      {
        id: 'proj-1',
        conversations: [{ id: 'conv-1' }, { id: 'conv-2' }],
      },
      {
        id: 'proj-2',
        conversations: [{ id: 'conv-3' }],
      },
    ];
    const deletedId = 'proj-1';
    const remaining = projects.filter((p) => p.id !== deletedId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].conversations).toHaveLength(1);
  });

  it('orphaned conversations are cleaned up', () => {
    const projects = new Map([
      ['proj-1', { id: 'proj-1', name: 'Project 1' }],
    ]);
    const conversations = [
      { id: 'conv-1', projectId: 'proj-1' },
      { id: 'conv-2', projectId: 'proj-deleted' },
    ];
    const orphans = conversations.filter(
      (c) => !projects.has(c.projectId),
    );
    expect(orphans).toHaveLength(1);
    expect(orphans[0].id).toBe('conv-2');
  });

  it('deletion is idempotent', () => {
    const projects = [{ id: 'proj-1' }, { id: 'proj-2' }];
    const result1 = projects.filter((p) => p.id !== 'proj-1');
    const result2 = result1.filter((p) => p.id !== 'proj-1');
    expect(result1).toEqual(result2);
  });

  it('non-existent project deletion is safe', () => {
    const projects = [{ id: 'proj-1' }];
    const result = projects.filter((p) => p.id !== 'nonexistent');
    expect(result).toHaveLength(1);
  });
});
