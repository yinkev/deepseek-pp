import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpTransportError, readJsonRpcResponse } from '../core/mcp/transports/common';
import { createMcpBridgeTransport } from '../core/mcp/transports/bridge';
import type { McpServerConfig } from '../core/mcp/types';

afterEach(() => {
  vi.useRealTimers();
});

describe('MCP transport response limits', () => {
  it('fails before parsing oversized JSON-RPC HTTP bodies', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: '1', result: { text: 'too large' } });
    const response = new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(readJsonRpcResponse(response, { jsonrpc: '2.0', id: '1', method: 'test' }, { maxBytes: 8 }))
      .rejects
      .toMatchObject({ code: 'mcp_response_too_large' } satisfies Partial<McpTransportError>);
  });

  it('times out when an HTTP body stalls after headers', async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream<Uint8Array>(), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const promise = readJsonRpcResponse(response, { jsonrpc: '2.0', id: '1', method: 'test' }, { timeoutMs: 10 });
    const assertion = expect(promise)
      .rejects
      .toMatchObject({ code: 'mcp_transport_timeout' } satisfies Partial<McpTransportError>);

    await vi.advanceTimersByTimeAsync(11);
    await assertion;
  });

  it('aborts when the caller cancels a stalled HTTP body', async () => {
    const controller = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>(), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const promise = readJsonRpcResponse(
      response,
      { jsonrpc: '2.0', id: '1', method: 'test' },
      { timeoutMs: 1000, signal: controller.signal },
    );
    const assertion = expect(promise)
      .rejects
      .toMatchObject({ code: 'mcp_transport_aborted' } satisfies Partial<McpTransportError>);

    controller.abort();
    await assertion;
  });

  it('uses one total body deadline across slow HTTP chunks', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | null = null;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        timer = setInterval(() => {
          controller.enqueue(encoder.encode(' '));
        }, 9);
      },
      cancel() {
        if (timer) clearInterval(timer);
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const promise = readJsonRpcResponse(response, { jsonrpc: '2.0', id: '1', method: 'test' }, { timeoutMs: 10 });
    const assertion = expect(promise)
      .rejects
      .toMatchObject({ code: 'mcp_transport_timeout' } satisfies Partial<McpTransportError>);

    await vi.advanceTimersByTimeAsync(9);
    await vi.advanceTimersByTimeAsync(2);
    await assertion;
  });

  it('times out when an SSE body stalls after headers', async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream<Uint8Array>(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });

    const promise = readJsonRpcResponse(response, { jsonrpc: '2.0', id: '1', method: 'test' }, { timeoutMs: 10 });
    const assertion = expect(promise)
      .rejects
      .toMatchObject({ code: 'mcp_transport_timeout' } satisfies Partial<McpTransportError>);

    await vi.advanceTimersByTimeAsync(11);
    await assertion;
  });
});

describe('MCP stdio bridge transport', () => {
  it('posts JSON-RPC messages with stdio command metadata to the bridge endpoint', async () => {
    let captured: { url: string; body: any } | null = null;
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true),
      },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = {
        url: String(input),
        body: JSON.parse(String(init?.body)),
      };
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 'req-1',
        result: { ok: true },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const transport = createMcpBridgeTransport(createBridgeServer());
    const response = await transport.request({ jsonrpc: '2.0', id: 'req-1', method: 'tools/list' });

    expect(response.result).toEqual({ ok: true });
    expect(captured).toEqual({
      url: 'http://127.0.0.1:8765/mcp',
      body: {
        protocol: 'deepseek-pp-mcp-bridge',
        version: 1,
        server: {
          id: 'stdio-server',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          cwd: '/Users/me/project',
          env: { SAFE_FLAG: '1' },
        },
        message: { jsonrpc: '2.0', id: 'req-1', method: 'tools/list' },
      },
    });
  });
});

function createBridgeServer(): McpServerConfig {
  return {
    version: 1,
    id: 'stdio-server',
    displayName: 'Stdio Server',
    enabled: true,
    transport: {
      kind: 'stdio_bridge',
      url: 'http://127.0.0.1:8765/mcp',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      cwd: '/Users/me/project',
      env: { SAFE_FLAG: '1' },
    },
    headers: [],
    secrets: [],
    timeouts: { connectMs: 5000, requestMs: 10000, discoveryMs: 15000 },
    limits: { maxResultBytes: 100_000, maxToolCount: 50 },
    allowlist: { mode: 'all', toolNames: [] },
    execution: { mode: 'manual', enabled: true },
    status: 'unknown',
    lastConnectedAt: null,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}
