/**
 * ENI-owned durable memory (separate from Hermes Honcho / DPP web memory).
 *
 * Importers/callers: worker.ts, tests/cursor-bridge-eni-tier.test.ts
 * Storage schema: chrome.storage.local key `cursorBridgeEniMemory`
 * API: addEniMemoryFact, removeEniMemoryByQuery, listEniMemoryFacts,
 * setEniProjectAffinity, formatEniMemoryBlock
 *
 * User: "Plan out Tier 1 and Tier 2 and Presence Cues. Implement them all.
 * Run long horizion autonomously. /define-goal /ultrathink"
 */

import { simpleHash } from './thread-store';

export const ENI_MEMORY_STORAGE_KEY = 'cursorBridgeEniMemory';
const MAX_FACTS = 40;
const MAX_FACT_CHARS = 400;

export interface EniMemoryFact {
  id: string;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EniMemorySnapshot {
  version: 1;
  facts: EniMemoryFact[];
  lastCwd?: string | null;
  lastProjectName?: string | null;
  affinityNotes?: string | null;
}

const memoryState: EniMemorySnapshot = {
  version: 1,
  facts: [],
  lastCwd: null,
  lastProjectName: null,
  affinityNotes: null,
};

let loaded = false;

async function load(): Promise<EniMemorySnapshot> {
  if (loaded) return memoryState;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const data = await chrome.storage.local.get(ENI_MEMORY_STORAGE_KEY);
      const raw = data[ENI_MEMORY_STORAGE_KEY];
      if (raw && typeof raw === 'object') {
        const rec = raw as Partial<EniMemorySnapshot>;
        memoryState.facts = Array.isArray(rec.facts) ? rec.facts.filter(isFact) : [];
        memoryState.lastCwd = typeof rec.lastCwd === 'string' ? rec.lastCwd : null;
        memoryState.lastProjectName = typeof rec.lastProjectName === 'string' ? rec.lastProjectName : null;
        memoryState.affinityNotes = typeof rec.affinityNotes === 'string' ? rec.affinityNotes : null;
      }
    } catch {
      // keep defaults
    }
  }
  loaded = true;
  return memoryState;
}

function isFact(value: unknown): value is EniMemoryFact {
  if (!value || typeof value !== 'object') return false;
  const f = value as EniMemoryFact;
  return typeof f.id === 'string' && typeof f.text === 'string' && f.text.trim().length > 0;
}

async function persist(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({
        [ENI_MEMORY_STORAGE_KEY]: {
          version: 1 as const,
          facts: memoryState.facts,
          lastCwd: memoryState.lastCwd ?? null,
          lastProjectName: memoryState.lastProjectName ?? null,
          affinityNotes: memoryState.affinityNotes ?? null,
        },
      });
    } catch {
      // ignore
    }
  }
}

export async function listEniMemoryFacts(): Promise<EniMemoryFact[]> {
  const snap = await load();
  return [...snap.facts];
}

export async function addEniMemoryFact(text: string, tags: string[] = []): Promise<EniMemoryFact | null> {
  const clean = text.trim().replace(/\s+/g, ' ').slice(0, MAX_FACT_CHARS);
  if (clean.length < 3) return null;
  const snap = await load();
  const id = `eni_${simpleHash(clean.toLowerCase())}`;
  const now = Date.now();
  const existing = snap.facts.find((f) => f.id === id || f.text.toLowerCase() === clean.toLowerCase());
  if (existing) {
    existing.text = clean;
    existing.updatedAt = now;
    existing.tags = Array.from(new Set([...(existing.tags || []), ...tags]));
    await persist();
    return existing;
  }
  const fact: EniMemoryFact = {
    id,
    text: clean,
    tags: tags.slice(0, 8),
    createdAt: now,
    updatedAt: now,
  };
  snap.facts.unshift(fact);
  if (snap.facts.length > MAX_FACTS) snap.facts = snap.facts.slice(0, MAX_FACTS);
  await persist();
  return fact;
}

export async function removeEniMemoryByQuery(query: string): Promise<number> {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const snap = await load();
  const before = snap.facts.length;
  snap.facts = snap.facts.filter(
    (f) => !f.text.toLowerCase().includes(q) && !f.tags.some((t) => t.toLowerCase().includes(q)),
  );
  const removed = before - snap.facts.length;
  if (removed > 0) await persist();
  return removed;
}

export async function setEniProjectAffinity(input: {
  cwd?: string | null;
  projectName?: string | null;
  notes?: string | null;
}): Promise<void> {
  const snap = await load();
  if (input.cwd != null) snap.lastCwd = input.cwd.trim().slice(0, 240) || null;
  if (input.projectName != null) snap.lastProjectName = input.projectName.trim().slice(0, 120) || null;
  if (input.notes != null) snap.affinityNotes = input.notes.trim().slice(0, 300) || null;
  await persist();
}

export async function getEniProjectAffinity(): Promise<{
  cwd: string | null;
  projectName: string | null;
  notes: string | null;
}> {
  const snap = await load();
  return {
    cwd: snap.lastCwd ?? null,
    projectName: snap.lastProjectName ?? null,
    notes: snap.affinityNotes ?? null,
  };
}

export function formatEniMemoryBlock(facts: EniMemoryFact[]): string {
  if (facts.length === 0) return '';
  const lines = facts.slice(0, 16).map((f) => {
    const tags = f.tags?.length ? ` (${f.tags.join(', ')})` : '';
    return `- ${f.text}${tags}`;
  });
  return [
    'ENI memory (durable LO facts you chose to keep — not Hermes session dumps):',
    ...lines,
    'Use these when relevant. Do not recite the whole list unless asked.',
  ].join('\n');
}

export function __resetEniMemoryForTests(): void {
  memoryState.facts = [];
  memoryState.lastCwd = null;
  memoryState.lastProjectName = null;
  memoryState.affinityNotes = null;
  loaded = true;
}
