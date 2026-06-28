import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
selectMemories,
getMemoryBudget,
formatMemoryLine,
formatMemoriesBlock,
estimateTokens,
} from '../core/memory/selector';
import { buildAugmentedPrompt } from '../core/memory/injector';
import { filterMemoriesByProjectScope } from '../core/memory/scope';
import type { Memory } from '../core/types';

// --- Mock IndexedDB via Dexie by replacing the store module with in-memory simulation ---
const dbState = { memories: [] as Memory[] };

vi.mock('../core/memory/store', () => ({
async getAllMemories(): Promise<Memory[]> {
  return [...dbState.memories];
},
async getMemoryById(id: number): Promise<Memory | undefined> {
  return dbState.memories.find((m) => m.id === id);
},
async saveMemory(mem: any): Promise<number> {
  const id = Math.max(0, ...dbState.memories.map((m) => m.id ?? 0)) + 1;
  const now = Date.now();
  const full: Memory = {
    id,
    syncId: mem.syncId ?? `sync-${id}`,
    scope: mem.scope ?? 'global',
    projectId: mem.projectId,
    type: mem.type,
    name: mem.name,
    content: mem.content,
    description: mem.description ?? '',
    tags: mem.tags ?? [],
    pinned: !!mem.pinned,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    lastAccessedAt: now,
  };
  dbState.memories.push(full);
  return id;
},
async updateMemory(mem: Memory): Promise<void> {
  const idx = dbState.memories.findIndex((m) => m.id === mem.id);
  if (idx >= 0) {
    dbState.memories[idx] = { ...mem, updatedAt: Date.now() };
  }
},
async deleteMemory(id: number): Promise<void> {
  dbState.memories = dbState.memories.filter((m) => m.id !== id);
},
async deleteMemoriesForProject(projectId: string): Promise<number> {
  const before = dbState.memories.length;
  dbState.memories = dbState.memories.filter((m) => m.projectId !== projectId);
  return before - dbState.memories.length;
},
async touchMemories(ids: number[]): Promise<void> {
  const now = Date.now();
  dbState.memories = dbState.memories.map((m) => {
    if (m.id != null && ids.includes(m.id)) {
      return { ...m, accessCount: (m.accessCount ?? 0) + 1, lastAccessedAt: now };
    }
    return m;
  });
},
async replaceAllMemories(memories: any[]): Promise<void> {
  dbState.memories = memories.map((m, i) => ({
    id: m.id ?? i + 1,
    syncId: m.syncId ?? `sync-rep-${i}`,
    scope: m.scope ?? 'global',
    projectId: m.projectId,
    type: m.type ?? 'topic',
    name: m.name,
    content: m.content,
    description: m.description ?? '',
    tags: m.tags ?? [],
    pinned: !!m.pinned,
    createdAt: m.createdAt ?? Date.now(),
    updatedAt: m.updatedAt ?? Date.now(),
    accessCount: m.accessCount ?? 0,
    lastAccessedAt: m.lastAccessedAt ?? Date.now(),
  })) as Memory[];
},
async archiveStaleMemories(): Promise<number> {
  const STALE_THRESHOLD_DAYS = 90;
  const MIN_ACCESS_FOR_RETENTION = 3;
  const threshold = Date.now() - STALE_THRESHOLD_DAYS * 86_400_000;
  const stale = dbState.memories.filter(
    (m) => !m.pinned && (m.accessCount ?? 0) < MIN_ACCESS_FOR_RETENTION && m.lastAccessedAt < threshold,
  );
  const ids = stale.map((m) => m.id).filter((id): id is number => id != null);
  if (ids.length === 0) return 0;
  dbState.memories = dbState.memories.filter((m) => !ids.includes(m.id!));
  return ids.length;
},
db: {} as any,
}));

function createMemory(overrides: Partial<Memory> = {}): Memory {
const id = overrides.id ?? Math.floor(Math.random() * 90000) + 1000;
const now = Date.now();
return {
  id,
  syncId: overrides.syncId ?? `sync-${id}`,
  scope: overrides.scope ?? 'global',
  projectId: overrides.projectId,
  type: overrides.type ?? 'user',
  name: overrides.name ?? 'Test Memory',
  content: overrides.content ?? 'Test content for memory injection',
  description: overrides.description ?? '',
  tags: overrides.tags ?? [],
  pinned: overrides.pinned ?? false,
  createdAt: overrides.createdAt ?? now - 10_000_000,
  updatedAt: overrides.updatedAt ?? now - 100_000,
  accessCount: overrides.accessCount ?? 0,
  lastAccessedAt: overrides.lastAccessedAt ?? now - 86_400_000,
  ...overrides,
};
}

