import type { BrowserControlToolName } from './types';

const ACT_VERIFY_TOOL_NAMES = new Set<BrowserControlToolName>([
  'browser_navigate',
  'browser_go_back',
  'browser_go_forward',
  'browser_refresh',
  'browser_select_tab',
  'browser_click',
  'browser_hover',
  'browser_fill',
  'browser_fill_form',
  'browser_key',
  'browser_type',
  'browser_wait_for',
  'browser_handle_dialog',
]);

export function shouldVerifyAfterBrowserAction(name: string): name is BrowserControlToolName {
  return ACT_VERIFY_TOOL_NAMES.has(name as BrowserControlToolName);
}

export function createBrowserActVerifyPrompt(input: {
  toolName: string;
  summary: string;
}): string {
  const summary = input.summary.trim();
  return [
    summary
      ? `I just ran ${input.toolName}: ${summary}.`
      : `I just ran ${input.toolName}.`,
    'Look at the updated page and check whether the action appears to have worked before deciding the next step.',
    'If the page does not match the goal, use what is visible to correct course.',
  ].join(' ');
}
