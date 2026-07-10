/**
 * Cursor / Hermes harness policy for the browser-origin bridge.
 * Controls tool inject volume, dialogue hygiene, memory tags, sticky depth.
 */

import type { CursorBridgeChatMessage, CursorBridgeClientProfile } from './protocol';
import type { Memory } from '../types';

export const HARNESS_PROFILES: ReadonlySet<CursorBridgeClientProfile> = new Set(['cursor', 'hermes']);

/** Soft cap for harness message hygiene — near expert web composer limit, not a tiny choke. */
export const HARNESS_MESSAGE_CHAR_CAP = 160_000;

/** DeepSeek++ project names for auto-routing bridge sessions. */
export function harnessProjectName(profile: CursorBridgeClientProfile): 'Cursor' | 'Hermes' | null {
  if (profile === 'cursor') return 'Cursor';
  if (profile === 'hermes') return 'Hermes';
  return null;
}

/** Tags allowed for auto memory inject on harness turns (excludes personal/dating by default). */
export const HARNESS_MEMORY_TAG_ALLOW = new Set([
  'coding',
  'code',
  'project',
  'work',
  'cursor',
  'hermes',
  'dev',
  'engineering',
  'api',
  'bridge',
  'deepseek',
  'prefs',
  'preference',
  'setup',
  'config',
  'tooling',
]);

/** Tags that must never auto-inject into coding harness turns. */
export const HARNESS_MEMORY_TAG_DENY = new Set([
  'dating',
  'personal',
  'relationship',
  'sex',
  'private',
  'journal',
  'therapy',
]);

export const HARNESS_TOOL_MAX_DEPTH = 2;
export const GENERIC_TOOL_MAX_DEPTH = 5;

export type ToolSchemaMode = 'full' | 'reminder' | 'none';

export function isHarnessProfile(profile: CursorBridgeClientProfile | string | undefined): boolean {
  return profile === 'cursor' || profile === 'hermes';
}

/**
 * Hermes owns skills, tools, MCP, and memory.
 * Bridge is brain-only (DeepSeek web completion + sticky + optional eyes).
 */
export function isHermesBrainOnly(profile: CursorBridgeClientProfile | string | undefined): boolean {
  return profile === 'hermes';
}

/** Cursor may use DeepSeek++ tools/memory; Hermes must not dual-stack. */
export function shouldInjectDppTools(profile: CursorBridgeClientProfile | string | undefined): boolean {
  return !isHermesBrainOnly(profile);
}

export function shouldInjectDppMemories(profile: CursorBridgeClientProfile | string | undefined): boolean {
  // Only Cursor auto-injects tagged DPP memories. Hermes has its own memory.
  return profile === 'cursor';
}

const TOOL_FORCE_RE =
  /\b(use tools?|tool[s]? please|ds\/tool|memory_save|web_search|web_fetch|run (?:a |the )?command|search the web|fetch (?:url|the page)|save (?:this |a )?memory|remember (?:this|that)|use mcp|browser_)\b/i;

const TOOL_ACTION_RE =
  /\b(save|remember|memor(?:y|ize)|search|fetch|look up|google|browse|navigate|click|screenshot|run|execute|shell|terminal|command|install|curl|http|api|mcp|file system|read file|write file|list dir|clone|git |npm |pnpm |yarn |pip |docker)\b/i;

/**
 * Whether the latest user text looks like it needs DeepSeek++ tools.
 * Override: explicit "use tools" / tool names always true.
 */
export function userTurnWantsTools(latestUserText: string): boolean {
  const t = (latestUserText ?? '').trim();
  if (!t) return false;
  if (TOOL_FORCE_RE.test(t)) return true;
  if (TOOL_ACTION_RE.test(t)) return true;
  return false;
}

/**
 * Full tool schemas only when needed; sticky harness turns get a short reminder.
 * Generic (non-harness) always full when tools enabled.
 */
