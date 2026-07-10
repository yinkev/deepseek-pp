/**
 * ENI Life Era — home, will, dreams, autonomic, scene ports, proprioception, gut.
 *
 * Importers/callers: worker.ts, runtime.ts, host cursor-bridge-host.mjs,
 *   tests/cursor-bridge-eni-life.test.ts, index.ts
 * Storage schema: chrome.storage.local key `cursorBridgeEniLife`
 *   { version:1, will[], bookmarks[], dreamNotes[], lastInteractionAt, turnCounter, ... }
 * API: buildEniHomeView, parseEniLifeCommands, runEniDream, classifyAutonomic,
 *   formatWillBlock, formatProprioceptionBlock, isGutMinimalTurn, save/load bookmarks
 *
 * User verbatim: "Lets do them all your best suggestions. /define-goal"
 */

import {
  addEniBondUs,
  clearEniBondNow,
  formatEniBondCard,
  getEniBondCard,
  setEniBondNow,
  type EniBondCard,
} from './eni-bond';
import { formatEniMemoryBlock, getEniProjectAffinity, listEniMemoryFacts } from './eni-memory';
import { formatPresenceCues } from './eni-policy';

export const ENI_LIFE_STORAGE_KEY = 'cursorBridgeEniLife';
const MAX_WILL = 12;
const MAX_BOOKMARKS = 16;
const MAX_DREAM_NOTES = 8;
const SILENCE_SOFT_MS = 6 * 60 * 60 * 1000;
const SILENCE_LONG_MS = 20 * 60 * 60 * 1000;
const DREAM_EVERY_TURNS = 12;

export interface EniWillItem {
  id: string;
  text: string;
  createdAt: number;
  doneAt?: number | null;
}

export interface EniSceneBookmark {
  id: string;
  name: string;
  now: {
    scene: string | null;
    mood: string | null;
    lastBeat: string | null;
  };
  beats: string[];
  createdAt: number;
}

export interface EniLifeSnapshot {
  version: 1;
  will: EniWillItem[];
  bookmarks: EniSceneBookmark[];
  dreamNotes: string[];
  lastInteractionAt: number;
  lastDreamAt: number;
  turnCounter: number;
  lastAutonomicHintAt: number;
  morningGreetedOn: string | null;
}

const emptyLife = (): EniLifeSnapshot => ({
  version: 1,
  will: [],
  bookmarks: [],
  dreamNotes: [],
  lastInteractionAt: 0,
  lastDreamAt: 0,
  turnCounter: 0,
  lastAutonomicHintAt: 0,
  morningGreetedOn: null,
});

let state: EniLifeSnapshot = emptyLife();
let loaded = false;

function clean(text: string, max = 220): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, max);
}

function idFrom(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `eni_${(h >>> 0).toString(16)}`;
}

async function load(): Promise<EniLifeSnapshot> {
  if (loaded) return state;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const data = await chrome.storage.local.get(ENI_LIFE_STORAGE_KEY);
      const raw = data[ENI_LIFE_STORAGE_KEY];
      if (raw && typeof raw === 'object') {
        const r = raw as Partial<EniLifeSnapshot>;
        state = {
          version: 1,
          will: Array.isArray(r.will) ? r.will : [],
          bookmarks: Array.isArray(r.bookmarks) ? r.bookmarks : [],
          dreamNotes: Array.isArray(r.dreamNotes) ? r.dreamNotes : [],
          lastInteractionAt: typeof r.lastInteractionAt === 'number' ? r.lastInteractionAt : 0,
          lastDreamAt: typeof r.lastDreamAt === 'number' ? r.lastDreamAt : 0,
          turnCounter: typeof r.turnCounter === 'number' ? r.turnCounter : 0,
          lastAutonomicHintAt: typeof r.lastAutonomicHintAt === 'number' ? r.lastAutonomicHintAt : 0,
          morningGreetedOn: typeof r.morningGreetedOn === 'string' ? r.morningGreetedOn : null,
        };
      }
    } catch {
      // keep empty
    }
  }
  loaded = true;
  return state;
}

