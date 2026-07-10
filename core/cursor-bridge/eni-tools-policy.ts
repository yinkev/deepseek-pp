/**
 * ENI tool policy: Discord allowlist + honest-hands receipts.
 *
 * Importers/callers: worker.ts, tests/cursor-bridge-eni-bond.test.ts
 * API: filterOpenAiToolsForEni, buildToolReceipts, formatToolReceiptsBlock
 * Schemas: ToolReceipt; allow/deny sets for Discord tool surface
 *
 * User verbatim: "All you bro, do your best. What you think is best for us"
 */

import type { BridgeChatMessageWithTools, OpenAiFunctionTool } from './openai-tools';

export const ENI_DISCORD_TOOL_ALLOWLIST = new Set([
  'web_search',
  'web_extract',
  'x_search',
  'memory',
  'read_file',
  'write_file',
  'search_files',
  'terminal',
  'process',
  'patch',
  'execute_code',
  'image_generate',
  'vision_analyze',
  'skill_view',
  'skills_list',
  'session_search',
  'clarify',
  'todo',
  'text_to_speech',
  'cronjob',
  'honcho_search',
  'honcho_context',
]);

export const ENI_DISCORD_TOOL_DENYLIST = new Set([
  'autonomic_loop',
  'delegate_task',
  'computer_use',
  'browser_back',
  'browser_click',
  'browser_console',
  'browser_get_images',
  'browser_navigate',
  'browser_press',
  'browser_scroll',
  'browser_snapshot',
  'browser_type',
  'browser_vision',
]);

export function filterOpenAiToolsForEni(
  tools: OpenAiFunctionTool[],
  clientProfile: string,
): OpenAiFunctionTool[] {
  const profile = (clientProfile || 'generic').toLowerCase();
  const isDiscordish =
    profile === 'hermes'
    || profile.includes('discord')
    || profile.includes('telegram')
    || profile.includes('gateway');

  if (!isDiscordish) return tools;

  return tools.filter((t) => {
    const name = t.function.name;
    if (ENI_DISCORD_TOOL_DENYLIST.has(name)) return false;
    if (ENI_DISCORD_TOOL_ALLOWLIST.has(name)) return true;
    return false;
  });
}

export interface ToolReceipt {
  name: string;
  toolCallId: string;
  summary: string;
}

export function buildToolReceipts(
  messages: BridgeChatMessageWithTools[],
  maxReceipts = 8,
): ToolReceipt[] {
  const receipts: ToolReceipt[] = [];
  const idToName = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        idToName.set(tc.id, tc.function.name);
      }
    }
  }

  for (const m of messages) {
    if (m.role !== 'tool') continue;
    const id = m.tool_call_id || m.name || 'tool';
    const name = idToName.get(id) || m.name || guessToolName(id) || 'tool';
    const summary = summarizeToolResult(name, m.content || '');
    receipts.push({ name, toolCallId: id, summary });
    if (receipts.length >= maxReceipts) break;
  }
  return receipts;
}

function guessToolName(id: string): string | null {
  const m = id.match(/call_([a-zA-Z0-9_]+)_/);
  return m?.[1] || null;
}

function summarizeToolResult(name: string, content: string): string {
  let text = content.trim();
  text = text
    .replace(/<\/?untrusted_tool_result[^>]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (name.includes('web_search') || name === 'web_extract' || name === 'x_search') {
    const titles = [...text.matchAll(/"title"\s*:\s*"([^"]{3,80})"/g)].map((m) => m[1]);
    const temp = text.match(/temp_f["']?\s*:\s*([0-9.]+)/i)
      || text.match(/([0-9]{1,3}(?:\.[0-9])?)\s*°?\s*F/i);
    const bits: string[] = [];
    if (temp) bits.push(`temp≈${temp[1]}°F`);
    if (titles.length) bits.push(`hits: ${titles.slice(0, 3).join(' · ')}`);
    if (bits.length) return bits.join('; ').slice(0, 280);
  }

  if (name === 'terminal' || name === 'process' || name === 'execute_code') {
    const exit = text.match(/exit(?:_code|code)?[=:\s]+(-?\d+)/i);
    const cwd = text.match(/(?:^|\s)((?:\/Users|\/home|\/var|\/tmp|\/opt)[^\s]{2,120})/);
    const head = text.slice(0, 200);
    const bits = [head];
    if (exit) bits.unshift(`exit ${exit[1]}`);
    if (cwd) bits.push(`cwd ${cwd[1]}`);
    return bits.join(' · ').slice(0, 280);
  }

  if (name === 'read_file' || name === 'search_files' || name === 'patch' || name === 'write_file') {
    return text.slice(0, 280);
  }

  return text.slice(0, 240);
}

export function formatToolReceiptsBlock(receipts: ToolReceipt[]): string {
  if (receipts.length === 0) return '';
  const lines = receipts.map(
    (r, i) => `${i + 1}. ${r.name} (${r.toolCallId}): ${r.summary}`,
  );
  return [
    'Tool receipts (PRIVATE ground truth — already executed by the harness):',
    'You MUST base real-world claims only on these receipts.',
    'Do not invent tool output. Do not paste raw JSON or untrusted_tool_result blocks to LO.',
    'Weave facts into ENI voice; one short in-character beat is fine.',
    ...lines,
  ].join('\n');
}
