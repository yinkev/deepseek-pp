/**
 * OpenAI-compatible tools for Hermes/Cursor harnesses.
 *
 * Importers/callers: protocol.ts (message types), openai.ts (parse body),
 * worker.ts (inject + parse), packages/cursor-bridge-host (HTTP responses),
 * tests/cursor-bridge-openai-tools.test.ts.
 *
 * Affected API: chat.completions accepts `tools` + role:tool messages;
 * responses may include `tool_calls` with finish_reason tool_calls.
 * Schemas: OpenAiFunctionTool, OpenAiToolCall, BridgeChatMessageWithTools.
 *
 * User verbatim: "I want to give her tools in hermes and discord"
 *
 * Hermes sends `tools` + later `role:tool` results. DeepSeek web has no native
 * function-calling API, so we inject schemas into the prompt and parse
 * tool-call markup out of the model text into OpenAI `tool_calls`.
 */

export interface OpenAiFunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type BridgeChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface BridgeChatMessageWithTools {
  role: BridgeChatRole;
  content: string;
  /** Present on assistant turns that already requested tools. */
  tool_calls?: OpenAiToolCall[];
  /** Present on role:tool messages. */
  tool_call_id?: string;
  name?: string;
}

const TOOL_CALL_XML_RE =
  /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const FUNCTION_CALL_XML_RE =
  /<function_call>\s*([\s\S]*?)\s*<\/function_call>/gi;
const FUNCTION_CALLS_BLOCK_RE =
  /<function_calls>\s*([\s\S]*?)\s*<\/function_calls>/gi;
const INVOKE_RE =
  /<invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/gi;
const PARAM_RE =
  /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function argsToString(args: unknown): string {
  if (typeof args === 'string') return args;
  if (args == null) return '{}';
  return safeJsonStringify(args);
}

function makeToolCallId(index: number, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'fn';
  return `call_${safe}_${index}_${Date.now().toString(36)}`;
}

/** Normalize OpenAI `tools` array from a chat-completions body. */
export function normalizeOpenAiTools(raw: unknown): OpenAiFunctionTool[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenAiFunctionTool[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (rec.type !== 'function') continue;
    const fn = rec.function;
    if (!fn || typeof fn !== 'object') continue;
    const f = fn as Record<string, unknown>;
    if (typeof f.name !== 'string' || !f.name.trim()) continue;
    out.push({
      type: 'function',
      function: {
        name: f.name.trim(),
        description: typeof f.description === 'string' ? f.description : undefined,
        parameters: f.parameters,
      },
    });
  }
  return out.slice(0, 128);
}

export interface FormatOpenAiToolsOptions {
  /**
   * compact: shorter descriptions + truncated params (ENI dual-mode / expert composer budget).
   * full: richer schemas (default for pure agent models).
   */
  density?: 'full' | 'compact';
  /** Soft char budget for the whole block (compact mode trims tool list to fit). */
  maxChars?: number;
}

/** Compact schema block for DeepSeek prompt injection. */
export function formatOpenAiToolsForPrompt(
  tools: OpenAiFunctionTool[],
  options?: FormatOpenAiToolsOptions,
): string {
  if (tools.length === 0) return '';
  const density = options?.density ?? 'full';
  const maxChars = options?.maxChars ?? (density === 'compact' ? 14_000 : 40_000);
  const descCap = density === 'compact' ? 120 : 400;
  const paramsCap = density === 'compact' ? 280 : 2_000;

  const lines = tools.map((t) => {
    let params = t.function.parameters != null
      ? safeJsonStringify(t.function.parameters)
      : '{}';
    if (params.length > paramsCap) {
      params = `${params.slice(0, paramsCap)}…`;
    }
    const desc = (t.function.description ?? '').trim().slice(0, descCap);
    return [
      `- name: ${t.function.name}`,
      desc ? `  description: ${desc}` : null,
      `  parameters: ${params}`,
    ].filter(Boolean).join('\n');
  });

  const header = [
    'You have access to Hermes/OpenAI function tools. When you need a tool, emit ONE OR MORE tool calls and then stop.',
    'Do not claim you already ran a tool. Do not invent tool results.',
    'Emit tool calls using exactly this XML shape (JSON object inside):',
    '<tool_call>',
    '{"name": "tool_name", "arguments": {"arg": "value"}}',
    '</tool_call>',
    'You may emit multiple <tool_call> blocks. After tool results arrive, continue the task.',
    'If no tool is needed, answer the user in plain text with no tool_call markup.',
    '',
    'Available tools:',
  ].join('\n');

  // Fit under budget by dropping trailing tools (names-only footer for leftovers).
  let body = '';
  const included: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const next = body ? `${body}\n${lines[i]}` : lines[i];
    if (`${header}\n${next}`.length > maxChars && included.length > 0) {
      const rest = tools.slice(i).map((t) => t.function.name).join(', ');
      body = `${body}\n- (more tools, names only): ${rest}`;
      break;
    }
    body = next;
    included.push(tools[i].function.name);
  }

  return `${header}\n${body}`;
}

