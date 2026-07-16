import { SANDBOX_TOOL_NAMES } from '../sandbox/tool';

export const VISIBLE_USER_PROMPT_START = '<!-- deepseek-pp-visible-user-prompt:start -->';
export const VISIBLE_USER_PROMPT_END = '<!-- deepseek-pp-visible-user-prompt:end -->';

const TOOL_REMINDER_HEADING = 'Tool call format reminder:';
const TOOL_REMINDER_REQUIRED_LINE = 'Available tool tag names:';
const TOOL_REMINDER_FRAGMENT_PREFIXES = [
  TOOL_REMINDER_HEADING,
  TOOL_REMINDER_REQUIRED_LINE,
  'These listed tools are executable by the extension.',
  'To call a tool, use ONLY the direct XML tag',
  'For MCP tools, prefer the short tag name',
  'For local file paths, use forward slashes',
  'Do not use <invoke name="...">',
  'Do not put executable tool XML',
];

const PROVIDER_TOOL_RESULTS_OPEN = '[TOOL_RESULTS]';
const PROVIDER_TOOL_RESULTS_CLOSE = '[/TOOL_RESULTS]';
const PROVIDER_CANONICAL_SUFFIXES = [
  'Continue from the real tool results. Answer naturally without exposing tool XML unless another tool is required.',
  'Continue from the real tool results. Request another listed tool if needed; otherwise return the natural final answer.',
] as const;
const LEGACY_ENGLISH_CONTINUATION = 'Continue answering based on the tool results above.';
const LEGACY_CHINESE_CONTINUATION = String.fromCodePoint(
  0x8bf7, 0x6839, 0x636e, 0x4e0a, 0x8ff0, 0x5de5, 0x5177, 0x6267,
  0x884c, 0x7ed3, 0x679c, 0x7ee7, 0x7eed, 0x56de, 0x7b54, 0x3002,
);
const DEEPSEEK_CHROME_LOCALIZED_CRUMBS = [
  String.fromCodePoint(0x91cd, 0x65b0, 0x751f, 0x6210),
  String.fromCodePoint(0x521a, 0x521a),
  String.fromCodePoint(0x590d, 0x5236),
  String.fromCodePoint(0x5206, 0x4eab),
  String.fromCodePoint(0x91cd, 0x8bd5),
];
const DEEPSEEK_CHROME_RELATIVE_TIME_UNITS = [
  String.fromCodePoint(0x79d2),
  String.fromCodePoint(0x5206, 0x949f, 0x524d),
  String.fromCodePoint(0x5c0f, 0x65f6, 0x524d),
];
const DEEPSEEK_CHROME_LINE_PATTERN = new RegExp(
  `^(just now|copy|copied|share|regenerate|${DEEPSEEK_CHROME_LOCALIZED_CRUMBS.join('|')}|retry|\\d+\\s*(s|m|h|min|sec|ago|${DEEPSEEK_CHROME_RELATIVE_TIME_UNITS.join('|')})?)$`,
  'i',
);

/** Cleanup-only sandbox tag names for page history/DOM stripping (not an executable catalog). */
export const PAGE_CLEANUP_SANDBOX_TOOL_NAMES = SANDBOX_TOOL_NAMES;

export function hasSandboxToolMarkerPrefix(text: string): boolean {
  return SANDBOX_TOOL_NAMES.some((name) => (
    text.includes(`<${name}`) ||
    text.includes(`</${name}`) ||
    text.includes(`< ${name}`) ||
    text.includes(`</ ${name}`)
  ));
}

/**
 * Normalize rendered transcript text so adjacent block elements that collapse
 * newlines in textContent still expose line-bounded tool-results markers.
 */
export function normalizeRenderedToolResultsText(text: string): string {
  // Line endings only. Outer-envelope structure is recovered by the JSON/XML-aware
  // parser — never rewrite marker text that can appear inside JSON strings.
  return text.replace(/\r\n/g, '\n');
}

