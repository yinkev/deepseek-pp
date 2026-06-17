import { translate, type LocaleMessageKey, type SupportedLocale } from '../i18n';
import type { ScenarioConfig } from '../types';
import { getBuiltInScenarioCanonical } from './store';

const BUILT_IN_SCENARIO_IDS = ['summarize', 'explain', 'translate'] as const;
type BuiltInScenarioId = (typeof BUILT_IN_SCENARIO_IDS)[number];

function builtInLabelKey(id: BuiltInScenarioId): LocaleMessageKey {
  return `sidepanel.scenario.builtIn.${id}.label`;
}

function builtInTemplateKey(id: BuiltInScenarioId): LocaleMessageKey {
  return `sidepanel.scenario.builtIn.${id}.template`;
}

function isBuiltInScenarioId(id: string): id is BuiltInScenarioId {
  return (BUILT_IN_SCENARIO_IDS as readonly string[]).includes(id);
}

export function localizeScenario(scenario: ScenarioConfig, locale: SupportedLocale): ScenarioConfig {
  if (!scenario.builtIn || !isBuiltInScenarioId(scenario.id)) return scenario;

  const label = translate(locale, builtInLabelKey(scenario.id));
  const defaultTemplate = getBuiltInScenarioCanonical(scenario.id)?.template;
  const template = defaultTemplate && scenario.template === defaultTemplate
    ? translate(locale, builtInTemplateKey(scenario.id))
    : scenario.template;

  return { ...scenario, label, template };
}

export function localizeScenarios(scenarios: ScenarioConfig[], locale: SupportedLocale): ScenarioConfig[] {
  return scenarios.map((scenario) => localizeScenario(scenario, locale));
}