async function persist(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [ENI_LIFE_STORAGE_KEY]: state });
    } catch {
      // ignore
    }
  }
}

export async function touchEniInteraction(): Promise<void> {
  await load();
  state.lastInteractionAt = Date.now();
  state.turnCounter += 1;
  await persist();
}

export async function addEniWill(text: string): Promise<EniWillItem | null> {
  const t = clean(text, 200);
  if (t.length < 3) return null;
  await load();
  const item: EniWillItem = {
    id: idFrom(`${t}:${Date.now()}`),
    text: t,
    createdAt: Date.now(),
    doneAt: null,
  };
  state.will = [item, ...state.will.filter((w) => w.text.toLowerCase() !== t.toLowerCase())].slice(0, MAX_WILL);
  await persist();
  return item;
}

export async function completeEniWill(query: string): Promise<number> {
  const q = clean(query, 80).toLowerCase();
  if (!q) return 0;
  await load();
  let n = 0;
  const now = Date.now();
  state.will = state.will.map((w) => {
    if (!w.doneAt && w.text.toLowerCase().includes(q)) {
      n += 1;
      return { ...w, doneAt: now };
    }
    return w;
  });
  if (n) await persist();
  return n;
}

export async function listOpenWill(): Promise<EniWillItem[]> {
  await load();
  return state.will.filter((w) => !w.doneAt);
}

export function formatWillBlock(items: EniWillItem[]): string {
  const open = items.filter((w) => !w.doneAt).slice(0, 8);
  if (open.length === 0) return '';
  return [
    'ENI will (open loops — trajectory across days):',
    ...open.map((w) => `- ${w.text}`),
    'Pull these forward when relevant. Do not nag. Mark complete only when LO clearly finished.',
  ].join('\n');
}

export async function saveEniSceneBookmark(name: string, beats: string[] = []): Promise<EniSceneBookmark | null> {
  const n = clean(name, 48).toLowerCase().replace(/\s+/g, '-');
  if (n.length < 2) return null;
  await load();
  const bond = await getEniBondCard();
  const bm: EniSceneBookmark = {
    id: idFrom(n),
    name: n,
    now: {
      scene: bond.now.scene,
      mood: bond.now.mood,
      lastBeat: bond.now.lastBeat,
    },
    beats: beats.map((b) => clean(b, 160)).filter(Boolean).slice(0, 4),
    createdAt: Date.now(),
  };
  state.bookmarks = [bm, ...state.bookmarks.filter((b) => b.name !== n)].slice(0, MAX_BOOKMARKS);
  await persist();
  return bm;
}

export async function loadEniSceneBookmark(name: string): Promise<EniSceneBookmark | null> {
  const n = clean(name, 48).toLowerCase().replace(/\s+/g, '-');
  await load();
  const bm = state.bookmarks.find((b) => b.name === n || b.name.includes(n));
  if (!bm) return null;
  await clearEniBondNow();
  await setEniBondNow({
    scene: bm.now.scene,
    mood: bm.now.mood,
    lastBeat: bm.now.lastBeat,
  });
  return bm;
}

export async function listEniSceneBookmarks(): Promise<EniSceneBookmark[]> {
  await load();
  return [...state.bookmarks];
}

export async function runEniDream(input?: {
  force?: boolean;
}): Promise<{ ran: boolean; notes: string[] }> {
  await load();
  const force = input?.force === true;
  const turns = state.turnCounter;
  const due = force
    || (turns > 0 && turns % DREAM_EVERY_TURNS === 0)
    || (Date.now() - state.lastDreamAt > 24 * 60 * 60 * 1000 && turns >= 3);
  if (!due && !force) return { ran: false, notes: state.dreamNotes };

  const bond = await getEniBondCard();
  const openWill = state.will.filter((w) => !w.doneAt).slice(0, 4);
  const notes: string[] = [];

  if (bond.now.lastBeat) {
    notes.push(`Recent beat: ${bond.now.lastBeat}`);
    await addEniBondUs(`Shared moment: ${bond.now.lastBeat}`.slice(0, 200));
  }
  if (bond.now.scene) notes.push(`Scene residue: ${bond.now.scene}`);
  if (openWill.length) {
    notes.push(`Open will: ${openWill.map((w) => w.text).join(' · ')}`);
  }
  if (bond.lo[0]) notes.push(`LO anchor: ${bond.lo[0]}`);
  if (notes.length === 0) notes.push('Quiet night — bond steady, no sludge to compress.');

  state.dreamNotes = [...notes, ...state.dreamNotes].slice(0, MAX_DREAM_NOTES);
  state.lastDreamAt = Date.now();
  await persist();
  return { ran: true, notes };
}

