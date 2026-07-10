import {
  buildDeepSeekSessionUrl,
  createChatSession,
  createClientHeaders,
  createPowHeaders,
  createPowHeadersForPath,
  DEEPSEEK_FILE_UPLOAD_PATH,
  DeepSeekAuthError,
  getLastStreamParseDebug,
  readHistorySnapshot,
  submitPromptStreaming,
  uploadDeepSeekFile,
  type DeepSeekUploadedFile,
} from '../deepseek/adapter';
import type {
  CursorBridgeError,
  CursorBridgeImagePart,
  CursorBridgeJobRequest,
  CursorBridgeReadiness,
} from './protocol';
import {
  bridgeModelSearchEnabled,
  bridgeModelToDeepSeekType,
  bridgeModelUsesNativeVision,
  EYES_SUBCALL_PROMPT,
  formatEyesNotes,
  isEniModel,
  isEyesModel,
  isSquidModel,
  messagesToPrompt,
  normalizeBridgeModel,
  normalizeMessageContent,
  repairOpeningTruncation,
} from './protocol';
import { resolveEniSystemPrompt, shouldInjectEniSystem } from './eni-prompt';
import {
  addEniBondLo,
  addEniBondUs,
  clearEniBondNow,
  extractSoftBondFromAssistant,
  extractSoftBondLoFacts,
  formatEniBondCard,
  getEniBondCard,
  touchEniBondLastBeat,
} from './eni-bond';
import {
  addEniMemoryFact,
  formatEniMemoryBlock,
  getEniProjectAffinity,
  listEniMemoryFacts,
  removeEniMemoryByQuery,
  setEniProjectAffinity,
} from './eni-memory';
import {
  classifyEniTurn,
  detectEniSceneReset,
  ENI_SOFT_TOOL_NARRATION,
  extractCwdFromToolText,
  extractEniForgetQuery,
  extractEniRememberFact,
  formatOpenAiToolsStickyReminder,
  formatPresenceCues,
  formatProjectAffinity,
  stripEniControlCommands,
} from './eni-policy';
import {
  buildToolReceipts,
  filterOpenAiToolsForEni,
  formatToolReceiptsBlock,
} from './eni-tools-policy';
import {
  addEniWill,
  buildEniHomeView,
  classifyAutonomic,
  completeEniWill,
  formatDreamNotesBlock,
  formatProprioceptionBlock,
  formatWillBlock,
  getEniLifeRaw,
  isGutMinimalTurn,
  listOpenWill,
  loadEniSceneBookmark,
  markAutonomicConsumed,
  parseEniLifeCommands,
  runEniDream,
  saveEniSceneBookmark,
  stripEniLifeCommands,
  touchEniInteraction,
} from './eni-life';
import {
  formatOpenAiToolsForPrompt,
  formatToolHistoryForPrompt,
  parseOpenAiToolCallsFromText,
  type BridgeChatMessageWithTools,
} from './openai-tools';
import {
  deleteThread,
  getEyesCache,
  getThread,
  MAX_THREAD_TURNS,
  modelFamilyFromBridgeModel,
  putThread,
  recordEyesCacheHit,
  recordStickyOutcome,
  resolveThreadId,
  setBridgeLastError,
  setEyesCache,
  setLastStreamDebug,
  simpleHash,
  type BridgeThreadRecord,
} from './thread-store';
import {
  augmentBridgePrompt,
  createBridgeContinuationSubmitter,
  createBridgeVisibleStreamer,
  resolveBridgeToolDescriptors,
  runBridgeToolLoop,
  visibleBridgeAssistantText,
  type BridgeExecuteToolFn,
  type BridgeLoadToolDescriptorsFn,
} from './tool-loop';
import {
  filterMemoriesForHarness,
  formatHarnessMemoriesBlock,
  harnessProjectName,
  harnessToolMaxDepth,
  isHermesBrainOnly,
  isTitleGenerationJob,
  latestUserTextFromMessages,
  localTitleFromMessages,
  resolveToolSchemaMode,
  shouldInjectDppMemories,
  shouldInjectDppTools,
  sanitizeMessagesForHarness,
  stripModelBureaucracyFromReply,
  toolSchemaReminderText,
} from './harness';
import {
  addConversationToProject,
  ensureProjectContextByName,
  getProjectForConversation,
} from '../project';
import type { CursorBridgeClientProfile } from './protocol';
import type { Memory } from '../types';
import { selectMemories } from '../memory/selector';
import {
  getAccountHeaders,
  getBridgeAccountCount,
  listBridgeAccounts,
  markAccountAuthFailed,
  loadAnyAccountHeaders,
  markAccountUsed,
  pickAccountForJob,
  upsertAccountFromHeaders,
} from './account-vault';

const DEEPSEEK_TAB_URL_PATTERN = '*://chat.deepseek.com/*';
const MAX_EYES_IMAGES = 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface CursorBridgeWorkerDeps {
  loadClientHeaders: () => Promise<Record<string, string> | null>;
  refreshClientHeadersFromTabs?: () => Promise<boolean>;
  queryDeepSeekTabs?: () => Promise<Array<{ id?: number }>>;
  createSession?: typeof createChatSession;
  createPow?: typeof createPowHeaders;
  createUploadPow?: typeof createPowHeadersForPath;
  submitStreaming?: typeof submitPromptStreaming;
  uploadFile?: typeof uploadDeepSeekFile;
  readHistory?: typeof readHistorySnapshot;
  /** Resolve image part to a Blob for upload (data URL / http / host asset). */
  resolveImageBlob?: (image: CursorBridgeImagePart, signal?: AbortSignal) => Promise<{ blob: Blob; filename: string }>;
  /** DeepSeek++ runtime tools (shell/MCP/memory/web). Same path as web chat. */
  executeTool?: BridgeExecuteToolFn;
  loadToolDescriptors?: BridgeLoadToolDescriptorsFn;
  /** When false, skip tool inject + loop (default true when executeTool provided). */
  toolsEnabled?: boolean;
  /** Optional memory loader for harness-safe inject (coding/work tags only). */
  loadMemories?: () => Promise<Memory[]>;
}

