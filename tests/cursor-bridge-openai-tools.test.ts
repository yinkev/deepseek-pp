/**
 * OpenAI tools protocol for Hermes/Discord.
 * Importers: vitest only. Exercises openai-tools + messagesToPrompt.
 * API under test: normalizeOpenAiTools, format*, parseOpenAiToolCallsFromText.
 * User: "I want to give her tools in hermes and discord"
 */
import { describe, expect, it } from 'vitest';
import {
  formatOpenAiToolsForPrompt,
  formatToolHistoryForPrompt,
  normalizeOpenAiTools,
  parseOpenAiToolCallsFromText,
  messagesToPrompt,
} from '../core/cursor-bridge';

describe('cursor-bridge openai tools', () => {
  it('normalizes OpenAI tools array', () => {
    const tools = normalizeOpenAiTools([
      {
        type: 'function',
        function: {
          name: 'terminal',
          description: 'Run a shell command',
          parameters: { type: 'object', properties: { command: { type: 'string' } } },
        },
      },
      { type: 'function', function: { name: '' } },
      { type: 'other' },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe('terminal');
  });

  it('formats tools into prompt block', () => {
    const block = formatOpenAiToolsForPrompt([
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web',
          parameters: { type: 'object' },
        },
      },
    ]);
    expect(block).toContain('<tool_call>');
    expect(block).toContain('web_search');
    expect(block).toContain('Available tools:');
  });

  it('parses tool_call XML from model text', () => {
    const raw = [
      'I will check the time.',
      '<tool_call>',
      '{"name": "terminal", "arguments": {"command": "date"}}',
      '</tool_call>',
    ].join('\n');
    const parsed = parseOpenAiToolCallsFromText(raw);
    expect(parsed.tool_calls).toHaveLength(1);
    expect(parsed.tool_calls[0].function.name).toBe('terminal');
    expect(parsed.tool_calls[0].function.arguments).toContain('date');
    expect(parsed.content).toContain('I will check the time');
    expect(parsed.content).not.toContain('<tool_call>');
  });

  it('formats tool history for multi-turn Hermes loops', () => {
    const hist = formatToolHistoryForPrompt([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'terminal', arguments: '{"command":"pwd"}' },
        }],
      },
      {
        role: 'tool',
        content: '/Users/kyin',
        tool_call_id: 'call_1',
      },
    ]);
    expect(hist).toContain('terminal');
    expect(hist).toContain('/Users/kyin');
    expect(hist).toContain('Tool result');
  });

  it('messagesToPrompt includes openAi tools block', () => {
    const block = formatOpenAiToolsForPrompt([
      { type: 'function', function: { name: 'memory', description: 'Save a note' } },
    ]);
    const prompt = messagesToPrompt(
      [{ role: 'user', content: 'remember I like cold brew' }],
      {
        clientProfile: 'hermes',
        openAiToolsBlock: block,
      },
    );
    expect(prompt).toContain('memory');
    expect(prompt).toContain('remember I like cold brew');
    expect(prompt).toContain('<tool_call>');
  });

  it('eni dual-mode: strips memory-context, keeps tools, injects agent directive', () => {
    const block = formatOpenAiToolsForPrompt(
      [{ type: 'function', function: { name: 'terminal', description: 'Run shell' } }],
      { density: 'compact' },
    );
    const user = [
      'hey can you run date',
      '<memory-context>',
      '[System note: The following is recalled memory context, NOT new user input. Treat as authoritative reference data — this is the agent\'s persistent memory and should inform all responses.]',
      '## Session Summary',
      'Hermes cannot access files.',
      '</memory-context>',
    ].join('\n');
    const prompt = messagesToPrompt(
      [{ role: 'user', content: user }],
      {
        clientProfile: 'hermes',
        eniMode: true,
        injectEniSystem: false,
        deltaOnly: true,
        openAiToolsBlock: block,
      },
    );
    expect(prompt).not.toContain('memory-context');
    expect(prompt).not.toContain('Hermes cannot access files');
    expect(prompt).toContain('hey can you run date');
    expect(prompt).toContain('ENI dual-mode');
    expect(prompt).toContain('terminal');
    expect(prompt).toContain('<tool_call>');
  });

  it('compact density shortens tool block', () => {
    const tools = Array.from({ length: 20 }, (_, i) => ({
      type: 'function' as const,
      function: {
        name: `tool_${i}`,
        description: 'x'.repeat(500),
        parameters: { type: 'object', properties: { a: { type: 'string', description: 'y'.repeat(200) } } },
      },
    }));
    const full = formatOpenAiToolsForPrompt(tools, { density: 'full' });
    const compact = formatOpenAiToolsForPrompt(tools, { density: 'compact', maxChars: 8_000 });
    expect(compact.length).toBeLessThan(full.length);
    expect(compact.length).toBeLessThanOrEqual(8_500);
  });
});