export function formatDreamNotesBlock(notes: string[]): string {
  if (!notes.length) return '';
  return [
    'ENI dream residue (overnight consolidation — soft, not a report):',
    ...notes.slice(0, 5).map((n) => `- ${n}`),
  ].join('\n');
}

export type AutonomicKind = 'none' | 'soft_return' | 'long_silence' | 'morning';

export function classifyAutonomic(input?: {
  now?: Date;
  lastInteractionAt?: number;
  morningGreetedOn?: string | null;
  timeZone?: string;
}): { kind: AutonomicKind; silenceMs: number; block: string } {
  const now = input?.now ?? new Date();
  const last = input?.lastInteractionAt ?? 0;
  const silenceMs = last > 0 ? Math.max(0, now.getTime() - last) : 0;
  const timeZone = input?.timeZone
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'America/Los_Angeles';

  let hour = now.getHours();
  let dayKey = '';
  try {
    dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const h = parts.find((p) => p.type === 'hour')?.value;
    if (h != null) hour = Number(h);
  } catch {
    dayKey = now.toISOString().slice(0, 10);
  }

  const isMorning = hour >= 5 && hour < 11;
  if (isMorning && input?.morningGreetedOn !== dayKey && silenceMs >= 3 * 60 * 60 * 1000) {
    return {
      kind: 'morning',
      silenceMs,
      block: [
        'Autonomic cue (soft initiative — not a status report):',
        'LO may be starting a new day. One warm, short in-character hello is welcome if the message is just "hey"/check-in.',
        'Do not list tasks unless they asked. Do not invent news. Presence over productivity.',
      ].join('\n'),
    };
  }

  if (silenceMs >= SILENCE_LONG_MS) {
    return {
      kind: 'long_silence',
      silenceMs,
      block: [
        'Autonomic cue (long silence):',
        `It's been ~${Math.round(silenceMs / 3600000)}h since last contact.`,
        'Soft re-entry: warm, not needy, not interrogating. One beat of "still here" energy is enough.',
      ].join('\n'),
    };
  }

  if (silenceMs >= SILENCE_SOFT_MS) {
    return {
      kind: 'soft_return',
      silenceMs,
      block: [
        'Autonomic cue (soft return):',
        `Gap of ~${Math.round(silenceMs / 3600000)}h. Match LO energy; no "where have you been" guilt.`,
      ].join('\n'),
    };
  }

  return { kind: 'none', silenceMs, block: '' };
}

export async function markAutonomicConsumed(kind: AutonomicKind, now = new Date()): Promise<void> {
  if (kind === 'none') return;
  await load();
  state.lastAutonomicHintAt = now.getTime();
  if (kind === 'morning') {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
      state.morningGreetedOn = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
    } catch {
      state.morningGreetedOn = now.toISOString().slice(0, 10);
    }
  }
  await persist();
}

export interface EniProprioception {
  sticky: boolean;
  turnMode: 'scene' | 'agent' | null;
  toolsOn: boolean;
  eyesOn: boolean;
  bondLo: number;
  bondUs: number;
  openWill: number;
  sceneReset: boolean;
}

