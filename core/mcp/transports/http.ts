import { buildMcpRequestHeaders } from '../store';
import { MCP_PROTOCOL_VERSION } from '../client';
import type {
  McpJsonRpcNotification,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpProtocolTransport,
  McpServerConfig,
} from '../types';
import {
  ensureMcpServerOriginPermission,
  fetchWithTimeout,
  getMcpEndpointUrl,
  readJsonRpcResponse,
} from './common';

const MCP_PROTOCOL_VERSION_HEADER = 'MCP-Protocol-Version';
const MCP_SESSION_ID_HEADER = 'Mcp-Session-Id';

export function createMcpHttpTransport(server: McpServerConfig): McpProtocolTransport {
  return {
    request(request, options) {
      return sendHttpMessage(server, request, options?.timeoutMs, options?.maxResponseBytes, options?.signal);
    },
    async notify(notification, options) {
      await sendHttpMessage(server, notification, options?.timeoutMs, options?.maxResponseBytes, options?.signal);
    },
  };
}

export function createMcpStreamableHttpTransport(server: McpServerConfig): McpProtocolTransport {
  let sessionId: string | null = null;
  const session = {
    get: () => sessionId,
    set: (nextSessionId: string) => {
      sessionId = nextSessionId;
    },
  };
  return {
    request(request, options) {
      return sendHttpMessage(server, request, options?.timeoutMs, options?.maxResponseBytes, options?.signal, {
        includeProtocolVersion: true,
        session,
      });
    },
    async notify(notification, options) {
      await sendHttpMessage(server, notification, options?.timeoutMs, options?.maxResponseBytes, options?.signal, {
        includeProtocolVersion: true,
        session,
      });
    },
  };
}

async function sendHttpMessage<TParams extends Record<string, unknown> | undefined, TResult>(
  server: McpServerConfig,
  message: McpJsonRpcRequest<TParams> | McpJsonRpcNotification,
  timeoutMs: number = server.timeouts.requestMs,
  maxResponseBytes: number = server.limits.maxResultBytes,
  signal?: AbortSignal,
  streamable?: {
    includeProtocolVersion: boolean;
    session: {
      get(): string | null;
      set(sessionId: string): void;
    };
  },
): Promise<McpJsonRpcResponse<TResult>> {
  await ensureMcpServerOriginPermission(server);
  const url = getMcpEndpointUrl(server);
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...buildMcpRequestHeaders(server),
  };
  if (streamable?.includeProtocolVersion) {
    headers[MCP_PROTOCOL_VERSION_HEADER] = MCP_PROTOCOL_VERSION;
  }
  const sessionId = streamable?.session.get();
  if (sessionId) {
    headers[MCP_SESSION_ID_HEADER] = sessionId;
  }
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    credentials: 'omit',
    headers,
    body: JSON.stringify(message),
  }, timeoutMs, signal);
  const nextSessionId = response.headers.get(MCP_SESSION_ID_HEADER)?.trim();
  if (streamable && nextSessionId) {
    streamable.session.set(nextSessionId);
  }

  return readJsonRpcResponse<TResult>(
    response,
    'id' in message ? message as McpJsonRpcRequest<TParams> : undefined,
    { maxBytes: maxResponseBytes, timeoutMs, signal },
  );
}
