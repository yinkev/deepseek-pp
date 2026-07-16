import { describe, expect, it } from 'vitest';
import {
  extractResponseTextFromParsed,
  ResponseTextAssembler,
} from '../core/deepseek/stream-codec';

describe('ResponseTextAssembler', () => {
  it('captures relative BATCH fragment create + append (classic Multi-turn chop)', () => {
    const a = new ResponseTextAssembler();
    const d1 = a.apply({
      p: 'response',
      o: 'BATCH',
      v: [
        { p: 'fragments', o: 'APPEND', v: [{ content: 'Multi' }] },
        { p: 'fragments/-1/content', o: 'APPEND', v: '-turn' },
      ],
    });
    const d2 = a.apply({ p: 'response/fragments/-1/content', o: 'APPEND', v: ' bridges' });
    expect(d1 + d2).toBe('Multi-turn bridges');
    expect(a.text).toBe('Multi-turn bridges');
  });

  it('handles cumulative SET without duplicating', () => {
    const a = new ResponseTextAssembler();
    expect(a.apply({ p: 'response/fragments/-1/content', o: 'SET', v: 'There' })).toBe('There');
    expect(a.apply({ p: 'response/fragments/-1/content', o: 'SET', v: 'There are' })).toBe(' are');
    expect(a.apply({ p: 'response/fragments/-1/content', o: 'APPEND', v: ' three' })).toBe(' three');
    expect(a.text).toBe('There are three');
  });

  it('extracts relative fragments APPEND without response/ prefix', () => {
    expect(extractResponseTextFromParsed({
      p: 'fragments',
      o: 'APPEND',
      v: [{ content: 'Hello' }],
    })).toBe('Hello');
  });
});
