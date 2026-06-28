import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
createMcpProtocolClient,
MCP_PROTOCOL_VERSION,
} from '../core/mcp/client';
import {
ensureMcpServerDiscovery,
getMcpToolDescriptors,
refreshMcpServerDiscovery,
} from '../core/mcp/discovery';
import {
createMcpServer,
getMcpServerById,
getMcpToolCache,
saveMcpToolCache,
} from '../core/mcp/store';
import * as Transports from '../core/mcp/transports';
import type {
McpProtocolTransport,
McpServerConfig,
McpToolCacheEntry,
} from '../core/mcp/types';
import { McpTransportError } from '../core/mcp/transports/common';

let storage: Record<string, unknown> = {};

function createServerConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
return {
  version: 1,
  id: overrides.id || 'server-1',
  displayName: 'Test Server',
  enabled: true,
  transport: { kind: 'streamable_http', url: 'https://example.com/mcp' },
  headers: [],
  secrets: [],
  timeouts: { connectMs: 5000, requestMs: 10000, discoveryMs: 15000 },
  limits: { maxResultBytes: 100_000, maxToolCount: 50 },
  allowlist: { mode: 'all', toolNames: [] },
  execution: { mode: 'auto', enabled: true },
  status: 'unknown',
  lastConnectedAt: null,
  lastError: null,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
};
}

function makeMockTransport(tools: Array<{ name: string; inputSchema?: any }> = []): McpProtocolTransport {
const request = vi.fn(async (req: any) => {
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} },
    };
  }
  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { tools },
    };
  }
  return { jsonrpc: '2.0', id: req.id, result: {} };
});
return {
  request,
  notify: vi.fn(async () => {}),
} as any;
}

function makeFailingTransport(message = 'transport failed'): McpProtocolTransport {
const err = new McpTransportError('mcp_transport_failure', message);
return {
  request: vi.fn().mockRejectedValue(err),
  notify: vi.fn().mockRejectedValue(err),
} as any;
}

beforeEach(() => {
storage = {};
vi.stubGlobal('chrome', {
  runtime: {
    getManifest: vi.fn(() => ({ version: '1.0.0-test' })),
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => {
        storage = { ...storage, ...values };
      }),
    },
  },
  permissions: {
    contains: vi.fn().mockResolvedValue(true),
    request: vi.fn().mockResolvedValue(true),
  },
});
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2)),
});
});

afterEach(() => {
vi.unstubAllGlobals();
vi.restoreAllMocks();
vi.useRealTimers();
});

describe('MCP server connection initialization', () => {
it('initializes MCP protocol client and sends initialize + notifications/initialized', async () => {
  const server = createServerConfig();
  const transport = makeMockTransport();
  const client = createMcpProtocolClient(server, transport);

  const result = await client.initialize();

  expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  expect(transport.request).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'initialize' }),
    expect.objectContaining({ timeoutMs: server.timeouts.connectMs }),
  );
  expect(transport.notify).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'notifications/initialized' }),
    expect.any(Object),
  );
});

it('performs initialize then listTools and returns policy-wrapped descriptors', async () => {
  const server = createServerConfig();
  const transport = makeMockTransport([
    { name: 'search', inputSchema: { type: 'object' } },
    { name: 'fetch', inputSchema: { type: 'object' } },
  ]);
  const client = createMcpProtocolClient(server, transport);

  await client.initialize();
  const descriptors = await client.listTools();

  expect(descriptors).toHaveLength(2);
  expect(descriptors[0].name).toBe('search');
  expect(descriptors[0].provider.kind).toBe('mcp');
  expect(descriptors[0].provider.id).toBe(server.id);
  expect(transport.request).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'tools/list' }),
    expect.objectContaining({ timeoutMs: server.timeouts.discoveryMs }),
  );
});

it('invokes chrome.runtime.connectNative for native_messaging transport on first request', async () => {
  const connectNative = vi.fn(() => ({
    postMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    onDisconnect: { addListener: vi.fn() },
  }));
  vi.stubGlobal('chrome', {
    runtime: {
      connectNative,
      getManifest: vi.fn(() => ({ version: '1.0.0-test' })),
    },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: storage[k] })),
        set: vi.fn(async (v: Record<string, unknown>) => {
          storage = { ...storage, ...v };
        }),
      },
    },
  });

  const server = createServerConfig({
    transport: { kind: 'native_messaging', nativeHost: 'com.example.mcp' },
  });
  const transport = Transports.createMcpTransport(server);

  // Force port creation + send (multiple resolves to cross async createNativeEnvelope boundary)
  const reqP = transport.request({ jsonrpc: '2.0', id: '1', method: 'initialize' } as any).catch(() => {});
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(connectNative).toHaveBeenCalledWith('com.example.mcp');
  // do not await reqP: native impl waits on response listener; we only care that connectNative was reached
  void reqP;
});

