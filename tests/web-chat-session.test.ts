import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSidepanelWebChatSessionState,
  getOrCreateSidepanelWebChatSession,
  loadSidepanelWebChatSessionState,
  normalizeSidepanelWebChatSessionState,
  saveSidepanelWebChatSessionState,
} from '../core/chat/web-session';
import { setChatEnabled } from '../core/chat/store';
import {
  clearSidepanelWebAuthRejected,
  isSidepanelWebAuthRejected,
  markSidepanelWebAuthRejected,
} from '../core/chat/web-auth-state';
import {
  clearDeepSeekWebLastSession,
  getDeepSeekWebSessionPreference,
  rememberDeepSeekWebSession,
} from '../core/chat/session-preference';
import {
  getPersonalConvenienceConfig,
  savePersonalConvenienceConfig,
} from '../core/personal-convenience/config';

describe('sidepanel DeepSeek Web chat session state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reuses a saved session chain after in-memory state is lost', async () => {
    const { session } = stubChromeStorage();
    const createSession = vi.fn(async () => 'session-1');

    const first = await getOrCreateSidepanelWebChatSession({
      chatSessionId: null,
      parentMessageId: null,
    }, createSession);
    await saveSidepanelWebChatSessionState({
      chatSessionId: first.chatSessionId,
      parentMessageId: 22,
    });

    const second = await getOrCreateSidepanelWebChatSession({
      chatSessionId: null,
      parentMessageId: null,
    }, createSession);

    expect(first).toEqual({ chatSessionId: 'session-1', parentMessageId: null });
    expect(second).toEqual({ chatSessionId: 'session-1', parentMessageId: 22 });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(session.data.deepseek_pp_sidepanel_web_chat_session).toEqual({
      chatSessionId: 'session-1',
      parentMessageId: 22,
    });
  });

  it('keeps session-chain metadata in session storage only', async () => {
    const { session, local } = stubChromeStorage();

    await saveSidepanelWebChatSessionState({
      chatSessionId: 'session-1',
      parentMessageId: 101,
    });

    await expect(loadSidepanelWebChatSessionState()).resolves.toEqual({
      chatSessionId: 'session-1',
      parentMessageId: 101,
    });
    expect(session.data.deepseek_pp_sidepanel_web_chat_session).toEqual({
      chatSessionId: 'session-1',
      parentMessageId: 101,
    });
    expect(local.data.deepseek_pp_sidepanel_web_chat_session).toBeUndefined();
  });

  it('clears malformed stored session state', async () => {
    const { session } = stubChromeStorage({
      session: {
        deepseek_pp_sidepanel_web_chat_session: {
          chatSessionId: '',
          parentMessageId: 101,
        },
      },
    });

    await expect(loadSidepanelWebChatSessionState()).resolves.toBeNull();
    expect(session.data.deepseek_pp_sidepanel_web_chat_session).toBeUndefined();
  });

  it('clears the saved session chain on explicit reset', async () => {
    const { session } = stubChromeStorage({
      session: {
        deepseek_pp_sidepanel_web_chat_session: {
          chatSessionId: 'session-1',
          parentMessageId: 101,
        },
      },
    });

    await clearSidepanelWebChatSessionState();

    expect(session.data.deepseek_pp_sidepanel_web_chat_session).toBeUndefined();
  });

  it('clears web session metadata and cached headers when chat is disabled', async () => {
    const { session, local } = stubChromeStorage({
      session: {
        deepseek_pp_sidepanel_web_chat_session: {
          chatSessionId: 'session-1',
          parentMessageId: 101,
        },
        deepseek_pp_sidepanel_web_auth_rejected: true,
        deepseekCachedClientHeaders: {
          Authorization: 'Bearer session-token',
        },
      },
      local: {
        deepseekCachedClientHeaders: {
          Authorization: 'Bearer legacy-token',
        },
      },
    });

    await setChatEnabled(false);

    expect(local.data.deepseek_pp_chat_enabled).toBe(false);
    expect(session.data.deepseek_pp_sidepanel_web_chat_session).toBeUndefined();
    expect(session.data.deepseek_pp_sidepanel_web_auth_rejected).toBeUndefined();
    expect(session.data.deepseekCachedClientHeaders).toBeUndefined();
    expect(local.data.deepseekCachedClientHeaders).toBeUndefined();
  });

  it('tracks rejected web auth in session storage only', async () => {
    const { session, local } = stubChromeStorage();

    await expect(isSidepanelWebAuthRejected()).resolves.toBe(false);
    await markSidepanelWebAuthRejected();
    await expect(isSidepanelWebAuthRejected()).resolves.toBe(true);
    expect(session.data.deepseek_pp_sidepanel_web_auth_rejected).toBe(true);
    expect(local.data.deepseek_pp_sidepanel_web_auth_rejected).toBeUndefined();

    await clearSidepanelWebAuthRejected();

    await expect(isSidepanelWebAuthRejected()).resolves.toBe(false);
    expect(session.data.deepseek_pp_sidepanel_web_auth_rejected).toBeUndefined();
  });

  it('allows explicit fresh auth capture to clear a rejected marker', async () => {
    const { session } = stubChromeStorage({
      session: {
        deepseek_pp_sidepanel_web_auth_rejected: true,
      },
    });

    await expect(isSidepanelWebAuthRejected()).resolves.toBe(true);
    await clearSidepanelWebAuthRejected();

    await expect(isSidepanelWebAuthRejected()).resolves.toBe(false);
    expect(session.data.deepseek_pp_sidepanel_web_auth_rejected).toBeUndefined();
  });

  it('normalizes only safe session id and parent id metadata', () => {
    expect(normalizeSidepanelWebChatSessionState({
      chatSessionId: ' session-1 ',
      parentMessageId: 0,
      Authorization: 'Bearer should-not-matter',
      dataUrl: 'data:image/png;base64,AAAA',
    })).toEqual({
      chatSessionId: 'session-1',
      parentMessageId: 0,
    });
    expect(normalizeSidepanelWebChatSessionState({
      chatSessionId: 'session-1',
      parentMessageId: -1,
    })).toEqual({
      chatSessionId: 'session-1',
      parentMessageId: null,
    });
  });

  it('remembers only the last safe DeepSeek Web session pointer in local storage', async () => {
    const { local, session } = stubChromeStorage();

    await rememberDeepSeekWebSession({
      chatSessionId: ' session-remembered ',
      parentMessageId: 42,
    }, 'sidepanel', 1234);

    await expect(getDeepSeekWebSessionPreference()).resolves.toEqual({
      lastSession: {
        chatSessionId: 'session-remembered',
        parentMessageId: 42,
        source: 'sidepanel',
        updatedAt: 1234,
      },
    });
    const json = JSON.stringify(local.data.deepseek_pp_deepseek_web_session_preference);
    expect(json).toContain('session-remembered');
    expect(json).not.toMatch(/Authorization|Bearer|Cookie|data:image|dataUrl|refFileIds/);
    expect(session.data.deepseek_pp_deepseek_web_session_preference).toBeUndefined();

    await clearDeepSeekWebLastSession();
    expect(local.data.deepseek_pp_deepseek_web_session_preference).toBeUndefined();
  });

  it('stores personal convenience config with default-on personal settings', async () => {
    const { local } = stubChromeStorage();

    await expect(getPersonalConvenienceConfig()).resolves.toMatchObject({
      enabled: true,
      autoReadyCheckBeforeRun: true,
      autoRefreshWebAuth: true,
      sameSessionStrategy: 'last',
      visualMonitorDefault: true,
      reducedConfirmations: true,
    });

    await savePersonalConvenienceConfig({
      autoReadyCheckBeforeRun: false,
      sameSessionStrategy: 'current',
    });

    expect(local.data.deepseek_pp_personal_convenience).toMatchObject({
      enabled: true,
      autoReadyCheckBeforeRun: false,
      sameSessionStrategy: 'current',
    });
  });
});

function stubChromeStorage(initial?: {
  session?: Record<string, unknown>;
  local?: Record<string, unknown>;
}) {
  const session = createStorageArea(initial?.session);
  const local = createStorageArea(initial?.local);
  vi.stubGlobal('chrome', {
    storage: {
      session,
      local,
    },
  });
  return { session, local };
}

function createStorageArea(initial: Record<string, unknown> = {}) {
  const area = {
    data: { ...initial },
    get: vi.fn(async (keys?: string | string[]) => {
      if (typeof keys === 'string') return { [keys]: area.data[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, area.data[key]]));
      }
      return { ...area.data };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(area.data, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete area.data[key];
      }
    }),
  };
  return area;
}
