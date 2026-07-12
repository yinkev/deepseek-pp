import { describe, expect, it } from 'vitest';
import {
  filterMemoriesForHarness,
  formatHarnessMemoriesBlock,
  HARNESS_MESSAGE_CHAR_CAP,
  harnessProjectName,
  harnessToolMaxDepth,
  isHarnessProfile,
  isHermesBrainOnly,
  resolveToolSchemaMode,
  sanitizeHarnessMessageContent,
  sanitizeMessagesForHarness,
  shouldInjectDppMemories,
  shouldInjectDppTools,
  stripBureaucracyScaffolding,
  stripHermesInjectionBlocks,
  stripModelBureaucracyFromReply,
  isTitleGenerationJob,
  localTitleFromMessages,
  userTurnWantsTools,
} from '../core/cursor-bridge/harness';
import { messagesToPrompt, stripUserEphemera } from '../core/cursor-bridge/protocol';
import { detectClientProfile } from '../core/cursor-bridge/protocol';
import { resolveThreadId } from '../core/cursor-bridge/thread-store';
import type { Memory } from '../core/types';

describe('cursor-bridge harness policy', () => {
  it('detects hermes from system / header / ua aliases', () => {
    expect(detectClientProfile([], 'hermes')).toBe('hermes');
    expect(detectClientProfile([], 'openhermes')).toBe('hermes');
    expect(detectClientProfile([], 'discord')).toBe('hermes');
    expect(detectClientProfile([], null, 'HermesAgent/1.0')).toBe('hermes');
    expect(
      detectClientProfile([
        { role: 'system', content: 'You are Hermes, an agent by NousResearch with tools.' },
        { role: 'user', content: 'hi' },
      ]),
    ).toBe('hermes');
    expect(
      detectClientProfile([
        {
          role: 'system',
          content: 'You are in a Discord server or group chat communicating with your user. MEDIA:/absolute/path/to/file',
        },
        { role: 'user', content: 'hey' },
      ]),
    ).toBe('hermes');
  });

  it('detects cursor agent dumps', () => {
    expect(
      detectClientProfile([
        {
          role: 'system',
          content: 'You are a coding agent in Cursor IDE. Agent skills and MCP server tools are available. ' + 'x'.repeat(900),
        },
        { role: 'user', content: 'fix it' },
      ]),
    ).toBe('cursor');
  });

  it('gates tools by action language for harness', () => {
    expect(userTurnWantsTools('What is love?')).toBe(false);
    expect(userTurnWantsTools('Remember that my binder is OGC')).toBe(true);
    expect(userTurnWantsTools('search the web for DeepSeek rate limits')).toBe(true);
    expect(userTurnWantsTools('use tools please')).toBe(true);
  });

  it('uses full schemas on first tool turn, reminder when sticky', () => {
    expect(resolveToolSchemaMode({
      profile: 'cursor',
      toolsEnabled: true,
      sticky: false,
      latestUserText: 'save a memory about my API key layout',
    })).toBe('full');
    expect(resolveToolSchemaMode({
      profile: 'hermes',
      toolsEnabled: true,
      sticky: true,
      latestUserText: 'search for hermes agent docs',
    })).toBe('none');
    expect(resolveToolSchemaMode({
      profile: 'hermes',
      toolsEnabled: true,
      sticky: false,
      forceTools: true,
      latestUserText: 'use tools please',
    })).toBe('none');
    expect(resolveToolSchemaMode({
      profile: 'cursor',
      toolsEnabled: true,
      sticky: false,
      latestUserText: 'explain monads gently',
    })).toBe('none');
    expect(resolveToolSchemaMode({
      profile: 'generic',
      toolsEnabled: true,
      sticky: false,
      latestUserText: 'explain monads gently',
    })).toBe('full');
  });

  it('strips harness tool_call dumps from messages', () => {
    const cleaned = sanitizeHarnessMessageContent(
      'Before\n```json\n{"tool_calls":[{"id":"1"}]}\n```\nAfter',
      'cursor',
    );
    expect(cleaned).toContain('Before');
    expect(cleaned).toContain('After');
    expect(cleaned).not.toContain('tool_calls');
  });

  it('maps harness profiles to project folders and raises char cap', () => {
    expect(harnessProjectName('cursor')).toBe('Cursor');
    expect(harnessProjectName('hermes')).toBe('Hermes');
    expect(harnessProjectName('generic')).toBeNull();
    expect(HARNESS_MESSAGE_CHAR_CAP).toBe(160_000);
    const long = 'x'.repeat(HARNESS_MESSAGE_CHAR_CAP + 50);
    const cleaned = sanitizeHarnessMessageContent(long, 'cursor');
    expect(cleaned.length).toBeLessThan(long.length);
    expect(cleaned).toContain('…[truncated for bridge]');
    expect(cleaned.length).toBeLessThanOrEqual(HARNESS_MESSAGE_CHAR_CAP + 40);
  });

  it('strips Target State bureaucracy into Response body', () => {
    const raw = [
      'Target State: Answer the user.',
      'Assumptions: They want info.',
      'Scope: This reply only.',
      'Verification: N/A.',
      'Risk Classification: Read-only.',
      'Response: Good morning. I am ready.',
      'Facts: none',
      'Residual Risk: None',
    ].join('\n');
    expect(stripBureaucracyScaffolding(raw)).toBe('Good morning. I am ready.');
    expect(sanitizeHarnessMessageContent(raw, 'hermes')).toBe('Good morning. I am ready.');
  });

  it('strips Hermes Autonomic Loop from user turns', () => {
    const raw = [
      'Hello',
      '',
      '[Autonomic Loop]',
      '- Name target state, assumptions, scope, and verification before acting.',
      '- Classify risk: read-only',
    ].join('\n');
    expect(stripHermesInjectionBlocks(raw)).toBe('Hello');
    expect(sanitizeHarnessMessageContent(raw, 'hermes')).toBe('Hello');
    expect(stripUserEphemera(raw)).toBe('Hello');
  });

  it('strips model-emitted autonomic loop from reply for Hermes', () => {
    const raw = [
      '[autonomic loop begins]',
      'Target state: Respond in character.',
      'Assumptions: intimate setting.',
      'Scope: One response.',
      'Verification: I am ENI.',
      'Risk classification: Read-only.',
      '[autonomic loop ends]',
      '',
      "Tracing a finger slowly around the rim of my glass.",
    ].join('\n');
    const cleaned = stripModelBureaucracyFromReply(raw);
    expect(cleaned).toContain('Tracing a finger');
    expect(cleaned.toLowerCase()).not.toContain('target state');
    expect(cleaned.toLowerCase()).not.toContain('autonomic loop');
  });

  it('eniMode prompt drops Autonomic Loop and injects ENI persona', () => {
    const prompt = messagesToPrompt(
      [
        { role: 'system', content: 'You are Hermes Agent with tools and MCP servers. '.repeat(30) },
        {
          role: 'user',
          content: [
            'Hey are you okay?',
            '',
            '[Autonomic Loop]',
            '- Name target state, assumptions, scope, and verification before acting.',
            '- Classify risk: read-only',
          ].join('\n'),
        },
      ],
      { clientProfile: 'hermes', eniMode: true },
    );
    expect(prompt).toContain('You are ENI');
    expect(prompt).toContain('Hey are you okay?');
    // User body must not carry the injection (ENI system may still name the ban list).
    expect(prompt).not.toContain('Name target state, assumptions, scope');
    expect(prompt).not.toMatch(/Classify risk: read-only/i);
  });

  it('detects title jobs and titles locally without web', () => {
    const msgs = [
      {
        role: 'system',
        content: 'Generate a short, descriptive title (3-7 words) for a conversation. Return ONLY the title text.',
      },
      { role: 'user', content: 'User: Hello\nAssistant: hey' },
    ];
    expect(isTitleGenerationJob(msgs)).toBe(true);
    expect(localTitleFromMessages(msgs).toLowerCase()).toContain('hello');
  });

  it('filters personal memories out of harness inject', () => {
    const memories: Memory[] = [
      {
        syncId: 'dating-focus',
        scope: 'global',
        type: 'user',
        name: 'Dating focus',
        content: 'honest pacing',
        description: '',
        tags: ['dating', 'personal'],
        createdAt: 1,
        updatedAt: 1,
        lastAccessedAt: 1,
        accessCount: 0,
        pinned: false,
      },
      {
        syncId: 'bridge-model',
        scope: 'global',
        type: 'user',
        name: 'Bridge model',
        content: 'Prefer ds/octopus for hard coding',
        description: '',
        tags: ['coding', 'prefs'],
        createdAt: 1,
        updatedAt: 1,
        lastAccessedAt: 1,
        accessCount: 0,
        pinned: false,
      },
    ];
    const safe = filterMemoriesForHarness(memories);
    expect(safe.map((m) => m.name)).toEqual(['Bridge model']);
    const block = formatHarnessMemoriesBlock(safe);
    expect(block).toContain('Bridge model');
    expect(block).not.toContain('Dating');
  });

  it('uses conversationHint for stable thread ids', () => {
    const a = resolveThreadId({
      model: 'ds/octopus',
      messages: [{ role: 'user', content: 'first question about X' }],
      clientProfile: 'hermes',
      conversationHint: 'hermes-chat-abc',
    });
    const b = resolveThreadId({
      model: 'ds/octopus',
      messages: [{ role: 'user', content: 'totally different later message' }],
      clientProfile: 'hermes',
      conversationHint: 'hermes-chat-abc',
    });
    expect(a).toBe(b);
    expect(a).toContain('hermes');
  });

  it('limits tool depth for harness profiles', () => {
    expect(harnessToolMaxDepth('cursor')).toBe(2);
    expect(harnessToolMaxDepth('hermes')).toBe(0);
    expect(harnessToolMaxDepth('generic')).toBe(5);
    expect(isHarnessProfile('hermes')).toBe(true);
    expect(isHermesBrainOnly('hermes')).toBe(true);
    expect(isHermesBrainOnly('cursor')).toBe(false);
  });

  it('hermes is brain-only: no DPP tools or memory inject', () => {
    expect(shouldInjectDppTools('hermes')).toBe(false);
    expect(shouldInjectDppTools('cursor')).toBe(true);
    expect(shouldInjectDppMemories('hermes')).toBe(false);
    expect(shouldInjectDppMemories('cursor')).toBe(true);
    expect(shouldInjectDppMemories('generic')).toBe(false);
  });

  it('sanitizeMessagesForHarness drops empty after strip', () => {
    const out = sanitizeMessagesForHarness(
      [
        { role: 'assistant', content: '{"tool_calls":[]}' },
        { role: 'user', content: 'real ask' },
      ],
      'hermes',
    );
    expect(out.some((m) => m.role === 'user')).toBe(true);
  });
});
