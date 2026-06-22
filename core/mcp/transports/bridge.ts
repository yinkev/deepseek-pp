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

interface McpBridgeEnvelope {
  protocol: 'deepseek-pp-mcp-bridge';
  version: 1;
  server: {
    id: string;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification;
}

export function createMcpBridgeTransport(server: McpServerConfig): McpProtocolTransport {
  return {
    request(request, options) {
      return sendBridgeMessage(server, request, options?.timeoutMs, options?.maxResponseBytes, options?.signal);
    },
    async notify(notification, options) {
      await sendBridgeMessage(server, notification, options?.timeoutMs, options?.maxResponseBytes, options?.signal);
    },
  };
}

async function sendBridgeMessage<TParams extends Record<string, unknown> | undefined, TResult>(
  server: McpServerConfig,
  message: McpJsonRpcRequest<TParams> | McpJsonRpcNotification,
  timeoutMs: number = server.timeouts.requestMs,
  maxResponseBytes: number = server.limits.maxResultBytes,
  signal?: AbortSignal,
): Promise<McpJsonRpcResponse<TResult>> {
  await ensureMcpServerOriginPermission(server);
  const response = await fetchWithTimeout(getMcpEndpointUrl(server), {
    method: 'POST',
    credentials: 'omit',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify(createBridgeEnvelope(server, message)),
  }, timeoutMs, signal);

  return readJsonRpcResponse<TResult>(
    response,
    'id' in message ? message as McpJsonRpcRequest<TParams> : undefined,
    { maxBytes: maxResponseBytes, timeoutMs, signal },
  );
}

function createBridgeEnvelope(
  server: McpServerConfig,
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification,
): McpBridgeEnvelope {
  return {
    protocol: 'deepseek-pp-mcp-bridge',
    version: 1,
    server: {
      id: server.id,
      command: server.transport.command,
      args: server.transport.args,
      cwd: server.transport.cwd,
      env: server.transport.env,
    },
    message,
  };
}
