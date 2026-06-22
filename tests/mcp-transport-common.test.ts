import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpTransportError, readJsonRpcResponse } from '../core/mcp/transports/common';

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