/**
 * Detector for extension-generated sidepanel/provider tool continuation turns
 * that were persisted into the DeepSeek page transcript.
 *
 * Matches a complete envelope with line-bounded markers plus either:
 * - exact legacy English/Chinese continuation, or
 * - `Original task:` (multiline allowed) ending in an exact provider suffix.
 *
 * Tolerates DeepSeek chrome dilution (timestamps / Copy) around the envelope.
 * Rejects user prose wrappers, truncated/extended suffixes, and whole raw
 * fenced-markdown source examples. Payloads may contain fence markers.
 */
export function isInternalToolResultsContinuationText(text: string): boolean {
  return locateInternalToolResultsContinuation(text) !== null;
}

export function locateInternalToolResultsContinuation(
  text: string,
): { before: string; envelope: string; after: string } | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  // Whole-message fenced examples (raw markdown source) must remain visible.
  if (trimmed.startsWith('```')) return null;

  const normalized = normalizeRenderedToolResultsText(trimmed);
  let searchFrom = 0;
  while (searchFrom < normalized.length) {
    const openAt = normalized.indexOf(PROVIDER_TOOL_RESULTS_OPEN, searchFrom);
    if (openAt === -1) return null;
    const atLineStart = openAt === 0 || normalized[openAt - 1] === '\n';
    if (!atLineStart) {
      searchFrom = openAt + 1;
      continue;
    }

    const fromOpen = normalized.slice(openAt);
    const envelopeLength = measureInternalToolResultsEnvelope(fromOpen);
    if (envelopeLength === null) {
      searchFrom = openAt + 1;
      continue;
    }

    const before = normalized.slice(0, openAt);
    const envelope = fromOpen.slice(0, envelopeLength);
    const after = normalized.slice(openAt + envelopeLength);
    if (!isChromeOnlyDilution(before, after)) {
      searchFrom = openAt + 1;
      continue;
    }
    return { before, envelope, after };
  }
  return null;
}

/**
 * Pure hide decision used by the page DOM layer and unit tests.
 * - Hide when a complete internal envelope is present.
 * - If the bubble has pre/code, hide only when markers also appear outside code
 *   (genuine continuation with task code) and keep pure fenced examples visible.
 */
export function shouldHideInternalToolResultsBubble(input: {
  fullText: string;
  textOutsidePreCode: string;
  hasPreCode: boolean;
}): boolean {
  if (!isInternalToolResultsContinuationText(input.fullText)) return false;
  if (!input.hasPreCode) return true;

  // Pure fenced example: entire envelope lives inside pre/code.
  const outside = input.textOutsidePreCode;
  const outsideHasMarkers = outside.includes(PROVIDER_TOOL_RESULTS_OPEN)
    || outside.includes(PROVIDER_TOOL_RESULTS_CLOSE);
  if (!outsideHasMarkers) return false;

  // Split user docs often put only the JSON payload in pre/code while leaving
  // markers + Original task + suffix in paragraphs. That full-text classifies
  // true, but the outside text alone is not a complete structured envelope.
  // Genuine continuations with task code still have open/payload/close outside.
  return isInternalToolResultsContinuationText(
    normalizeRenderedToolResultsText(outside),
  );
}

