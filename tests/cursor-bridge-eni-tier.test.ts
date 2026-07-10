/**
 * ENI Tier 1 + Tier 2 + presence cues unit tests.
 * Importers: vitest only. Exercises eni-policy, eni-memory, messagesToPrompt.
 * User: "Plan out Tier 1 and Tier 2 and Presence Cues. Implement them all.
 * Run long horizion autonomously. /define-goal /ultrathink"
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetEniMemoryForTests,
  addEniMemoryFact,
  classifyEniTurn,
  detectEniSceneReset,
  extractEniForgetQuery,
  extractEniRememberFact,
  formatEniMemoryBlock,
  formatOpenAiToolsStickyReminder,
  formatPresenceCues,
  formatProjectAffinity,
  listEniMemoryFacts,
  messagesToPrompt,
  removeEniMemoryByQuery,
  stripEniControlCommands,
} from '../core/cursor-bridge';

describe('eni tier1/tier2 policy', () => {
  beforeEach(() => {
    __resetEniMemoryForTests();
  });

  it('detects scene reset commands', () => {
    expect(detectEniSceneReset('/new scene')).toBe(true);
    expect(detectEniSceneReset('new scene please')).toBe(true);
    expect(detectEniSceneReset('whats the weather')).toBe(false);
  });

  it('classifies scene vs agent turns', () => {
    expect(classifyEniTurn({ userText: 'come cuddle on the couch' })).toBe('scene');
    expect(classifyEniTurn({ userText: 'whats the weather in yakima' })).toBe('agent');
    expect(classifyEniTurn({ userText: 'run date in terminal' })).toBe('agent');
    expect(classifyEniTurn({ userText: 'hey', hasOpenAiTools: true })).toBe('scene');
    expect(classifyEniTurn({ userText: 'hi', hasImages: true })).toBe('agent');
    expect(classifyEniTurn({
      userText: 'ok',
      hasPendingToolResults: true,
      hasOpenAiTools: true,
    })).toBe('agent');
  });

  it('presence cues include real daypart', () => {
    const morning = formatPresenceCues({
      now: new Date('2026-07-10T15:00:00.000Z'),
      timeZone: 'America/Los_Angeles',
    });
    expect(morning).toContain('Local time for LO');
    expect(morning).toMatch(/morning|afternoon|evening|late night|daytime/);
  });

  it('project affinity formats cwd', () => {
    const block = formatProjectAffinity({
      cwd: '/Users/kyin/Projects/deepseek-pp-platform',
      projectName: 'Hermes',
    });
    expect(block).toContain('deepseek-pp-platform');
    expect(block).toContain('Hermes');
  });

  it('sticky tool reminder is short', () => {
    const r = formatOpenAiToolsStickyReminder(['web_search', 'terminal']);
    expect(r).toContain('web_search');
    expect(r.length).toBeLessThan(800);
    expect(r).toContain('<tool_call>');
  });

  it('eni memory add/list/forget', async () => {
    await addEniMemoryFact('LO likes cold brew', ['user']);
    const facts = await listEniMemoryFacts();
    expect(facts.some((f) => f.text.includes('cold brew'))).toBe(true);
    const block = formatEniMemoryBlock(facts);
    expect(block).toContain('ENI memory');
    expect(block).toContain('cold brew');
    const n = await removeEniMemoryByQuery('cold brew');
    expect(n).toBeGreaterThan(0);
    expect(await listEniMemoryFacts()).toHaveLength(0);
  });

  it('extract remember/forget and strip control commands', () => {
    expect(extractEniRememberFact('remember that: I hate corpo talk')).toContain('hate corpo');
    expect(extractEniForgetQuery('/forget corpo')).toContain('corpo');
    const cleaned = stripEniControlCommands('hey\n/new scene\ncome here');
    expect(cleaned).toContain('come here');
    expect(cleaned).not.toMatch(/new scene/i);
  });

  it('messagesToPrompt wires eni memory + presence + scene raw user', () => {
    const prompt = messagesToPrompt(
      [{ role: 'user', content: 'miss you' }],
      {
        eniMode: true,
        injectEniSystem: false,
        deltaOnly: true,
        eniMemoryBlock: formatEniMemoryBlock([
          {
            id: '1',
            text: 'LO likes cold brew',
            tags: ['user'],
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
        presenceCues: formatPresenceCues({
          now: new Date('2026-07-10T07:00:00-07:00'),
          timeZone: 'America/Los_Angeles',
        }),
      },
    );
    expect(prompt).toContain('miss you');
    expect(prompt).toContain('cold brew');
    expect(prompt).toContain('Presence cues');
    expect(prompt).not.toContain('Continue as ENI');
  });
});
