import { describe, expect, it } from 'vitest';
import {
  applyPromptAutomationReadinessFixes,
  applySafeAutomationReadinessFixes,
  evaluateAutomationReadiness,
  getPromptAutomationReadinessFixes,
  getSafeAutomationReadinessFixes,
} from '../core/automation/readiness';
import { AUTOMATION_WORKFLOW_TEMPLATES, createAutomationInputFromWorkflowTemplate } from '../core/automation/workflow-templates';
import type { AutomationCreateInput } from '../core/automation/types';

describe('automation readiness', () => {
  it('grades workflow templates without blockers', () => {
    for (const template of AUTOMATION_WORKFLOW_TEMPLATES) {
      const report = evaluateAutomationReadiness(createAutomationInputFromWorkflowTemplate(template));

      expect(report.status).not.toBe('blocked');
      expect(report.issues.some((issue) => issue.severity === 'blocker')).toBe(false);
    }
  });

  it('blocks prompts that contain inline raw media or credentials without echoing them', () => {
    const report = evaluateAutomationReadiness(createInput({
      prompt: 'Plan and evaluate this Authorization: Bearer secret-token data:image/png;base64,AAAA then stop.',
    }));

    expect(report.status).toBe('blocked');
    expect(report.issues).toContainEqual({
      code: 'sensitive_prompt_content',
      severity: 'blocker',
    });
    expect(JSON.stringify(report)).not.toMatch(/secret-token|data:image|Authorization|Bearer|AAAA/);
  });

  it('blocks common signed URL and API key shapes without echoing them', () => {
    const report = evaluateAutomationReadiness(createInput({
      prompt: 'Review https://example.com/file?X-Amz-Signature=abc123 and sk-proj-1234567890abcdef1234567890abcdef, then stop.',
    }));

    expect(report.status).toBe('blocked');
    expect(report.issues).toContainEqual({
      code: 'sensitive_prompt_content',
      severity: 'blocker',
    });
    expect(JSON.stringify(report)).not.toMatch(/X-Amz-Signature|sk-proj|1234567890abcdef/);
  });

  it('blocks Telegram bot token shapes without echoing them', () => {
    const report = evaluateAutomationReadiness(createInput({
      prompt: 'Check this bot token 123456789:AAFakeTelegramBotToken_1234567890abcdef and stop.',
    }));

    expect(report.status).toBe('blocked');
    expect(report.issues).toContainEqual({
      code: 'sensitive_prompt_content',
      severity: 'blocker',
    });
    expect(JSON.stringify(report)).not.toMatch(/FakeTelegramBotToken|123456789:/);
  });

  it('catches Vision runs that have no visual input', () => {
    const report = evaluateAutomationReadiness(createInput({
      promptOptions: {
        modelType: 'vision',
        searchEnabled: false,
        thinkingEnabled: false,
        refFileIds: [],
        webVisionFiles: [],
      },
    }));

    expect(report.status).toBe('blocked');
    expect(report.issues).toContainEqual({
      code: 'vision_without_visual_input',
      severity: 'blocker',
    });
  });

  it('treats newly attached images as valid transient Vision input', () => {
    const report = evaluateAutomationReadiness(
      createInput({
        promptOptions: {
          modelType: 'vision',
          searchEnabled: false,
          thinkingEnabled: false,
          refFileIds: [],
          webVisionFiles: [],
        },
      }),
      { transientImageCount: 1 },
    );

    expect(report.status).not.toBe('blocked');
    expect(report.issues.some((issue) => issue.code === 'vision_without_visual_input')).toBe(false);
  });

  it('does not force every ordinary automation into an evaluator-loop rubric', () => {
    const report = evaluateAutomationReadiness(createInput({
      prompt: 'Send me a concise daily note about whether the saved page changed, then stop.',
      promptOptions: {
        modelType: null,
        searchEnabled: false,
        thinkingEnabled: false,
        refFileIds: [],
      },
    }));

    expect(report.issues.some((issue) => issue.code === 'loop_contract_weak')).toBe(false);
  });

  it('warns when research loops do not enable Web search', () => {
    const report = evaluateAutomationReadiness(createInput({
      prompt: 'Research this source. Plan, evaluate, review, grade, iterate, then stop.',
      promptOptions: {
        modelType: null,
        searchEnabled: false,
        thinkingEnabled: true,
        refFileIds: [],
      },
    }));

    expect(report.status).toBe('needs_attention');
    expect(report.issues).toContainEqual({
      code: 'research_without_search',
      severity: 'warning',
    });
  });

  it('applies safe option fixes for research and evaluator warnings', () => {
    const input = createInput({
      prompt: 'Research this source, evaluate evidence, review contradictions, grade confidence, iterate once, then stop.',
      promptOptions: {
        modelType: null,
        searchEnabled: false,
        thinkingEnabled: false,
        refFileIds: [],
      },
    });
    const report = evaluateAutomationReadiness(input);
    const issueCodes = getSafeAutomationReadinessFixes(report);

    expect(issueCodes).toEqual(['research_without_search', 'evaluation_without_thinking']);

    const fixed = applySafeAutomationReadinessFixes(input.promptOptions, issueCodes);
    expect(fixed.searchEnabled).toBe(true);
    expect(fixed.thinkingEnabled).toBe(true);
    expect(fixed.refFileIds).toEqual([]);
  });

  it('adds a deterministic loop contract for weak long-horizon prompts', () => {
    const input = createInput({
      prompt: 'Run a workflow that evaluates the source.',
      promptOptions: {
        modelType: null,
        searchEnabled: false,
        thinkingEnabled: true,
        refFileIds: [],
      },
    });
    const report = evaluateAutomationReadiness(input);
    const issueCodes = getPromptAutomationReadinessFixes(report);

    expect(issueCodes).toEqual(['loop_contract_weak']);

    const fixedPrompt = applyPromptAutomationReadinessFixes(input.prompt, issueCodes);
    expect(fixedPrompt).toContain('Workflow contract: Plan the work, evaluate evidence, review risks, grade confidence, iterate once if useful, then stop');

    const fixedReport = evaluateAutomationReadiness({ ...input, prompt: fixedPrompt });
    expect(fixedReport.issues.some((issue) => issue.code === 'loop_contract_weak')).toBe(false);
    expect(applyPromptAutomationReadinessFixes(fixedPrompt, issueCodes)).toBe(fixedPrompt);
  });

  it('adds an explicit stop rule for scheduled prompts', () => {
    const input = createInput({
      prompt: 'Research project updates and summarize them.',
      schedule: {
        kind: 'cron',
        expression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true,
        minimumIntervalMinutes: 15,
      },
      promptOptions: {
        modelType: null,
        searchEnabled: true,
        thinkingEnabled: true,
        refFileIds: [],
      },
    });
    const report = evaluateAutomationReadiness(input);
    const issueCodes = getPromptAutomationReadinessFixes(report);

    expect(issueCodes).toContain('scheduled_without_stop_condition');

    const fixedPrompt = applyPromptAutomationReadinessFixes(input.prompt, issueCodes);
    const fixedReport = evaluateAutomationReadiness({ ...input, prompt: fixedPrompt });
    expect(fixedReport.issues.some((issue) => issue.code === 'scheduled_without_stop_condition')).toBe(false);
  });

  it('normalizes Vision flags while preserving visual-input blockers', () => {
    const input = createInput({
      prompt: 'Look at the current page and stop.',
      promptOptions: {
        modelType: 'vision',
        searchEnabled: true,
        thinkingEnabled: true,
        refFileIds: [],
      },
    });
    const report = evaluateAutomationReadiness(input);
    const issueCodes = getSafeAutomationReadinessFixes(report);

    expect(report.issues).toContainEqual({
      code: 'vision_without_visual_input',
      severity: 'blocker',
    });
    expect(issueCodes).toEqual(['vision_flags_inconsistent']);

    const fixed = applySafeAutomationReadinessFixes(input.promptOptions, issueCodes);
    expect(fixed.modelType).toBe('vision');
    expect(fixed.searchEnabled).toBe(false);
    expect(fixed.thinkingEnabled).toBe(false);
  });

  it('keeps scheduled memory hygiene in warning territory instead of silently approving it', () => {
    const report = evaluateAutomationReadiness(createInput({
      prompt: 'Review memory hygiene and delete duplicates. Plan, evaluate, review, grade, iterate, then stop for explicit confirmation.',
      schedule: {
        kind: 'cron',
        expression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true,
        minimumIntervalMinutes: 15,
      },
    }));

    expect(report.status).toBe('needs_attention');
    expect(report.issues).toContainEqual({
      code: 'scheduled_memory_review',
      severity: 'warning',
    });
  });
});

function createInput(overrides: Partial<AutomationCreateInput> = {}): AutomationCreateInput {
  return {
    name: 'Readiness check',
    prompt: 'Plan the work, evaluate evidence, review risks, grade the result, iterate once, then stop for explicit confirmation.',
    schedule: {
      kind: 'manual',
      expression: null,
      timezone: 'UTC',
      enabled: false,
      minimumIntervalMinutes: 15,
    },
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: true,
      refFileIds: [],
      webVisionFiles: [],
    },
    ...overrides,
  };
}
