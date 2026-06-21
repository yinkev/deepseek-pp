import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatPage from '../entrypoints/sidepanel/pages/ChatPage';

type RuntimeMessage = {
  type: string;
  payload?: unknown;
  done?: boolean;
  error?: string;
};

type SubmittedImage = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
};

type ChatSubmitMessage = {
  type: 'CHAT_SUBMIT_PROMPT';
  payload: {
    text: string;
    images?: SubmittedImage[];
  };
};

let container: HTMLDivElement;
let root: Root | null;
let sendMessage: ReturnType<typeof vi.fn>;
let objectUrlSeq = 0;
let createdObjectUrls: string[];
let revokedObjectUrls: string[];
let runtimeListeners: Array<(message: RuntimeMessage) => void>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  createdObjectUrls = [];
  revokedObjectUrls = [];
  runtimeListeners = [];
  objectUrlSeq = 0;
  sendMessage = vi.fn(async (message: RuntimeMessage) => {
    if (message.type === 'GET_AUTH_STATUS') {
      return { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true };
    }
    if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return undefined;
    if (message.type === 'GET_VOICE_SETTINGS') return undefined;
    if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') {
      return {
        ok: true,
        config: {
          enabled: true,
          autoReadyCheckBeforeRun: true,
          autoRefreshWebAuth: true,
          sameSessionStrategy: 'last',
          visualMonitorDefault: true,
          reducedConfirmations: true,
        },
      };
    }
    if (message.type === 'CAPTURE_CURRENT_TAB_IMAGE') {
      return {
        ok: true,
        image: {
          name: 'captured-tab.png',
          mimeType: 'image/png',
          sizeBytes: 5,
          dataUrl: `data:image/png;base64,${btoa('probe')}`,
        },
        tab: {
          id: 12,
          windowId: 1,
          title: 'Example',
          url: 'https://example.com/',
        },
      };
    }
    if (message.type === 'CAPTURE_BROWSER_CONTROL_TARGET_IMAGE') {
      return {
        ok: true,
        image: {
          name: 'browser-control-12.png',
          mimeType: 'image/png',
          sizeBytes: 7,
          dataUrl: `data:image/png;base64,${btoa('browser')}`,
        },
        tab: {
          id: 12,
          windowId: 1,
        },
      };
    }
    if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
    return null;
  });
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: (message: RuntimeMessage) => void) => {
          runtimeListeners.push(listener);
        }),
        removeListener: vi.fn((listener: (message: RuntimeMessage) => void) => {
          runtimeListeners = runtimeListeners.filter((item) => item !== listener);
        }),
      },
    },
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:deepseek-pp-test-${objectUrlSeq += 1}`;
    createdObjectUrls.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revokedObjectUrls.push(url);
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sidepanel chat image attachments', () => {
  it('queues a pasted screenshot, previews it, and sends it through CHAT_SUBMIT_PROMPT', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');
    const pasted = new File(['probe'], 'clipboard.png', { type: 'image/png' });

    await act(async () => {
      textarea.dispatchEvent(createClipboardPasteEvent([pasted]));
    });

    expect(container.querySelector('img[alt="clipboard.png"]')).toBeTruthy();
    expect(container.textContent).toContain('clipboard.png');
    expect(createdObjectUrls).toEqual(['blob:deepseek-pp-test-1']);

    await enterText(textarea, 'I am checking this UI crop. What looks wrong or risky in this panel?');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(submit.payload.text).toBe('I am checking this UI crop. What looks wrong or risky in this panel?');
    expect(submit.payload.images).toHaveLength(1);
    expect(submit.payload.images?.[0]).toMatchObject({
      name: 'clipboard.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    expect(submit.payload.images?.[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);

    await emitRuntimeMessage({ type: 'CHAT_STREAM_CHUNK', done: true });

    expect(revokedObjectUrls).toEqual(['blob:deepseek-pp-test-1']);
    expect(sendMessage.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            type: expect.stringMatching(/^(SAVE|SET|STORE|SYNC)_/i),
          }),
        ]),
      ]),
    );
  });

  it('uses a natural screenshot prompt when sending images without typed text', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await act(async () => {
      textarea.dispatchEvent(createClipboardPasteEvent([
        new File(['shot'], 'screenshot.png', { type: 'image/png' }),
      ]));
    });

    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(submit.payload.text).toBe('I am checking this screenshot. What looks wrong or risky, and what should I do next?');
    expect(submit.payload.images).toHaveLength(1);
  });

  it('cycles the DeepSeek Web session strategy from the chat header', async () => {
    await renderChatPage();

    expect(container.textContent).toContain('会话：上次');

    await clickButtonByLabel('切换会话策略');
    expect(container.textContent).toContain('会话：当前');

    await clickButtonByLabel('切换会话策略');
    expect(container.textContent).toContain('会话：新建');

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_PERSONAL_CONVENIENCE_CONFIG',
      payload: { sameSessionStrategy: 'current' },
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_PERSONAL_CONVENIENCE_CONFIG',
      payload: { sameSessionStrategy: 'new' },
    });
    expect(container.textContent).not.toMatch(/session-[a-z0-9_-]+/i);
  });

  it('captures the current tab into a transient attachment', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await clickButtonByLabel('捕获当前标签页');

    expect(container.querySelector('img[alt="captured-tab.png"]')).toBeTruthy();
    expect(createdObjectUrls).toEqual(['blob:deepseek-pp-test-1']);

    await enterText(textarea, 'What is visually wrong here?');
    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(submit.payload.text).toBe('What is visually wrong here?');
    expect(submit.payload.images).toHaveLength(1);
    expect(submit.payload.images?.[0]).toMatchObject({
      name: 'captured-tab.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    expect(submit.payload.images?.[0]?.dataUrl).toBe(`data:image/png;base64,${btoa('probe')}`);
    expect(sendMessage.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            type: expect.stringMatching(/^(SAVE|SET|STORE|SYNC)_/i),
          }),
        ]),
      ]),
    );
  });

  it('captures the Browser Control target with a natural handoff prompt', async () => {
    await renderChatPage();

    await clickButtonByLabel('使用浏览器控制目标视图');

    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');
    expect(textarea.value).toBe('看一下我当前的浏览器画面，帮我判断下一步该怎么做。');
    expect(container.querySelector('img[alt="browser-control-12.png"]')).toBeTruthy();

    await clickButtonByLabel('发送');
    const submit = await waitForSubmit();

    expect(submit.payload.text).toBe('看一下我当前的浏览器画面，帮我判断下一步该怎么做。');
    expect(submit.payload.images).toHaveLength(1);
    expect(submit.payload.images?.[0]).toMatchObject({
      name: 'browser-control-12.png',
      mimeType: 'image/png',
      sizeBytes: 7,
    });
    expect(sendMessage.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            type: expect.stringMatching(/^(SAVE|SET|STORE|SYNC)_/i),
          }),
        ]),
      ]),
    );
  });

  it('shows capture failures without adding an attachment', async () => {
    sendMessage.mockImplementation(async (message: RuntimeMessage) => {
      if (message.type === 'GET_AUTH_STATUS') {
        return { available: true, provider: 'deepseek-web', hasApiKey: false, hasToken: true };
      }
      if (message.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return undefined;
      if (message.type === 'GET_VOICE_SETTINGS') return undefined;
      if (message.type === 'GET_PERSONAL_CONVENIENCE_CONFIG') return undefined;
      if (message.type === 'CAPTURE_CURRENT_TAB_IMAGE') return { ok: false, error: 'capture denied' };
      if (message.type === 'CHAT_SUBMIT_PROMPT') return { ok: true };
      return null;
    });
    await renderChatPage();

    await clickButtonByLabel('捕获当前标签页');

    expect(container.querySelectorAll('.ds-chat-attachment-card')).toHaveLength(0);
    expect(container.textContent).toContain('capture denied');
  });

  it('restores pasted attachments when the accepted stream later fails', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');
    const pasted = new File(['probe'], 'retry.png', { type: 'image/png' });

    await act(async () => {
      textarea.dispatchEvent(createClipboardPasteEvent([pasted]));
    });
    await enterText(textarea, 'I am checking this crop. What should I fix?');
    await clickButtonByLabel('发送');
    await waitForSubmit();

    expect(container.querySelector('img[alt="retry.png"]')).toBeNull();

    await emitRuntimeMessage({
      type: 'CHAT_STREAM_CHUNK',
      error: 'DeepSeek Web Vision upload failed.',
    });

    expect(inputByPlaceholder('给 DeepSeek++ 发送消息').value).toBe('I am checking this crop. What should I fix?');
    expect(container.querySelector('img[alt="retry.png"]')).toBeTruthy();
    expect(container.textContent).toContain('DeepSeek Web Vision upload failed.');
    expect(revokedObjectUrls).toEqual([]);
  });

  it('queues dropped images and blocks attachments above the per-turn limit', async () => {
    await renderChatPage();
    const composer = container.querySelector('.ds-chat-composer');
    expect(composer).toBeTruthy();

    await act(async () => {
      composer?.dispatchEvent(createDropEvent([
        new File(['a'], 'one.png', { type: 'image/png' }),
        new File(['b'], 'two.jpg', { type: 'image/jpeg' }),
        new File(['c'], 'three.webp', { type: 'image/webp' }),
        new File(['d'], 'four.gif', { type: 'image/gif' }),
        new File(['e'], 'five.png', { type: 'image/png' }),
      ]));
    });

    expect(container.querySelectorAll('.ds-chat-attachment-card')).toHaveLength(4);
    expect(container.textContent).toContain('最多只能附加 4 张图片');
    expect(createdObjectUrls).toHaveLength(4);
  });

  it('revokes preview object URLs when an attachment is removed and when the page unmounts', async () => {
    await renderChatPage();
    const textarea = inputByPlaceholder('给 DeepSeek++ 发送消息');

    await act(async () => {
      textarea.dispatchEvent(createClipboardPasteEvent([
        new File(['a'], 'remove.png', { type: 'image/png' }),
        new File(['b'], 'unmount.png', { type: 'image/png' }),
      ]));
    });

    await clickButtonByLabel('移除 remove.png');
    expect(revokedObjectUrls).toEqual(['blob:deepseek-pp-test-1']);

    await act(async () => {
      root?.unmount();
      root = null;
    });

    expect(revokedObjectUrls).toEqual(['blob:deepseek-pp-test-1', 'blob:deepseek-pp-test-2']);
  });
});

async function renderChatPage() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(ChatPage));
  });
  await flushPromises();
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function inputByPlaceholder(placeholder: string): HTMLTextAreaElement {
  const input = container.querySelector(`textarea[placeholder="${placeholder}"]`);
  expect(input).toBeTruthy();
  return input as HTMLTextAreaElement;
}

async function enterText(input: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function clickButtonByLabel(label: string) {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function waitForSubmit(): Promise<ChatSubmitMessage> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const submit = sendMessage.mock.calls
      .map(([message]) => message as RuntimeMessage)
      .find((message): message is ChatSubmitMessage => message.type === 'CHAT_SUBMIT_PROMPT');
    if (submit) return submit;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error('CHAT_SUBMIT_PROMPT was not sent.');
}

async function emitRuntimeMessage(message: RuntimeMessage) {
  await act(async () => {
    for (const listener of runtimeListeners) {
      listener(message);
    }
  });
}

function createClipboardPasteEvent(files: File[]): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files,
      items: files.map((file) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
    },
  });
  return event;
}

function createDropEvent(files: File[]): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files,
      items: files.map((file) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
    },
  });
  return event;
}