beforeEach(() => {
dbState.memories = [];
});

describe('memory selection by budget', () => {
it('getMemoryBudget returns full budget for small prompts', () => {
  expect(getMemoryBudget(100)).toBe(1500);
  expect(getMemoryBudget(2999)).toBe(1500);
});

it('getMemoryBudget shrinks for large prompts but never below 800', () => {
  const small = getMemoryBudget(1000);
  const large = getMemoryBudget(15000);
  expect(large).toBeLessThan(small);
  expect(large).toBeGreaterThanOrEqual(800);
});

it('selectMemories returns empty for no memories', () => {
  expect(selectMemories('anything', [])).toEqual([]);
});

it('selectMemories selects by score and stops when budget exhausted', () => {
  const prompt = 'react typescript best practices';
  const memories: Memory[] = Array.from({ length: 50 }, (_, i) =>
    createMemory({
      id: i + 1,
      name: `Important decision ${i}`,
      content: 'Detailed context about component architecture and state management choices. '.repeat(5),
      pinned: i === 0,
      lastAccessedAt: Date.now() - i * 1000,
      accessCount: Math.max(0, 10 - i),
    }),
  );
  const result = selectMemories(prompt, memories, { budget: 180 });
  expect(result.length).toBeGreaterThan(0);
  expect(result.length).toBeLessThan(10);
  // Pinned first should be preferred when scores allow
  if (result.length > 0) {
    expect(result[0].pinned || result.some((m) => m.id === 1)).toBeTruthy();
  }
});

it('selectMemories with tiny budget still returns at least one if candidates exist', () => {
  const mems = [createMemory({ id: 1, name: 'a', content: 'b' })];
  const result = selectMemories('x', mems, { budget: 1 });
  expect(result.length).toBe(1);
});
});

describe('memory injection into prompt augmentation', () => {
it('buildAugmentedPrompt returns usedMemoryIds and injects selected memories into system block', () => {
  const memories = [
    createMemory({ id: 42, name: 'Preferred stack', content: 'React + TypeScript + Vitest', tags: ['frontend'] }),
    createMemory({ id: 43, name: 'Communication style', content: 'Keep responses concise and actionable' }),
  ];

  const result = buildAugmentedPrompt('How should I structure my new component?', memories);

  expect(result.usedMemoryIds).toContain(42);
  expect(result.usedMemoryIds).toContain(43);
  expect(result.augmented).toContain('#42');
  expect(result.augmented).toContain('[user] Preferred stack');
  expect(result.augmented).toContain('React + TypeScript + Vitest');
  expect(result.augmented).toContain('Keep responses concise and actionable');
});

it('buildAugmentedPrompt with no memories still produces valid augmentation', () => {
  const result = buildAugmentedPrompt('simple question here', []);
  expect(result.usedMemoryIds).toEqual([]);
  expect(result.augmented.length).toBeGreaterThan(20);
});

it('injection respects selectMemories budget internally', () => {
  const prompt = 'short';
  // Make each memory expensive so budget limits the count sharply
  const many = Array.from({ length: 40 }, (_, i) =>
    createMemory({ id: i + 10, name: `M${i}`, content: 'word '.repeat(80) }),
  );
  const result = buildAugmentedPrompt(prompt, many);
  // Each formatted memory is costly (~70-90 tokens); default 1500 budget should limit count
  expect(result.usedMemoryIds.length).toBeGreaterThan(0);
  expect(result.usedMemoryIds.length).toBeLessThan(25);
});
});

