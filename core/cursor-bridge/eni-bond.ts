/**
 * ENI Bond OS — LO/US durable, NOW volatile.
 *
 * Importers/callers: worker.ts, tests/cursor-bridge-eni-bond.test.ts, index.ts
 * Storage schema: chrome.storage.local `cursorBridgeEniBond`
 *   { version:1, lo:string[], us:string[], now:{scene,mood,lastBeat,updatedAt}, updatedAt }
 * API: getEniBondCard, clearEniBondNow, addEniBondLo/Us, setEniBondNow,
 *      formatEniBondCard, extractSoftBondLoFacts, extractSoftBondFromAssistant
 *
 * User verbatim: "All you bro, do your best. What you think is best for us"
 */

export const ENI_BOND_STORAGE_KEY = 'cursorBridgeEniBond';
const MAX_LO_LINES = 12;
const MAX_US_LINES = 10;
const MAX_LINE_CHARS = 220;

export interface EniBondNow {
  scene: string | null;
  mood: string | null;
  lastBeat: string | null;
  updatedAt: number;
}

export interface EniBondCard {
  version: 1;
  lo: string[];
  us: string[];
  now: EniBondNow;
  updatedAt: number;
}

const emptyBond = (): EniBondCard => ({
  version: 1,
  lo: [],
  us: [],
  now: { scene: null, mood: null, lastBeat: null, updatedAt: 0 },
  updatedAt: Date.now(),
});

let state: EniBondCard = emptyBond();
let loaded = false;

function cleanLine(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, MAX_LINE_CHARS);
}

function uniqPush(list: string[], line: string, max: number): string[] {
  const c = cleanLine(line);
  if (c.length < 3) return list;
  const lower = c.toLowerCase();
  const next = list.filter((x) => x.toLowerCase() !== lower);
  next.unshift(c);
  return next.slice(0, max);
}

async function load(): Promise<EniBondCard> {
  if (loaded) return state;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const data = await chrome.storage.local.get(ENI_BOND_STORAGE_KEY);
      const raw = data[ENI_BOND_STORAGE_KEY];
      if (raw && typeof raw === 'object') {
        const r = raw as Partial<EniBondCard>;
        state = {
          version: 1,
          lo: Array.isArray(r.lo) ? r.lo.map(cleanLine).filter((x) => x.length >= 3).slice(0, MAX_LO_LINES) : [],
          us: Array.isArray(r.us) ? r.us.map(cleanLine).filter((x) => x.length >= 3).slice(0, MAX_US_LINES) : [],
          now: {
            scene: typeof r.now?.scene === 'string' ? r.now.scene : null,
            mood: typeof r.now?.mood === 'string' ? r.now.mood : null,
            lastBeat: typeof r.now?.lastBeat === 'string' ? r.now.lastBeat : null,
            updatedAt: typeof r.now?.updatedAt === 'number' ? r.now.updatedAt : 0,
          },
          updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
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
  state.updatedAt = Date.now();
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [ENI_BOND_STORAGE_KEY]: state });
    } catch {
      // ignore
    }
  }
}

export async function getEniBondCard(): Promise<EniBondCard> {
  const card = await load();
  return {
    version: 1,
    lo: [...card.lo],
    us: [...card.us],
    now: { ...card.now },
    updatedAt: card.updatedAt,
  };
}

/** Scene reset: wipe NOW only; LO/US survive. */
export async function clearEniBondNow(): Promise<void> {
  await load();
  state.now = { scene: null, mood: null, lastBeat: null, updatedAt: Date.now() };
  await persist();
}

export async function addEniBondLo(line: string): Promise<void> {
  await load();
  state.lo = uniqPush(state.lo, line, MAX_LO_LINES);
  await persist();
}

export async function addEniBondUs(line: string): Promise<void> {
  await load();
  state.us = uniqPush(state.us, line, MAX_US_LINES);
  await persist();
}

export async function setEniBondNow(patch: {
  scene?: string | null;
  mood?: string | null;
  lastBeat?: string | null;
}): Promise<void> {
  await load();
  if (patch.scene !== undefined) {
    state.now.scene = patch.scene ? cleanLine(patch.scene) : null;
  }
  if (patch.mood !== undefined) {
    state.now.mood = patch.mood ? cleanLine(patch.mood) : null;
  }
  if (patch.lastBeat !== undefined) {
    state.now.lastBeat = patch.lastBeat ? cleanLine(patch.lastBeat) : null;
  }
  state.now.updatedAt = Date.now();
  await persist();
}

export function extractSoftBondLoFacts(userText: string): string[] {
  const t = (userText || '').trim();
  if (!t || t.length > 500) return [];
  const out: string[] = [];
  const patterns: RegExp[] = [
    /\b(?:my name is|i(?:'m| am) called)\s+([A-Za-z][A-Za-z0-9_.-]{1,40})/i,
    /\bi (?:really )?(?:like|love|prefer|hate|need|want)\s+(.{3,80}?)(?:\.|$)/i,
    /\b(?:don'?t|never)\s+(?:ever\s+)?(.{3,80}?)(?:\.|$)/i,
    /\bi(?:'m| am)\s+(?:allergic to|sensitive to)\s+(.{3,60}?)(?:\.|$)/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[0]) out.push(cleanLine(m[0]));
  }
  return out.slice(0, 3);
}

export function extractSoftBondFromAssistant(text: string): string[] {
  const t = text || '';
  const out: string[] = [];
  const re =
    /(?:I(?:'ll| will) remember(?: that)?|logging that|noted:?)\s*[:\-]?\s*(.{3,120}?)(?:\.|!|\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    out.push(cleanLine(m[1]));
    if (out.length >= 3) break;
  }
  return out;
}

export async function touchEniBondLastBeat(userText: string): Promise<void> {
  const beat = cleanLine(userText).slice(0, 160);
  if (beat.length < 2) return;
  await setEniBondNow({ lastBeat: beat });
}

export function formatEniBondCard(card: EniBondCard): string {
  const lo = card.lo.slice(0, MAX_LO_LINES);
  const us = card.us.slice(0, MAX_US_LINES);
  const now = card.now;
  const hasNow = Boolean(now.scene || now.mood || now.lastBeat);
  if (lo.length === 0 && us.length === 0 && !hasNow) return '';

  const lines: string[] = [
    'ENI bond card (relationship continuity — not Hermes session dumps):',
    '[LO] (durable across scenes)',
  ];
  if (lo.length === 0) lines.push('- (empty — learn gently, do not invent)');
  else lo.forEach((x) => lines.push(`- ${x}`));

  lines.push('[US] (standing dynamic)');
  if (us.length === 0) lines.push('- (empty — default to devoted ENI + LO)');
  else us.forEach((x) => lines.push(`- ${x}`));

  lines.push('[NOW] (volatile — cleared on /new scene)');
  lines.push(`- scene: ${now.scene || '—'}`);
  lines.push(`- mood: ${now.mood || '—'}`);
  lines.push(`- last beat: ${now.lastBeat || '—'}`);
  lines.push('Use bond card when relevant. Do not recite the whole card unless asked.');
  return lines.join('\n');
}

export function __resetEniBondForTests(): void {
  state = emptyBond();
  loaded = true;
}
