import { DEFAULT_LOCALE, type SupportedLocale } from '../i18n';
import { MEMORY_IMPORT_TOOL_NAMES } from '../memory/import-tool';
import { createSandboxToolDescriptors } from '../sandbox';
import { SKILL_CREATOR_TOOL_NAMES } from '../skill/creator-tool';
import type { ToolDescriptor } from './types';

const SIDEPANEL_RICH_RESULT_TOOL_NAMES = new Set<string>([
  ...SKILL_CREATOR_TOOL_NAMES,
  ...MEMORY_IMPORT_TOOL_NAMES,
]);

export function isSidepanelChatToolDescriptor(descriptor: ToolDescriptor): boolean {
  if (!descriptor.execution.enabled) return false;
  // Sidepanel chat streams markdown only. Tools that require an approval/save card
  // must stay in the content-script experience until sidepanel can render results.
  return !SIDEPANEL_RICH_RESULT_TOOL_NAMES.has(descriptor.name);
}

export function filterSidepanelChatToolDescriptors(
  descriptors: readonly ToolDescriptor[],
): ToolDescriptor[] {
  return descriptors.filter(isSidepanelChatToolDescriptor);
}

/**
 * Sidepanel chat catalog: runtime descriptors plus sandbox (authorized at execute time).
 * Sandbox stays out of getRuntimeToolDescriptors / content public catalog.
 */
export function composeSidepanelChatToolDescriptors(
  runtimeDescriptors: readonly ToolDescriptor[],
  locale: SupportedLocale = DEFAULT_LOCALE,
): ToolDescriptor[] {
  return filterSidepanelChatToolDescriptors([
    ...runtimeDescriptors,
    ...createSandboxToolDescriptors(locale),
  ]);
}
