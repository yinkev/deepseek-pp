import {
  isInternalToolResultsContinuationText,
  normalizeRenderedToolResultsText,
  shouldHideInternalToolResultsBubble,
} from './visibility';

/**
 * Whole-message hide decision for a DeepSeek page `.ds-message` bubble that may
 * contain internal tool-results continuation protocol.
 */
export function shouldHideToolResultsMessageBubble(
  message: HTMLElement,
  options?: {
    isInlineAgentContinuation?: (text: string) => boolean;
  },
): boolean {
  const text = message.textContent;
  if (typeof text !== 'string' || !text) return false;
  if (options?.isInlineAgentContinuation?.(text)) return true;

  const logicalText = normalizeRenderedToolResultsText(
    serializeElementTextWithBlockNewlines(message),
  );
  const fullText = logicalText.trim() || text;
  const hasPreCode = Boolean(message.querySelector('pre, code'));
  const textOutsidePreCode = collectTextOutsidePreCode(message);
  return shouldHideInternalToolResultsBubble({
    fullText,
    textOutsidePreCode,
    hasPreCode,
  });
}

export function serializeElementTextWithBlockNewlines(root: ParentNode): string {
  const blockTags = new Set([
    'P', 'DIV', 'PRE', 'LI', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'TR', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'UL', 'OL', 'TABLE',
  ]);
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    if (tag === 'BR') {
      text += '\n';
      return;
    }
    const block = blockTags.has(tag);
    if (block) text += '\n';
    for (const child of Array.from(element.childNodes)) walk(child);
    if (block) text += '\n';
  };
  walk(root as unknown as Node);
  return text.replace(/\n{3,}/g, '\n\n');
}

export function collectTextOutsidePreCode(root: HTMLElement): string {
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('pre, code, script, style')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    text += node.nodeValue ?? '';
    node = walker.nextNode();
  }
  return text;
}

export function getToolResultsMessageCandidates(root: ParentNode): HTMLElement[] {
  const messages = new Set<HTMLElement>();
  if (root instanceof HTMLElement) {
    if (root.matches('.ds-message')) messages.add(root);
    const ancestor = root.closest('.ds-message');
    if (ancestor instanceof HTMLElement) messages.add(ancestor);
  }
  if ('querySelectorAll' in root) {
    for (const message of root.querySelectorAll<HTMLElement>('.ds-message')) {
      messages.add(message);
    }
  }
  return Array.from(messages);
}

export function hideInternalToolResultsMessages(
  root: ParentNode,
  options?: {
    isInlineAgentContinuation?: (text: string) => boolean;
  },
): number {
  let hidden = 0;
  for (const message of getToolResultsMessageCandidates(root)) {
    if (!shouldHideToolResultsMessageBubble(message, options)) continue;
    message.setAttribute('data-dpp-hidden-internal-tool-results', 'true');
    message.style.display = 'none';
    hidden += 1;
  }
  return hidden;
}

/**
 * Production MutationObserver routing for incremental DeepSeek page renders.
 * Always ascends to the enclosing `.ds-message` so sibling block appends complete
 * the continuation envelope before hide is re-evaluated.
 */
export function collectToolResultsHideRootsFromMutations(
  mutations: readonly MutationRecord[],
): ParentNode[] {
  const roots = new Set<ParentNode>();
  for (const mutation of mutations) {
    if (mutation.type === 'characterData') {
      const parent = mutation.target.parentElement;
      const message = parent?.closest('.ds-message');
      if (message) roots.add(message);
      else if (parent) roots.add(parent);
      continue;
    }

    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {
        const message = node.closest('.ds-message');
        roots.add(message ?? node);
        continue;
      }
      if (node instanceof Text) {
        const message = node.parentElement?.closest('.ds-message');
        if (message) roots.add(message);
      }
    }
  }
  return Array.from(roots);
}

export function createInternalToolResultsMessageHider(
  options?: {
    isInlineAgentContinuation?: (text: string) => boolean;
    /** Optional side effect after hide (e.g. legacy content-script attribute). */
    afterHide?: (root: ParentNode) => void;
  },
): {
  hideIn: (root: ParentNode) => number;
  observe: (target: Node) => MutationObserver;
} {
  const hideIn = (root: ParentNode) => {
    const hidden = hideInternalToolResultsMessages(root, options);
    options?.afterHide?.(root);
    return hidden;
  };
  return {
    hideIn,
    observe(target: Node) {
      const observer = new MutationObserver((mutations) => {
        for (const root of collectToolResultsHideRootsFromMutations(mutations)) {
          hideIn(root);
        }
      });
      observer.observe(target, { childList: true, subtree: true, characterData: true });
      return observer;
    },
  };
}

/**
 * Production content-script composition: same hide path as the extracted
 * factory, plus the historical `data-dpp-hidden-inline-agent-continuation`
 * marker used by the strip walker.
 */
export function createContentScriptToolResultsMessageHider(
  options?: {
    isInlineAgentContinuation?: (text: string) => boolean;
  },
): {
  hideIn: (root: ParentNode) => number;
  observe: (target: Node) => MutationObserver;
} {
  return createInternalToolResultsMessageHider({
    ...options,
    afterHide(root) {
      const scope = root instanceof Document ? root : document;
      for (const message of Array.from(
        scope.querySelectorAll<HTMLElement>('[data-dpp-hidden-internal-tool-results="true"]'),
      )) {
        if (root instanceof Document || root === message || (root instanceof Node && root.contains(message))) {
          message.setAttribute('data-dpp-hidden-inline-agent-continuation', 'true');
        }
      }
    },
  });
}

export function messageLooksLikeInternalToolResults(text: string | null | undefined): boolean {
  return typeof text === 'string' && isInternalToolResultsContinuationText(text);
}
