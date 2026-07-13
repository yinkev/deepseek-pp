import { createStreamingToolTextAccumulator } from '../interceptor/streaming-tool-text';
import { extractToolCalls } from '../interceptor/tool-parser';
import type { ToolCall, ToolDescriptor, ToolExecutionRecord, ToolResult } from '../types';

/**
 * Shared streaming + tool-extract helpers for DeepSeek sidepanel legacy loops
 * (web + official API). Keeps tool XML off the visible stream while preserving
 * raw assistant text for extractToolCalls.
 */
export function createSidepanelLegacyToolStream(
  toolDescriptors: readonly ToolDescriptor[],
  onVisibleDelta: (delta: string) => void,
): {
  onTextChunk: (newText: string, fullText: string) => void;
  finishStream: () => void;
  getFullText: (fallback?: string) => string;
  extractCalls: () => ToolCall[];
} {
  const toolText = createStreamingToolTextAccumulator(toolDescriptors);
  let visibleLength = 0;
  let accumulated = '';

  const emitVisibleGrowth = (visible: string) => {
    if (visible.length <= visibleLength) return;
    const delta = visible.slice(visibleLength);
    visibleLength = visible.length;
    if (delta) onVisibleDelta(delta);
  };

  return {
    onTextChunk(newText: string, fullText: string) {
      accumulated = fullText;
      emitVisibleGrowth(toolText.append(newText));
    },
    finishStream() {
      emitVisibleGrowth(toolText.flush());
    },
    getFullText(fallback = '') {
      return accumulated || fallback;
    },
    extractCalls() {
      return extractToolCalls(accumulated, { descriptors: toolDescriptors });
    },
  };
}

export async function executeSidepanelToolCalls(
  calls: readonly ToolCall[],
  executeTool: (call: ToolCall) => Promise<ToolResult>,
): Promise<ToolExecutionRecord[]> {
  const execs: ToolExecutionRecord[] = [];
  for (const call of calls) {
    const result = await executeTool(call);
    execs.push({
      name: call.name,
      result: {
        ok: result.ok,
        summary: result.summary,
        detail: result.detail,
        output: result.output,
        truncated: result.truncated,
        error: result.error,
      },
    });
  }
  return execs;
}