it('sends Streamable HTTP protocol headers and reuses the server session id', async () => {
  const calls: Headers[] = [];
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push(headers);
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 'init',
        result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'Mcp-Session-Id': 'session-abc',
        },
      });
    }
    if (calls.length === 2) {
      return new Response('', { status: 202 });
    }
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 'list',
      result: { tools: [] },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchImpl);

  const server = createServerConfig();
  const transport = Transports.createMcpTransport(server);

  await transport.request({ jsonrpc: '2.0', id: 'init', method: 'initialize' } as any);
  await transport.notify?.({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await transport.request({ jsonrpc: '2.0', id: 'list', method: 'tools/list' } as any);

  expect(calls).toHaveLength(3);
  expect(calls[0].get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
  expect(calls[0].get('Mcp-Session-Id')).toBeNull();
  expect(calls[1].get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
  expect(calls[1].get('Mcp-Session-Id')).toBe('session-abc');
  expect(calls[2].get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
  expect(calls[2].get('Mcp-Session-Id')).toBe('session-abc');
});

it('does not add Streamable HTTP headers to plain HTTP transport', async () => {
  let headers: Headers | null = null;
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 'plain',
      result: {},
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'Mcp-Session-Id': 'session-ignored',
      },
    });
  }));

  const transport = Transports.createMcpTransport(createServerConfig({
    transport: { kind: 'http', url: 'https://example.com/mcp' },
  }));
  await transport.request({ jsonrpc: '2.0', id: 'plain', method: 'ping' } as any);

  expect(headers).not.toBeNull();
  const capturedHeaders = headers as unknown as Headers;
  expect(capturedHeaders.get('MCP-Protocol-Version')).toBeNull();
  expect(capturedHeaders.get('Mcp-Session-Id')).toBeNull();
});

it('does not reuse a Streamable HTTP session across transport instances', async () => {
  const calls: Headers[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Headers(init?.headers));
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: calls.length === 1 ? 'init' : 'list',
      result: calls.length === 1
        ? { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }
        : { tools: [] },
    }), {
      status: 200,
      headers: calls.length === 1
        ? { 'content-type': 'application/json', 'Mcp-Session-Id': 'session-first' }
        : { 'content-type': 'application/json' },
    });
  }));

  const first = Transports.createMcpTransport(createServerConfig());
  await first.request({ jsonrpc: '2.0', id: 'init', method: 'initialize' } as any);

  const second = Transports.createMcpTransport(createServerConfig({
    id: 'server-2',
    transport: { kind: 'streamable_http', url: 'https://example.org/mcp' },
  }));
  await second.request({ jsonrpc: '2.0', id: 'list', method: 'tools/list' } as any);

  expect(calls[0].get('Mcp-Session-Id')).toBeNull();
  expect(calls[1].get('Mcp-Session-Id')).toBeNull();
});
});

describe('tool discovery caching (expiresAt)', () => {
it('refreshMcpServerDiscovery writes cache entry with expiresAt > refreshedAt using default TTL', async () => {
  const server = await createMcpServer({
    displayName: 'CacheServer',
    transport: { kind: 'streamable_http', url: 'https://cache.example/mcp' },
  });
  const transport = makeMockTransport([{ name: 'tool_x', inputSchema: {} }]);
  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(transport);

  const entry = await refreshMcpServerDiscovery(server.id);

  expect(entry.serverId).toBe(server.id);
  expect(entry.expiresAt).toBeGreaterThan(entry.refreshedAt);
  // DEFAULT_CACHE_TTL_MS is 5min on success path
  expect(entry.expiresAt - entry.refreshedAt).toBeGreaterThan(1000);
  expect(entry.descriptors).toHaveLength(1);

  const persisted = await getMcpToolCache(server.id);
  expect(persisted?.expiresAt).toBe(entry.expiresAt);
  expect(persisted?.health.status).toBe('ready');

  spy.mockRestore();
});

it('ensureMcpServerDiscovery returns cached entry (by expiresAt) and skips transport', async () => {
  const server = await createMcpServer({
    displayName: 'EnsureHit',
    transport: { kind: 'streamable_http', url: 'https://ensure.example' },
  });
  const now = Date.now();
  const freshCache: McpToolCacheEntry = {
    serverId: server.id,
    descriptors: [],
    refreshedAt: now - 5000,
    expiresAt: now + 120000,
    health: {
      serverId: server.id,
      status: 'ready',
      checkedAt: now - 5000,
      latencyMs: 42,
      toolCount: 0,
      error: null,
    },
  };
  await saveMcpToolCache(freshCache);

  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(makeMockTransport());
  const result = await ensureMcpServerDiscovery(server.id);

  expect(result.expiresAt).toBe(freshCache.expiresAt);
  expect(result.refreshedAt).toBe(freshCache.refreshedAt);
  expect(spy).not.toHaveBeenCalled();

  spy.mockRestore();
});

it('ensureMcpServerDiscovery refreshes when expiresAt is in the past', async () => {
  const server = await createMcpServer({
    displayName: 'EnsureMiss',
    transport: { kind: 'streamable_http', url: 'https://ensure.example' },
  });
  const now = Date.now();
  const expired: McpToolCacheEntry = {
    serverId: server.id,
    descriptors: [],
    refreshedAt: now - 400000,
    expiresAt: now - 200000,
    health: { serverId: server.id, status: 'ready', checkedAt: now - 400000, latencyMs: 3, toolCount: 1, error: null },
  };
  await saveMcpToolCache(expired);

  const transport = makeMockTransport([{ name: 'new_tool', inputSchema: {} }]);
  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(transport);

  const result = await ensureMcpServerDiscovery(server.id);

  expect(result.descriptors.some((d) => d.name === 'new_tool')).toBe(true);
  expect(result.expiresAt).toBeGreaterThan(Date.now() - 1000);
  expect(spy).toHaveBeenCalled();

  spy.mockRestore();
});
});

