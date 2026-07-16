import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCall, ToolDescriptor, ToolResult } from '../core/types';

vi.mock('../core/mcp/discovery', () => ({
  executeMcpToolCall: vi.fn(),
  getMcpToolDescriptors: vi.fn(),
  refreshMcpServerDiscovery: vi.fn(),
}));

vi.mock('../core/mcp/store', () => ({
  getAllMcpServers: vi.fn(async () => []),
}));

vi.mock('../core/memory/store', () => ({
  deleteMemory: vi.fn(),
  getMemoryById: vi.fn(),
  saveMemory: vi.fn(),
  updateMemory: vi.fn(),
}));

vi.mock('../core/tool/history', () => ({
  appendToolCallHistory: vi.fn(),
}));

import {
  executeMcpToolCall,
  getMcpToolDescriptors,
} from '../core/mcp/discovery';
import { deleteMemory } from '../core/memory/store';
import { createSandboxToolDescriptors, executeSandboxToolCall } from '../core/sandbox';
import {
  executeRuntimeToolCall,
  getRuntimeToolDescriptors,
} from './helpers/production-tool-runtime';

describe('tool provider routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', {
      storage: {
        local: { get: vi.fn(async () => ({})) },
      },
    });
  });

  it('routes an MCP descriptor before matching a colliding local tool name', async () => {
    const descriptor = makeCollidingMcpDescriptor();
    const providerResult: ToolResult = { ok: true, summary: 'MCP handled the call' };
    vi.mocked(getMcpToolDescriptors).mockResolvedValue([descriptor]);
    vi.mocked(executeMcpToolCall).mockResolvedValue(providerResult);

    const result = await executeRuntimeToolCall(
      makeCall(descriptor),
      {
        kind: 'trusted',
        trigger: 'test',
        requestId: 'request-provider-routing',
        chatSessionId: null,
      },
      'en',
    );

    expect(result).toEqual(providerResult);
    expect(executeMcpToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ descriptorId: descriptor.id, provider: descriptor.provider }),
      descriptor,
      {},
    );
    expect(deleteMemory).not.toHaveBeenCalled();
  });

  it('authorizes injected sandbox descriptors through the real executor and rejects forged metadata', async () => {
    vi.mocked(getMcpToolDescriptors).mockResolvedValue([]);
    const descriptors = createSandboxToolDescriptors('en');
    const sandboxDescriptor = descriptors[0];
    const sandboxRuntime = {
      runSandbox: vi.fn(async (): Promise<ToolResult> => ({
        ok: true,
        summary: '2',
        detail: '2',
      })),
    };
    const validCall = makeSandboxCall(sandboxDescriptor);

    const authorized = await executeRuntimeToolCall(
      validCall,
      {
        kind: 'trusted',
        trigger: 'sidepanel_chat',
        requestId: 'request-sandbox-ok',
        chatSessionId: null,
      },
      'en',
      {
        injectedProvider: {
          descriptors,
          execute: (call, _descriptor, { locale }) => executeSandboxToolCall(
            sandboxRuntime,
            call,
            locale,
          ),
        },
      },
    );
    expect(authorized.ok).toBe(true);
    expect(sandboxRuntime.runSandbox).toHaveBeenCalledTimes(1);
    expect(sandboxRuntime.runSandbox).toHaveBeenCalledWith({
      language: 'javascript',
      code: '1 + 1',
      input: undefined,
      timeoutMs: 5000,
    });

    const forged = await executeRuntimeToolCall(
      {
        ...validCall,
        id: 'call-sandbox-forged',
        descriptorId: 'forged-sandbox-id',
        source: { trigger: 'sidepanel_chat', requestId: 'request-sandbox-forged' },
      },
      {
        kind: 'trusted',
        trigger: 'sidepanel_chat',
        requestId: 'request-sandbox-forged',
        chatSessionId: null,
      },
      'en',
      {
        injectedProvider: {
          descriptors,
          execute: (call, _descriptor, { locale }) => executeSandboxToolCall(
            sandboxRuntime,
            call,
            locale,
          ),
        },
      },
    );
    expect(forged.ok).toBe(false);
    expect(forged.error?.code).toBe('tool_unsupported');
    expect(sandboxRuntime.runSandbox).toHaveBeenCalledTimes(1);

    const publicDescriptors = await getRuntimeToolDescriptors('en');
    expect(publicDescriptors.some((descriptor) => descriptor.id === 'local:sandbox:sandbox_run')).toBe(false);
  });

  it('rejects an injected descriptor sharing a real registry descriptor ID before execution', async () => {
    vi.mocked(getMcpToolDescriptors).mockResolvedValue([]);
    const registryDescriptor = (await getRuntimeToolDescriptors('en'))
      .find((descriptor) => descriptor.id === 'local:memory:memory_delete');
    expect(registryDescriptor).toBeTruthy();
    const injectedExecute = vi.fn(async (): Promise<ToolResult> => ({
      ok: true,
      summary: 'Injected executor must not run',
    }));
    const collidingDescriptor = {
      ...createSandboxToolDescriptors('en')[0],
      id: registryDescriptor!.id,
    };

    await expect(executeRuntimeToolCall(
      makeCall(registryDescriptor!),
      {
        kind: 'trusted',
        trigger: 'test',
        requestId: 'request-injected-id-collision',
        chatSessionId: null,
      },
      'en',
      {
        injectedProvider: {
          descriptors: [collidingDescriptor],
          execute: injectedExecute,
        },
      },
    )).rejects.toMatchObject({ code: 'tool_descriptor_duplicate' });
    expect(injectedExecute).not.toHaveBeenCalled();
    expect(deleteMemory).not.toHaveBeenCalled();
  });

  it('rejects an injected descriptor sharing a real registry invocation name before execution', async () => {
    vi.mocked(getMcpToolDescriptors).mockResolvedValue([]);
    const registryDescriptor = (await getRuntimeToolDescriptors('en'))
      .find((descriptor) => descriptor.id === 'local:memory:memory_delete');
    expect(registryDescriptor).toBeTruthy();
    const injectedExecute = vi.fn(async (): Promise<ToolResult> => ({
      ok: true,
      summary: 'Injected executor must not run',
    }));
    const collidingDescriptor = {
      ...createSandboxToolDescriptors('en')[0],
      invocationName: registryDescriptor!.invocationName,
    };

    await expect(executeRuntimeToolCall(
      makeSandboxCall(collidingDescriptor),
      {
        kind: 'trusted',
        trigger: 'sidepanel_chat',
        requestId: 'request-injected-invocation-collision',
        chatSessionId: null,
      },
      'en',
      {
        injectedProvider: {
          descriptors: [collidingDescriptor],
          execute: injectedExecute,
        },
      },
    )).rejects.toMatchObject({ code: 'tool_invocation_duplicate' });
    expect(injectedExecute).not.toHaveBeenCalled();
    expect(deleteMemory).not.toHaveBeenCalled();
  });

  it('preserves the production local-to-MCP descriptor order', async () => {
    const descriptor = makeCollidingMcpDescriptor();
    vi.mocked(getMcpToolDescriptors).mockResolvedValue([descriptor]);

    const descriptors = await getRuntimeToolDescriptors('en');

    expect(descriptors).toEqual(expect.arrayContaining([descriptor]));
    expect(descriptors.map((item) => item.name)).toEqual([
      'memory_save',
      'memory_update',
      'memory_delete',
      'web_search',
      'web_fetch',
      'artifact_create',
      'artifact_bundle_create',
      'skill_draft_create',
      'memory_import_preview',
      'memory_delete',
    ]);
  });
});

