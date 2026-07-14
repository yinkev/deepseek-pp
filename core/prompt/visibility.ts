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
const LEGACY_CHINESE_CONTINUATION = '请根据上述工具执行结果继续回答。';

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
  let next = text.replace(/\r\n/g, '\n');
  // Do not rewrite marker literals inside JSON string values. Only repair
  // structural collapse around the outer envelope boundary.
  if (next.startsWith(`${PROVIDER_TOOL_RESULTS_OPEN}`) && !next.startsWith(`${PROVIDER_TOOL_RESULTS_OPEN}\n`)) {
    next = `${PROVIDER_TOOL_RESULTS_OPEN}\n${next.slice(PROVIDER_TOOL_RESULTS_OPEN.length)}`;
  }
  // JSON array/object end or XML close tag glued to the outer close marker.
  next = next.replace(/(\]|>)\[\/TOOL_RESULTS\]/g, `$1\n${PROVIDER_TOOL_RESULTS_CLOSE}`);
  // Restore the generated blank line before the continuation body when block
  // rendering collapsed it away.
  next = next.replace(
    /\[\/TOOL_RESULTS\]\n?(?=Original task:|Continue answering based on the tool results above\.|请根据上述工具执行结果继续回答。)/g,
    `${PROVIDER_TOOL_RESULTS_CLOSE}\n\n`,
  );
  return next;
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
  if (!fromOpen.startsWith(`${PROVIDER_TOOL_RESULTS_OPEN}\n`)) return null;

  // Walk candidate close markers from the payload region only. Prefer the first
  // close that yields a structured payload AND a valid continuation body so a
  // later `[/TOOL_RESULTS]` inside Original task: cannot steal the outer boundary.
  // Payload-internal close literals are skipped because they leave a remainder
  // that is not a blank line + Original task / legacy suffix.
  const closeToken = `\n${PROVIDER_TOOL_RESULTS_CLOSE}\n`;
  let searchFrom = PROVIDER_TOOL_RESULTS_OPEN.length;
  while (searchFrom < fromOpen.length) {
    const closeIndex = fromOpen.indexOf(closeToken, searchFrom);
    if (closeIndex === -1) return null;

    const payload = fromOpen.slice(PROVIDER_TOOL_RESULTS_OPEN.length + 1, closeIndex);
    if (!isStructuredToolResultsPayload(payload)) {
      searchFrom = closeIndex + 1;
      continue;
    }

    const afterCloseStart = closeIndex + closeToken.length;
    const remainder = fromOpen.slice(afterCloseStart);
    // Generated forms always insert a blank line after the close marker.
    if (!remainder.startsWith('\n') && !remainder.startsWith('\r\n')) {
      searchFrom = closeIndex + 1;
      continue;
    }
    const afterClose = remainder.replace(/^\r?\n*/, '');
    if (!afterClose) {
      searchFrom = closeIndex + 1;
      continue;
    }
    const leadingBlankLength = remainder.length - afterClose.length;
    const bodyLength = measureContinuationBodyLength(afterClose);
    if (bodyLength === null) {
      searchFrom = closeIndex + 1;
      continue;
    }
    return afterCloseStart + leadingBlankLength + bodyLength;
  }
  return null;
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

function isStructuredToolResultsPayload(payload: string): boolean {
  const trimmed = payload.trim();
  if (!trimmed) return false;

  // Provider loop: JSON array/object of tool results (must actually parse).
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.length >= 0;
      return parsed !== null && typeof parsed === 'object';
    } catch {
      return false;
    }
  }

  // Legacy sidepanel: one or more matching <name>...</name> wrappers.
  let rest = trimmed;
  let sawBlock = false;
  while (rest.length > 0) {
    const openMatch = rest.match(/^<([A-Za-z][\w-]*)>/);
    if (!openMatch || !openMatch[1]) return false;
    const tag = openMatch[1];
    const close = `</${tag}>`;
    const closeIndex = rest.indexOf(close, openMatch[0].length);
    if (closeIndex === -1) return false;
    rest = rest.slice(closeIndex + close.length).replace(/^\s+/, '');
    sawBlock = true;
  }
  return sawBlock;
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
  return /^(just now|copy|copied|share|regenerate|重新生成|刚刚|复制|分享|retry|重试|\d+\s*(s|m|h|min|sec|ago|秒|分钟前|小时前)?)$/i.test(line);
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
