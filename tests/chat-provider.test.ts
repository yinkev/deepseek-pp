import { describe, expect, it } from 'vitest';
import { selectSidepanelChatProvider } from '../core/chat/provider';

describe('sidepanel chat provider selection', () => {
  it('prefers the logged-in DeepSeek Web path when both web headers and an API key exist', () => {
    expect(selectSidepanelChatProvider({
      hasApiKey: true,
      hasWebHeaders: true,
    })).toBe('deepseek-web');
  });

  it('uses official API only as a text fallback when web headers are unavailable', () => {
    expect(selectSidepanelChatProvider({
      hasApiKey: true,
      hasWebHeaders: false,
    })).toBe('official-api');
  });

  it('routes image turns to DeepSeek Web even when no web headers are currently cached', () => {
    expect(selectSidepanelChatProvider({
      hasApiKey: true,
      hasWebHeaders: false,
      hasImages: true,
    })).toBe('deepseek-web');
  });

  it('reports no provider when neither web auth nor API fallback exists', () => {
    expect(selectSidepanelChatProvider({
      hasApiKey: false,
      hasWebHeaders: false,
    })).toBeNull();
  });
});