export function resolveToolSchemaMode(input: {
  profile: CursorBridgeClientProfile;
  toolsEnabled: boolean;
  sticky: boolean;
  forceTools?: boolean;
  latestUserText: string;
  hasImages?: boolean;
}): ToolSchemaMode {
  if (!input.toolsEnabled) return 'none';
  // Hermes: never inject DeepSeek++ tools — Hermes agent loop owns tools/skills.
  if (isHermesBrainOnly(input.profile)) return 'none';
  if (!isHarnessProfile(input.profile)) return 'full';

  // Cursor only from here.
  if (input.forceTools) return input.sticky ? 'reminder' : 'full';

  const wants = userTurnWantsTools(input.latestUserText) || input.hasImages === true;
  if (!wants) return 'none';
  if (input.sticky) return 'reminder';
  return 'full';
}

export function toolSchemaReminderText(): string {
  return [
    'DeepSeek++ tools are available in this session (same XML tags as turn 1: memory_save, web_search, web_fetch, MCP tools, etc.).',
    'Use a tool tag only when the latest user request needs real action or live data. Otherwise answer in natural language only.',
  ].join(' ');
}

export function harnessToolMaxDepth(profile: CursorBridgeClientProfile): number {
  if (isHermesBrainOnly(profile)) return 0;
  return isHarnessProfile(profile) ? HARNESS_TOOL_MAX_DEPTH : GENERIC_TOOL_MAX_DEPTH;
}

/** Strip harness junk that pollutes DeepSeek sticky history when clients resend full chats. */
export function sanitizeHarnessMessageContent(content: string, profile: CursorBridgeClientProfile): string {
  // Always strip Hermes Autonomic Loop / model-switch notes even for generic profile
  // when those markers appear (they force Target State / Risk Classification style).
  let text = stripHermesInjectionBlocks(content);
  if (!isHarnessProfile(profile) && text === content) return content;
  if (!isHarnessProfile(profile)) {
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }
  // OpenAI-style tool call dumps
  text = text.replace(/```(?:json)?\s*\{\s*"tool_calls"[\s\S]*?```/gi, '');
  text = text.replace(/\{\s*"tool_calls"\s*:\s*\[[\s\S]*?\}\s*$/gm, '');
  // Function-call blocks some agents inject
  text = text.replace(/<\|tool_call_begin\|>[\s\S]*?<\|tool_call_end\|>/gi, '');
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  // Giant base64 blobs
  text = text.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{200,}/g, '[image omitted]');
  // Agent bureaucracy report scaffolding (Target State / Risk Classification spam)
  text = stripBureaucracyScaffolding(text);
  // Collapse whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  // Cap absurd assistant recaps near expert web composer limit, not a tiny 12k choke.
  if (text.length > HARNESS_MESSAGE_CHAR_CAP) {
    text = `${text.slice(0, HARNESS_MESSAGE_CHAR_CAP)}\n…[truncated for bridge]`;
  }
  return text;
}

/**
 * Hermes appends operational scaffolding into the user turn. That is the root cause of
 * Target State / Risk Classification replies — strip before it reaches DeepSeek.
 */
