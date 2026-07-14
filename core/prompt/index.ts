export {
  buildPromptAugmentation,
  renderToolSchemas,
} from './augmentation';

export {
  VISIBLE_USER_PROMPT_END,
  VISIBLE_USER_PROMPT_START,
  PAGE_CLEANUP_SANDBOX_TOOL_NAMES,
  containsInternalPromptMarker,
  extractVisibleUserPrompt,
  hasSandboxToolMarkerPrefix,
  isInternalToolResultsContinuationText,
  locateInternalToolResultsContinuation,
  markVisibleUserPrompt,
  normalizeRenderedToolResultsText,
  sanitizeInternalPromptText,
  shouldHideInternalToolResultsBubble,
} from './visibility';
export {
  collectTextOutsidePreCode,
  collectToolResultsHideRootsFromMutations,
  createContentScriptToolResultsMessageHider,
  createInternalToolResultsMessageHider,
  getToolResultsMessageCandidates,
  hideInternalToolResultsMessages,
  messageLooksLikeInternalToolResults,
  serializeElementTextWithBlockNewlines,
  shouldHideToolResultsMessageBubble,
} from './page-tool-results-hide';

export type {
  PromptAugmentationOptions,
  PromptAugmentationResult,
} from './augmentation';