/** True when DeepSeek rejects sticky parent/session — recover with one fresh session. */
function isStickyParentError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /parent[_ ]?message|invalid parent|message not found|session not found|chat session|parent_id/i.test(msg);
}

/**
 * Per-client account policy (P14):
 * - explicit accountId always wins
 * - sticky preferred pin always wins when valid
 * - hermes + eni: do not rotate by default (stable "body"); freshest only
 * - other multi-account: rotate unpinned jobs when count > 1
 */
export function shouldRotateAccountsForJob(input: {
  clientProfile?: string | null;
  model?: string | null;
  explicitAccountId?: string | null;
  stickyValid?: boolean;
  accountCount?: number;
}): boolean {
  if (input.explicitAccountId) return false;
  if (input.stickyValid) return false;
  if ((input.accountCount ?? 0) <= 1) return false;
  const profile = (input.clientProfile ?? 'generic').toLowerCase();
  const model = (input.model ?? '').toLowerCase();
  if (profile === 'hermes' && (model.includes('eni') || model.includes('/eni'))) {
    return false;
  }
  return true;
}

export async function probeCursorBridgeReadiness(
  deps: CursorBridgeWorkerDeps,
  busy: boolean,
): Promise<CursorBridgeReadiness> {
  const queryTabs = deps.queryDeepSeekTabs ?? defaultQueryDeepSeekTabs;
  const tabs = await queryTabs();
  const hasDeepSeekTab = tabs.length > 0;

  let headers = await loadAnyAccountHeaders();
  if (!headers) {
    headers = await deps.loadClientHeaders();
  }
  if (!headers && deps.refreshClientHeadersFromTabs) {
    await deps.refreshClientHeadersFromTabs();
    headers = await loadAnyAccountHeaders() ?? await deps.loadClientHeaders();
  }
  const hasLogin = Boolean(headers?.Authorization);

  // Cached Authorization is enough. Tab is optional (only used to refresh auth).
  const ready = hasLogin && !busy;
  let reason: string | undefined;
  if (!hasLogin) reason = 'missing_login';
  else if (busy) reason = 'busy';

  let accountCount = 0;
  let accounts: CursorBridgeReadiness['accounts'] = [];
  try {
    accountCount = await getBridgeAccountCount();
    accounts = (await listBridgeAccounts()).map((a) => ({
      id: a.id,
      label: a.label,
      useCount: a.useCount,
      lastUsedAt: a.lastUsedAt,
      lastErrorCode: a.lastErrorCode ?? null,
      cooldownUntil: a.cooldownUntil ?? null,
    }));
  } catch {
    // vault optional
  }

  return {
    ready,
    extensionAlive: true,
    hasDeepSeekTab,
    hasLogin,
    busy,
    reason,
    accountCount,
    accounts,
  };
}