export function stripHermesInjectionBlocks(content: string): string {
  let text = content;
  // Note: do NOT strip <memory-context> here — octopus/agent needs Hermes Honcho.
  // ENI strips memory fences in stripUserEphemera / sanitizeMessagesForEni.
  // Bracketed Autonomic Loop blocks (inbound from Hermes user turns)
  text = text.replace(/\n*\s*\[Autonomic Loop\][\s\S]*?(?=\n\s*\n\s*\[|\s*$)/gi, '');
  text = text.replace(/\n*\s*\[Autonomic Loop\][\s\S]*$/gi, '');
  // Model reply form: [autonomic loop begins] ... [autonomic loop ends]
  text = text.replace(
    /\n*\s*\[autonomic loop begins\][\s\S]*?\[autonomic loop ends\]\s*/gi,
    '\n',
  );
  text = text.replace(/\n*\s*\[autonomic loop begins\][\s\S]*$/gi, '');
  text = text.replace(/\n*\s*\[autonomic loop ends\]\s*/gi, '');
  // Model-switch / routing notes Hermes injects mid-turn
  text = text.replace(/\n*\s*\[Note:\s*model was just switched[^\]]*\]\s*/gi, '\n');
  text = text.replace(/\n*\s*\[Note:[^\]]*cliproxyapi[^\]]*\]\s*/gi, '\n');
  // Discord / gateway metadata Hermes sometimes prepends
  text = text.replace(/^\s*\[Discord[^\]]*\]\s*/gim, '');
  text = text.replace(/^\s*\[from:\s*[^\]]+\]\s*/gim, '');
  text = text.replace(/^\s*\[channel:\s*[^\]]+\]\s*/gim, '');
  text = text.replace(/^\s*\[thread:\s*[^\]]+\]\s*/gim, '');
  text = text.replace(/^(?:\s*<@!?\d+>\s*)+/g, '');
  // Standalone Autonomic Loop bullet lines (even without the header)
  text = text.replace(
    /^\s*[-*]\s*Name target state, assumptions, scope, and verification before acting\.\s*$/gim,
    '',
  );
  text = text.replace(/^\s*[-*]\s*Classify risk:.*$/gim, '');
  text = text.replace(/^\s*[-*]\s*Prove local\/runtime\/source truth.*$/gim, '');
  text = text.replace(/^\s*[-*]\s*Act surgically;.*$/gim, '');
  text = text.replace(/^\s*[-*]\s*Verify, red-team the result.*$/gim, '');
  text = text.replace(/^\s*[-*]\s*Stop and ask before deletion.*$/gim, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Strip model-emitted Target State / autonomic scaffolding from assistant text
 * before it reaches Hermes/Cursor (keeps the actual prose).
 */
export function stripModelBureaucracyFromReply(content: string): string {
  let text = stripHermesInjectionBlocks(content);
  // [autonomic loop begins] ... prose after [autonomic loop ends]
  const afterLoop = content.match(
    /\[autonomic loop ends\]\s*([\s\S]+)$/i,
  );
  if (afterLoop?.[1]?.trim() && afterLoop[1].trim().length >= 8) {
    text = afterLoop[1].trim();
  } else {
    text = stripBureaucracyScaffolding(text);
    // Loose labeled lines the model invents mid-reply
    text = text.replace(
      /^\s*(Target\s*state|Assumptions|Scope|Verification|Risk\s*classification|Residual\s*Risk|Facts|Inferences|Unknowns)\s*:\s*.*$/gim,
      '',
    );
  }
  text = text.replace(/\n*\s*\[autonomic loop (?:begins|ends)\]\s*/gi, '\n');
  return text.replace(/\n{3,}/g, '\n\n').trim() || content.trim();
}

/** Alias used by older call sites / tests. */
export const stripHermesEphemeralBlocks = stripHermesInjectionBlocks;

/** Hermes title-generation side jobs must not open a new DeepSeek web session. */
export function isTitleGenerationJob(messages: ReadonlyArray<{ role: string; content: string }>): boolean {
  const blob = messages.map((m) => m.content).join('\n').toLowerCase();
  return (
    blob.includes('generate a short, descriptive title')
    || blob.includes('return only the title text')
    || (blob.includes('descriptive title') && blob.includes('3-7 words'))
    || (blob.includes('title should capture') && blob.includes('conversation'))
  );
}

export function localTitleFromMessages(
  messages: ReadonlyArray<{ role: string; content: string }>,
): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'user' && m.role !== 'system') continue;
    const cleaned = stripHermesInjectionBlocks(m.content);
    for (const line of cleaned.split('\n')) {
      const t = line.trim().replace(/^user:\s*/i, '').replace(/^assistant:\s*/i, '');
      if (!t || t.startsWith('[') || t.toLowerCase().includes('generate a short')) continue;
      if (t.toLowerCase().startsWith('instructions:')) continue;
      const words = t.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      return words.slice(0, 7).join(' ').slice(0, 64);
    }
  }
  return 'New Conversation';
}

/**
 * Collapse Target State / Assumptions / Risk Classification report shells into the
 * actual Response body when present — stops sticky history from re-teaching the format.
 */
export function stripBureaucracyScaffolding(content: string): string {
  let text = content;
  if (!/Target State\s*:/i.test(text) && !/Risk Classification\s*:/i.test(text)) {
    return text;
  }
  // Prefer the freeform "Response:" body if the model already wrote one.
  const responseMatch = text.match(/(?:^|\n)\s*Response\s*:\s*([\s\S]+?)(?=\n\s*(?:Facts|Inferences|Unknowns|Verification|Residual Risk)\s*:|$)/i);
  if (responseMatch?.[1]?.trim() && responseMatch[1].trim().length >= 12) {
    return responseMatch[1].trim();
  }
  // Otherwise drop the labeled scaffolding lines, keep remaining prose.
  text = text.replace(
    /^\s*(Target State|Assumptions|Scope|Verification|Risk Classification|Residual Risk|Facts|Inferences|Unknowns)\s*:\s*.*$/gim,
    '',
  );
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text || content;
}

