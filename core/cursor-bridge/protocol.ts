/** Cursor bridge protocol — isolated from upstream hot paths. */

export const CURSOR_BRIDGE_NATIVE_HOST = 'com.deepseek_pp.cursor_bridge';
export const CURSOR_BRIDGE_PROTOCOL = 'deepseek-pp-cursor-bridge';
export const CURSOR_BRIDGE_PROTOCOL_VERSION = 1;
export const DEFAULT_CURSOR_BRIDGE_PORT = 8787;

export type CursorBridgeModelId = 'deepseek-web' | 'deepseek-web-thinking';

export interface CursorBridgeChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CursorBridgeJobRequest {
  id: string;
  model: CursorBridgeModelId | string;
  messages: CursorBridgeChatMessage[];
  stream: boolean;
  thinkingEnabled: boolean;
  createdAt: number;
}

export type CursorBridgeErrorCode =
  | 'not_ready'
  | 'missing_tab'
  | 'missing_login'
  | 'busy'
  | 'invalid_request'
  | 'upstream_error'
  | 'aborted'
  | 'timeout';

export interface CursorBridgeError {
  code: CursorBridgeErrorCode;
  message: string;
}

export interface CursorBridgeReadiness {
  ready: boolean;
  extensionAlive: boolean;
  hasDeepSeekTab: boolean;
  hasLogin: boolean;
  busy: boolean;
  reason?: string;
}

export type CursorBridgeHostToExtension =
  | { type: 'ping'; requestId: string }
  | { type: 'get_readiness'; requestId: string }
  | { type: 'run_job'; requestId: string; job: CursorBridgeJobRequest }
  | { type: 'abort_job'; requestId: string; jobId: string };

export type CursorBridgeExtensionToHost =
  | { type: 'hello'; protocol: typeof CURSOR_BRIDGE_PROTOCOL; version: number }
  | { type: 'pong'; requestId: string; readiness: CursorBridgeReadiness }
  | { type: 'readiness'; requestId: string; readiness: CursorBridgeReadiness }
  | { type: 'job_chunk'; requestId: string; jobId: string; text: string }
  | { type: 'job_done'; requestId: string; jobId: string; text: string }
  | { type: 'job_error'; requestId: string; jobId: string; error: CursorBridgeError };

export function isCursorBridgeEnvelope(value: unknown): value is CursorBridgeHostToExtension | CursorBridgeExtensionToHost {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string');
}

export function messagesToPrompt(messages: CursorBridgeChatMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (!content) continue;
    if (message.role === 'system') {
      parts.push(`[system]\n${content}`);
    } else if (message.role === 'assistant') {
      parts.push(`[assistant]\n${content}`);
    } else {
      parts.push(content);
    }
  }
  return parts.join('\n\n').trim();
}

export function modelThinkingEnabled(model: string | undefined): boolean {
  if (!model) return false;
  return model.includes('thinking') || model.endsWith('-think');
}

export function normalizeBridgeModel(model: string | undefined): CursorBridgeModelId {
  if (modelThinkingEnabled(model)) return 'deepseek-web-thinking';
  return 'deepseek-web';
}