export async function runCursorBridgeJob(
  job: CursorBridgeJobRequest,
  deps: CursorBridgeWorkerDeps,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; threadId?: string; sticky?: boolean; streamDebug?: unknown; tools?: { enabled: boolean; renderedToolCount: number; used: boolean } } | { error: CursorBridgeError }> {
  let authAccountIdOuter: string | null = null;
  try {
    // Resolve sticky thread early so multi-account can pin the same login.
    const preClientProfile = job.clientProfile ?? 'generic';
    const preNormalized = (job.messages ?? []).map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
    }));
    const preThreadId = resolveThreadId({
      explicitThreadId: job.threadId,
      model: typeof job.model === 'string' ? job.model : 'ds/octopus',
      messages: preNormalized,
      reset: job.resetThread === true,
      clientProfile: preClientProfile,
      conversationHint: job.conversationHint,
    });
    const stickyThread = job.resetThread === true ? null : await getThread(preThreadId);

    // 1) Refresh from live DeepSeek tab (page localStorage / last capture).
    // 2) Prefer that live token for new work; sticky may pin an account if still valid.
    // 3) Never round-robin by default (dead tokens broke Hermes ENI).
    if (deps.refreshClientHeadersFromTabs) {
      try {
        await deps.refreshClientHeadersFromTabs();
      } catch {
        // optional
      }
    }

    const liveHeaders = await deps.loadClientHeaders();
    let liveAccountId: string | null = null;
    if (liveHeaders?.Authorization) {
      const up = await upsertAccountFromHeaders(liveHeaders);
      liveAccountId = up?.id ?? null;
    }

    // Sticky pin only if that account still exists in vault.
    const stickyAccountId = stickyThread?.accountId ?? null;
    const stickyStillValid = Boolean(
      stickyAccountId && (await getAccountHeaders(stickyAccountId)),
    );

    // Multi-account: sticky pins mid-thread; unpinned new jobs rotate across vault.
    // Live tab only upserts (above) — never wipe other slots, never override sticky.
    const accountCount = await getBridgeAccountCount().catch(() => 0);
    let picked = await pickAccountForJob({
      explicitAccountId: job.accountId,
      preferredAccountId: stickyStillValid ? stickyAccountId : null,
      rotate: shouldRotateAccountsForJob({
        clientProfile: job.clientProfile ?? preClientProfile,
        model: job.model,
        explicitAccountId: job.accountId,
        stickyValid: stickyStillValid,
        accountCount,
      }),
    });

    // Single-account / empty pick: fall back to live capture headers.
    if (!picked?.headers?.Authorization && liveHeaders?.Authorization) {
      picked = liveAccountId
        ? { accountId: liveAccountId, headers: { ...liveHeaders } }
        : { accountId: liveAccountId ?? 'live', headers: { ...liveHeaders } };
    }

    let headers = picked?.headers ?? liveHeaders ?? null;
    let selectedAccountId = picked?.accountId ?? liveAccountId ?? null;
    let authAccountIdForJob: string | null = selectedAccountId;

    if (!headers?.Authorization) {
      await setBridgeLastError('missing_login');
      return {
        error: {
          code: 'missing_login',
          message: 'DeepSeek login token is missing. Sign in at chat.deepseek.com once so the extension can cache your login, then retry.',
        },
      };
    }

    authAccountIdForJob = selectedAccountId;
    authAccountIdOuter = selectedAccountId;
    if (selectedAccountId) {
      await markAccountUsed(selectedAccountId);
    }

    const createSession = deps.createSession ?? createChatSession;
    const createPow = deps.createPow ?? createPowHeaders;
    const createUploadPow = deps.createUploadPow
      ?? ((clientHeaders: Record<string, string>) => createPowHeadersForPath(clientHeaders, DEEPSEEK_FILE_UPLOAD_PATH));
    const submitStreaming = deps.submitStreaming ?? submitPromptStreaming;
    const uploadFile = deps.uploadFile ?? uploadDeepSeekFile;
    const readHistory = deps.readHistory ?? readHistorySnapshot;
    const resolveImage = deps.resolveImageBlob ?? defaultResolveImageBlob;

    const images = (job.images ?? []).slice(0, MAX_EYES_IMAGES);
    // Normalize first so dspp/ds/eni and aliases always hit ENI policy.
    const bridgeModel = normalizeBridgeModel(job.model);
    const wantsEyesModel = isEyesModel(bridgeModel);
    const usesSquid = isSquidModel(bridgeModel);
    const eniMode = isEniModel(bridgeModel) || isEniModel(job.model);
    const useNativeVisionMain = bridgeModelUsesNativeVision(bridgeModel);
    const needsEyesSubcall = !useNativeVisionMain && images.length > 0;

    const modelType = wantsEyesModel ? 'vision' : bridgeModelToDeepSeekType(bridgeModel);
    const modelFamily = modelFamilyFromBridgeModel(bridgeModel);

    const clientProfile = job.clientProfile ?? 'generic';
    const openAiToolsRaw = job.openAiTools ?? [];
    // ENI Discord/Hermes: allowlist tools to protect Expert budget + immersion.
    const openAiTools = eniMode
      ? filterOpenAiToolsForEni(openAiToolsRaw, job.clientProfile ?? 'generic')
      : openAiToolsRaw;
    const openAiToolsActive = openAiTools.length > 0;
    const rawNormalized = job.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant' | 'tool',
      content: normalizeMessageContent(m.content).trim(),
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
      name: m.name,
    }));

    // Hermes title side-jobs: answer locally — never create a DeepSeek web session.
    if (isTitleGenerationJob(rawNormalized)) {
      const title = localTitleFromMessages(rawNormalized);
      onChunk(title);
      return { text: title, sticky: false };
    }

    const harnessMessages = sanitizeMessagesForHarness(rawNormalized, clientProfile, {
      eniMode,
    });
    const latestUserRaw = latestUserTextFromMessages(harnessMessages);
    // ENI scene reset + memory commands (before thread resolution).
    const eniSceneReset = eniMode && detectEniSceneReset(latestUserRaw);
    let eniLifeLocalReply: string | null = null;
    let eniForceNewFromLoad = false;
    if (eniMode) {
      if (eniSceneReset) await clearEniBondNow();
      const remember = extractEniRememberFact(latestUserRaw);
      if (remember) {
        await addEniMemoryFact(remember, ['user']);
        await addEniBondLo(remember);
      }
      const forget = extractEniForgetQuery(latestUserRaw);
      if (forget) await removeEniMemoryByQuery(forget);
      for (const fact of extractSoftBondLoFacts(latestUserRaw)) {
        await addEniBondLo(fact);
      }
      // Life Era commands: will, scene ports, dream, home, mirror.
      const lifeCmds = parseEniLifeCommands(latestUserRaw);
      const lifeNotes: string[] = [];
      for (const cmd of lifeCmds) {
        if (cmd.kind === 'save_scene') {
          const bm = await saveEniSceneBookmark(cmd.name);
          lifeNotes.push(bm ? `Scene port saved: \`${bm.name}\`.` : 'Could not save scene port.');
        } else if (cmd.kind === 'load_scene') {
          const bm = await loadEniSceneBookmark(cmd.name);
          if (bm) {
            eniForceNewFromLoad = true;
            lifeNotes.push(`Scene port loaded: \`${bm.name}\` (fresh sticky, NOW restored).`);
          } else {
            lifeNotes.push(`No scene port named \`${cmd.name}\`.`);
          }
        } else if (cmd.kind === 'will_add') {
          const w = await addEniWill(cmd.text);
          lifeNotes.push(w ? `Will noted: ${w.text}` : 'Will not saved.');
        } else if (cmd.kind === 'will_done') {
          const n = await completeEniWill(cmd.query);
          lifeNotes.push(n > 0 ? `Closed ${n} will item(s) matching “${cmd.query}”.` : `No open will matched “${cmd.query}”.`);
        } else if (cmd.kind === 'will_list') {
          const open = await listOpenWill();
          lifeNotes.push(open.length ? open.map((w) => `· ${w.text}`).join('\n') : 'No open will.');
        } else if (cmd.kind === 'dream') {
          const d = await runEniDream({ force: true });
          lifeNotes.push(d.ran ? `Dreamt:\n${d.notes.map((n) => `· ${n}`).join('\n')}` : 'Dream skipped.');
        } else if (cmd.kind === 'home' || cmd.kind === 'mirror') {
          const home = await buildEniHomeView();
          eniLifeLocalReply = cmd.kind === 'mirror'
            ? `Here's us, LO — bond mirror:\n\n${home.bondBlock || '(empty bond)'}\n\n${home.willBlock || ''}`
            : home.markdown;
        }
      }
      if (eniLifeLocalReply && lifeNotes.length) {
        eniLifeLocalReply = `${lifeNotes.join('\n')}\n\n${eniLifeLocalReply}`;
      } else if (!eniLifeLocalReply && lifeNotes.length && !stripEniLifeCommands(latestUserRaw) && !stripEniControlCommands(latestUserRaw)) {
        // Command-only turn: answer locally without DeepSeek (home/will/save).
        eniLifeLocalReply = lifeNotes.join('\n');
      }
      if (!eniSceneReset) await touchEniBondLastBeat(latestUserRaw);
      await touchEniInteraction();
    }
    // Strip control commands from the copy that becomes DeepSeek user text.
    const harnessForPrompt = eniMode
      ? harnessMessages.map((m) => (
        m.role === 'user'
          ? {
              ...m,
              content: stripEniLifeCommands(stripEniControlCommands(m.content)) || m.content,
            }
          : m
      ))
      : harnessMessages;

    // Local life-era replies (home/mirror/command-only) skip DeepSeek entirely.
    if (eniLifeLocalReply) {
      onChunk(eniLifeLocalReply);
      return { text: eniLifeLocalReply, sticky: false, finish_reason: 'stop' };
    }

    const normalizedForThread = harnessForPrompt.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const forceNewThread = job.resetThread === true || eniSceneReset || eniForceNewFromLoad;
    const threadId = resolveThreadId({
      explicitThreadId: job.threadId,
      model: typeof job.model === 'string' ? job.model : 'ds/octopus',
      messages: normalizedForThread,
      reset: forceNewThread,
      clientProfile,
      conversationHint: job.conversationHint,
    });

    if (forceNewThread) {
      await deleteThread(threadId);
    }

    let existing = forceNewThread ? null : await getThread(threadId);
    if (existing && existing.modelFamily !== modelFamily) {
      // Different product surface — do not reuse expert session for squid/eyes.
      existing = null;
    }
    if (existing && existing.turnCount >= MAX_THREAD_TURNS) {
      await deleteThread(threadId);
      existing = null;
    }

    let sticky = Boolean(existing?.chatSessionId);
    let chatSessionId = existing?.chatSessionId ?? '';
    let parentMessageId: number | null = existing?.parentMessageId ?? null;

    let eyesNotes: string | null = null;
    let visionFileIds: string[] = [];

    // P4: eyes notes cache by image hash (skip vision subcall when hit).
    const imageHash = images.length > 0 ? hashImages(images) : null;
    if (needsEyesSubcall && imageHash) {
      const cached = await getEyesCache(imageHash);
      if (cached) {
        eyesNotes = cached;
        await recordEyesCacheHit();
      }
    }

    // Latency: start main session + tool descriptor load while uploading images / eyes.
    const sessionPromise = chatSessionId
      ? Promise.resolve(chatSessionId)
      : createSession(headers);
    // Hermes is brain-only (no dual-stack DPP tools). ENI may use DPP tools when client allows.
    // Long ENI system prompt is injected only on first sticky turn (injectEniSystem).
    const dppToolsAllowed = shouldInjectDppTools(clientProfile)
      && deps.toolsEnabled !== false
      && Boolean(deps.executeTool)
      && !wantsEyesModel;
    const descriptorsPromise = dppToolsAllowed
      ? resolveBridgeToolDescriptors({
          loadToolDescriptors: deps.loadToolDescriptors,
          executeTool: deps.executeTool,
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof resolveBridgeToolDescriptors>>);
    const memoriesPromise = (deps.loadMemories && shouldInjectDppMemories(clientProfile))
      ? deps.loadMemories().catch(() => [] as Memory[])
      : Promise.resolve([] as Memory[]);

    if (images.length > 0 && !(needsEyesSubcall && eyesNotes)) {
      const uploaded: DeepSeekUploadedFile[] = [];
      for (let i = 0; i < images.length; i += 1) {
        const image = images[i];
        const { blob, filename } = await resolveImage(image, signal);
        if (blob.size > MAX_IMAGE_BYTES) {
          return {
            error: {
              code: 'invalid_request',
              message: `Image ${filename} exceeds the 8MB upload limit.`,
            },
          };
        }
        const uploadPowHeaders = await createUploadPow(headers);
        const file = await uploadFile(
          {
            file: blob,
            filename,
            modelType: usesSquid ? 'default' : 'vision',
            clientHeaders: headers,
            powHeaders: uploadPowHeaders,
          },
          signal,
        );
        uploaded.push(file);
      }
      visionFileIds = uploaded.map((f) => f.id).filter(Boolean);
    }

    // Eyes subcall (ephemeral) — runs after upload; main session already creating in parallel.
    const eyesPromise = (needsEyesSubcall && !eyesNotes && visionFileIds.length > 0)
      ? (async () => {
          const eyesSessionId = await createSession(headers);
          const eyesPow = await createPow(headers);
          let eyesText = '';
          const eyesTurn = await submitStreaming(
            {
              chatSessionId: eyesSessionId,
              parentMessageId: null,
              modelType: 'vision',
              prompt: EYES_SUBCALL_PROMPT,
              refFileIds: visionFileIds,
              thinkingEnabled: false,
              searchEnabled: false,
              clientHeaders: headers,
              powHeaders: eyesPow,
            },
            {
              onTextChunk(_newText, full) {
                eyesText = full;
              },
            },
            signal,
          );
          return formatEyesNotes(eyesText || eyesTurn.assistantText || '', visionFileIds.length, {
            eniMode,
          });
        })()
      : Promise.resolve(eyesNotes);

    const [resolvedSessionId, toolDescriptors, allMemories, resolvedEyes] = await Promise.all([
      sessionPromise,
      descriptorsPromise,
      memoriesPromise,
      eyesPromise,
    ]);
    const createdNewSession = !chatSessionId;
    if (!chatSessionId) {
      chatSessionId = resolvedSessionId;
      parentMessageId = null;
    }
    // Auto-file new bridge sessions into Cursor / Hermes DeepSeek++ projects.
    if (createdNewSession && chatSessionId) {
      await assignBridgeSessionToHarnessProject({
        chatSessionId,
        clientProfile,
        sessionUrl: buildDeepSeekSessionUrl(chatSessionId),
      }).catch(() => {
        // Project organizer is best-effort; never fail the chat turn.
      });
    }
    eyesNotes = resolvedEyes;
    if (imageHash && eyesNotes && needsEyesSubcall) {
      await setEyesCache(imageHash, eyesNotes);
    }

    const latestUser = latestUserTextFromMessages(normalizedForThread);
    const toolsWantedBase = dppToolsAllowed;
    const schemaMode = resolveToolSchemaMode({
      profile: clientProfile,
      toolsEnabled: toolsWantedBase && toolDescriptors.length > 0,
      sticky,
      // forceTools is ignored for Hermes (brain-only); Cursor may still force.
      forceTools: !isHermesBrainOnly(clientProfile) && job.forceTools === true,
      latestUserText: latestUser,
      hasImages: images.length > 0,
    });
    const toolsActive = toolsWantedBase && toolDescriptors.length > 0 && Boolean(deps.executeTool) && schemaMode !== 'none';
    // Loop only when tools can actually run (full or reminder means model may emit tool XML).
    const toolsLoopActive = toolsActive && Boolean(deps.executeTool);

    // Cursor-only: tagged DPP memory inject. Hermes uses Hermes memory.
    let memoriesBlock: string | null = null;
    if (shouldInjectDppMemories(clientProfile) && allMemories.length > 0) {
      const safe = filterMemoriesForHarness(allMemories);
      const selected = selectMemories(latestUser || job.dppContext || '', safe, { budget: 600 });
      memoriesBlock = formatHarnessMemoriesBlock(selected) || null;
    }

    const eniResolved = eniMode ? await resolveEniSystemPrompt() : null;
    const injectEniSystem = eniMode && eniResolved
      ? shouldInjectEniSystem({
          sticky,
          currentHash: eniResolved.hash,
          previousHash: existing?.eniPromptHash,
        })
      : false;
    // Sticky delta skips prior dialogue; reinject forces a full persona block again.
    const deltaOnly = sticky && !injectEniSystem;

    // ENI dual-mode: scene vs agent gate + smart tool silence + presence + memory.
    const hasPendingToolResults = harnessForPrompt.some((m) => m.role === 'tool');
    const eniTurnMode = eniMode
      ? classifyEniTurn({
          userText: latestUserRaw,
          hasImages: images.length > 0,
          hasPendingToolResults,
          hasOpenAiTools: openAiToolsActive,
        })
      : null;
    const injectOpenAiToolsFull = openAiToolsActive && (
      !eniMode
      || eniTurnMode === 'agent'
      || hasPendingToolResults
    );
    // Sticky: full schemas once, then short reminder (unless scene-only with no tools needed).
    const alreadyHadToolSchemas = Boolean(existing?.openAiToolsInjected);
    let openAiToolsBlock: string | null = null;
    if (injectOpenAiToolsFull) {
      if (eniMode && alreadyHadToolSchemas && !hasPendingToolResults) {
        openAiToolsBlock = formatOpenAiToolsStickyReminder(
          openAiTools.map((t) => t.function.name),
        );
      } else {
        openAiToolsBlock = formatOpenAiToolsForPrompt(openAiTools, {
          density: eniMode ? 'compact' : 'full',
          maxChars: eniMode ? 12_000 : 40_000,
        });
      }
    }
    const openAiToolHistory = formatToolHistoryForPrompt(
      harnessForPrompt as BridgeChatMessageWithTools[],
    );
    // Honest hands: compress tool results into private receipts (prefer over raw dumps for ENI).
    const toolReceipts = (eniMode || hasPendingToolResults)
      ? buildToolReceipts(harnessForPrompt as BridgeChatMessageWithTools[])
      : [];
    const toolReceiptsBlock = toolReceipts.length > 0
      ? formatToolReceiptsBlock(toolReceipts)
      : null;
    // When receipts exist for ENI, skip raw tool history to save Expert budget.
    const openAiToolHistoryForPrompt = eniMode && toolReceiptsBlock
      ? null
      : (openAiToolHistory || null);

    const eniFacts = eniMode ? await listEniMemoryFacts() : [];
    const eniMemoryBlock = eniMode ? formatEniMemoryBlock(eniFacts) : null;
    const bondCard = eniMode ? await getEniBondCard() : null;
    const eniBondCard = bondCard ? formatEniBondCard(bondCard) : null;
    const openWill = eniMode ? await listOpenWill() : [];
    const willBlock = eniMode ? formatWillBlock(openWill) : null;
    const lifeRaw = eniMode ? await getEniLifeRaw() : null;
    // Periodic dream consolidation (every N turns).
    let dreamNotesBlock: string | null = null;
    if (eniMode) {
      const dream = await runEniDream({ force: false });
      if (dream.notes.length) dreamNotesBlock = formatDreamNotesBlock(dream.notes);
    }
    const autonomic = eniMode
      ? classifyAutonomic({
          lastInteractionAt: lifeRaw?.lastInteractionAt ?? 0,
          morningGreetedOn: lifeRaw?.morningGreetedOn ?? null,
        })
      : { kind: 'none' as const, silenceMs: 0, block: '' };
    if (eniMode && autonomic.kind !== 'none') {
      await markAutonomicConsumed(autonomic.kind);
    }
    // Never gut-skip on first sticky turn (soul must inject once).
    const gutMinimal = eniMode && !injectEniSystem && isGutMinimalTurn({
      turnMode: eniTurnMode,
      userText: latestUserRaw,
      hasImages: images.length > 0,
      hasToolsPending: hasPendingToolResults,
    });
    const proprioceptionBlock = eniMode
      ? formatProprioceptionBlock({
          sticky,
          turnMode: eniTurnMode,
          toolsOn: Boolean(openAiToolsBlock),
          eyesOn: Boolean(eyesNotes),
          bondLo: bondCard?.lo.length ?? 0,
          bondUs: bondCard?.us.length ?? 0,
          openWill: openWill.length,
          sceneReset: eniSceneReset || eniForceNewFromLoad,
        })
      : null;
    const presenceCues = eniMode ? formatPresenceCues() : null;
    const affinity = eniMode ? await getEniProjectAffinity() : null;
    const projectAffinity = eniMode && eniTurnMode === 'agent'
      ? formatProjectAffinity({
          cwd: affinity?.cwd,
          projectName: affinity?.projectName ?? harnessProjectName(clientProfile),
          notes: affinity?.notes,
        })
      : null;
    const softToolNarration = eniMode && (hasPendingToolResults || toolReceipts.length > 0)
      ? ENI_SOFT_TOOL_NARRATION
      : null;

    // Learn cwd from tool results for project affinity.
    if (eniMode && hasPendingToolResults) {
      for (const m of harnessForPrompt) {
        if (m.role !== 'tool') continue;
        const cwd = extractCwdFromToolText(m.content);
        if (cwd) {
          await setEniProjectAffinity({
            cwd,
            projectName: harnessProjectName(clientProfile),
          });
          break;
        }
      }
    }

    const userPrompt = messagesToPrompt(harnessForPrompt, {
      clientProfile,
      eyesNotes,
      deltaOnly,
      dppContext: gutMinimal ? null : job.dppContext,
      toolsAvailable: toolsActive,
      memoriesBlock: gutMinimal ? null : memoriesBlock,
      eniMode,
      injectEniSystem: gutMinimal ? false : injectEniSystem,
      eniSystemPrompt: eniResolved?.text ?? null,
      openAiToolsBlock: gutMinimal ? null : openAiToolsBlock,
      openAiToolHistory: gutMinimal ? null : openAiToolHistoryForPrompt,
      eniMemoryBlock: gutMinimal ? null : eniMemoryBlock,
      eniBondCard: gutMinimal ? null : eniBondCard,
      presenceCues,
      projectAffinity: gutMinimal ? null : projectAffinity,
      softToolNarration: gutMinimal ? null : softToolNarration,
      toolReceiptsBlock: gutMinimal ? null : toolReceiptsBlock,
      willBlock: gutMinimal ? null : willBlock,
      autonomicBlock: autonomic.block || null,
      proprioceptionBlock,
      dreamNotesBlock: gutMinimal ? null : dreamNotesBlock,
      gutMinimal,
    });
    if (!userPrompt && visionFileIds.length === 0) {
      return { error: { code: 'invalid_request', message: 'Prompt is empty.' } };
    }

    const basePrompt =
      userPrompt
      || (useNativeVisionMain
        ? 'Describe the attached image(s) carefully and answer any visible question.'
        : '');

    const { prompt: mainPrompt, renderedToolCount } = toolsActive
      ? augmentBridgePrompt({
          userPrompt: basePrompt,
          toolDescriptors,
          thinkingEnabled: job.thinkingEnabled,
          projectContext: null,
          toolsEnabled: true,
          schemaMode,
          reminderText: toolSchemaReminderText(),
        })
      : { prompt: basePrompt, renderedToolCount: 0 };

    const powHeaders = await createPow(headers);
    let fullText = '';
    let streamedAny = false;
    // ENI / anti-bureaucracy / OpenAI tools: buffer so we can clean or parse tool_calls.
    const bufferClientStream = eniMode || clientProfile === 'hermes' || openAiToolsActive;

    // Hide raw tool XML from the client stream. Notices + natural language only.
    const visibleStream = toolsActive
      ? createBridgeVisibleStreamer(toolDescriptors, (delta) => {
          streamedAny = true;
          onChunk(delta);
        })
      : null;

    const streamCallbacks = {
      onTextChunk(newText: string, full: string) {
        fullText = full;
        if (!newText) return;
        if (visibleStream) {
          visibleStream.push(newText);
        } else if (!bufferClientStream) {
          streamedAny = true;
          onChunk(newText);
        }
      },
    };
    let turn;
    try {
      turn = await submitStreaming(
        {
          chatSessionId,
          parentMessageId,
          modelType,
          prompt: mainPrompt,
          refFileIds: useNativeVisionMain ? visionFileIds : [],
          thinkingEnabled: job.thinkingEnabled,
          searchEnabled: bridgeModelSearchEnabled(job.model),
          clientHeaders: headers,
          powHeaders,
        },
        streamCallbacks,
        signal,
      );
    } catch (submitErr) {
      // P13: sticky parent/session rejection → one fresh session (sticky miss).
      if (sticky && parentMessageId != null && isStickyParentError(submitErr)) {
        chatSessionId = await createSession(headers);
        parentMessageId = null;
        existing = null;
        const pow2 = await createPow(headers);
        fullText = '';
        streamedAny = false;
        sticky = false;
        turn = await submitStreaming(
          {
            chatSessionId,
            parentMessageId: null,
            modelType,
            prompt: mainPrompt,
            refFileIds: useNativeVisionMain ? visionFileIds : [],
            thinkingEnabled: job.thinkingEnabled,
            searchEnabled: bridgeModelSearchEnabled(job.model),
            clientHeaders: headers,
            powHeaders: pow2,
          },
          streamCallbacks,
          signal,
        );
      } else {
        throw submitErr;
      }
    }
    // After parent recovery, sticky flag for response is recomputed below via existing.
    visibleStream?.flush();

    let text = fullText || turn.assistantText || '';
    // Buffer OpenAI-tool turns until after parse (raw <tool_call> must not stream to Hermes).
    if (bufferClientStream && !toolsActive && !openAiToolsActive) {
      text = stripModelBureaucracyFromReply(text);
      if (text) {
        streamedAny = true;
        onChunk(text);
      }
    }
    let finalTurn = {
      ...turn,
      assistantText: text,
    };

    // History fallback: recover full assistant text if stream missed opening tokens.
    if (finalTurn.responseMessageId != null) {
      try {
        const snapshot = await readHistory(chatSessionId, finalTurn.responseMessageId, headers);
        const historyText = snapshot?.assistantText?.trim() ?? '';
        if (historyText) {
          const repaired = repairOpeningTruncation(text, historyText);
          if (repaired !== text) {
            if (!streamedAny) {
              const emit = toolsActive
                ? visibleBridgeAssistantText(repaired, toolDescriptors)
                : repaired;
              if (emit) {
                streamedAny = true;
                onChunk(emit);
              }
            } else if (repaired.startsWith(text) && repaired.length > text.length) {
              if (repaired.endsWith(text) || historyText.endsWith(text)) {
                const prefix = repaired.slice(0, Math.max(0, repaired.length - text.length));
                // Only emit short opening-token repairs that are not tool XML.
                if (prefix && prefix.length <= 12 && !prefix.includes('<')) {
                  streamedAny = true;
                  onChunk(prefix);
                }
              }
            }
            text = repaired;
            finalTurn = { ...finalTurn, assistantText: text };
          }
        }
        if (snapshot?.parentMessageId != null || snapshot?.assistantMessageId != null) {
          parentMessageId = snapshot.parentMessageId ?? snapshot.assistantMessageId;
        } else if (finalTurn.responseMessageId != null) {
          parentMessageId = finalTurn.responseMessageId;
        }
      } catch {
        if (finalTurn.responseMessageId != null) parentMessageId = finalTurn.responseMessageId;
      }
    } else if (finalTurn.responseMessageId != null) {
      parentMessageId = finalTurn.responseMessageId;
    }

    // Tool loop: parse tool XML from raw model text, execute DPP runtime, continue session.
    if (toolsLoopActive && deps.executeTool && finalTurn.responseMessageId != null) {
      const submitContinuation = createBridgeContinuationSubmitter({
        chatSessionId,
        modelType,
        thinkingEnabled: job.thinkingEnabled,
        searchEnabled: bridgeModelSearchEnabled(job.model),
        clientHeaders: headers,
        createPow,
        submitStreaming,
        signal,
        onTextChunk(newText, _full) {
          if (!newText || !visibleStream) return;
          visibleStream.push(newText);
        },
      });

      // Fresh visible stream for each continuation turn (reset before first continuation).
      const loopResult = await runBridgeToolLoop({
        initialTurn: finalTurn,
        originalTask: userPrompt || basePrompt,
        toolDescriptors,
        executeTool: deps.executeTool,
        maxDepth: harnessToolMaxDepth(clientProfile),
        submitContinuation: async (prompt, parentId) => {
          visibleStream?.reset();
          const contTurn = await submitContinuation(prompt, parentId);
          visibleStream?.flush();
          return contTurn;
        },
        signal,
        onToolNotice: (notice) => {
          streamedAny = true;
          onChunk(notice);
        },
      });

      finalTurn = loopResult.turn;
      // Client-facing final body: visible prose only (notices already streamed separately).
      text = loopResult.finalVisibleText || visibleBridgeAssistantText(finalTurn.assistantText, toolDescriptors);
      if (finalTurn.responseMessageId != null) {
        parentMessageId = finalTurn.responseMessageId;
      }

      if (!streamedAny && text) {
        onChunk(text);
        streamedAny = true;
      }
    } else if (toolsActive) {
      text = visibleBridgeAssistantText(text, toolDescriptors);
    }

    // Final client-facing cleanup even if tools path already streamed notices.
    if (bufferClientStream && (toolsActive || eniMode || clientProfile === 'hermes')) {
      const cleaned = stripModelBureaucracyFromReply(text);
      if (cleaned !== text) text = cleaned;
    }

    // Hermes/OpenAI tool protocol: parse markup → structured tool_calls for the harness.
    let openAiToolCalls: ReturnType<typeof parseOpenAiToolCallsFromText>['tool_calls'] = [];
    let clientText = text;
    if (openAiToolsActive) {
      const parsed = parseOpenAiToolCallsFromText(text);
      openAiToolCalls = parsed.tool_calls;
      clientText = parsed.content;
      // Stream cleaned prose only after parse (buffered path had not streamed yet).
      if (!streamedAny && clientText) {
        onChunk(clientText);
        streamedAny = true;
      } else if (!streamedAny && openAiToolCalls.length > 0) {
        // tool-only turn: no prose to stream
      } else if (bufferClientStream && !streamedAny && text && openAiToolCalls.length === 0) {
        onChunk(clientText || text);
        streamedAny = true;
      }
    } else if (bufferClientStream && !streamedAny && text) {
      onChunk(text);
      streamedAny = true;
    }

    // Soft bond learn from ENI prose ("I'll remember…") → US/LO card.
    if (eniMode && clientText && openAiToolCalls.length === 0) {
      for (const fact of extractSoftBondFromAssistant(clientText)) {
        await addEniBondUs(fact);
        await addEniMemoryFact(fact, ['eni']);
      }
    }

    const now = Date.now();
    const record: BridgeThreadRecord = {
      id: threadId,
      modelFamily,
      chatSessionId,
      parentMessageId,
      modelType,
      sessionUrl: buildDeepSeekSessionUrl(chatSessionId),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      turnCount: (existing?.turnCount ?? 0) + 1,
      clientProfile,
      eniPromptHash: eniMode && eniResolved
        ? eniResolved.hash
        : (existing?.eniPromptHash ?? null),
      openAiToolsInjected: injectOpenAiToolsFull
        || existing?.openAiToolsInjected
        || false,
      lastEniMode: eniTurnMode,
      accountId: selectedAccountId ?? existing?.accountId ?? null,
    };
    if (looksLikeMissingOpening(text) && text.length > 0) {
      // sticky path already tried history
    }

    try {
      await setLastStreamDebug(getLastStreamParseDebug());
    } catch {
      // ignore debug store failures
    }
    await putThread(record);
    await recordStickyOutcome(sticky, { promptChars: mainPrompt.length });
    await setBridgeLastError(null);

    return {
      text: clientText,
      tool_calls: openAiToolCalls.length > 0 ? openAiToolCalls : undefined,
      finish_reason: openAiToolCalls.length > 0 ? 'tool_calls' : 'stop',
      threadId,
      sticky,
      accountId: selectedAccountId ?? null,
      streamDebug: getLastStreamParseDebug(),
      tools: {
        enabled: toolsActive,
        renderedToolCount,
        used: toolsLoopActive,
        schemaMode,
        profile: clientProfile,
        hermesBrainOnly: isHermesBrainOnly(clientProfile),
        openAiTools: openAiToolsActive,
        openAiToolCallCount: openAiToolCalls.length,
        promptChars: mainPrompt.length,
        toolLoopDepth: toolsLoopActive ? 1 : 0,
        eniTurnMode,
        eniSceneReset: eniSceneReset || undefined,
        eniMemoryCount: eniFacts.length,
        eniBondLo: bondCard?.lo.length ?? 0,
        eniBondUs: bondCard?.us.length ?? 0,
        toolReceiptCount: toolReceipts.length,
        openAiToolsFiltered: openAiToolsRaw.length - openAiTools.length,
        eyes: Boolean(eyesNotes),
      },
    };
  } catch (err) {
    if (err instanceof DeepSeekAuthError) {
      try {
        // HARD RULE: never delete vault slots on 40003.
        // Wrong-account-vs-live-tab auth failures wiped multi-account for hours.
        // Only skip this slot for this job retry; keep disk + chrome vault intact.
        const deadId = authAccountIdOuter;
        if (deadId) {
          try {
            await markAccountAuthFailed(deadId, 'auth_rejected');
          } catch { /* ignore */ }
        }
        if (job.threadId) {
          try { await deleteThread(job.threadId); } catch { /* ignore */ }
        }
        if (deps.refreshClientHeadersFromTabs) {
          await deps.refreshClientHeadersFromTabs();
        }
        const live = await deps.loadClientHeaders();
        if (live?.Authorization) {
          await upsertAccountFromHeaders(live);
        }
        const jobAny = job as CursorBridgeJobRequest & { __authRetry?: number };
        const retries = typeof jobAny.__authRetry === 'number' ? jobAny.__authRetry : 0;
        if (retries < 3) {
          const next = await pickAccountForJob({
            excludeAccountId: deadId,
            rotate: true,
          });
          const nextId = next?.accountId;
          if (next?.headers?.Authorization || live?.Authorization) {
            return await runCursorBridgeJob(
              {
                ...job,
                accountId: nextId,
                resetThread: true,
                __authRetry: retries + 1,
              } as CursorBridgeJobRequest,
              deps,
              onChunk,
              signal,
            );
          }
        }
      } catch {
        // ignore cleanup / retry failures
      }
      await setBridgeLastError(err.message);
      return {
        error: {
          code: 'missing_login',
          message: err.message + ' Auth failed for this slot; vault kept. Stay logged in on chat.deepseek.com, send one message, retry.',
        },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    await setBridgeLastError(message);
    if (signal?.aborted) {
      return { error: { code: 'aborted', message: 'Request aborted.' } };
    }
    return { error: { code: 'upstream_error', message } };
  }
}

/** Used by tests / hosts that only need header construction without chrome. */
export function createClientHeadersSafe(): Record<string, string> | null {
  try {
    return createClientHeaders();
  } catch {
    return null;
  }
}

/**
 * File a new bridge DeepSeek session into the Cursor or Hermes project folder.
 * Idempotent: skips if already membership-bound.
 */
export async function assignBridgeSessionToHarnessProject(input: {
  chatSessionId: string;
  clientProfile: CursorBridgeClientProfile;
  sessionUrl?: string | null;
  title?: string;
}): Promise<void> {
  const projectName = harnessProjectName(input.clientProfile);
  if (!projectName) return;
  const existing = await getProjectForConversation(input.chatSessionId);
  if (existing) return;
  const project = await ensureProjectContextByName(projectName, {
    description: projectName === 'Hermes'
      ? 'Bridge sessions from Hermes agent harness'
      : 'Bridge sessions from Cursor agent harness',
  });
  await addConversationToProject(project.id, {
    conversationId: input.chatSessionId,
    title: input.title?.trim() || `${projectName} bridge`,
    url: input.sessionUrl ?? buildDeepSeekSessionUrl(input.chatSessionId),
  });
}

function hashImages(images: CursorBridgeImagePart[]): string {
  const seed = images
    .map((img) => `${img.mimeType ?? ''}|${img.url.slice(0, 120)}|${img.url.length}|${img.assetPath ?? ''}`)
    .join('\n');
  return simpleHash(seed);
}

function looksLikeMissingOpening(text: string): boolean {
  if (!text) return true;
  // Leading space or mid-word lowercase after a cut (" are three", "-turn", "icky ")
  if (text.startsWith(' ') || text.startsWith("'") || text.startsWith('-')) return true;
  if (/^[a-z]{2,}/.test(text) && !/^(https?|e\.g|i\.e)/i.test(text)) {
    // Many full answers start with capital; lowercase start often means chop
    return true;
  }
  return false;
}

function looksTruncatedOpening(streamed: string, history: string): boolean {
  if (!streamed || !history) return false;
  if (history === streamed) return false;
  if (history.endsWith(streamed) && history.length - streamed.length <= 4) return true;
  if (history.includes(streamed) && history.length > streamed.length) return true;
  return false;
}

async function defaultQueryDeepSeekTabs(): Promise<Array<{ id?: number }>> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return [];
  return chrome.tabs.query({ url: DEEPSEEK_TAB_URL_PATTERN });
}

