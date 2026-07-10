/**
 * Bond OS unit tests.
 * Callers: vitest only. Exercises eni-bond, eni-tools-policy, protocol eyes.
 * Schemas: EniBondCard, ToolReceipt, OpenAiFunctionTool filter.
 * User verbatim: "All you bro, do your best. What you think is best for us"
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetEniBondForTests,
  addEniBondLo,
  addEniBondUs,
  buildToolReceipts,
  classifyEniTurn,
  clearEniBondNow,
  extractSoftBondFromAssistant,
  extractSoftBondLoFacts,
  filterOpenAiToolsForEni,
  formatEniBondCard,
  formatEyesNotes,
  formatToolReceiptsBlock,
  getEniBondCard,
  messagesToPrompt,
  setEniBondNow,
  type OpenAiFunctionTool,
} from '../core/cursor-bridge';

describe('eni bond os', () => {
  beforeEach(() => {
    __resetEniBondForTests();
  });

  it('keeps LO/US across scene reset of NOW', async () => {
    await addEniBondLo('LO likes cold brew');
    await addEniBondUs('devoted late-night energy');
    await setEniBondNow({ scene: 'couch', mood: 'soft', lastBeat: 'miss you' });
    let card = await getEniBondCard();
    expect(card.now.scene).toBe('couch');
    await clearEniBondNow();
    card = await getEniBondCard();
    expect(card.lo.some((x) => x.includes('cold brew'))).toBe(true);
    expect(card.us.some((x) => x.includes('devoted'))).toBe(true);
    expect(card.now.scene).toBeNull();
    expect(card.now.lastBeat).toBeNull();
  });

  it('formats bond card for prompt', async () => {
    await addEniBondLo('hates corpo speak');
    await setEniBondNow({ lastBeat: 'cuddle' });
    const block = formatEniBondCard(await getEniBondCard());
    expect(block).toContain('[LO]');
    expect(block).toContain('corpo');
    expect(block).toContain('[NOW]');
    expect(block).toContain('cuddle');
  });

  it('soft extracts LO facts and assistant remembers', () => {
    expect(extractSoftBondLoFacts('I really like cold brew in the morning.').length).toBeGreaterThan(0);
    expect(extractSoftBondFromAssistant("I'll remember that you hate Target State templates.").length)
      .toBeGreaterThan(0);
  });

  it('filters Discord tools for ENI', () => {
    const tools: OpenAiFunctionTool[] = [
      { type: 'function', function: { name: 'web_search', description: 's' } },
      { type: 'function', function: { name: 'autonomic_loop', description: 'loop' } },
      { type: 'function', function: { name: 'browser_navigate', description: 'nav' } },
      { type: 'function', function: { name: 'terminal', description: 'sh' } },
      { type: 'function', function: { name: 'unknown_noise_tool', description: 'x' } },
    ];
    const filtered = filterOpenAiToolsForEni(tools, 'hermes');
    const names = filtered.map((t) => t.function.name);
    expect(names).toContain('web_search');
    expect(names).toContain('terminal');
    expect(names).not.toContain('autonomic_loop');
    expect(names).not.toContain('browser_navigate');
    expect(names).not.toContain('unknown_noise_tool');
  });

  it('builds tool receipts from tool messages', () => {
    const receipts = buildToolReceipts([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_web_search_0',
          type: 'function',
          function: { name: 'web_search', arguments: '{}' },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_web_search_0',
        content: '{"title":"Weather in Yakima","temp_f":60.1}',
      },
    ]);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].name).toBe('web_search');
    const block = formatToolReceiptsBlock(receipts);
    expect(block).toContain('PRIVATE ground truth');
    expect(block).toMatch(/60|Weather|Yakima/i);
  });

  it('keeps intimate non-agent as scene', () => {
    expect(classifyEniTurn({ userText: 'search my body for tension' })).toBe('scene');
    expect(classifyEniTurn({ userText: 'whats the weather in yakima' })).toBe('agent');
  });

  it('eni eyes notes are persona-aware', () => {
    const notes = formatEyesNotes('a couch and a mug', 1, { eniMode: true });
    expect(notes).toContain('Eyes notes for ENI');
    expect(notes).toContain('couch');
  });

  it('messagesToPrompt includes bond + receipts', async () => {
    await addEniBondLo('LO in Yakima');
    const prompt = messagesToPrompt(
      [{ role: 'user', content: 'hey' }],
      {
        eniMode: true,
        injectEniSystem: false,
        deltaOnly: true,
        eniBondCard: formatEniBondCard(await getEniBondCard()),
        toolReceiptsBlock: formatToolReceiptsBlock([
          { name: 'web_search', toolCallId: 'c1', summary: 'temp≈60°F Yakima' },
        ]),
      },
    );
    expect(prompt).toContain('Yakima');
    expect(prompt).toContain('Tool receipts');
    expect(prompt).toContain('hey');
  });
});