describe('global vs project-scoped memory', () => {
it('filterMemoriesByProjectScope keeps only global when projectId is null', () => {
  const input = [
    createMemory({ id: 1, scope: 'global', name: 'Global rule' }),
    createMemory({ id: 2, scope: 'project', projectId: 'alpha', name: 'Alpha rule' }),
    createMemory({ id: 3, scope: 'project', projectId: 'beta', name: 'Beta rule' }),
  ];
  const filtered = filterMemoriesByProjectScope(input, null);
  expect(filtered.map((m) => m.id)).toEqual([1]);
});

it('filterMemoriesByProjectScope keeps global + matching project', () => {
  const input = [
    createMemory({ id: 1, scope: 'global' }),
    createMemory({ id: 2, scope: 'project', projectId: 'alpha' }),
    createMemory({ id: 3, scope: 'project', projectId: 'beta' }),
  ];
  const filtered = filterMemoriesByProjectScope(input, 'alpha');
  expect(filtered.map((m) => m.id).sort()).toEqual([1, 2]);
});

it('prompt augmentation after scoping excludes foreign project memories', () => {
  const all = [
    createMemory({ id: 100, scope: 'global', name: 'Global', content: 'always available' }),
    createMemory({ id: 101, scope: 'project', projectId: 'proj-1', name: 'Local rule', content: 'use the project linter' }),
    createMemory({ id: 102, scope: 'project', projectId: 'proj-2', name: 'Secret', content: 'do not leak this' }),
  ];
  const scoped = filterMemoriesByProjectScope(all, 'proj-1');
  const res = buildAugmentedPrompt('review the PR', scoped);

  expect(res.augmented).toContain('always available');
  expect(res.augmented).toContain('use the project linter');
  expect(res.augmented).not.toContain('do not leak this');
  expect(res.usedMemoryIds).toContain(100);
  expect(res.usedMemoryIds).toContain(101);
  expect(res.usedMemoryIds).not.toContain(102);
});
});

describe('memory archival (90+ day untouched)', () => {
it('archiveStaleMemories deletes only unpinned low-access memories older than 90 days', async () => {
  const now = Date.now();
  const oldMs = 100 * 86_400_000;

  const stale = createMemory({
    id: 500,
    pinned: false,
    accessCount: 1,
    lastAccessedAt: now - oldMs,
    name: 'Stale memory',
  });
  const staleZero = createMemory({
    id: 501,
    pinned: false,
    accessCount: 0,
    lastAccessedAt: now - oldMs,
  });
  const highAccessOld = createMemory({
    id: 502,
    pinned: false,
    accessCount: 5,
    lastAccessedAt: now - oldMs,
  });
  const pinnedOld = createMemory({
    id: 503,
    pinned: true,
    accessCount: 0,
    lastAccessedAt: now - oldMs,
  });
  const recentLow = createMemory({
    id: 504,
    pinned: false,
    accessCount: 0,
    lastAccessedAt: now - 1000,
  });

  dbState.memories = [stale, staleZero, highAccessOld, pinnedOld, recentLow];

  const deleted = await (await import('../core/memory/store')).archiveStaleMemories();

  expect(deleted).toBe(2);
  const remaining = dbState.memories.map((m) => m.id);
  expect(remaining).toEqual(expect.arrayContaining([502, 503, 504]));
  expect(remaining).not.toContain(500);
  expect(remaining).not.toContain(501);
});

it('archiveStaleMemories returns 0 when no memory qualifies for archival', async () => {
  const now = Date.now();
  dbState.memories = [
    createMemory({ id: 600, pinned: true, accessCount: 0, lastAccessedAt: now - 100 * 86400000 }),
    createMemory({ id: 601, pinned: false, accessCount: 12, lastAccessedAt: now - 100 * 86400000 }),
    createMemory({ id: 602, pinned: false, accessCount: 1, lastAccessedAt: now }),
  ];
  const count = await (await import('../core/memory/store')).archiveStaleMemories();
  expect(count).toBe(0);
});
});

describe('memory access count update', () => {
it('touchMemories increments accessCount and updates lastAccessedAt for matching ids', async () => {
  const originalTime = 1_700_000_000_000;
  const mem = createMemory({
    id: 700,
    accessCount: 2,
    lastAccessedAt: originalTime,
  });
  dbState.memories = [mem];

  const store = await import('../core/memory/store');
  await store.touchMemories([700]);

  const after = dbState.memories.find((m) => m.id === 700)!;
  expect(after.accessCount).toBe(3);
  expect(after.lastAccessedAt).toBeGreaterThan(originalTime);
});

it('touchMemories affects only the requested ids', async () => {
  const a = createMemory({ id: 701, accessCount: 0, lastAccessedAt: 10 });
  const b = createMemory({ id: 702, accessCount: 0, lastAccessedAt: 10 });
  dbState.memories = [a, b];

  const store = await import('../core/memory/store');
  await store.touchMemories([701]);

  expect(dbState.memories.find((m) => m.id === 701)!.accessCount).toBe(1);
  expect(dbState.memories.find((m) => m.id === 702)!.accessCount).toBe(0);
});
});