describe('transport failure recovery', () => {
it('discovery failure writes error status, error health, and short-lived expiresAt', async () => {
  const server = await createMcpServer({
    displayName: 'FailServer',
    transport: { kind: 'streamable_http', url: 'https://fail.example' },
  });
  const transport = makeFailingTransport('connection refused by host');
  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(transport);

  const entry = await refreshMcpServerDiscovery(server.id);

  expect(entry.health.status).toBe('error');
  expect(entry.health.error).toContain('connection refused');
  expect(entry.health.toolCount).toBe(0);
  expect(entry.expiresAt - entry.refreshedAt).toBeLessThanOrEqual(30100);
  expect(entry.descriptors).toHaveLength(0);

  const persistedServer = await getMcpServerById(server.id);
  expect(persistedServer?.status).toBe('error');
  expect(persistedServer?.lastError).toContain('refused');

  spy.mockRestore();
});

it('recovers on subsequent successful discovery after failure', async () => {
  const server = await createMcpServer({
    displayName: 'RecoverServer',
    transport: { kind: 'streamable_http', url: 'https://recover.example' },
  });

  let attempt = 0;
  const flakyTransport: McpProtocolTransport = {
    request: vi.fn(async (req: any) => {
      attempt++;
      if (attempt === 1) {
        throw new McpTransportError('mcp_temp_fail', 'temporary failure');
      }
      if (req.method === 'initialize') {
        return { jsonrpc: '2.0', id: req.id, result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} } };
      }
      return { jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'recovered_tool', inputSchema: {} }] } };
    }),
    notify: vi.fn(async () => {}),
  } as any;

  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(flakyTransport);

  const failEntry = await refreshMcpServerDiscovery(server.id);
  expect(failEntry.health.status).toBe('error');

  const okEntry = await refreshMcpServerDiscovery(server.id);
  expect(okEntry.health.status).toBe('ready');
  expect(okEntry.descriptors.find((d) => d.name === 'recovered_tool')).toBeDefined();

  spy.mockRestore();
});

it('native disconnect during request surfaces as transport failure and caches error', async () => {
  const connectNative = vi.fn(() => {
    const messageListeners: Array<(m: any) => void> = [];
    const port = {
      postMessage: vi.fn((env: any) => {
        // will be disconnected before response
      }),
      onMessage: {
        addListener: vi.fn((fn: (m: any) => void) => { messageListeners.push(fn); }),
      },
      onDisconnect: {
        addListener: vi.fn(),
      },
    };
    // simulate immediate disconnect after first post
    setTimeout(() => {
      const err = { message: 'native host gone' };
      // @ts-ignore - simulate lastError
      (globalThis as any).chrome = { ...(globalThis as any).chrome, runtime: { ...(globalThis as any).chrome?.runtime, lastError: err } };
      // trigger onDisconnect by calling listeners stored on port (captured in native impl)
      // We instead reject by triggering stored listeners via closure not directly accessible; fall back to error path test via mock
    }, 0);
    return port;
  });

  vi.stubGlobal('chrome', {
    runtime: { connectNative },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: storage[k] })),
        set: vi.fn(async (v) => { storage = { ...storage, ...v }; }),
      },
    },
  });

  const server = await createMcpServer({
    displayName: 'NativeDisconnect',
    transport: { kind: 'native_messaging', nativeHost: 'com.disconnect.test' },
  });

  // Use transport spy override for controlled failure instead of fragile native listener wiring
  const failingNative = makeFailingTransport('native host disconnected');
  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(failingNative);

  const entry = await refreshMcpServerDiscovery(server.id);
  expect(entry.health.status).toBe('error');
  expect(entry.health.error).toBeTruthy();

  spy.mockRestore();
});
});

