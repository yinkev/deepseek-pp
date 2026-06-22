import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('background memory bounds', () => {
  it('caps official API sidepanel chat messages kept in service-worker memory', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('OFFICIAL_API_CHAT_MESSAGE_LIMIT = 80');
    expect(source).toContain('function pruneOfficialApiChatMessages(');
    expect(source).toContain('messages.slice(-OFFICIAL_API_CHAT_MESSAGE_LIMIT)');
    expect(source).toContain('officialApiChatMessages = pruneOfficialApiChatMessages(await runOfficialApiToolLoop(');
  });

  it('routes sidepanel streamed text through the tool-text accumulator before broadcasting', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("import { createStreamingToolTextAccumulator } from '../core/interceptor/streaming-tool-text';");
    expect(source).toContain('function createSidepanelVisibleTextEmitter(');
    expect(source).toContain('function createSidepanelVisibleTextBuffer(');
    expect(source).toContain('const visibleText = createStreamingToolTextAccumulator(createSidepanelDisplayToolDescriptors(toolDescriptors));');
    expect(source).toContain('emit(visibleText.append(chunk));');
    expect(source).toContain('emit(visibleText.flush());');
    expect(source).toContain('const visibleOutput = visibleText.flush();');
    expect(source).toContain('if (visibleOutput) {');
    expect(source).toContain('broadcastChatChunk({ text: visibleOutput, done: false }, excludeTabId, streamId);');
    expect(source).toContain("const visibleReasoningText = createSidepanelVisibleTextEmitter(toolDescriptors, excludeTabId, streamId, 'reasoning', 'reasoningText');");
    expect(source).toContain('function createSidepanelDisplayToolDescriptors(');
    expect(source).toContain('name: `${descriptor.name}_result`,');
    expect(source).toContain("broadcastChatChunk({ text: '', done: true }, excludeTabId, streamId);");
    expect(source).not.toContain('broadcastChatChunk({ text: fullText, done: true }');
  });

  it('requires sidepanel tool continuations to report back after browser work', () => {
    const enPath = join(process.cwd(), 'core/i18n/resources/en.ts');
    const zhPath = join(process.cwd(), 'core/i18n/resources/zh-CN.ts');
    const enSource = readFileSync(enPath, 'utf8');
    const zhSource = readFileSync(zhPath, 'utf8');

    expect(enSource).toContain('answer the user directly with the observed result');
    expect(enSource).toContain('Do not stop after tool use');
    expect(enSource).toContain('browser_wait_for or browser_snapshot');
    expect(enSource).toContain('Do not expose raw tool JSON or XML');
    expect(zhSource).toContain('不要在工具调用后停止');
    expect(zhSource).toContain('browser_wait_for 或 browser_snapshot');
    expect(zhSource).toContain('不要暴露原始工具 JSON 或 XML');
  });

  it('uses budgeted sidepanel tool-result sanitization before continuation prompts', () => {
    const backgroundPath = join(process.cwd(), 'entrypoints/background.ts');
    const sidepanelToolPath = join(process.cwd(), 'core/tool/sidepanel.ts');
    const backgroundSource = readFileSync(backgroundPath, 'utf8');
    const sidepanelToolSource = readFileSync(sidepanelToolPath, 'utf8');

    expect(backgroundSource).toContain('formatSidepanelToolResultsForContinuation,');
    expect(sidepanelToolSource).toContain('SIDEPANEL_TOOL_RESULT_MAX_NODES = 1_000');
    expect(sidepanelToolSource).toContain('function sanitizeSidepanelValueWithinBudget(');
    expect(sidepanelToolSource).toContain('seen: new WeakSet<object>()');
    expect(sidepanelToolSource).toContain('budget.remaining <= 0');
    expect(sidepanelToolSource).toContain('sanitizeSidepanelSensitiveKeyValue(');
    expect(sidepanelToolSource).toContain('sanitizeSidepanelObjectKey(');
    expect(sidepanelToolSource).not.toContain('redactDurableToolValue');
    expect(sidepanelToolSource).not.toContain('JSON.stringify(redacted)');
  });

  it('propagates sidepanel stream ids through chat chunk broadcasts', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('const chatStreamId = typeof streamId ===');
    expect(source).toContain('handleChatSubmitPrompt(');
    expect(source).toContain('chatStreamId,');
    expect(source).toContain('streamId?: string,');
    expect(source).toContain("chrome.runtime.sendMessage({ type: 'CHAT_STREAM_CHUNK', ...chunk, streamId: chunk.streamId ?? streamId })");
  });

  it('keeps sidepanel tool disclosures compact and non-leaky', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('const eventId = `${step}-${index}-${call.id || call.name}`;');
    expect(source).toContain('formatSidepanelToolEventDetail(result)');
    expect(source).toContain('function formatSidepanelToolEventDetail(result: ToolResult)');
    expect(source).toContain('result.error?.message');
    expect(source).not.toContain('formatSidepanelToolEventDetail(call.name, result)');
  });

  it('caps sidepanel tool fan-out before execution', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('SIDEPANEL_TOOL_CALLS_PER_STEP_LIMIT = 8');
    expect(source).toContain('SIDEPANEL_TOOL_CALLS_PER_TURN_LIMIT = 40');
    expect(source).toContain('function selectSidepanelToolCallsForStep(');
    expect(source).toContain('Math.min(toolCalls.length, SIDEPANEL_TOOL_CALLS_PER_STEP_LIMIT, remainingTurnCalls)');
    expect(source.match(/selectSidepanelToolCallsForStep\(toolCalls, executedToolCallCount\)/g)).toHaveLength(2);
    expect(source.match(/broadcastSidepanelToolLimitEvent\(selectedToolCalls\.skippedCount, excludeTabId, streamId\)/g)).toHaveLength(2);
    expect(source).toContain("backgroundT('background.chat.toolCallLimit')");
  });

  it('bounds sidepanel web turns so the UI cannot hang forever', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('SIDEPANEL_WEB_TURN_TIMEOUT_MS = 90_000');
    expect(source).toContain('SIDEPANEL_CHAT_JOB_TIMEOUT_MS = SIDEPANEL_WEB_TURN_TIMEOUT_MS + 5_000');
    expect(source).toContain('function submitSidepanelWebTurnWithTimeout(');
    expect(source).toContain('function runSidepanelChatSubmitJob(');
    expect(source).toContain('sidepanelChatSubmitPromise = runSidepanelChatSubmitJob(job, sender.tab?.id, chatStreamId)');
    expect(source).toContain('Promise.race([guardedJob, timeout])');
    expect(source).toContain('submitPromptStreaming(input, callbacks, controller.signal)');
    expect(source).toContain('DeepSeek Web did not respond within 90 seconds.');
    expect(source).toContain('DeepSeek Web did not respond within 95 seconds.');
    expect(source).toContain('const turn = await submitSidepanelWebTurnWithTimeout({');
  });

  it('surfaces bounded DeepSeek Web turn phases as compact status events', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('function broadcastSidepanelWebStatusEvent(');
    expect(source).toContain("id: 'deepseek-web-turn-status'");
    expect(source).toContain("name: 'deepseek_web_turn'");
    expect(source).toContain("title: 'DeepSeek Web'");
    expect(source).toContain("broadcastSidepanelWebStatusEvent('Preparing DeepSeek Web session'");
    expect(source).toContain("broadcastSidepanelWebStatusEvent('Solving DeepSeek verification'");
    expect(source).toContain("broadcastSidepanelWebStatusEvent('Waiting for model stream'");
    expect(source).toContain("broadcastSidepanelWebStatusEvent('Using browser tools'");
    expect(source).toContain("broadcastSidepanelWebStatusEvent('Done', excludeTabId, streamId, 'success')");
    expect(source).toContain("broadcastSidepanelWebStatusEvent('Tool step limit reached', excludeTabId, streamId, 'error')");
  });

  it('recovers web auth from stale DeepSeek content scripts after extension reload', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('reloadStaleDeepSeekTabsAndRefreshHeaders(preferredTabId)');
    expect(source).toContain('function reloadStaleDeepSeekTabsAndRefreshHeaders(');
    expect(source).toContain('await Promise.all(health.staleTabIds.map((tabId) => chrome.tabs.reload(tabId).catch(() => undefined)))');
    expect(source).toContain('waitForDeepSeekContentScripts(preferredTabId, health.staleTabIds, 7_500)');
    expect(source).toContain('return ready && refreshClientHeadersFromDeepSeekTabs(preferredTabId)');
  });
});
