import { describe, expect, it } from 'vitest';
import {
  localizeScenario,
  resolveBuiltInTemplateForSave,
} from '../core/scenario/localization';
import { getBuiltInScenarioCanonical } from '../core/scenario/store';

describe('scenario localization', () => {
  it('projects built-in scenario labels and untouched default templates for English', () => {
    const canonical = getBuiltInScenarioCanonical('summarize');
    expect(canonical).toBeTruthy();

    const localized = localizeScenario(canonical!, 'en');
    expect(localized.label).toBe('Summarize');
    expect(localized.template).toContain('Summarize the following content');
  });

  it('keeps user-edited built-in templates unchanged', () => {
    const canonical = getBuiltInScenarioCanonical('explain');
    const customized = { ...canonical!, template: 'Custom explain template: {text}' };

    const localized = localizeScenario(customized, 'en');
    expect(localized.label).toBe('Explain');
    expect(localized.template).toBe('Custom explain template: {text}');
  });

  it('persists canonical built-in templates when the editor still shows localized defaults', () => {
    const canonical = getBuiltInScenarioCanonical('summarize');
    expect(canonical).toBeTruthy();

    const saved = resolveBuiltInTemplateForSave(
      canonical!,
      'Summarize the following content concisely:\n\n{text}',
      'en',
    );
    expect(saved).toBe(canonical!.template);
  });

  it('does not mutate custom scenarios', () => {
    const custom = {
      id: 'custom_1',
      label: 'My scenario',
      template: 'Do this: {text}',
      builtIn: false,
      enabled: true,
    };

    expect(localizeScenario(custom, 'en')).toEqual(custom);
  });
});