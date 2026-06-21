export type SidepanelChatProvider = 'deepseek-web' | 'official-api' | null;

export interface SidepanelChatProviderInput {
  hasApiKey: boolean;
  hasWebHeaders: boolean;
  hasImages?: boolean;
}

export function selectSidepanelChatProvider(
  input: SidepanelChatProviderInput,
): SidepanelChatProvider {
  if (input.hasWebHeaders || input.hasImages === true) return 'deepseek-web';
  if (input.hasApiKey) return 'official-api';
  return null;
}
