import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MULTIMODAL_MCP_NATIVE_HOST,
  MULTIMODAL_MCP_SERVER_NAME,
} from '../core/multimodal/contracts';
import type { McpServerConfig, McpToolCacheEntry, ToolDescriptor } from '../core/types';
import McpPage from '../entrypoints/sidepanel/pages/McpPage';

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;

  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: vi.fn(() => ({ version: '0.7.5' })),
      sendMessage: vi.fn(async (message: { type?: string }) => {
        if (message.type === 'GET_MCP_SERVERS') return [multimodalServer];
        if (message.type === 'GET_PLATFORM_CAPABILITIES') return null;
        if (message.type === 'GET_MCP_TOOL_CACHE') return multimodalCache;
        if (message.type === 'GET_TOOL_CALL_HISTORY') return [];
        return null;
      }),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe('McpPage server row collapse', () => {
  it('collapses the initially selected Multimodal Vision row', async () => {
    await renderMcpPage();

    expect(container.textContent).toContain('连接器');
    expect(container.textContent).toContain('连接');
    expect(container.textContent).toContain('媒体分析宿主');
    expect(container.textContent).not.toContain(MULTIMODAL_MCP_SERVER_NAME);
    expect(container.textContent).not.toContain(MULTIMODAL_MCP_NATIVE_HOST);

    const row = container.querySelector('.ds-connector-row') as HTMLElement | null;
    expect(row).toBeTruthy();

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('媒体分析');
    expect(container.textContent).not.toContain('媒体分析宿主');
  });
});

async function renderMcpPage() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(McpPage));
  });
  await settle();
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const now = 1_718_000_000_000;

const multimodalServer: McpServerConfig = {
  version: 1,
  id: 'multimodal',
  displayName: MULTIMODAL_MCP_SERVER_NAME,
  enabled: true,
  transport: {
    kind: 'native_messaging',
    nativeHost: MULTIMODAL_MCP_NATIVE_HOST,
  },
  headers: [],
  secrets: [],
  timeouts: {
    connectMs: 5_000,
    requestMs: 180_000,
    discoveryMs: 10_000,
  },
  limits: {
    maxResultBytes: 128_000,
    maxToolCount: 8,
  },
  allowlist: {
    mode: 'all',
    toolNames: [],
  },
  execution: {
    enabled: true,
    mode: 'auto',
  },
  status: 'ready',
  lastConnectedAt: now,
  lastError: null,
  createdAt: now,
  updatedAt: now,
};

const multimodalTools: ToolDescriptor[] = [
  toolDescriptor('vision_status', 'Multimodal Status'),
  toolDescriptor('analyze_images', 'Analyze Images'),
  toolDescriptor('analyze_video', 'Analyze Video'),
];

const multimodalCache: McpToolCacheEntry = {
  serverId: multimodalServer.id,
  descriptors: multimodalTools,
  refreshedAt: now,
  expiresAt: now + 60_000,
  health: {
    serverId: multimodalServer.id,
    status: 'ready',
    checkedAt: now,
    latencyMs: 42,
    toolCount: multimodalTools.length,
    error: null,
  },
};

function toolDescriptor(name: string, title: string): ToolDescriptor {
  return {
    id: `multimodal:${name}`,
    provider: {
      kind: 'mcp',
      id: multimodalServer.id,
      displayName: MULTIMODAL_MCP_SERVER_NAME,
      transport: 'native_messaging',
    },
    name,
    invocationName: name,
    title,
    description: title,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    execution: {
      enabled: true,
      mode: 'auto',
      risk: 'low',
    },
  };
}
