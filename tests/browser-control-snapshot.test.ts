import { describe, expect, it } from 'vitest';
import { formatAccessibilitySnapshot, type FormattedSnapshot } from '../core/browser-control/snapshot';

interface AxNodeInput {
  nodeId?: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  description?: { value?: unknown };
  backendDOMNodeId?: number;
  childIds?: string[];
  properties?: Array<{ name?: string; value?: { value?: unknown } }>;
}

function ax(overrides: Partial<AxNodeInput> = {}): AxNodeInput {
  return {
    nodeId: '1',
    role: { value: 'node' },
    ...overrides,
  };
}

function format(nodes: AxNodeInput[], opts: { maxNodes?: number; maxTextBytes?: number } = {}): FormattedSnapshot {
  return formatAccessibilitySnapshot({
    axNodes: nodes,
    snapshotId: 'snap-1',
    targetLeaseId: 'lease-1',
    capturedAt: 1000,
    url: 'https://example.com/',
    title: 'Example',
    maxNodes: opts.maxNodes ?? 400,
    maxTextBytes: opts.maxTextBytes ?? 24_000,
  });
}

describe('formatAccessibilitySnapshot', () => {
  it('empty axNodes produces snapshot with header text only', () => {
    const result = format([]);
    expect(result.result.nodes).toHaveLength(0);
    expect(result.result.truncated).toBe(false);
    expect(result.result.text).toContain('Snapshot ID: snap-1');
    expect(result.result.text).toContain('Target Lease ID: lease-1');
    expect(result.result.text).toContain('URL: https://example.com/');
    expect(result.result.text).toContain('Title: Example');
  });

  it('single node with role and name formats correctly', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'button' }, name: { value: 'Submit' } }),
    ]);
    expect(result.result.nodes).toHaveLength(1);
    expect(result.result.nodes[0]).toMatchObject({
      uid: 'e1',
      role: 'button',
      name: 'Submit',
      level: 0,
    });
    expect(result.result.text).toContain('[e1] button "Submit"');
  });

  it('node hierarchy with childIds produces indented output', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Page' }, childIds: ['2'] }),
      ax({ nodeId: '2', role: { value: 'button' }, name: { value: 'Click' } }),
    ]);
    expect(result.result.nodes).toHaveLength(2);
    expect(result.result.nodes[0].level).toBe(0);
    expect(result.result.nodes[1].level).toBe(1);
  });

  it('ignored nodes are filtered out', () => {
    const result = format([
      ax({ nodeId: '1', ignored: true, role: { value: 'button' }, name: { value: 'Hidden' } }),
      ax({ nodeId: '2', role: { value: 'text' }, name: { value: 'Visible' } }),
    ]);
    expect(result.result.nodes).toHaveLength(1);
    expect(result.result.nodes[0].name).toBe('Visible');
  });

  it('nodes without role/name/value/description are excluded', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'generic' } }),
    ]);
    expect(result.result.nodes).toHaveLength(0);
  });

  it('generic node with name is included', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'generic' }, name: { value: 'Container' } }),
    ]);
    expect(result.result.nodes).toHaveLength(1);
  });

  it('none node without name/value is excluded', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'none' } }),
    ]);
    expect(result.result.nodes).toHaveLength(0);
  });

  it('none node with name is included', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'none' }, name: { value: 'Spacer' } }),
    ]);
    expect(result.result.nodes).toHaveLength(1);
  });

  it('maxNodes budget truncates and sets truncated=true', () => {
    const result = format(
      [
        ax({ nodeId: '1', role: { value: 'button' }, name: { value: 'A' } }),
        ax({ nodeId: '2', role: { value: 'button' }, name: { value: 'B' } }),
        ax({ nodeId: '3', role: { value: 'button' }, name: { value: 'C' } }),
      ],
      { maxNodes: 2 },
    );
    expect(result.result.nodes).toHaveLength(2);
    expect(result.result.truncated).toBe(true);
    expect(result.result.text).toContain('...[snapshot truncated]');
  });

  it('maxTextBytes budget truncates and sets truncated=true', () => {
    const result = format(
      [
        ax({ nodeId: '1', role: { value: 'button' }, name: { value: 'A' } }),
        ax({ nodeId: '2', role: { value: 'button' }, name: { value: 'B' } }),
        ax({ nodeId: '3', role: { value: 'button' }, name: { value: 'C' } }),
      ],
      { maxTextBytes: 120 },
    );
    expect(result.result.truncated).toBe(true);
    expect(result.result.text).toContain('...[snapshot truncated]');
  });

  it('backend node IDs map to uid strings', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'button' }, name: { value: 'A' }, backendDOMNodeId: 10 }),
      ax({ nodeId: '2', role: { value: 'button' }, name: { value: 'B' }, backendDOMNodeId: 20 }),
    ]);
    expect(result.uidToBackendNodeId.get('e1')).toBe(10);
    expect(result.uidToBackendNodeId.get('e2')).toBe(20);
  });

  it('nodes without backendDOMNodeId are not in uid map', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'button' }, name: { value: 'A' } }),
    ]);
    expect(result.uidToBackendNodeId.has('e1')).toBe(false);
  });

  it('properties (disabled, focused, selected, checked) are extracted', () => {
    const result = format([
      ax({
        nodeId: '1',
        role: { value: 'checkbox' },
        name: { value: 'Accept' },
        properties: [
          { name: 'disabled', value: { value: true } },
          { name: 'focused', value: { value: true } },
          { name: 'selected', value: { value: false } },
          { name: 'checked', value: { value: true } },
        ],
      }),
    ]);
    expect(result.result.nodes[0]).toMatchObject({
      disabled: true,
      focused: true,
      selected: false,
      checked: true,
    });
  });

  it('mixed checked value normalizes correctly', () => {
    const result = format([
      ax({
        nodeId: '1',
        role: { value: 'checkbox' },
        name: { value: 'Mixed' },
        properties: [{ name: 'checked', value: { value: 'mixed' } }],
      }),
    ]);
    expect(result.result.nodes[0].checked).toBe('mixed');
  });

  it('false checked value normalizes correctly', () => {
    const result = format([
      ax({
        nodeId: '1',
        role: { value: 'checkbox' },
        name: { value: 'Unchecked' },
        properties: [{ name: 'checked', value: { value: false } }],
      }),
    ]);
    expect(result.result.nodes[0].checked).toBe(false);
  });

  it('value and description fields are captured', () => {
    const result = format([
      ax({
        nodeId: '1',
        role: { value: 'textbox' },
        name: { value: 'Email' },
        value: { value: 'test@example.com' },
        description: { value: 'Enter your email' },
      }),
    ]);
    expect(result.result.nodes[0]).toMatchObject({
      value: 'test@example.com',
      description: 'Enter your email',
    });
  });

  it('circular references in childIds do not cause infinite loop', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'node' }, name: { value: 'A' }, childIds: ['2'] }),
      ax({ nodeId: '2', role: { value: 'node' }, name: { value: 'B' }, childIds: ['1'] }),
    ]);
    expect(result.result.nodes.length).toBeLessThanOrEqual(2);
    expect(result.result.truncated).toBe(false);
  });

  it('deep tree traversal processes all levels', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'root' }, childIds: ['2'] }),
      ax({ nodeId: '2', role: { value: 'level1' }, childIds: ['3'] }),
      ax({ nodeId: '3', role: { value: 'level2' }, childIds: ['4'] }),
      ax({ nodeId: '4', role: { value: 'level3' } }),
    ]);
    expect(result.result.nodes).toHaveLength(4);
    expect(result.result.nodes.map((n) => n.level)).toEqual([0, 1, 2, 3]);
  });

  it('snapshot text includes uid in brackets', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'button' }, name: { value: 'Go' } }),
    ]);
    expect(result.result.text).toContain('[e1]');
  });

  it('uid assignments are sequential', () => {
    const result = format([
      ax({ nodeId: '10', role: { value: 'a' } }),
      ax({ nodeId: '20', role: { value: 'b' } }),
      ax({ nodeId: '30', role: { value: 'c' } }),
    ]);
    expect(result.result.nodes.map((n) => n.uid)).toEqual(['e1', 'e2', 'e3']);
  });

  it('handles numeric role values', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 42 }, name: { value: 'Test' } }),
    ]);
    expect(result.result.nodes[0].role).toBe('42');
  });

  it('handles boolean name values', () => {
    const result = format([
      ax({ nodeId: '1', role: { value: 'node' }, name: { value: true } }),
    ]);
    expect(result.result.nodes[0].name).toBe('true');
  });

  it('node properties without name are skipped', () => {
    const result = format([
      ax({
        nodeId: '1',
        role: { value: 'button' },
        properties: [
          { value: { value: 'orphan' } },
          { name: 'disabled', value: { value: true } },
        ],
      }),
    ]);
    expect(result.result.nodes[0].disabled).toBe(true);
  });

  it('formats snapshot line with checked attribute', () => {
    const result = format([
      ax({
        nodeId: '1',
        role: { value: 'checkbox' },
        name: { value: 'Check' },
        properties: [{ name: 'checked', value: { value: true } }],
      }),
    ]);
    expect(result.result.text).toContain('checked=true');
  });

  it('formats snapshot line with selected attribute', () => {
    const result = format([
      ax({
        nodeId: '1',
        role: { value: 'option' },
        name: { value: 'Opt' },
        properties: [{ name: 'selected', value: { value: true } }],
      }),
    ]);
    expect(result.result.text).toContain('selected');
  });

  it('formats snapshot line with disabled attribute', () => {
    const result = format([
      ax({
        nodeId: '1',
        role: { value: 'button' },
        name: { value: 'Off' },
        properties: [{ name: 'disabled', value: { value: true } }],
      }),
    ]);
    expect(result.result.text).toContain('disabled');
  });

  it('formats snapshot line with focused attribute', () => {
    const result = format([
      ax({
        nodeId: '1',
        role: { value: 'textbox' },
        name: { value: 'Input' },
        properties: [{ name: 'focused', value: { value: true } }],
      }),
    ]);
    expect(result.result.text).toContain('focused');
  });

  it('formats snapshot line with value', () => {
    const result = format([
      ax({
        nodeId: '1',
        role: { value: 'textbox' },
        name: { value: 'Name' },
        value: { value: 'John' },
      }),
    ]);
    expect(result.result.text).toContain('value="John"');
  });

  it('maxTextBytes=0 causes immediate truncation', () => {
    const result = format(
      [ax({ nodeId: '1', role: { value: 'node' } })],
      { maxTextBytes: 0 },
    );
    expect(result.result.truncated).toBe(true);
  });

  it('result contains snapshotId, targetLeaseId, capturedAt, url, title', () => {
    const result = format([]);
    expect(result.result).toMatchObject({
      snapshotId: 'snap-1',
      targetLeaseId: 'lease-1',
      capturedAt: 1000,
      url: 'https://example.com/',
      title: 'Example',
    });
  });
});