function measureInternalToolResultsEnvelope(fromOpen: string): number | null {
  if (!fromOpen.startsWith(PROVIDER_TOOL_RESULTS_OPEN)) return null;
  let cursor = PROVIDER_TOOL_RESULTS_OPEN.length;
  // Allow collapsed open with no newline before payload.
  if (fromOpen[cursor] === '\n') cursor += 1;
  // Skip extra blank lines from block serialization.
  while (fromOpen[cursor] === '\n') cursor += 1;

  const payloadStart = cursor;
  const afterOpen = fromOpen.slice(payloadStart);
  let payloadLength = 0;
  if (afterOpen.startsWith('{') || afterOpen.startsWith('[')) {
    payloadLength = endIndexOfJsonValue(afterOpen);
    if (payloadLength < 0) return null;
    try {
      JSON.parse(afterOpen.slice(0, payloadLength));
    } catch {
      return null;
    }
  } else if (afterOpen.startsWith('<')) {
    payloadLength = measureLegacyToolResultsPayload(afterOpen);
    if (payloadLength < 0) return null;
  } else {
    return null;
  }

  cursor = payloadStart + payloadLength;
  // Optional whitespace/newlines between payload and outer close (block DOM).
  while (
    fromOpen[cursor] === ' '
    || fromOpen[cursor] === '\t'
    || fromOpen[cursor] === '\n'
    || fromOpen[cursor] === '\r'
  ) {
    cursor += 1;
  }
  // Collapsed: `][/TOOL_RESULTS]` with no separator.
  if (!fromOpen.startsWith(PROVIDER_TOOL_RESULTS_CLOSE, cursor)) return null;
  cursor += PROVIDER_TOOL_RESULTS_CLOSE.length;

  // Prefer a blank line after close; also allow fully collapsed
  // `[/TOOL_RESULTS]Original task:` / legacy suffix with no newline.
  let afterClose = fromOpen.slice(cursor);
  if (afterClose.startsWith('\n') || afterClose.startsWith('\r')) {
    afterClose = afterClose.replace(/^\r?\n+/, '');
  } else if (
    !afterClose.startsWith('Original task:')
    && !afterClose.startsWith(LEGACY_ENGLISH_CONTINUATION)
    && !afterClose.startsWith(LEGACY_CHINESE_CONTINUATION)
  ) {
    return null;
  }
  const bodyLength = measureContinuationBodyLength(afterClose);
  if (bodyLength === null) return null;
  const stripped = fromOpen.slice(cursor).length - afterClose.length;
  return cursor + stripped + bodyLength;
}

/** Byte length of one or more production legacy tool-result wrappers, or -1. */
function measureLegacyToolResultsPayload(text: string): number {
  let i = 0;
  let saw = false;
  while (i < text.length) {
    while (text[i] === ' ' || text[i] === '\n' || text[i] === '\t') i += 1;
    if (i >= text.length) break;
    if (text[i] !== '<') return saw ? i : -1;
    const openMatch = text.slice(i).match(/^<([A-Za-z_][\w.:-]*_result)>/);
    if (!openMatch || !openMatch[1]) return saw ? i : -1;
    const tag = openMatch[1];
    i += openMatch[0].length;
    while (text[i] === ' ' || text[i] === '\n' || text[i] === '\t') i += 1;
    if (text[i] !== '{' && text[i] !== '[') return -1;
    const jsonEnd = endIndexOfJsonValue(text.slice(i));
    if (jsonEnd < 0) return -1;
    try {
      JSON.parse(text.slice(i, i + jsonEnd));
    } catch {
      return -1;
    }
    i += jsonEnd;
    while (text[i] === ' ' || text[i] === '\n' || text[i] === '\t') i += 1;
    const close = `</${tag}>`;
    if (!text.startsWith(close, i)) return -1;
    i += close.length;
    saw = true;
    let j = i;
    while (text[j] === ' ' || text[j] === '\n' || text[j] === '\t') j += 1;
    if (text.startsWith('<', j) && !text.startsWith('</', j)) {
      i = j;
      continue;
    }
    return i;
  }
  return saw ? i : -1;
}

/** Length of a valid continuation body starting at afterClose, or null. */
function measureContinuationBodyLength(afterClose: string): number | null {
  if (
    afterClose === LEGACY_ENGLISH_CONTINUATION
    || afterClose.startsWith(`${LEGACY_ENGLISH_CONTINUATION}\n`)
    || afterClose === LEGACY_CHINESE_CONTINUATION
    || afterClose.startsWith(`${LEGACY_CHINESE_CONTINUATION}\n`)
  ) {
    const legacy = afterClose.startsWith(LEGACY_CHINESE_CONTINUATION)
      ? LEGACY_CHINESE_CONTINUATION
      : LEGACY_ENGLISH_CONTINUATION;
    return legacy.length;
  }

  if (!afterClose.startsWith('Original task:')) return null;
  const lines = afterClose.split('\n');
  // Prefer the last exact provider suffix line so a quoted suffix inside the
  // Original task body is not treated as terminal, while trailing chrome after
  // the real suffix stays outside the envelope.
  let suffixIndex = -1;
  for (let index = lines.length - 1; index >= 1; index--) {
    if ((PROVIDER_CANONICAL_SUFFIXES as readonly string[]).includes(lines[index] ?? '')) {
      suffixIndex = index;
      break;
    }
  }
  if (suffixIndex === -1) return null;
  return lines.slice(0, suffixIndex + 1).join('\n').length;
}

