import {
  formatEniBondCard,
  getEniBondCard,
} from '../cursor-bridge/eni-bond';
import {
  formatEniMemoryBlock,
  listEniMemoryFacts,
} from '../cursor-bridge/eni-memory';
import { resolveEniSystemPrompt } from '../cursor-bridge/eni-prompt';
import { DEFAULT_LOCALE, type SupportedLocale } from '../i18n';
import { resolveSkillPrompt } from '../interceptor/request-augmentation';
import { buildPromptAugmentation } from '../prompt';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  normalizePromptInjectionSettings,
  shouldInjectPresetForTurn,
  type PromptInjectionSettings,
} from '../prompt/settings';
import { parseSkillCommand } from '../skill/parser';
import type {
  Memory,
  Skill,
  SystemPromptPreset,
  ToolDescriptor,
} from '../types';
import type { ProviderToolProtocol } from './tool-protocol';

export interface CompileSharedAgentPromptInput {
  userPrompt: string;
  isFirstProviderTurn: boolean;
  messageCount: number;
  memories: readonly Memory[];
  skills: Array<Pick<Skill, 'name' | 'instructions' | 'memoryEnabled'>>;
  activePreset: SystemPromptPreset | null;
  toolDescriptors: readonly ToolDescriptor[];
  locale?: SupportedLocale;
  promptSettings?: Partial<PromptInjectionSettings>;
  projectContext?: string | null;
  toolProtocol?: ProviderToolProtocol;
}

export interface CompiledSharedAgentPrompt {
  prompt: string;
  skillName: string | null;
  usedMemoryIds: number[];
}

export async function compileSharedAgentPrompt(
  input: CompileSharedAgentPromptInput,
): Promise<CompiledSharedAgentPrompt> {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const settings = normalizePromptInjectionSettings(
    input.promptSettings ?? DEFAULT_PROMPT_INJECTION_SETTINGS,
  );
  const invocation = parseSkillCommand(input.userPrompt);
  const skill = invocation
    ? resolveSkillPrompt(input.skills, invocation.skillName, invocation.args, locale)
    : null;
  const taskPrompt = skill?.combinedPrompt ?? input.userPrompt;
  const shouldInjectPreset = shouldInjectPresetForTurn({
    hasActivePreset: Boolean(input.activePreset),
    isFirstMessage: input.isFirstProviderTurn,
    messageCount: input.messageCount,
    cadence: settings.presetCadence,
  });
  const { augmented, usedMemoryIds } = buildPromptAugmentation(taskPrompt, {
    memories: [...input.memories],
    thinkingEnabled: false,
    identityOnly: skill ? !skill.memoryEnabled : false,
    presetContent: shouldInjectPreset ? input.activePreset?.content ?? null : null,
    projectContext: input.projectContext,
    toolDescriptors: input.toolDescriptors,
    locale,
    memoryEnabled: settings.memoryEnabled,
    systemPromptEnabled: settings.systemPromptEnabled && input.toolProtocol !== 'json-envelope',
    forceResponseLanguage: settings.forceResponseLanguage === 'auto'
      ? null
      : settings.forceResponseLanguage,
  });

  if (!input.isFirstProviderTurn) {
    return { prompt: augmented, skillName: skill?.skillName ?? null, usedMemoryIds };
  }

  const [identity, eniFacts, bond] = await Promise.all([
    resolveEniSystemPrompt(),
    listEniMemoryFacts(),
    getEniBondCard(),
  ]);
  const eniContext = [
    identity.text,
    formatEniMemoryBlock(eniFacts),
    formatEniBondCard(bond),
  ].filter(Boolean).join('\n\n');

  return {
    prompt: `${eniContext}\n\n---\n\n${augmented}`,
    skillName: skill?.skillName ?? null,
    usedMemoryIds,
  };
}