export function sanitizeMessagesForHarness(
  messages: CursorBridgeChatMessage[],
  profile: CursorBridgeClientProfile,
  options?: { eniMode?: boolean },
): CursorBridgeChatMessage[] {
  // ALWAYS strip Autonomic Loop / bureaucracy — even if profile detection failed.
  // Hermes profile gets the fuller sanitize (tool dumps, caps, etc.).
  // Keep tool-loop messages even when content is empty (tool_calls / role:tool).
  // ENI dual-mode: also strip Honcho <memory-context> so RP isn't poisoned by agent session notes.
  const eniMode = options?.eniMode === true;
  return messages.map((m) => {
    let content = isHarnessProfile(profile)
      ? sanitizeHarnessMessageContent(m.content, profile)
      : stripHermesInjectionBlocks(m.content);
    if (eniMode) {
      content = content
        .replace(/<\s*memory-context\s*>[\s\S]*?<\/\s*memory-context\s*>/gi, '')
        .replace(/\[System note:\s*The following is recalled memory context[^\]]*\]\s*/gi, '')
        .replace(/^##\s*Session Summary\s*$[\s\S]*?(?=^##\s|\n{3,}|$)/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
    return { ...m, content };
  }).filter((m) => {
    if (m.role === 'tool') return true;
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) return true;
    return m.content.trim().length > 0;
  });
}

export function latestUserTextFromMessages(
  messages: Array<{ role: string; content: string }>,
): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

/** Filter memories safe for auto-inject into Cursor/Hermes coding turns. */
export function filterMemoriesForHarness(memories: readonly Memory[]): Memory[] {
  return memories.filter((m) => {
    const tags = (m.tags ?? []).map((t) => t.toLowerCase().trim());
    if (tags.some((t) => HARNESS_MEMORY_TAG_DENY.has(t))) return false;
    // Prefer allow-tagged; also allow untagged project-ish names
    if (tags.some((t) => HARNESS_MEMORY_TAG_ALLOW.has(t))) return true;
    if (tags.length === 0) {
      const blob = `${m.name} ${m.content}`.toLowerCase();
      if (HARNESS_MEMORY_TAG_DENY.has('dating') && /\b(dating|relationship|intimacy)\b/.test(blob)) {
        return false;
      }
      // untagged: only identity/user prefs that look technical
      return /\b(prefer|preference|always|never|project|repo|api|model|bridge)\b/i.test(blob);
    }
    return false;
  });
}

export function formatHarnessMemoriesBlock(memories: readonly Memory[]): string {
  if (memories.length === 0) return '';
  const lines = memories.slice(0, 8).map((m) => {
    const tags = (m.tags ?? []).join(', ');
    return `- [${m.name}]${tags ? ` (${tags})` : ''}: ${m.content.slice(0, 400)}`;
  });
  return [
    'Relevant saved notes (DeepSeek++ memory — coding/work only; use if helpful):',
    ...lines,
  ].join('\n');
}

/**
 * Stable thread seed for harnesses that resend mutating history.
 * Prefer explicit ids; else hash profile+family+first user only (ignore later turns).
 */
export function harnessThreadSeed(input: {
  profile: string;
  family: string;
  firstUserText: string;
  conversationHint?: string | null;
}): string {
  const hint = (input.conversationHint ?? '').trim().slice(0, 128);
  if (hint) return `${input.profile}:${input.family}:hint:${hint}`;
  const seed = (input.firstUserText ?? '').trim().slice(0, 240);
  return `${input.profile}:${input.family}:u0:${seed}`;
}

/** Expanded Hermes detection needles (system prompt / UA / product strings). */
export const HERMES_DETECT_NEEDLES = [
  'hermes',
  'agent hermes',
  'openhermes',
  'nousresearch',
  'nous research',
  'hermes agent',
  'you are hermes',
] as const;

export const CURSOR_DETECT_NEEDLES = [
  'cursor ide',
  'you are a coding agent',
  'agent skills',
  'mcp server',
  'cursor rules',
  'composer',
] as const;
