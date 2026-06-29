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
    expect(source).toContain('const nextMessages = pruneOfficialApiChatMessages(await runOfficialApiToolLoop(');
    expect(source).toContain('officialApiChatMessages = nextMessages;');
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

  it('prepares a safe Browser Control target before sidepanel Browser View capture', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');
    const start = source.indexOf('async function captureBrowserControlTargetImage()');
    const end = source.indexOf('async function executeBrowserScreenshotVisionTool(');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const captureSource = source.slice(start, end);
    const prepareIndex = captureSource.indexOf('browserControlService.preparePersonalTarget({ allowActiveFallback: true })');
    const captureIndex = captureSource.indexOf('browserControlService.captureBrowserViewForVision()');

    expect(prepareIndex).toBeGreaterThanOrEqual(0);
    expect(captureIndex).toBeGreaterThan(prepareIndex);
    expect(captureSource).toContain('make a non-DeepSeek tab active');
  });

  it('keeps DeepSeek Web Vision payload errors actionable instead of masking them', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('return formatDeepSeekWebVisionPayloadError(err);');
    expect(source).toContain('function formatDeepSeekWebVisionPayloadError(');
    expect(source).toContain('DeepSeek Web Vision request failed: ${detail}');
  });

  it('recovers sidepanel Web response id and text from history before failing Vision turns', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('readHistorySnapshot,');
    expect(source).toContain('const resolvedTurn = await resolveSidepanelWebTurnResult(turn, currentInput, streamedFullText, signal);');
    expect(source).toContain('readHistorySnapshot(input.chatSessionId, null, {');
    expect(source).toContain('candidate !== null && candidate !== input.parentMessageId');
    expect(source).toContain("assistantText: streamedFullText ? '' : history?.assistantText ?? ''");
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

  it('routes browser screenshot capture through the Vision upload path before generic browser control', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');
    const executorStart = source.indexOf('async function executeBackgroundRuntimeToolCall(');
    const executorEnd = source.indexOf('function throwIfRuntimeToolAborted(');
    expect(executorStart).toBeGreaterThanOrEqual(0);
    expect(executorEnd).toBeGreaterThan(executorStart);
    const executorSource = source.slice(executorStart, executorEnd);
    const screenshotBranch = executorSource.indexOf('call.name === BROWSER_CAPTURE_SCREENSHOT_TOOL_NAME');
    const genericBrowserControlBranch = executorSource.indexOf('isBrowserControlToolName(call.name)');

    expect(source).toContain("const BROWSER_CAPTURE_SCREENSHOT_TOOL_NAME = 'browser_capture_screenshot';");
    expect(screenshotBranch).toBeGreaterThanOrEqual(0);
    expect(genericBrowserControlBranch).toBeGreaterThan(screenshotBranch);
    expect(executorSource).toContain('const result = await executeBrowserScreenshotVisionTool(call, options?.signal);');
    expect(executorSource).toContain('await appendToolCallHistory(call, result, source);');
    expect(executorSource.slice(screenshotBranch, genericBrowserControlBranch)).toContain('return result;');

    const toolStart = source.indexOf('async function executeBrowserScreenshotVisionTool(');
    const toolEnd = source.indexOf('async function uploadBrowserScreenshotCapture(');
    expect(toolStart).toBeGreaterThanOrEqual(0);
    expect(toolEnd).toBeGreaterThan(toolStart);
    const screenshotToolSource = source.slice(toolStart, toolEnd);

    expect(screenshotToolSource).toContain("kind: 'deepseek_web_vision_capture'");
    expect(screenshotToolSource).toContain('refFileIds: [uploaded.upload.refFileId]');
    expect(screenshotToolSource).toContain('webVisionFiles: [toToolVisionMetadata(uploaded.upload.metadata)]');
    expect(screenshotToolSource).toContain('image: uploaded.image');
    expect(screenshotToolSource).not.toContain('capture.dataBase64');
    expect(screenshotToolSource).not.toContain('dataUrl');

    const uploadStart = source.indexOf('async function uploadBrowserScreenshotCaptureWithHeaders(');
    const uploadEnd = source.indexOf('function createCapturedTabSerializedImage(');
    expect(uploadStart).toBeGreaterThanOrEqual(0);
    expect(uploadEnd).toBeGreaterThan(uploadStart);
    const uploadSource = source.slice(uploadStart, uploadEnd);

    expect(uploadSource).toContain('image: {\n      name: image.name,\n      mimeType: image.mimeType,\n      sizeBytes: image.sizeBytes,\n    },');
    expect(uploadSource).not.toContain('dataUrl: image.dataUrl');
    expect(uploadSource).not.toContain('dataBase64: capture.dataBase64');
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
    const jobRunnerPath = join(process.cwd(), 'core/chat/sidepanel-job-runner.ts');
    const jobRunnerSource = readFileSync(jobRunnerPath, 'utf8');

    expect(source).toContain('SIDEPANEL_WEB_TURN_TIMEOUT_MS = 90_000');
    expect(source).toContain('SIDEPANEL_CHAT_JOB_TIMEOUT_MS = SIDEPANEL_WEB_TURN_TIMEOUT_MS + 5_000');
    expect(source).toContain('function submitSidepanelWebTurnWithTimeout(');
    expect(source).toContain('function runSidepanelChatSubmitJob(');
    expect(source).toContain('const controller = new AbortController();');
    expect(source).toContain('sidepanelChatSubmitPromise = runSidepanelChatSubmitJob(job, sender.tab?.id, chatStreamId, controller)');
    expect(source).toContain('const loopId = await markChatLoopStarted(loopProvider, streamId, streamId);');
    expect(source).toContain('await markChatLoopFinished(loopId);');
    expect(source).toContain('return runSidepanelChatSubmitJobWithTimeout({');
    expect(source).toContain('timeoutMs: SIDEPANEL_CHAT_JOB_TIMEOUT_MS');
    expect(source).toContain('broadcastTerminalError: broadcastSidepanelTerminalError');
    expect(source).toContain('markChatLoopFinished');
    expect(source).toContain('throwIfSidepanelChatJobAborted(signal);');
    expect(source).toContain('submitPromptStreaming(input, callbacks, controller.signal)');
    expect(source).toContain('DeepSeek Web did not respond within 90 seconds.');
    expect(source).toContain('DeepSeek Web did not respond within 95 seconds.');
    expect(source).toContain('const turn = await submitSidepanelWebTurnWithTimeout({');
    expect(jobRunnerSource).toContain('Promise.race([guardedJob, timeout])');
    expect(jobRunnerSource).toContain('input.controller.abort();');
    expect(jobRunnerSource).toContain('await input.markChatLoopFinished(input.streamId);');
    expect(jobRunnerSource).toContain('if (timedOut && timeoutCleanup) {');
    expect(jobRunnerSource).toContain('await timeoutCleanup;');
    expect(jobRunnerSource).toContain('if (timedOut) return;');
  });

  it('clears the sidepanel chat busy lock through timeout and error completion', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("if (sidepanelChatSubmitPromise) return { ok: false, error: 'chat_busy' };");
    expect(source).toContain('sidepanelChatSubmitPromise = runSidepanelChatSubmitJob(job, sender.tab?.id, chatStreamId, controller)');
    expect(source).toContain('.finally(() => {\n          sidepanelChatSubmitPromise = null;\n        });');
    expect(source).toContain('runSidepanelChatSubmitJobWithTimeout({');
  });

  it('marks DeepSeek Web status terminal before timeout or error completion chunks', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');
    const jobRunnerPath = join(process.cwd(), 'core/chat/sidepanel-job-runner.ts');
    const jobRunnerSource = readFileSync(jobRunnerPath, 'utf8');
    const start = source.indexOf('async function runSidepanelChatSubmitJob(');
    const end = source.indexOf('async function handleWebChatSubmitPrompt(');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const jobRunner = source.slice(start, end);

    expect(source).toContain('function broadcastSidepanelTerminalError(');
    expect(source).toContain('function finalizeRunningSidepanelToolEvents(');
    expect(source).toContain('const sidepanelRunningToolEvents = new Map<string, {');
    expect(source).toContain('const eventKey = streamId ? `${streamId}:${eventId}` : eventId;');
    expect(source).toContain('sidepanelRunningToolEvents.set(eventKey, { id: eventId, call, excludeTabId, streamId, startedAt });');
    expect(source).toContain('sidepanelRunningToolEvents.delete(eventKey);');
    expect(source).toContain('if (signal?.aborted || isSidepanelChatJobAbortError(err)) {');
    expect(source).toContain('sidepanelRunningToolEvents.delete(eventKey);\n      throw err;');
    expect(source).toContain("broadcastSidepanelWebStatusEvent(statusSummary, excludeTabId, streamId, 'error');");
    expect(jobRunnerSource).toContain('await input.markChatLoopFinished(input.streamId);');
    expect(source).toContain('broadcastSidepanelTerminalError(error, undefined, interrupted.streamId);');
    expect(jobRunner).toContain('timeoutError: \'DeepSeek Web did not respond within 95 seconds.');
    expect(jobRunner).toContain('broadcastTerminalError: broadcastSidepanelTerminalError');
    expect(jobRunner).toContain('markChatLoopFinished');
    expect(jobRunnerSource).toMatch(
      /timedOut = true;[\s\S]*input\.broadcastTerminalError\(input\.timeoutError, input\.excludeTabId, input\.streamId, input\.timeoutError\);/,
    );
    expect(jobRunnerSource).toMatch(
      /const msg = err instanceof Error \? err\.message : String\(err\);[\s\S]*input\.broadcastTerminalError\(msg, input\.excludeTabId, input\.streamId, msg\);/,
    );
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

  it('reuses a single Runtime Doctor storage audit during personal ready checks', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('type RuntimeDoctorStorageAudit = {');
    expect(source).toContain('async function getRuntimeDoctorStorageAudit(): Promise<RuntimeDoctorStorageAudit>');
    expect(source).toContain('const storageAudit = await getRuntimeDoctorStorageAudit();');
    expect(source).toContain('let report = await getRuntimeDoctorReport(preferredTabId, readiness, storageAudit);');
    expect(source.match(/getRuntimeDoctorStorageSnapshot\(\)/g)).toHaveLength(2);
    expect(source.match(/scanRuntimeDoctorStorage\(snapshot\)/g)).toHaveLength(1);
    expect(source).not.toContain('const storageSnapshot = await getRuntimeDoctorStorageSnapshot();\n  const storage = scanRuntimeDoctorStorage(storageSnapshot);');
  });

  it('does not run personal runtime readiness on every service-worker bootstrap', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');
    const mainStart = source.indexOf('export default defineBackground(() => {');
    const listenerStart = source.indexOf('  chrome.runtime.onMessage.addListener', mainStart);
    expect(mainStart).toBeGreaterThanOrEqual(0);
    expect(listenerStart).toBeGreaterThan(mainStart);
    const bootstrapSource = source.slice(mainStart, listenerStart);

    expect(bootstrapSource).not.toContain("ensurePersonalRuntimeReady(undefined, 'startup')");
    expect(source).toContain("ensurePersonalRuntimeReady(preferredTabId, preferredTabId === undefined ? 'startup' : 'manual')");
    expect(source).toContain("return ensurePersonalRuntimeReady(sender.tab?.id, 'manual');");
  });

  it('does not rebroadcast background auth-status broadcasts back into itself', () => {
    const path = join(process.cwd(), 'entrypoints/background.ts');
    const source = readFileSync(path, 'utf8');
    const caseStart = source.indexOf("case 'AUTH_STATUS_CHANGED': {");
    const caseEnd = source.indexOf("case 'STORE_DEEPSEEK_CLIENT_HEADERS':", caseStart);
    expect(caseStart).toBeGreaterThanOrEqual(0);
    expect(caseEnd).toBeGreaterThan(caseStart);
    const authStatusCase = source.slice(caseStart, caseEnd);

    expect(source).toContain("const AUTH_STATUS_BROADCAST_SOURCE = 'deepseek_pp_background_auth_status';");
    expect(source).toContain('function isBackgroundAuthStatusBroadcast(');
    expect(source).toContain('broadcastSource: AUTH_STATUS_BROADCAST_SOURCE');
    expect(authStatusCase).toContain('if (isBackgroundAuthStatusBroadcast(message)) return { ok: true };');
    expect(authStatusCase.match(/broadcastChatAuthStatus/g)).toHaveLength(1);
  });

  it('does not refresh the DeepSeek tab again while storing fresh client headers', () => {
    const backgroundPath = join(process.cwd(), 'entrypoints/background.ts');
    const backgroundSource = readFileSync(backgroundPath, 'utf8');
    const caseStart = backgroundSource.indexOf("case 'STORE_DEEPSEEK_CLIENT_HEADERS': {");
    const caseEnd = backgroundSource.indexOf("case 'GET_AUTOMATIONS':", caseStart);
    expect(caseStart).toBeGreaterThanOrEqual(0);
    expect(caseEnd).toBeGreaterThan(caseStart);
    const storeHeadersCase = backgroundSource.slice(caseStart, caseEnd);

    expect(backgroundSource).toContain('function areStoredClientHeadersEqual(');
    expect(storeHeadersCase).toContain('const previousHeaders = await loadClientHeadersFromStorage();');
    expect(storeHeadersCase).toContain('const headersChanged = !areStoredClientHeadersEqual(previousHeaders, headers);');
    expect(storeHeadersCase).toContain('if (ok && headersChanged) await broadcastChatAuthStatus();');
    expect(storeHeadersCase).not.toContain('broadcastChatAuthStatus(sender.tab?.id)');

    const contentPath = join(process.cwd(), 'entrypoints/content.ts');
    const contentSource = readFileSync(contentPath, 'utf8');
    const persistStart = contentSource.indexOf('async function persistDeepSeekClientHeaders');
    const persistEnd = contentSource.indexOf('function startConversationExportActionInjector', persistStart);
    expect(persistStart).toBeGreaterThanOrEqual(0);
    expect(persistEnd).toBeGreaterThan(persistStart);
    const persistSource = contentSource.slice(persistStart, persistEnd);
    expect(persistSource).not.toContain("chrome.runtime.sendMessage({ type: 'AUTH_STATUS_CHANGED' })");
  });
});
