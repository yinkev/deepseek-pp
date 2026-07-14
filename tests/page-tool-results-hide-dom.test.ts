/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectToolResultsHideRootsFromMutations,
  createContentScriptToolResultsMessageHider,
  createInternalToolResultsMessageHider,
  hideInternalToolResultsMessages,
  shouldHideToolResultsMessageBubble,
} from '../core/prompt/page-tool-results-hide';

const CANONICAL_SUFFIX =
  'Continue from the real tool results. Answer naturally without exposing tool XML unless another tool is required.';

const LEGACY_ENGLISH = 'Continue answering based on the tool results above.';

function appendParagraph(parent: HTMLElement, text: string): HTMLElement {
  const p = document.createElement('p');
  p.textContent = text;
  parent.appendChild(p);
  return p;
}

describe('page tool-results hide DOM path', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps split user-authored protocol examples visible (markers outside, JSON in pre)', () => {
    const bubble = document.createElement('div');
    bubble.className = 'ds-message';
    appendParagraph(bubble, '[TOOL_RESULTS]');
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = JSON.stringify([{ tool: 'sandbox_run', ok: true, summary: 'demo' }], null, 2);
    pre.appendChild(code);
    bubble.appendChild(pre);
    appendParagraph(bubble, '[/TOOL_RESULTS]');
    appendParagraph(bubble, 'Original task: documentation example only');
    appendParagraph(bubble, CANONICAL_SUFFIX);
    document.body.appendChild(bubble);

    expect(shouldHideToolResultsMessageBubble(bubble)).toBe(false);
    expect(hideInternalToolResultsMessages(document)).toBe(0);
    expect(bubble.style.display).not.toBe('none');
  });

  it('hides a genuine bubble with task code and keeps a pure fenced example visible', () => {
    const genuine = document.createElement('div');
    genuine.className = 'ds-message';
    appendParagraph(genuine, 'Just now');
    appendParagraph(genuine, '[TOOL_RESULTS]');
    appendParagraph(genuine, '[{"tool":"sandbox_run","ok":true}]');
    appendParagraph(genuine, '[/TOOL_RESULTS]');
    appendParagraph(genuine, 'Original task: please fix');
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = 'console.log(1)';
    pre.appendChild(code);
    genuine.appendChild(pre);
    appendParagraph(genuine, CANONICAL_SUFFIX);
    appendParagraph(genuine, 'Copy');
    document.body.appendChild(genuine);

    expect(shouldHideToolResultsMessageBubble(genuine)).toBe(true);
    expect(hideInternalToolResultsMessages(document)).toBe(1);
    expect(genuine.style.display).toBe('none');
    expect(genuine.getAttribute('data-dpp-hidden-internal-tool-results')).toBe('true');

    const example = document.createElement('div');
    example.className = 'ds-message';
    const examplePre = document.createElement('pre');
    const exampleCode = document.createElement('code');
    exampleCode.textContent = [
      '[TOOL_RESULTS]',
      '[{"tool":"sandbox_run","ok":true}]',
      '[/TOOL_RESULTS]',
      '',
      'Original task: docs only',
      CANONICAL_SUFFIX,
    ].join('\n');
    examplePre.appendChild(exampleCode);
    example.appendChild(examplePre);
    document.body.appendChild(example);

    expect(shouldHideToolResultsMessageBubble(example)).toBe(false);
    expect(hideInternalToolResultsMessages(example)).toBe(0);
    expect(example.style.display).not.toBe('none');
  });

  it('hides real legacy sandbox_run_result envelopes', () => {
    const bubble = document.createElement('div');
    bubble.className = 'ds-message';
    appendParagraph(bubble, '[TOOL_RESULTS]');
    appendParagraph(bubble, '<sandbox_run_result>');
    appendParagraph(bubble, '{"ok":true,"summary":"31"}');
    appendParagraph(bubble, '</sandbox_run_result>');
    appendParagraph(bubble, '[/TOOL_RESULTS]');
    appendParagraph(bubble, LEGACY_ENGLISH);
    document.body.appendChild(bubble);

    expect(hideInternalToolResultsMessages(document)).toBe(1);
    expect(bubble.style.display).toBe('none');
  });

  it('incrementally completes a continuation and hides via production content-script hider', async () => {
    const hider = createContentScriptToolResultsMessageHider();
    const observer = hider.observe(document.body);

    const bubble = document.createElement('div');
    bubble.className = 'ds-message';
    document.body.appendChild(bubble);

    // Incomplete: only open marker + payload so far.
    appendParagraph(bubble, '[TOOL_RESULTS]');
    appendParagraph(bubble, '<sandbox_run_result>{"ok":true}</sandbox_run_result>');
    await Promise.resolve();
    expect(bubble.style.display).not.toBe('none');

    // Incremental sibling blocks complete the envelope.
    appendParagraph(bubble, '[/TOOL_RESULTS]');
    appendParagraph(bubble, LEGACY_ENGLISH);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bubble.style.display).toBe('none');
    expect(bubble.getAttribute('data-dpp-hidden-inline-agent-continuation')).toBe('true');
    observer.disconnect();
  });

  it('routes character-data mutations to the enclosing bubble and hides on complete text', async () => {
    const hider = createContentScriptToolResultsMessageHider();
    const observer = hider.observe(document.body);

    const bubble = document.createElement('div');
    bubble.className = 'ds-message';
    const p = document.createElement('p');
    p.textContent = '[TOOL_RESULTS]\n<sandbox_run_result>{"ok":true}</sandbox_run_result>\n[/TOOL_RESULTS]\n\n';
    bubble.appendChild(p);
    document.body.appendChild(bubble);

    // Complete the envelope by mutating character data (no element add).
    p.firstChild!.textContent = [
      '[TOOL_RESULTS]',
      '<sandbox_run_result>{"ok":true}</sandbox_run_result>',
      '[/TOOL_RESULTS]',
      '',
      LEGACY_ENGLISH,
    ].join('\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bubble.style.display).toBe('none');
    observer.disconnect();

    const routingBubble = document.createElement('div');
    routingBubble.className = 'ds-message';
    const routingP = appendParagraph(routingBubble, 'partial');
    document.body.appendChild(routingBubble);
    const record = {
      type: 'characterData',
      target: routingP.firstChild as CharacterData,
      addedNodes: [] as unknown as NodeList,
      removedNodes: [] as unknown as NodeList,
      previousSibling: null,
      nextSibling: null,
      attributeName: null,
      attributeNamespace: null,
      oldValue: null,
    } as MutationRecord;
    expect(collectToolResultsHideRootsFromMutations([record])).toContain(routingBubble);
  });

  it('completes a genuine envelope via raw added Text and hides with the live content-script observer', async () => {
    const hider = createContentScriptToolResultsMessageHider();
    const observer = hider.observe(document.body);

    const bubble = document.createElement('div');
    bubble.className = 'ds-message';
    document.body.appendChild(bubble);

    // Start incomplete: only the open/payload fragment as a text node.
    const textNode = document.createTextNode([
      '[TOOL_RESULTS]',
      '<sandbox_run_result>{"ok":true,"summary":"31"}</sandbox_run_result>',
      '[/TOOL_RESULTS]',
      '',
      '',
    ].join('\n'));
    bubble.appendChild(textNode);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bubble.style.display).not.toBe('none');

    // Complete the envelope by appending raw Text (not an Element).
    const completion = document.createTextNode(LEGACY_ENGLISH);
    bubble.appendChild(completion);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bubble.style.display).toBe('none');
    expect(bubble.getAttribute('data-dpp-hidden-internal-tool-results')).toBe('true');
    expect(bubble.getAttribute('data-dpp-hidden-inline-agent-continuation')).toBe('true');
    observer.disconnect();
  });
});
