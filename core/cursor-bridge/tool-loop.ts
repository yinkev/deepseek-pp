/**
 * Bridge tool loop — reuses DeepSeek++ prompt augmentation + runtime tools.
 * Same path as web chat automation / inline agent: inject tool schemas,
 * parse <tool_call>, execute via executeRuntimeToolCall, continue session.
 */

import type { ModelTurn, SubmitPromptInput } from '../deepseek/adapter';
import { extractToolCalls, stripToolCalls } from '../interceptor/tool-parser';
import { createStreamingToolTextAccumulator } from '../interceptor/streaming-tool-text';
import { DEFAULT_LOCALE, type SupportedLocale } from '../i18n';
import { buildPromptAugmentation } from '../prompt';
import {
  clampText,
  createToolExecutionRecord,
  runToolContinuationLoop,
} from '../tool-loop/engine';
import { DEFAULT_TOOL_DESCRIPTORS } from '../tool';
import type {
  ToolCall,
  ToolDescriptor,
  ToolExecutionRecord,
  ToolResult,
} from '../types';

export const BRIDGE_TOOL_MAX_DEPTH = 5;

export type BridgeExecuteToolFn = (call: ToolCall) => Promise<ToolResult>;
export type BridgeLoadToolDescriptorsFn = () => Promise<readonly ToolDescriptor[]>;

export interface BridgeToolLoopDeps {
  executeTool?: BridgeExecuteToolFn;
  loadToolDescriptors?: BridgeLoadToolDescriptorsFn;
  locale?: SupportedLocale;
  maxDepth?: number;
}

export interface BridgeAugmentPromptInput {
  userPrompt: string;
  toolDescriptors: readonly ToolDescriptor[];
  thinkingEnabled?: boolean;
  projectContext?: string | null;
  locale?: SupportedLocale;
  /** When false, skip tool schema injection (eyes subcalls). */
  toolsEnabled?: boolean;
  /** full = full schemas; reminder = short sticky reminder; none = no tools. */
  schemaMode?: 'full' | 'reminder' | 'none';
  /** Short reminder text for sticky harness turns. */
  reminderText?: string | null;
}

export function augmentBridgePrompt(input: BridgeAugmentPromptInput): {
  prompt: string;
  renderedToolCount: number;
} {
  const mode = input.schemaMode
    ?? (input.toolsEnabled === false ? 'none' : 'full');
  if (mode === 'none' || input.toolsEnabled === false) {
    return { prompt: input.userPrompt, renderedToolCount: 0 };
  }
  if (mode === 'reminder') {
    const reminder = (input.reminderText ?? '').trim()
      || 'DeepSeek++ tools remain available (same XML tags as earlier in this session). Use only if needed.';
    return {
      prompt: `${reminder}\n\n${input.userPrompt}`,
      renderedToolCount: 0,
    };
  }

  const { augmented, renderedToolCount } = buildPromptAugmentation(input.userPrompt, {
    memories: [],
    thinkingEnabled: input.thinkingEnabled === true,
    presetContent: null,
    projectContext: input.projectContext ?? null,
    toolDescriptors: input.toolDescriptors,
    locale: input.locale ?? DEFAULT_LOCALE,
    memoryEnabled: false,
    systemPromptEnabled: true,
  });

  return { prompt: augmented, renderedToolCount };
}

export function visibleBridgeAssistantText(
  text: string,
  toolDescriptors: readonly ToolDescriptor[],
): string {
  return stripToolCalls(text, { descriptors: toolDescriptors }).trim();
}


