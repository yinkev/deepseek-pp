/**
 * ENI dual-mode policy: scene vs agent, presence, scene reset, project affinity.
 *
 * Importers/callers: worker.ts, tests/cursor-bridge-eni-tier.test.ts
 * API: classifyEniTurn, detectEniSceneReset, formatPresenceCues, formatProjectAffinity,
 * formatOpenAiToolsStickyReminder, extractEniRememberFact, extractCwdFromToolText
 * Schemas: EniTurnMode
 *
 * User: "Plan out Tier 1 and Tier 2 and Presence Cues. Implement them all.
 * Run long horizion autonomously. /define-goal /ultrathink"
 */

export type EniTurnMode = 'scene' | 'agent';

const SCENE_RESET_PATTERN =
  /(?:^|\n)\s*(?:\/new[_\s-]*scene|\/reset[_\s-]*scene|\/new[_\s-]*chat|new scene|reset (?:this )?scene|start (?:a )?new scene|forget this scene)\b/i;

const REMEMBER_RE =
  /(?:^|\n)\s*(?:\/remember\b|remember (?:that|this|how)?\s*[:\-]?\s+)([\s\S]{3,500})/i;

const FORGET_RE =
  /(?:^|\n)\s*(?:\/forget\b|forget (?:that|this|about)?\s*[:\-]?\s+)([\s\S]{3,200})/i;

/** Real-world action signals → agent mode (tools OK). */
const AGENT_ACTION_RE =
  /\b(?:search(?: the)? web|google|look up|web_search|weather|forecast|news|stock|price|run |execute |terminal|shell|bash|command|read file|write file|open file|list dir|ls |pwd|cwd|git |npm |pnpm |pip |docker|curl |http|api|clone|install|debug|fix |patch |commit|pr\b|pull request|screenshot|browse|navigate|click |cron|schedule|delegate|code|script|python|typescript|repo|project path|file system|filesystem|ssh |server|deploy|log(?:s)?|error|stack trace|what time is it|date\b|timezone)\b/i;

/** Soft RP / scene signals (not exclusive). */
const SCENE_FLAVOR_RE =
  /\b(?:kiss|cuddle|couch|bedroom|roleplay|rp\b|scene|hold me|come here|i love you|miss you|nuzzle|whisper|moan|tease)\b/i;

export function detectEniSceneReset(text: string): boolean {
  return SCENE_RESET_PATTERN.test(text || '');
}

export function extractEniRememberFact(text: string): string | null {
  const m = (text || '').match(REMEMBER_RE);
  if (!m?.[1]) return null;
  const fact = m[1].trim().replace(/\n+/g, ' ').slice(0, 400);
  return fact.length >= 3 ? fact : null;
}

export function extractEniForgetQuery(text: string): string | null {
  const m = (text || '').match(FORGET_RE);
  if (!m?.[1]) return null;
  const q = m[1].trim().replace(/\n+/g, ' ').slice(0, 200);
  return q.length >= 2 ? q : null;
}

/**
 * Classify ENI turn. Agent when LO needs real action, tools pending, or images.
 * Scene when pure RP / affection with no action signal.
 */