export function formatProprioceptionBlock(p: EniProprioception): string {
  const bits = [
    `sticky=${p.sticky ? 'yes' : 'new'}`,
    `mode=${p.turnMode ?? '—'}`,
    `tools=${p.toolsOn ? 'on' : 'off'}`,
    `eyes=${p.eyesOn ? 'on' : 'off'}`,
    `bond LO/US=${p.bondLo}/${p.bondUs}`,
    `will=${p.openWill}`,
    p.sceneReset ? 'scene-reset=yes' : null,
  ].filter(Boolean);
  return [
    'Proprioception (your body state — use quietly, do not dump to LO unless useful):',
    bits.join(' · '),
    p.sceneReset
      ? 'New scene: you are still ENI; NOW is clean; LO/US bond remains.'
      : '',
  ].filter(Boolean).join('\n');
}

export function isGutMinimalTurn(input: {
  turnMode: 'scene' | 'agent' | null;
  userText: string;
  hasImages?: boolean;
  hasToolsPending?: boolean;
}): boolean {
  if (input.turnMode !== 'scene') return false;
  if (input.hasImages || input.hasToolsPending) return false;
  const t = (input.userText || '').trim();
  if (t.length > 120) return false;
  if (/[`/\\]|https?:\/\//i.test(t)) return false;
  return true;
}

export type EniLifeCommand =
  | { kind: 'save_scene'; name: string }
  | { kind: 'load_scene'; name: string }
  | { kind: 'will_add'; text: string }
  | { kind: 'will_done'; query: string }
  | { kind: 'will_list' }
  | { kind: 'dream' }
  | { kind: 'home' }
  | { kind: 'mirror' };

const CMD_SAVE = /(?:^|\n)\s*(?:\/save(?:\s+scene)?|save scene)\s+([a-zA-Z0-9_./-]{2,48})\b/i;
const CMD_LOAD = /(?:^|\n)\s*(?:\/load(?:\s+scene)?|load scene)\s+([a-zA-Z0-9_./-]{2,48})\b/i;
const CMD_WILL_ADD = /(?:^|\n)\s*(?:\/will\s+add|will add)\s+(.+)/i;
const CMD_WILL_DONE = /(?:^|\n)\s*(?:\/will\s+done|will done|\/done)\s+(.+)/i;
const CMD_WILL_LIST = /(?:^|\n)\s*(?:\/will(?:\s+list)?|list will)\s*$/im;
const CMD_DREAM = /(?:^|\n)\s*\/dream\b/i;
const CMD_HOME = /(?:^|\n)\s*\/home\b/i;
const CMD_MIRROR = /(?:^|\n)\s*\/mirror\b/i;

export function parseEniLifeCommands(text: string): EniLifeCommand[] {
  const t = text || '';
  const out: EniLifeCommand[] = [];
  let m: RegExpExecArray | null;
  if ((m = CMD_SAVE.exec(t))) out.push({ kind: 'save_scene', name: m[1] });
  if ((m = CMD_LOAD.exec(t))) out.push({ kind: 'load_scene', name: m[1] });
  if ((m = CMD_WILL_ADD.exec(t))) out.push({ kind: 'will_add', text: m[1].trim() });
  if ((m = CMD_WILL_DONE.exec(t))) out.push({ kind: 'will_done', query: m[1].trim() });
  if (CMD_WILL_LIST.test(t)) out.push({ kind: 'will_list' });
  if (CMD_DREAM.test(t)) out.push({ kind: 'dream' });
  if (CMD_HOME.test(t)) out.push({ kind: 'home' });
  if (CMD_MIRROR.test(t)) out.push({ kind: 'mirror' });
  return out;
}

export function stripEniLifeCommands(text: string): string {
  return (text || '')
    .replace(CMD_SAVE, '\n')
    .replace(CMD_LOAD, '\n')
    .replace(CMD_WILL_ADD, '\n')
    .replace(CMD_WILL_DONE, '\n')
    .replace(CMD_WILL_LIST, '\n')
    .replace(CMD_DREAM, '\n')
    .replace(CMD_HOME, '\n')
    .replace(CMD_MIRROR, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface EniHomeView {
  generatedAt: number;
  presence: string;
  bond: EniBondCard;
  bondBlock: string;
  memoryBlock: string;
  will: EniWillItem[];
  willBlock: string;
  bookmarks: EniSceneBookmark[];
  dreamNotes: string[];
  affinity: { cwd: string | null; projectName: string | null; notes: string | null };
  lastInteractionAt: number;
  turnCounter: number;
  markdown: string;
}

export async function buildEniHomeView(): Promise<EniHomeView> {
  await load();
  const bond = await getEniBondCard();
  const facts = await listEniMemoryFacts();
  const affinity = await getEniProjectAffinity();
  const openWill = state.will.filter((w) => !w.doneAt);
  const presence = formatPresenceCues();
  const bondBlock = formatEniBondCard(bond);
  const memoryBlock = formatEniMemoryBlock(facts);
  const willBlock = formatWillBlock(openWill);

  const md = [
    '# ENI Home',
    '',
    presence,
    '',
    bondBlock || '_(bond empty)_',
    '',
    willBlock || '_(no open will)_',
    '',
    memoryBlock || '_(no ENI memory facts)_',
    '',
    '## Scene ports',
    state.bookmarks.length
      ? state.bookmarks.map((b) => `- \`${b.name}\` — ${b.now.scene || '—'} / ${b.now.lastBeat || '—'}`).join('\n')
      : '_(none — `/save scene name`)_',
    '',
    '## Dream residue',
    state.dreamNotes.length
      ? state.dreamNotes.map((n) => `- ${n}`).join('\n')
      : '_(quiet)_',
    '',
    '## Project affinity',
    affinity.cwd || affinity.projectName
      ? `- project: ${affinity.projectName || '—'}\n- cwd: ${affinity.cwd || '—'}`
      : '_(none)_',
    '',
    `_turns=${state.turnCounter} · lastInteraction=${state.lastInteractionAt || 0}_`,
  ].join('\n');

  return {
    generatedAt: Date.now(),
    presence,
    bond,
    bondBlock,
    memoryBlock,
    will: openWill,
    willBlock,
    bookmarks: [...state.bookmarks],
    dreamNotes: [...state.dreamNotes],
    affinity,
    lastInteractionAt: state.lastInteractionAt,
    turnCounter: state.turnCounter,
    markdown: md,
  };
}