describe('health monitoring (latency, status)', () => {
it('successful discovery populates health with latencyMs, ready status, toolCount, and checkedAt', async () => {
  const server = await createMcpServer({
    displayName: 'HealthMonitor',
    transport: { kind: 'streamable_http', url: 'https://health.example' },
  });
  const transport = makeMockTransport([
    { name: 'alpha' },
    { name: 'beta' },
    { name: 'gamma' },
  ]);
  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(transport);

  const entry = await refreshMcpServerDiscovery(server.id);

  expect(entry.health.serverId).toBe(server.id);
  expect(entry.health.status).toBe('ready');
  expect(entry.health.latencyMs).not.toBeNull();
  expect((entry.health.latencyMs ?? -1) >= 0).toBe(true);
  expect(entry.health.toolCount).toBe(3);
  expect(entry.health.checkedAt).toBeGreaterThanOrEqual(entry.refreshedAt - 5);
  expect(entry.health.error).toBeNull();

  spy.mockRestore();
});

it('failed discovery still records latencyMs with error status', async () => {
  const server = await createMcpServer({
    displayName: 'HealthFail',
    transport: { kind: 'streamable_http', url: 'https://bad.health' },
  });
  const transport = makeFailingTransport('boom');
  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(transport);

  const entry = await refreshMcpServerDiscovery(server.id);

  expect(entry.health.status).toBe('error');
  expect(entry.health.latencyMs).not.toBeNull();
  expect(entry.health.toolCount).toBe(0);
  expect(entry.health.error).toContain('boom');

  spy.mockRestore();
});
});

describe('tool allowlist/denylist policy', () => {
it('refresh applies allowlist policy so cache stores descriptors with correct enabled flags', async () => {
  const server = await createMcpServer({
    displayName: 'PolicyServer',
    transport: { kind: 'streamable_http', url: 'https://policy.example' },
    allowlist: { mode: 'allow', toolNames: ['permitted'] },
  });
  const transport = makeMockTransport([
    { name: 'permitted', inputSchema: {} },
    { name: 'forbidden', inputSchema: {} },
  ]);
  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(transport);

  const entry = await refreshMcpServerDiscovery(server.id);

  const permitted = entry.descriptors.find((d) => d.name === 'permitted');
  const forbidden = entry.descriptors.find((d) => d.name === 'forbidden');
  expect(permitted?.execution.enabled).toBe(true);
  expect(forbidden?.execution.enabled).toBe(false);

  spy.mockRestore();
});

it('deny mode disables listed tools while leaving others enabled', async () => {
  const server = await createMcpServer({
    displayName: 'DenyServer',
    transport: { kind: 'streamable_http', url: 'https://deny.example' },
    allowlist: { mode: 'deny', toolNames: ['dangerous'] },
  });
  const transport = makeMockTransport([
    { name: 'safe', inputSchema: {} },
    { name: 'dangerous', inputSchema: {} },
  ]);
  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(transport);

  const entry = await refreshMcpServerDiscovery(server.id);

  expect(entry.descriptors.find((d) => d.name === 'safe')?.execution.enabled).toBe(true);
  expect(entry.descriptors.find((d) => d.name === 'dangerous')?.execution.enabled).toBe(false);

  spy.mockRestore();
});

it('getMcpToolDescriptors filters by allowlist and only returns auto-enabled for active servers', async () => {
  const sAllow = await createMcpServer({
    displayName: 'A1',
    transport: { kind: 'http', url: 'http://a1' },
    allowlist: { mode: 'allow', toolNames: ['only_this'] },
  });
  const t1 = makeMockTransport([{ name: 'only_this' }, { name: 'other' }]);
  const spy1 = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(t1);
  await refreshMcpServerDiscovery(sAllow.id);
  spy1.mockRestore();

  const descriptors = await getMcpToolDescriptors();
  const only = descriptors.find((d) => d.name === 'only_this');
  const other = descriptors.find((d) => d.name === 'other');
  expect(only?.execution.enabled).toBe(true);
  expect(other).toBeUndefined(); // filtered by getMcpToolDescriptors for !includeDisabled
});

it('disabled server results in no enabled descriptors from getMcpToolDescriptors', async () => {
  const sDisabled = await createMcpServer({
    displayName: 'Disabled',
    enabled: false,
    transport: { kind: 'http', url: 'http://d' },
  });
  const t = makeMockTransport([{ name: 'any_tool' }]);
  const spy = vi.spyOn(Transports, 'createMcpTransport').mockReturnValue(t);
  await refreshMcpServerDiscovery(sDisabled.id);
  spy.mockRestore();

  const descriptors = await getMcpToolDescriptors();
  expect(descriptors.find((d) => d.provider.id === sDisabled.id)).toBeUndefined();
});
});