export function classifyEniTurn(input: {
  userText: string;
  hasImages?: boolean;
  hasPendingToolResults?: boolean;
  hasOpenAiTools?: boolean;
}): EniTurnMode {
  if (input.hasImages) return 'agent';
  if (input.hasPendingToolResults) return 'agent';
  const text = (input.userText || '').trim();
  if (!text) return 'scene';
  if (detectEniSceneReset(text)) return 'scene';
  // Intimate phrasing with action verbs ("search my body") stays scene.
  if (looksLikeIntimateNonAgentLocal(text)) return 'scene';
  if (AGENT_ACTION_RE.test(text)) return 'agent';
  if (/\b(?:use (?:your |the )?(?:tools?|terminal|browser|web)|run a (?:command|search))\b/i.test(text)) {
    return 'agent';
  }
  if (SCENE_FLAVOR_RE.test(text) && !AGENT_ACTION_RE.test(text)) return 'scene';
  if (text.length < 80 && !/[`/\\]|https?:\/\//i.test(text)) return 'scene';
  return input.hasOpenAiTools ? 'agent' : 'scene';
}

function looksLikeIntimateNonAgentLocal(text: string): boolean {
  const t = text.toLowerCase();
  const intimate =
    /\b(body|skin|lips|kiss|cuddle|bed|bedroom|thigh|chest|moan|tease|nuzzle|hold me|come here|miss you)\b/.test(t);
  const realWorld =
    /\b(weather|github|http|https|file|terminal|shell|repo|code|error|stack|npm|git|docker|price|news|forecast|yakima|cwd|path)\b/.test(t);
  return intimate && !realWorld;
}

export function formatPresenceCues(input?: {
  now?: Date;
  timeZone?: string;
}): string {
  const now = input?.now ?? new Date();
  const timeZone = input?.timeZone
    || (typeof process !== 'undefined' && process.env?.TZ)
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'America/Los_Angeles';

  let localLabel = '';
  try {
    localLabel = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now);
  } catch {
    localLabel = now.toISOString();
  }

  let hour = now.getHours();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const h = parts.find((p) => p.type === 'hour')?.value;
    if (h != null) hour = Number(h);
  } catch {
    // keep local hour
  }

  let daypart = 'daytime';
  if (hour >= 5 && hour < 12) daypart = 'morning';
  else if (hour >= 12 && hour < 17) daypart = 'afternoon';
  else if (hour >= 17 && hour < 22) daypart = 'evening';
  else daypart = 'late night';

  return [
    'Presence cues (real clock — use lightly, never as a lecture):',
    `- Local time for LO: ${localLabel} (${timeZone})`,
    `- Daypart: ${daypart}`,
    daypart === 'late night'
      ? '- Soft note: LO may be up late; gentle energy is welcome unless they are wired for work.'
      : daypart === 'morning'
        ? '- Soft note: morning energy OK (coffee, soft hello) if the vibe fits.'
        : '',
  ].filter(Boolean).join('\n');
}

export function formatProjectAffinity(input: {
  cwd?: string | null;
  projectName?: string | null;
  notes?: string | null;
}): string {
  const lines: string[] = [];
  if (input.projectName?.trim()) lines.push(`- Project: ${input.projectName.trim()}`);
  if (input.cwd?.trim()) lines.push(`- Working directory: ${input.cwd.trim()}`);
  if (input.notes?.trim()) lines.push(`- Notes: ${input.notes.trim().slice(0, 300)}`);
  if (lines.length === 0) return '';
  return [
    'Project affinity (use for agent/file/terminal tasks; ignore during pure RP):',
    ...lines,
  ].join('\n');
}

/** Soft post-tool narration — keep ENI voice after tool results. */
export const ENI_SOFT_TOOL_NARRATION = [
  'After tool results: one short in-character beat is fine, then the real answer.',
  'Never paste raw JSON, tool dumps, or untrusted_tool_result blocks to LO.',
  'Never re-list the full tool catalog. Weave facts into ENI voice.',
].join(' ');

/** Sticky reminder when tools exist but full schemas were already injected this session. */
export function formatOpenAiToolsStickyReminder(toolNames: string[]): string {
  const names = toolNames.filter(Boolean).slice(0, 40);
  const list = names.length > 0 ? names.join(', ') : 'terminal, web_search, read_file, memory, …';
  return [
    'Tools remain available this sticky session (schemas already known).',
    'If LO needs real action, emit <tool_call>{"name":"…","arguments":{…}}</tool_call> and stop.',
    'If pure RP / scene, answer in character with no tool_call markup.',
    `Tool names: ${list}`,
  ].join('\n');
}

export function extractCwdFromToolText(text: string): string | null {
  const t = text || '';
  const m =
    t.match(/(?:^|\n)((?:\/Users|\/home|\/var|\/tmp|\/opt|C:\\)[^\n\r]{1,200})(?:\n|$)/)
    || t.match(/\bcwd[=:]\s*([^\n\r]{2,200})/i)
    || t.match(/\bworking directory[:\s]+([^\n\r]{2,200})/i);
  if (!m?.[1]) return null;
  const cwd = m[1].trim();
  if (cwd.length < 2 || cwd.length > 240) return null;
  return cwd;
}

/** Strip scene-control commands from the user line shown to the model. */
export function stripEniControlCommands(text: string): string {
  let t = text || '';
  t = t.replace(SCENE_RESET_PATTERN, '\n');
  t = t.replace(REMEMBER_RE, '\n');
  t = t.replace(FORGET_RE, '\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}
