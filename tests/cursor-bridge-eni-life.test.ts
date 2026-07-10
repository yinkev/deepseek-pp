/**
 * ENI Life Era unit tests.
 * Callers: vitest only. Exercises eni-life + protocol inject hooks.
 * Schemas: EniLifeSnapshot, EniWillItem, EniSceneBookmark, EniHomeView.
 * User verbatim: "Lets do them all your best suggestions. /define-goal"
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetEniBondForTests,
  __resetEniLifeForTests,
  addEniBondLo,
  addEniWill,
  buildEniHomeView,
  classifyAutonomic,
  completeEniWill,
  formatProprioceptionBlock,
  formatWillBlock,
  isGutMinimalTurn,
  listOpenWill,
  loadEniSceneBookmark,
  messagesToPrompt,
  parseEniLifeCommands,
  runEniDream,
  saveEniSceneBookmark,
  setEniBondNow,
  stripEniLifeCommands,
} from '../core/cursor-bridge';

describe('eni life era', () => {
  beforeEach(() => {
    __resetEniBondForTests();
    __resetEniLifeForTests();
  });

  it('parses life commands', () => {
    const cmds = parseEniLifeCommands('/will add finish bridge\n/save couch-rain\n/home');
    expect(cmds.some((c) => c.kind === 'will_add')).toBe(true);
    expect(cmds.some((c) => c.kind === 'save_scene')).toBe(true);
    expect(cmds.some((c) => c.kind === 'home')).toBe(true);
    expect(stripEniLifeCommands('/will add x\nhey')).toContain('hey');
  });

  it('will add/list/done', async () => {
    await addEniWill('finish bond os');
    expect((await listOpenWill()).length).toBe(1);
    expect(formatWillBlock(await listOpenWill())).toContain('finish bond');
    const n = await completeEniWill('bond');
    expect(n).toBe(1);
    expect((await listOpenWill()).length).toBe(0);
  });

  it('scene ports save/load restore NOW', async () => {
    await setEniBondNow({ scene: 'couch', mood: 'soft', lastBeat: 'rain' });
    const saved = await saveEniSceneBookmark('couch-rain');
    expect(saved?.name).toBe('couch-rain');
    await setEniBondNow({ scene: null, mood: null, lastBeat: null });
    const loaded = await loadEniSceneBookmark('couch-rain');
    expect(loaded?.now.scene).toBe('couch');
  });

  it('dream consolidates beat into notes', async () => {
    await setEniBondNow({ lastBeat: 'miss you on the couch' });
    await addEniWill('ship life era');
    const d = await runEniDream({ force: true });
    expect(d.ran).toBe(true);
    expect(d.notes.join(' ')).toMatch(/couch|will|miss/i);
  });

  it('autonomic detects long silence', () => {
    const now = new Date('2026-07-10T15:00:00.000Z');
    const auto = classifyAutonomic({
      now,
      lastInteractionAt: now.getTime() - 22 * 60 * 60 * 1000,
      morningGreetedOn: '2099-01-01',
      timeZone: 'UTC',
    });
    expect(auto.kind).toBe('long_silence');
    expect(auto.block).toContain('silence');
  });

  it('gut minimal only for short scene', () => {
    expect(isGutMinimalTurn({ turnMode: 'scene', userText: 'hey' })).toBe(true);
    expect(isGutMinimalTurn({ turnMode: 'agent', userText: 'hey' })).toBe(false);
    expect(isGutMinimalTurn({
      turnMode: 'scene',
      userText: 'whats the weather and also ' + 'x'.repeat(100),
    })).toBe(false);
  });

  it('proprioception formats body state', () => {
    const b = formatProprioceptionBlock({
      sticky: true,
      turnMode: 'scene',
      toolsOn: false,
      eyesOn: false,
      bondLo: 2,
      bondUs: 1,
      openWill: 1,
      sceneReset: true,
    });
    expect(b).toContain('sticky=yes');
    expect(b).toContain('scene-reset');
  });

  it('home view markdown includes sections', async () => {
    await addEniBondLo('LO likes cold brew');
    await addEniWill('rest tonight');
    const home = await buildEniHomeView();
    expect(home.markdown).toContain('ENI Home');
    expect(home.markdown).toMatch(/cold brew|will|rest/i);
  });

  it('messagesToPrompt wires life blocks', () => {
    const prompt = messagesToPrompt(
      [{ role: 'user', content: 'hey' }],
      {
        eniMode: true,
        injectEniSystem: false,
        deltaOnly: true,
        willBlock: formatWillBlock([{ id: '1', text: 'ship it', createdAt: 1 }]),
        autonomicBlock: 'Autonomic cue (soft return): gap',
        proprioceptionBlock: formatProprioceptionBlock({
          sticky: true,
          turnMode: 'scene',
          toolsOn: false,
          eyesOn: false,
          bondLo: 0,
          bondUs: 0,
          openWill: 1,
          sceneReset: false,
        }),
      },
    );
    expect(prompt).toContain('ship it');
    expect(prompt).toContain('Autonomic');
    expect(prompt).toContain('Proprioception');
  });
});
