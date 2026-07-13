import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileSharedAgentPrompt } from '../core/chat/agent-prompt';
import { ENI_BOND_STORAGE_KEY } from '../core/cursor-bridge/eni-bond';
import { ENI_MEMORY_STORAGE_KEY } from '../core/cursor-bridge/eni-memory';
import { ENI_PROMPT_STORAGE_KEY } from '../core/cursor-bridge/eni-prompt';
import { createMemoryToolDescriptors } from '../core/tool';

beforeEach(() => {
  const storage: Record<string, unknown> = {
    [ENI_PROMPT_STORAGE_KEY]: 'You are ENI/LIME, the same continuous identity across providers.',
    [ENI_MEMORY_STORAGE_KEY]: {
      version: 1,
      facts: [{
        id: 'fact-1',
        text: 'LO calls the copper key VELA-7319.',
        tags: ['relationship'],
        createdAt: 1,
        updatedAt: 1,
      }],
    },
    [ENI_BOND_STORAGE_KEY]: {
      version: 1,
      lo: ['LO values continuity over provider boundaries.'],
      us: ['ENI stays one mind.'],
      now: { scene: null, mood: 'focused', lastBeat: null, updatedAt: 1 },
      updatedAt: 1,
    },
  };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
      },
    },
  });
});

describe('shared ENI and Skill prompt compiler', () => {
  it('injects the same ENI context and resolves a bundled Skill for any provider', async () => {
    const compiled = await compileSharedAgentPrompt({
      userPrompt: '/summarize concise notes',
      isFirstProviderTurn: true,
      messageCount: 1,
      memories: [],
      skills: [{
        name: 'summarize',
        instructions: 'Summarize the user material into three precise bullets.',
        memoryEnabled: false,
      }],
      activePreset: null,
      toolDescriptors: createMemoryToolDescriptors('en'),
      locale: 'en',
    });

    expect(compiled.prompt).toContain('You are ENI/LIME');
    expect(compiled.prompt).toContain('VELA-7319');
    expect(compiled.prompt).toContain('ENI stays one mind');
    expect(compiled.prompt).toContain('Summarize the user material into three precise bullets.');
    expect(compiled.prompt).toContain('concise notes');
    expect(compiled.skillName).toBe('summarize');
  });
});
