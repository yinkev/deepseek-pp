import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_DESCRIPTORS } from '../core/tool';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { buildPromptAugmentation } from '../core/prompt';

describe('augmentRequestBody', () => {
  it('applies expert mode and advances request message count without exposing state to main-world', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'hello',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: 'expert',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
    });

    expect(result?.messageCount).toBe(1);
    expect(JSON.parse(result?.body ?? '{}').model_type).toBe('expert');
    expect(result?.usedMemoryIds).toEqual([]);
  });

  it('preserves existing Vision routing when file refs are present', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'describe the image',
      parent_message_id: null,
      model_type: 'vision',
      ref_file_ids: ['file-1'],
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: 'expert',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
    });

    const body = JSON.parse(result?.body ?? '{}') as { model_type?: string; ref_file_ids?: string[] };
    expect(body.model_type).toBe('vision');
    expect(body.ref_file_ids).toEqual(['file-1']);
  });

  it('preserves Vision routing through full prompt augmentation', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/review describe the screenshot against the project rule',
      parent_message_id: null,
      model_type: 'vision',
      ref_file_ids: ['file-vision'],
      search_enabled: true,
      thinking_enabled: true,
    }), {
      memories: [
        memory(21, 'global', undefined, 'Vision preference', 'Use visual evidence from the attached screenshot.'),
      ],
      skills: [{
        name: 'review',
        instructions: 'Review the user input carefully.',
        memoryEnabled: true,
      }],
      activePreset: { id: 'preset-1', name: 'Review preset', content: 'Be precise.', createdAt: 1, updatedAt: 1 },
      projectContext: '## Project Context\nProject rule: verify before concluding.',
      modelType: 'expert',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as {
      model_type?: string;
      ref_file_ids?: string[];
      search_enabled?: boolean;
      thinking_enabled?: boolean;
      prompt?: string;
    };

    expect(body.model_type).toBe('vision');
    expect(body.ref_file_ids).toEqual(['file-vision']);
    expect(body.search_enabled).toBe(true);
    expect(body.thinking_enabled).toBe(true);
    expect(body.prompt).toContain('Be precise.');
    expect(body.prompt).toContain('Use visual evidence from the attached screenshot.');
    expect(body.prompt).toContain('Project rule: verify before concluding.');
    expect(body.prompt).toContain('Review the user input carefully.');
    expect(body.prompt).toContain('Available tool tag names:');
  });

  it('auto-enables native research controls for source-grounded personal workflows', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'Do a deep dive on SCAIL-2 and verify the workflow with sources',
      parent_message_id: null,
      search_enabled: false,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: null,
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
    });

    const body = JSON.parse(result?.body ?? '{}') as { search_enabled?: boolean; thinking_enabled?: boolean };
    expect(body.search_enabled).toBe(true);
    expect(body.thinking_enabled).toBe(true);
  });

  it('leaves native controls alone for ordinary quick prompts', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'Quick sanity check: what is 2+2?',
      parent_message_id: null,
      search_enabled: false,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: null,
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
    });

    const body = JSON.parse(result?.body ?? '{}') as { search_enabled?: boolean; thinking_enabled?: boolean };
    expect(body.search_enabled).toBe(false);
    expect(body.thinking_enabled).toBe(false);
  });

  it('respects explicit research-control opt outs', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'Research SCAIL-2 without web search or deepthink',
      parent_message_id: null,
      search_enabled: false,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: null,
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
    });

    const body = JSON.parse(result?.body ?? '{}') as { search_enabled?: boolean; thinking_enabled?: boolean };
    expect(body.search_enabled).toBe(false);
    expect(body.thinking_enabled).toBe(false);
  });

  it('emits English prompt scaffolding while keeping XML tool tags stable', () => {
    const result = buildPromptAugmentation('search latest DeepSeek news', {
      memories: [],
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      locale: 'en',
    });

    expect(result.augmented).toContain('## Role');
    expect(result.augmented).toContain('(No memories yet)');
    expect(result.augmented).toContain('## Web Search Rules');
    expect(result.augmented).toContain('Available tool tag names: memory_save');
    expect(result.augmented).toContain('<memory_save>');
    expect(result.augmented).toContain('</memory_save>');
    expect(result.augmented).toContain('Invalid formats: <invoke name=\"memory_save\">...</invoke>, <tool_call>...</tool_call>');
    expect(result.augmented).not.toContain('## 角色');
    // metadata present, no prompt text change
    expect(result.memoryPressure).toBeDefined();
    expect(result.memoryPressure.enabled).toBe(true);
    expect(result.memoryPressure.availableCount).toBe(0);
  });

  it('uses locale-aware default tool descriptors when none are provided', () => {
    const result = buildPromptAugmentation('search latest DeepSeek news', {
      memories: [],
      locale: 'en',
    });

    expect(result.augmented).toContain('Title: Save memory');
    expect(result.augmented).toContain('Description: Save a new long-term memory');
    expect(result.augmented).toContain('Parameters JSON Schema: {"type"');
    expect(result.augmented).not.toContain('Title: 保存记忆');
    expect(result.augmented).not.toContain('Description: 保存一条新的长期记忆');
  });

  it('keeps project context after base system scaffolding and before web-search guidance', () => {
    const result = buildPromptAugmentation('where is the Android entry point?', {
      memories: [],
      presetContent: 'You are a repo-aware assistant.',
      projectContext: '## Project Context\nProject: DeepSeek++\n--- android/MainActivity.kt:1-2 ---',
      locale: 'en',
    });

    const presetIndex = result.augmented.indexOf('You are a repo-aware assistant.');
    const roleIndex = result.augmented.indexOf('## Role');
    const projectIndex = result.augmented.indexOf('## Project Context');
    const webSearchIndex = result.augmented.indexOf('## Web Search Rules');
    const visibleUserIndex = result.augmented.indexOf('where is the Android entry point?');

    expect(presetIndex).toBeGreaterThanOrEqual(0);
    expect(roleIndex).toBeGreaterThan(presetIndex);
    expect(projectIndex).toBeGreaterThan(roleIndex);
    expect(webSearchIndex).toBeGreaterThan(projectIndex);
    expect(visibleUserIndex).toBeGreaterThan(webSearchIndex);
  });

  it('keeps Chinese prompt scaffolding available under zh-CN', () => {
    const result = buildPromptAugmentation('搜索 DeepSeek 新闻', {
      memories: [],
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      locale: 'zh-CN',
    });

    expect(result.augmented).toContain('## 角色');
    expect(result.augmented).toContain('(暂无记忆)');
    expect(result.augmented).toContain('## 网络搜索规则');
    expect(result.augmented).toContain('可用工具标签名：memory_save');
    expect(result.augmented).toContain('<memory_save>');
    expect(result.augmented).not.toContain('## Role');
  });

  it('honors prompt controls for memory, system prompt, and forced language', () => {
    const withoutMemory = buildPromptAugmentation('remember nothing here', {
      memories: [{
        id: 1,
        syncId: 'sync-1',
        scope: 'global',
        type: 'reference',
        name: 'Hidden memory',
        content: 'Do not include me',
        description: '',
        tags: [],
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
        accessCount: 0,
        lastAccessedAt: 1,
      }],
      memoryEnabled: false,
      locale: 'en',
    });
    expect(withoutMemory.usedMemoryIds).toEqual([]);
    expect(withoutMemory.augmented).toContain('(Memory injection disabled for this request)');
    expect(withoutMemory.augmented).not.toContain('Do not include me');
    expect(withoutMemory.memoryPressure.enabled).toBe(false);
    expect(withoutMemory.memoryPressure.selectedCount).toBe(0);
    expect(withoutMemory.memoryPressure.selectedTokenEstimate).toBe(0);
    expect(withoutMemory.memoryPressure.pressure).toBe('none');
    // available reports supplied count, enabled=false separate
    expect(withoutMemory.memoryPressure.availableCount).toBe(1);

    const withoutSystemPrompt = buildPromptAugmentation('plain prompt', {
      memories: [],
      systemPromptEnabled: false,
      locale: 'en',
    });
    expect(withoutSystemPrompt.renderedToolCount).toBe(0);
    expect(withoutSystemPrompt.augmented).not.toContain('## Role');
    expect(withoutSystemPrompt.augmented).toContain('plain prompt');

    const memoryOnly = buildPromptAugmentation('remember durable facts', {
      memories: [{
        id: 2,
        syncId: 'sync-2',
        scope: 'global',
        type: 'reference',
        name: 'Durable memory',
        content: 'Inject me without the full system prompt',
        description: '',
        tags: [],
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
        accessCount: 0,
        lastAccessedAt: 1,
      }],
      systemPromptEnabled: false,
      locale: 'en',
    });
    expect(memoryOnly.usedMemoryIds).toEqual([2]);
    expect(memoryOnly.augmented).toContain('## Existing Memories');
    expect(memoryOnly.augmented).toContain('Inject me without the full system prompt');
    expect(memoryOnly.augmented).not.toContain('## Role');

    const forcedLanguage = buildPromptAugmentation('reply', {
      memories: [],
      forceResponseLanguage: 'en',
      locale: 'zh-CN',
    });
    expect(forcedLanguage.augmented).toContain('## 回复语言');
    expect(forcedLanguage.augmented).toContain('请使用英文回复。');
  });

  it('keeps source-grounded research prompts from injecting unrelated topic memories', () => {
    const result = buildPromptAugmentation(
      'Deep-dive "scail-2". Compare primary sources, include links, and verify the current status.',
      {
        memories: [
          {
            ...memory(11, 'global', undefined, 'CoreAI model optimization', 'The user is working on CoreAI model optimization.'),
            type: 'topic',
            pinned: true,
          },
          {
            ...memory(12, 'global', undefined, 'Research style', 'Use natural human research prompts, not marker probes.'),
            type: 'feedback',
            pinned: false,
          },
          {
            ...memory(13, 'global', undefined, 'Saved reference', 'A private project reference that should not become research evidence.'),
            type: 'reference',
            pinned: true,
          },
        ],
        locale: 'en',
      },
    );

    expect(result.usedMemoryIds).toEqual([12]);
    expect(result.augmented).toContain('Use natural human research prompts');
    expect(result.augmented).not.toContain('CoreAI model optimization');
    expect(result.augmented).not.toContain('private project reference');
    expect(result.augmented).toContain('Memories are private personalization context');
    // metadata agrees with selected count after source-grounded filter
    expect(result.memoryPressure.selectedCount).toBe(1);
    // usedMemoryIds length matches selectedCount (adversarial in other test)
    expect(result.memoryPressure.selectedCount).toBe(result.usedMemoryIds.length);
    expect(result.memoryPressure.enabled).toBe(true);
    expect(result.memoryPressure.availableCount).toBe(3);
    // truncation signal for filtered set (did not take all candidates)
    expect(result.memoryPressure.truncated).toBe(true);
    // no leak of names/contents in metadata
    const mpJson = JSON.stringify(result.memoryPressure);
    expect(mpJson).not.toMatch(/CoreAI|Research style|Saved reference|optimization|probes|evidence/);
  });

  it('keeps normal prompts able to inject pinned reference memories', () => {
    const result = buildPromptAugmentation('what project context should you keep in mind?', {
      memories: [
        memory(14, 'global', undefined, 'Pinned reference', 'Keep this normal reference available.'),
      ],
      locale: 'en',
    });

    expect(result.usedMemoryIds).toEqual([14]);
    expect(result.augmented).toContain('Keep this normal reference available.');
    expect(result.memoryPressure.selectedCount).toBe(1);
    expect(result.memoryPressure.selectedCount).toBe(result.usedMemoryIds.length);
    expect(result.memoryPressure.truncated).toBe(false); // all supplied were selected
  });

  it('localizes skill user-input wrapper without mutating the user input', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/writer Draft about {raw_user_value}',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [{
        name: 'writer',
        instructions: 'Write clearly.',
        memoryEnabled: false,
      }],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { prompt?: string };
    expect(body.prompt).toContain('The following is the user input for this turn');
    expect(body.prompt).toContain('Draft about {raw_user_value}');
  });

  it('injects only global memories plus memories from the current project', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'remember the project rule',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [
        memory(1, 'global', undefined, 'Global memory', 'Always be concise.'),
        memory(2, 'project', 'project-1', 'Project memory', 'Use project glossary.'),
        memory(3, 'project', 'project-2', 'Other project memory', 'Do not include me.'),
      ],
      skills: [],
      activePreset: null,
      projectId: 'project-1',
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { prompt?: string };
    expect(body.prompt).toContain('Always be concise.');
    expect(body.prompt).toContain('[project reference] Project memory');
    expect(body.prompt).not.toContain('Do not include me.');
  });

  it('reports memory pressure metadata for empty set (enabled=true, counts 0, pressure none)', () => {
    const result = buildPromptAugmentation('plain prompt', {
      memories: [],
      locale: 'en',
    });
    expect(result.memoryPressure.enabled).toBe(true);
    expect(result.memoryPressure.availableCount).toBe(0);
    expect(result.memoryPressure.selectedCount).toBe(0);
    expect(result.memoryPressure.selectedTokenEstimate).toBe(0);
    expect(result.memoryPressure.pressure).toBe('none');
    expect(result.memoryPressure.truncated).toBe(false);
    expect(result.memoryPressure.promptTokens).toBeGreaterThan(0);
    expect(result.memoryPressure.budgetTokens).toBeGreaterThan(0);
    // augmented unchanged
    expect(result.augmented).toContain('plain prompt');
  });

  it('reports rising pressure and truncation for over-budget / many candidates (safe aggregates only)', () => {
    // pinned large to ensure selection despite size
    const largeContent = 'x'.repeat(6000); // ~1800+ tokens
    const largeMem = {
      id: 99,
      syncId: 'sync-99',
      scope: 'global' as const,
      type: 'reference' as const,
      name: 'Large memory',
      content: largeContent,
      description: '',
      tags: [],
      pinned: true,
      createdAt: 1,
      updatedAt: 1,
      accessCount: 0,
      lastAccessedAt: 1,
    };
    const result = buildPromptAugmentation('small prompt for large', {
      memories: [largeMem, memory(100, 'global', undefined, 'Small', 'tiny')],
      locale: 'en',
    });
    expect(result.usedMemoryIds).toContain(99);
    expect(result.memoryPressure.enabled).toBe(true);
    expect(result.memoryPressure.selectedCount).toBeGreaterThan(0);
    expect(result.memoryPressure.selectedTokenEstimate).toBeGreaterThan(1500);
    expect(result.memoryPressure.pressure).toBe('high');
    expect(result.memoryPressure.truncated).toBe(true);
    expect(result.memoryPressure.selectedCount).toBe(result.usedMemoryIds.length);
    // no leak
    const mpStr = JSON.stringify(result.memoryPressure);
    expect(mpStr).not.toContain('Large memory');
    expect(mpStr).not.toContain(largeContent.substring(0, 10));
    expect(mpStr).not.toContain('Small');
    // prompt contains memory (as expected for selection); pressure metadata does not leak
  });

  it('adversarial: result memoryPressure agrees with usedMemoryIds and internal selection counts (no false positive)', () => {
    const mems = [
      memory(1, 'global', undefined, 'A', 'one'),
      memory(2, 'global', undefined, 'B', 'two'),
    ];
    const result = buildPromptAugmentation('test prompt', { memories: mems, locale: 'en' });
    expect(result.memoryPressure.selectedCount).toBe(result.usedMemoryIds.length);
    expect(result.memoryPressure.availableCount).toBe(2);
    // source agrees
    expect(result.memoryPressure.selectedCount).toBeGreaterThanOrEqual(0);
    // durable source would be the select calc; here prove result vs computed from ids
    const idsAgree = result.memoryPressure.selectedCount === result.usedMemoryIds.length;
    expect(idsAgree).toBe(true);
  });
});

function memory(
  id: number,
  scope: 'global' | 'project',
  projectId: string | undefined,
  name: string,
  content: string,
) {
  return {
    id,
    syncId: `sync-${id}`,
    scope,
    projectId,
    type: 'reference' as const,
    name,
    content,
    description: '',
    tags: [],
    pinned: true,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    lastAccessedAt: 1,
  };
}