/** Short stable labels for client stream notices: ds/tool:mem saved */
export function shortBridgeToolLabel(name: string): string {
  const n = (name ?? '').toLowerCase().trim();
  if (!n) return 'tool';
  if (
    n.startsWith('memory_')
    || n === 'memory'
    || n.includes('memory_save')
    || n.includes('memory_update')
    || n.includes('memory_delete')
    || n.includes('memory_import')
  ) {
    return 'mem';
  }
  if (n.includes('web_search') || n === 'web_search' || n === 'search' || n.startsWith('web_')) return 'web';
  if (n.includes('browser') || n.startsWith('browser_')) return 'browser';
  if (n.includes('shell') || n === 'bash' || n === 'run_command') return 'shell';
  if (n.includes('python') || n.includes('pyodide') || n === 'code_exec') return 'py';
  if (n.includes('artifact')) return 'artifact';
  if (n.includes('skill')) return 'skill';
  if (n.includes('__') || n.includes('mcp')) {
    const parts = n.split(/__|:/).filter(Boolean);
    const last = parts[parts.length - 1] ?? n;
    return last.replace(/[^a-z0-9_-]/g, '').slice(0, 16) || 'mcp';
  }
  const bare = n.split(/[.:/]/).pop() ?? n;
  return bare.replace(/[^a-z0-9_-]/g, '').slice(0, 16) || 'tool';
}

/** Result verb: memory tools use saved/failed; others use ok/failed. */
export function bridgeToolResultVerb(name: string, ok: boolean): string {
  if (!ok) return 'failed';
  const label = shortBridgeToolLabel(name);
  if (label === 'mem') return 'saved';
  return 'ok';
}

export function formatBridgeToolStartNotice(name: string): string {
  return `\n\nds/tool:${shortBridgeToolLabel(name)}…\n`;
}

export function formatBridgeToolResultNotice(name: string, ok: boolean): string {
  return `ds/tool:${shortBridgeToolLabel(name)} ${bridgeToolResultVerb(name, ok)}\n`;
}

/**
 * Per-turn stream filter: suppress raw tool XML mid-stream.
 * Emits only natural-language deltas. Call reset() at each new model turn.
 * Tool notices should go through onChunk directly, not through this streamer.
 */
export function createBridgeVisibleStreamer(
  toolDescriptors: readonly ToolDescriptor[],
  onVisibleDelta: (delta: string) => void,
): {
  push: (chunk: string) => void;
  flush: () => void;
  reset: () => void;
  getVisibleText: () => string;
} {
  let acc = createStreamingToolTextAccumulator(toolDescriptors);
  let lastLen = 0;

  const emitGrowth = (visible: string) => {
    if (visible.length > lastLen) {
      const delta = visible.slice(lastLen);
      lastLen = visible.length;
      if (delta) onVisibleDelta(delta);
    }
  };

  return {
    push(chunk: string) {
      if (!chunk) return;
      const visible = acc.append(chunk);
      emitGrowth(visible);
    },
    flush() {
      const visible = acc.flush();
      emitGrowth(visible);
    },
    reset() {
      acc = createStreamingToolTextAccumulator(toolDescriptors);
      lastLen = 0;
    },
    getVisibleText() {
      return acc.getVisibleText();
    },
  };
}

export function buildBridgeToolContinuationPrompt(
  executions: ToolExecutionRecord[],
  originalTask: string,
): string {
  const results = executions.map((execution) => ({
    tool: execution.name,
    provider: execution.provider?.displayName,
    ok: execution.result.ok,
    summary: execution.result.summary,
    detail: clampText(execution.result.detail, 4000),
    output: clampText(
      execution.result.output === undefined ? undefined : String(execution.result.output),
      8000,
    ),
    truncated: execution.result.truncated === true,
  }));

  return [
    'Tool results from DeepSeek++ runtime follow.',
    'Use them to continue. If the user task is complete, answer in natural language only — no more tool XML blocks.',
    'If you still need tools, emit the next tool tags exactly as specified (e.g. <memory_save>...</memory_save>).',
    '',
    '<original_task>',
    clampText(originalTask, 8000) ?? '',
    '</original_task>',
    '',
    '<tool_results>',
    JSON.stringify(results, null, 2),
    '</tool_results>',
  ].join('\n');
}

export async function resolveBridgeToolDescriptors(
  deps: BridgeToolLoopDeps,
): Promise<readonly ToolDescriptor[]> {
  if (deps.loadToolDescriptors) {
    try {
      const loaded = await deps.loadToolDescriptors();
      if (loaded && loaded.length > 0) return loaded;
    } catch {
      // fall through to defaults
    }
  }
  return DEFAULT_TOOL_DESCRIPTORS;
}

