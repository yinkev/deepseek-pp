import type { ChatModelRef } from './provider';

export interface NormalizedConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationTransferLimits {
  maxChars?: number;
  maxMessages?: number;
}

export function shouldStartFreshProviderSession(
  previous: ChatModelRef | null,
  next: ChatModelRef,
): boolean {
  return !previous
    || previous.providerId !== next.providerId
    || previous.modelId !== next.modelId;
}

export function buildBoundedConversationTransfer(
  messages: readonly NormalizedConversationMessage[],
  limits: ConversationTransferLimits = {},
): string {
  const maxChars = Math.max(1, limits.maxChars ?? 12_000);
  const maxMessages = Math.max(1, limits.maxMessages ?? 12);
  const selected: string[] = [];
  let length = 0;

  for (let index = messages.length - 1; index >= 0 && selected.length < maxMessages; index--) {
    const message = messages[index];
    const content = message.content.trim();
    if (!content) continue;
    const line = `${message.role}: ${content}`;
    const separatorLength = selected.length > 0 ? 1 : 0;
    if (length + separatorLength + line.length > maxChars) continue;
    selected.push(line);
    length += separatorLength + line.length;
  }

  return selected.reverse().join('\n');
}

export function prependConversationTransfer(
  prompt: string,
  transcript: readonly NormalizedConversationMessage[],
): string {
  const transfer = buildBoundedConversationTransfer(transcript);
  if (!transfer) return prompt;
  return [
    '<conversation_transfer>',
    transfer,
    '</conversation_transfer>',
    '',
    'Continue the same visible conversation with the same identity, memory, and commitments.',
    '',
    '<current_user>',
    prompt,
    '</current_user>',
  ].join('\n');
}
