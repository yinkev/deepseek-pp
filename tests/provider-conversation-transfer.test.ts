import { describe, expect, it } from 'vitest';
import {
  buildBoundedConversationTransfer,
  shouldStartFreshProviderSession,
} from '../core/chat/conversation-transfer';

describe('cross-provider conversation transfer', () => {
  it('keeps the newest bounded transcript and carries a randomized fact', () => {
    const transfer = buildBoundedConversationTransfer([
      { role: 'user', content: 'old '.repeat(100) },
      { role: 'assistant', content: 'older answer' },
      { role: 'user', content: 'Remember that my copper key is called VELA-7319.' },
      { role: 'assistant', content: 'I will remember VELA-7319.' },
    ], { maxChars: 180, maxMessages: 3 });

    expect(transfer).toContain('VELA-7319');
    expect(transfer).toContain('assistant: I will remember');
    expect(transfer).not.toContain('old old old');
    expect(transfer.length).toBeLessThanOrEqual(180);
  });

  it('starts a fresh upstream session whenever the selected provider changes', () => {
    expect(shouldStartFreshProviderSession(null, { providerId: 'deepseek-web', modelId: 'deepseek-web' })).toBe(true);
    expect(shouldStartFreshProviderSession(
      { providerId: 'deepseek-web', modelId: 'deepseek-web' },
      { providerId: 'deepseek-web', modelId: 'deepseek-web' },
    )).toBe(false);
    expect(shouldStartFreshProviderSession(
      { providerId: 'deepseek-web', modelId: 'deepseek-web' },
      { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
    )).toBe(true);
    expect(shouldStartFreshProviderSession(
      { providerId: 'qwen-web', modelId: 'qwen3.7-plus' },
      { providerId: 'deepseek-web', modelId: 'deepseek-web' },
    )).toBe(true);
  });
});