function makeCollidingMcpDescriptor(): ToolDescriptor {
  return {
    id: 'mcp:collision:memory_delete',
    provider: {
      kind: 'mcp',
      id: 'collision',
      displayName: 'Collision MCP',
      transport: 'native_messaging',
    },
    name: 'memory_delete',
    invocationName: 'mcp_collision_memory_delete',
    title: 'Remote delete',
    description: 'A deliberately colliding MCP tool.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    execution: { mode: 'auto', enabled: true, risk: 'high' },
  };
}

function makeCall(descriptor: ToolDescriptor): ToolCall {
  return {
    id: 'call-provider-routing',
    descriptorId: descriptor.id,
    provider: descriptor.provider,
    name: descriptor.name,
    invocationName: descriptor.invocationName,
    payload: { id: 7 },
    raw: '<mcp_collision_memory_delete>{"id":7}</mcp_collision_memory_delete>',
    source: { trigger: 'test', requestId: 'request-provider-routing' },
  };
}

function makeSandboxCall(descriptor: ToolDescriptor): ToolCall {
  return {
    id: 'call-sandbox-ok',
    descriptorId: descriptor.id,
    provider: descriptor.provider,
    name: descriptor.name,
    invocationName: descriptor.invocationName,
    payload: { language: 'javascript', code: '1 + 1' },
    raw: '<sandbox_run>{"language":"javascript","code":"1 + 1"}</sandbox_run>',
    source: { trigger: 'sidepanel_chat', requestId: 'request-sandbox-ok' },
  };
}
