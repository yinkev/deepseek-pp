import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PetState } from '../core/pet/lines';
import { en } from '../core/i18n/resources/en';
import { zhCN } from '../core/i18n/resources/zh-CN';

const PET_STATE_COVERAGE = {
  idle: true,
  thinking: true,
  speaking: true,
  working: true,
  confused: true,
  success: true,
  error: true,
  sleepy: true,
} satisfies Record<PetState, true>;

const PET_STATES = Object.keys(PET_STATE_COVERAGE) as PetState[];

describe('content tool block styles', () => {
  it('keeps restored tool detail content scrollable for long source output', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');
    const rule = source.match(/\.dpp-tool-block-item-detail \{([\s\S]*?)\n    \}/)?.[1] ?? '';

    expect(rule).toContain('max-height:');
    expect(rule).toContain('overflow: auto;');
    expect(rule).toContain('overscroll-behavior: contain;');
  });

  it('keeps sidepanel chat tool disclosures scroll-contained', () => {
    const path = join(process.cwd(), 'entrypoints/sidepanel/style.css');
    const source = readFileSync(path, 'utf8');
    const rule = source.match(/\.ds-chat-tool-detail \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(rule).toContain('max-height:');
    expect(rule).toContain('overflow: auto;');
    expect(rule).toContain('overscroll-behavior: contain;');
  });

  it('renders artifact results outside the collapsible executed-tools block', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('.dpp-artifact-results');
    expect(source).toContain('function renderDetachedArtifactResults(');
    expect(source).toContain('isDetachedArtifactToolResult(exec.result)');
    expect(source).toContain('renderDetachedArtifactResultsForBlock(session, toolBlockEl);');
    expect(source).toContain('renderDetachedArtifactResults(target, record.id, executions, block);');
    expect(source).toContain('responseHost.insertBefore(container, anchor);');
  });

  it('keeps rendered tool cleanup bounded for large message bodies', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('CLEANABLE_TEXT_DEEP_SCAN_MAX_CHARS');
    expect(source).toContain('CLEANUP_MESSAGE_SCAN_LIMIT');
    expect(source).toContain('hasLikelyToolMarkerPrefix');
    expect(source).toContain('if (i < minIndex) break;');
  });

  it('bounds restored tool and inline-agent state kept in content-script memory', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('TOOL_RESTORE_RECORD_LIMIT = 100');
    expect(source).toContain('ACTIVE_TOOL_BLOCK_SESSION_LIMIT = 20');
    expect(source).toContain('function pruneRestoredToolRecords(');
    expect(source).toContain('function pruneRestoredInlineAgentTraces(');
    expect(source).toContain('function pruneActiveToolBlockSessions(');
    expect(source).toContain('pruneActiveToolBlockSessions();');
    expect(source).toContain('pruneRestoredToolRecords();');
    expect(source).toContain('pruneRestoredInlineAgentTraces();');
  });

  it('caps queued main-world messages if bridge startup misses', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('MAIN_WORLD_PENDING_MESSAGE_LIMIT = 100');
    expect(source).toContain('pendingMainWorldMessages.length >= MAIN_WORLD_PENDING_MESSAGE_LIMIT');
    expect(source).toContain('pendingMainWorldMessages.shift();');
  });

  it('does not poll route changes on an interval', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("window.addEventListener('dpp:navigation', handleTokenSpeedRouteChange);");
    expect(source).toContain("window.addEventListener('dpp:navigation', handleToolBlockRouteChange);");
    expect(source).not.toContain('setInterval(handleTokenSpeedRouteChange');
    expect(source).not.toContain('setInterval(handleToolBlockRouteChange');
    expect(source).not.toContain('TOKEN_SPEED_ROUTE_CHECK_MS');
    expect(source).not.toContain('TOOL_BLOCK_ROUTE_CHECK_MS');
  });

  it('uses the shared injected theme variables for readable tool block text', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("import { injectInjectedThemeStyles } from '../core/ui/injected-theme';");
    expect(source).toContain('injectInjectedThemeStyles();');
    expect(source).toContain('color: var(--dpp-ui-text);');
    expect(source).toContain('color: var(--dpp-ui-text-muted);');
    expect(source).not.toContain('body.dpp-theme-dark .dpp-tool-block-item { color: rgb(200, 200, 200); }');
  });

  it('mounts inline agent output after DeepSeek final answer content instead of the reasoning block', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("const ASSISTANT_RESPONSE_CONTENT_SELECTOR = '._74c0879, .ds-assistant-message-main-content';");
    expect(source).toContain('function mountInlineAgentContainer(message: Element, container: HTMLElement): void');
    expect(source).toContain('inlineAgentContainerObserver.observe(message, { childList: true, subtree: true });');
    expect(source).not.toContain('inlineAgentContainerObserver.observe(responseHost, { childList: true });');
  });

  it('scopes task_complete cleanup to assistant body text outside code blocks', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('function shouldReplaceRenderedTaskCompleteBlock(textNode: Text): boolean');
    expect(source).toContain("if (parent.closest('pre, code')) return false;");
    expect(source).toContain("const message = parent.closest('.ds-message');");
    expect(source).toContain('return getAssistantContentHosts(message).some((host) => host.contains(parent));');
  });

  it('normalizes restored inline-agent traces that predate finalText storage', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("(trace.finalText === undefined || typeof trace.finalText === 'string')");
    expect(source).toContain("const finalText = typeof trace.finalText === 'string' ? trace.finalText : '';");
    expect(source).toContain("finalText: clampText(finalText, INLINE_AGENT_FINAL_RENDER_MAX_CHARS) ?? '',");
  });

  it('keeps permission banner text on the same injected theme contract', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');
    const rule = source.match(/\.dpp-permission-banner \{([\s\S]*?)\n    \}/)?.[1] ?? '';

    expect(rule).toContain('background: var(--dpp-ui-surface);');
    expect(rule).toContain('color: var(--dpp-ui-text);');
    expect(source).not.toContain('var(--ds-text');
    expect(source).not.toContain('var(--ds-text-secondary');
  });

  it('keeps the pet control popover read-only and bounded', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');
    const rule = source.match(/\.dpp-pet-control \{([\s\S]*?)\n    \}/)?.[1] ?? '';

    expect(source).toContain('function togglePetControlPanel()');
    expect(source).toContain("petControlPanelEl.dataset.visible = String(visible);");
    expect(source).toContain("host.setAttribute('role', 'button');");
    expect(source).toContain("host.setAttribute('aria-label', contentT('content.petControl.title'));");
    expect(source).toContain("host.setAttribute('aria-expanded', 'false');");
    expect(source).toContain("petHostEl?.setAttribute('aria-expanded', String(visible));");
    expect(source).toContain('hidePetBubble();');
    expect(source).toContain("petControlPanelEl?.dataset.visible === 'true'");
    expect(source).toContain('host.tabIndex = 0;');
    expect(source).toContain('function handlePetHostKeyDown(event: KeyboardEvent)');
    expect(source).toContain(`#\${PET_HOST_ID}:focus-visible`);
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('if (!moved) {');
    expect(source).toContain('togglePetControlPanel();');
    expect(source).toContain('content.petControl.statusLabel');
    expect(rule).toContain('width: min(230px, calc(100vw - 24px));');
    expect(rule).toContain('pointer-events: none;');
    expect(source).not.toContain("sendRuntimeMessage({ type: 'RUN_PERSONAL_AUTOPILOT_REPAIR'");
    expect(source).not.toContain("sendRuntimeMessage({ type: 'DETACH_BROWSER_CONTROL'");
  });

  it('keeps pet control labels translated for every pet state', () => {
    for (const locale of [en, zhCN]) {
      for (const state of PET_STATES) {
        expect(locale.content.petControl.states[state]).toEqual(expect.any(String));
        expect(locale.content.petControl.next[state]).toEqual(expect.any(String));
      }
    }
  });

  it('keeps grouped Skill source labels on the group header only', () => {
    const skillPage = readFileSync(join(process.cwd(), 'entrypoints/sidepanel/pages/SkillPage.tsx'), 'utf8');
    const skillCard = readFileSync(join(process.cwd(), 'entrypoints/sidepanel/components/SkillCard.tsx'), 'utf8');

    expect(skillPage).toContain('showSourceBadge={false}');
    expect(skillCard).toContain('showSourceBadge = true');
    expect(skillCard).toContain('showSourceBadge && badge');
  });
});