export interface RunBridgeToolLoopInput {
  initialTurn: ModelTurn;
  originalTask: string;
  toolDescriptors: readonly ToolDescriptor[];
  executeTool: BridgeExecuteToolFn;
  submitContinuation: (prompt: string, parentMessageId: number) => Promise<ModelTurn>;
  maxDepth?: number;
  signal?: AbortSignal;
  /** Optional: notify host of tool activity (not streamed as answer text). */
  onToolNotice?: (notice: string) => void;
}

export async function runBridgeToolLoop(
  input: RunBridgeToolLoopInput,
): Promise<{ turn: ModelTurn; executions: ToolExecutionRecord[]; finalVisibleText: string }> {
  const maxDepth = input.maxDepth ?? BRIDGE_TOOL_MAX_DEPTH;
  const descriptors = input.toolDescriptors;

  const loop = await runToolContinuationLoop({
    initialTurn: input.initialTurn,
    maxDepth,
    getAssistantText: (turn) => turn.assistantText,
    getParentCursor: (turn) => turn.responseMessageId,
    extractToolCalls: (text) => extractToolCalls(text, { descriptors }),
    async executeToolCall(call, parentMessageId) {
      if (input.signal?.aborted) {
        return createToolExecutionRecord(call, {
          ok: false,
          summary: 'Aborted',
          detail: 'Request aborted before tool execution.',
          name: call.name,
          provider: call.provider,
          descriptorId: call.descriptorId,
        }, { detailMaxLength: 4000, outputMaxLength: 8000 });
      }

      input.onToolNotice?.(formatBridgeToolStartNotice(call.name));

      const enriched: ToolCall = {
        ...call,
        source: {
          trigger: 'agent_run',
          messageId: parentMessageId,
        },
      };

      const result = await input.executeTool(enriched);
      const record = createToolExecutionRecord(call, result, {
        detailMaxLength: 4000,
        outputMaxLength: 8000,
      });

      input.onToolNotice?.(formatBridgeToolResultNotice(call.name, result.ok));

      return record;
    },
    buildContinuationPrompt: (executions) =>
      buildBridgeToolContinuationPrompt(executions, input.originalTask),
    submitContinuation: async (prompt, parentMessageId) => {
      if (input.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      return input.submitContinuation(prompt, parentMessageId);
    },
  });

  const finalVisibleText = visibleBridgeAssistantText(
    loop.turn.assistantText,
    descriptors,
  );

  return {
    turn: loop.turn,
    executions: loop.executions,
    finalVisibleText,
  };
}

/** Build a submit-continuation helper bound to the main model session. */
export function createBridgeContinuationSubmitter(options: {
  chatSessionId: string;
  modelType: string;
  thinkingEnabled: boolean;
  searchEnabled: boolean;
  clientHeaders: Record<string, string>;
  createPow: (headers: Record<string, string>) => Promise<Record<string, string>>;
  submitStreaming: (
    input: SubmitPromptInput,
    callbacks: {
      onTextChunk?: (newText: string, full: string) => void;
    },
    signal?: AbortSignal,
  ) => Promise<ModelTurn>;
  signal?: AbortSignal;
  onTextChunk?: (newText: string, full: string) => void;
}): (prompt: string, parentMessageId: number) => Promise<ModelTurn> {
  return async (prompt, parentMessageId) => {
    const powHeaders = await options.createPow(options.clientHeaders);
    let fullText = '';
    const turn = await options.submitStreaming(
      {
        chatSessionId: options.chatSessionId,
        parentMessageId,
        modelType: options.modelType,
        prompt,
        refFileIds: [],
        thinkingEnabled: options.thinkingEnabled,
        searchEnabled: options.searchEnabled,
        clientHeaders: options.clientHeaders,
        powHeaders,
      },
      {
        onTextChunk(newText, full) {
          fullText = full;
          options.onTextChunk?.(newText, full);
        },
      },
      options.signal,
    );
    if (!turn.assistantText && fullText) {
      return { ...turn, assistantText: fullText };
    }
    return turn;
  };
}