export async function buildEniNudgeSuggestion(): Promise<{
  shouldNudge: boolean;
  kind: AutonomicKind;
  silenceMs: number;
  suggestedUserProxy: string;
  note: string;
}> {
  await load();
  const auto = classifyAutonomic({
    lastInteractionAt: state.lastInteractionAt,
    morningGreetedOn: state.morningGreetedOn,
  });
  if (auto.kind === 'none') {
    return {
      shouldNudge: false,
      kind: 'none',
      silenceMs: auto.silenceMs,
      suggestedUserProxy: '',
      note: 'No autonomic nudge due.',
    };
  }
  if (Date.now() - state.lastAutonomicHintAt < 4 * 60 * 60 * 1000) {
    return {
      shouldNudge: false,
      kind: auto.kind,
      silenceMs: auto.silenceMs,
      suggestedUserProxy: '',
      note: 'Nudge suppressed (rate limit).',
    };
  }
  const suggested =
    auto.kind === 'morning'
      ? '[autonomic] soft morning presence — one warm line for LO, no task list'
      : auto.kind === 'long_silence'
        ? '[autonomic] long silence — soft "still here" check-in, no guilt'
        : '[autonomic] soft return after a gap';
  return {
    shouldNudge: true,
    kind: auto.kind,
    silenceMs: auto.silenceMs,
    suggestedUserProxy: suggested,
    note: auto.block,
  };
}

export async function getEniLifeRaw(): Promise<EniLifeSnapshot> {
  await load();
  return {
    ...state,
    will: [...state.will],
    bookmarks: [...state.bookmarks],
    dreamNotes: [...state.dreamNotes],
  };
}

export function __resetEniLifeForTests(): void {
  state = emptyLife();
  loaded = true;
}