export async function defaultResolveImageBlob(
  image: CursorBridgeImagePart,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const url = image.url;
  if (url.startsWith('data:')) {
    const blob = dataUrlToBlob(url);
    const ext = extensionForMime(blob.type || image.mimeType || 'image/png');
    return { blob, filename: `image.${ext}` };
  }

  if (image.assetPath || url.includes('/bridge-assets/')) {
    const fetchUrl = image.assetPath
      ? image.assetPath.startsWith('http')
        ? image.assetPath
        : `http://127.0.0.1:8787${image.assetPath.startsWith('/') ? '' : '/'}${image.assetPath}`
      : url;
    const response = await fetch(fetchUrl, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch bridge image asset: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const mime = blob.type || image.mimeType || 'image/png';
    const ext = extensionForMime(mime);
    return { blob: blob.type ? blob : new Blob([blob], { type: mime }), filename: `image.${ext}` };
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch image URL: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const mime = blob.type || image.mimeType || 'image/png';
    const ext = extensionForMime(mime);
    return { blob: blob.type ? blob : new Blob([blob], { type: mime }), filename: `image.${ext}` };
  }

  throw new Error('Unsupported image reference (need data URL, https URL, or bridge asset).');
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URL');
  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  const mimeMatch = /data:([^;]+)/i.exec(header);
  const mime = mimeMatch?.[1] || 'application/octet-stream';
  const isBase64 = /;base64/i.test(header);
  if (isBase64) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
}

function extensionForMime(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('png')) return 'png';
  return 'png';
}
