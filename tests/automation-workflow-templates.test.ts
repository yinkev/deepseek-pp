import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_WORKFLOW_TEMPLATES,
  createAutomationInputFromWorkflowTemplate,
  type AutomationWorkflowTemplate,
} from '../core/automation/workflow-templates';
import { parseAutomationSchedule } from '../core/automation/schedule';

describe('automation workflow templates', () => {
  it('keeps template ids unique and prompts shaped as long-horizon loops', () => {
    const ids = new Set<string>();

    for (const template of AUTOMATION_WORKFLOW_TEMPLATES) {
      expect(ids.has(template.id)).toBe(false);
      ids.add(template.id);

      const prompt = template.prompt.toLowerCase();
      expect(prompt).toContain('plan');
      expect(prompt).toContain('fan out');
      expect(prompt).toContain('evaluate');
      expect(prompt).toContain('review');
      expect(prompt).toContain('grade');
      expect(prompt).toContain('iterate');
      expect(prompt).toContain('stop');
      expect(prompt).toContain('explicit confirmation');
    }
  });

  it('creates valid AutomationCreateInput payloads without raw media or credentials', () => {
    for (const template of AUTOMATION_WORKFLOW_TEMPLATES) {
      const input = createAutomationInputFromWorkflowTemplate(template, { timezone: 'America/Los_Angeles' });

      expect(input.name).toBe(template.title);
      expect(input.prompt).toBe(template.prompt);
      expect(parseAutomationSchedule(input.schedule).ok).toBe(true);
      expect(input.promptOptions.webVisionFiles).toEqual([]);
      expect(input.promptOptions.visualEvidencePacks).toBeUndefined();
      expect(input.promptOptions.visualMonitor?.enabled === true).toBe(template.promptOptions.visualMonitorEnabled);
      expect(JSON.stringify(input)).not.toMatch(/data:image|dataUrl|dataBase64|base64Data|Authorization|Bearer|Cookie|signed_path|signedPath|token=/i);
    }
  });

  it('preserves template Search and DeepThink flags for text-only workflows', () => {
    const research = AUTOMATION_WORKFLOW_TEMPLATES.find((template) => template.id === 'deep-research-swarm');
    expect(research).toBeTruthy();

    const input = createAutomationInputFromWorkflowTemplate(research!, { timezone: 'UTC' });

    expect(input.promptOptions.modelType).toBeNull();
    expect(input.promptOptions.refFileIds).toEqual([]);
    expect(input.promptOptions.searchEnabled).toBe(true);
    expect(input.promptOptions.thinkingEnabled).toBe(true);
  });

  it('keeps memory hygiene review manual instead of scheduled', () => {
    const memory = AUTOMATION_WORKFLOW_TEMPLATES.find((template) => template.id === 'memory-hygiene-council');
    expect(memory).toBeTruthy();

    const input = createAutomationInputFromWorkflowTemplate(memory!, { timezone: 'UTC' });

    expect(input.schedule).toMatchObject({
      kind: 'manual',
      expression: null,
      enabled: false,
    });
  });

  it('forces Vision routing when a template carries Vision refs', () => {
    const template: AutomationWorkflowTemplate = {
      id: 'custom-vision',
      copyKey: 'customVision',
      title: 'Custom Vision',
      category: 'browser',
      summary: 'Custom visual check.',
      cadenceLabel: 'Manual',
      schedule: { kind: 'manual', expression: null, enabled: false },
      promptOptions: {
        modelType: null,
        searchEnabled: true,
        thinkingEnabled: true,
        visualMonitorEnabled: true,
        refFileIds: [' file-a ', 'file-a', 'file-b'],
      },
      prompt: 'Plan, fan out, evaluate, review, grade, iterate, then stop with explicit confirmation before any irreversible action.',
    };

    const input = createAutomationInputFromWorkflowTemplate(template, { timezone: 'UTC' });

    expect(input.promptOptions.modelType).toBe('vision');
    expect(input.promptOptions.refFileIds).toEqual(['file-a', 'file-b']);
    expect(input.promptOptions.searchEnabled).toBe(false);
    expect(input.promptOptions.thinkingEnabled).toBe(false);
  });
});