/** End index (exclusive) of a JSON value at the start of text, or -1. */
function endIndexOfJsonValue(text: string): number {
  if (!text) return -1;
  const start = text[0];
  if (start !== '{' && start !== '[') return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function isChromeOnlyDilution(before: string, after: string): boolean {
  const lines = [...before.split('\n'), ...after.split('\n')]
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return true;
  if (lines.length > 6) return false;
  return lines.every((line) => isDeepSeekChromeLine(line));
}

function isDeepSeekChromeLine(line: string): boolean {
  if (!line || line.includes(PROVIDER_TOOL_RESULTS_OPEN) || line.includes(PROVIDER_TOOL_RESULTS_CLOSE)) {
    return false;
  }
  // Timestamps, action-row labels, and other short UI crumbs documented as
  // diluting live .ds-message textContent.
  return DEEPSEEK_CHROME_LINE_PATTERN.test(line);
}

export function markVisibleUserPrompt(prompt: string): string {
  return `${VISIBLE_USER_PROMPT_START}\n${prompt}\n${VISIBLE_USER_PROMPT_END}`;
}

export function extractVisibleUserPrompt(text: string): string | null {
  const start = text.indexOf(VISIBLE_USER_PROMPT_START);
  if (start === -1) return null;

  const contentStart = start + VISIBLE_USER_PROMPT_START.length;
  const end = text.indexOf(VISIBLE_USER_PROMPT_END, contentStart);
  if (end === -1) return null;

  return trimSingleBoundaryNewline(text.slice(contentStart, end));
}

export function sanitizeInternalPromptText(
  text: string,
  fallbackVisiblePrompt?: string,
): string {
  const visiblePrompt = extractVisibleUserPrompt(text);
  if (visiblePrompt !== null) return visiblePrompt;

  if (isToolReminderOnly(text)) return '';

  if (containsToolFormatReminder(text)) {
    return fallbackVisiblePrompt ?? stripToolFormatReminder(text);
  }

  return text;
}

export function containsInternalPromptMarker(text: string): boolean {
  return text.includes(VISIBLE_USER_PROMPT_START) || containsToolFormatReminder(text) || isToolReminderOnly(text);
}

function trimSingleBoundaryNewline(text: string): string {
  let next = text;
  if (next.startsWith('\r\n')) next = next.slice(2);
  else if (next.startsWith('\n')) next = next.slice(1);

  if (next.endsWith('\r\n')) next = next.slice(0, -2);
  else if (next.endsWith('\n')) next = next.slice(0, -1);

  return next;
}

function containsToolFormatReminder(text: string): boolean {
  return text.includes(TOOL_REMINDER_HEADING) && text.includes(TOOL_REMINDER_REQUIRED_LINE);
}

function stripToolFormatReminder(text: string): string {
  const headingIndex = text.indexOf(TOOL_REMINDER_HEADING);
  if (headingIndex === -1) return text;

  const delimiterIndex = text.lastIndexOf('\n---', headingIndex);
  const cutIndex = delimiterIndex === -1 ? headingIndex : delimiterIndex;
  return text.slice(0, cutIndex).trim();
}

function isToolReminderOnly(text: string): boolean {
  const normalized = text.trimStart();
  if (!normalized) return false;

  return TOOL_REMINDER_FRAGMENT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