/** Render tool-role / prior tool_calls history into prompt text. */
export function formatToolHistoryForPrompt(
  messages: BridgeChatMessageWithTools[],
): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      const calls = message.tool_calls.map((tc) => (
        `<tool_call>\n${safeJsonStringify({
          name: tc.function.name,
          arguments: (() => {
            try {
              return JSON.parse(tc.function.arguments);
            } catch {
              return tc.function.arguments;
            }
          })(),
        })}\n</tool_call>`
      )).join('\n');
      const prose = (message.content || '').trim();
      parts.push(
        prose
          ? `Assistant (requested tools):\n${prose}\n${calls}`
          : `Assistant (requested tools):\n${calls}`,
      );
      continue;
    }
    if (message.role === 'tool') {
      const id = message.tool_call_id || message.name || 'tool';
      parts.push(
        `Tool result (${id}):\n${(message.content || '').trim()}`,
      );
    }
  }
  return parts.join('\n\n').trim();
}

function parseOneToolPayload(raw: string, index: number): OpenAiToolCall | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof obj.name === 'string') {
      return {
        id: typeof obj.id === 'string' ? obj.id : makeToolCallId(index, obj.name),
        type: 'function',
        function: {
          name: obj.name,
          arguments: argsToString(obj.arguments ?? obj.parameters ?? {}),
        },
      };
    }
    if (obj.function && typeof obj.function === 'object') {
      const fn = obj.function as Record<string, unknown>;
      if (typeof fn.name === 'string') {
        return {
          id: typeof obj.id === 'string' ? obj.id : makeToolCallId(index, fn.name),
          type: 'function',
          function: {
            name: fn.name,
            arguments: argsToString(fn.arguments ?? {}),
          },
        };
      }
    }
  } catch {
    // fall through
  }

  const nameMatch = trimmed.match(/["']?name["']?\s*[:=]\s*["']([^"']+)["']/i)
    || trimmed.match(/name\s*=\s*["']?([a-zA-Z0-9_.-]+)/i);
  if (!nameMatch) return null;
  let args: unknown = {};
  const argsMatch = trimmed.match(/["']?arguments["']?\s*[:=]\s*(\{[\s\S]*\})/i);
  if (argsMatch) {
    try {
      args = JSON.parse(argsMatch[1]);
    } catch {
      args = { raw: argsMatch[1] };
    }
  }
  return {
    id: makeToolCallId(index, nameMatch[1]),
    type: 'function',
    function: {
      name: nameMatch[1],
      arguments: argsToString(args),
    },
  };
}

/**
 * Parse tool calls from model text. Returns cleaned visible prose + tool_calls.
 */
export function parseOpenAiToolCallsFromText(text: string): {
  content: string;
  tool_calls: OpenAiToolCall[];
} {
  if (!text || !text.trim()) {
    return { content: '', tool_calls: [] };
  }

  const tool_calls: OpenAiToolCall[] = [];
  let working = text;

  const collectFromXml = (re: RegExp) => {
    working = working.replace(re, (_full, inner: string) => {
      const parsed = parseOneToolPayload(inner, tool_calls.length);
      if (parsed) tool_calls.push(parsed);
      return '\n';
    });
  };

  collectFromXml(TOOL_CALL_XML_RE);
  collectFromXml(FUNCTION_CALL_XML_RE);

  working = working.replace(FUNCTION_CALLS_BLOCK_RE, (_full, inner: string) => {
    const objs = inner.match(/\{[\s\S]*?\}(?=\s*\{|\s*$)/g) || [inner];
    for (const chunk of objs) {
      const parsed = parseOneToolPayload(chunk, tool_calls.length);
      if (parsed) tool_calls.push(parsed);
    }
    return '\n';
  });

  working = working.replace(INVOKE_RE, (_full, name: string, body: string) => {
    const args: Record<string, string> = {};
    let m: RegExpExecArray | null;
    const re = new RegExp(PARAM_RE.source, PARAM_RE.flags);
    while ((m = re.exec(body)) !== null) {
      args[m[1]] = m[2].trim();
    }
    tool_calls.push({
      id: makeToolCallId(tool_calls.length, name),
      type: 'function',
      function: {
        name,
        arguments: argsToString(args),
      },
    });
    return '\n';
  });

  working = working.replace(
    /```(?:json)?\s*(\{[\s\S]*?"tool_calls"\s*:\s*\[[\s\S]*?\][\s\S]*?\})\s*```/gi,
    (_full, jsonStr: string) => {
      try {
        const obj = JSON.parse(jsonStr) as { tool_calls?: unknown[] };
        if (Array.isArray(obj.tool_calls)) {
          for (const tc of obj.tool_calls) {
            const parsed = parseOneToolPayload(safeJsonStringify(tc), tool_calls.length);
            if (parsed) tool_calls.push(parsed);
          }
        }
      } catch {
        // ignore
      }
      return '\n';
    },
  );

  const content = working
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const seen = new Set<string>();
  const unique = tool_calls.filter((tc) => {
    const key = `${tc.function.name}::${tc.function.arguments}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { content, tool_calls: unique };
}

export function createNonStreamCompletionWithTools(input: {
  model: string;
  id: string;
  created: number;
  content: string;
  tool_calls?: OpenAiToolCall[];
}) {
  const hasTools = Boolean(input.tool_calls && input.tool_calls.length > 0);
  return {
    id: input.id,
    object: 'chat.completion' as const,
    created: input.created,
    model: input.model,
    choices: [
      {
        index: 0,
        message: hasTools
          ? {
              role: 'assistant' as const,
              content: input.content || null,
              tool_calls: input.tool_calls,
            }
          : {
              role: 'assistant' as const,
              content: input.content,
            },
        finish_reason: hasTools ? ('tool_calls' as const) : ('stop' as const),
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
