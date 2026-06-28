import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_OFFICIAL_API_CHAT_CONFIG,
  normalizeOfficialApiChatConfig,
  type OfficialApiChatConfig,
  type OfficialDeepSeekModel,
  type OfficialDeepSeekReasoningEffort,
  type OfficialDeepSeekThinkingMode,
} from '../../../core/chat/official-api-config';
import {
  DEFAULT_VOICE_SETTINGS,
  detectVoiceCapabilities,
  normalizeVoiceSettings,
  type VoiceSettings,
} from '../../../core/voice/settings';
import {
  DEFAULT_PERSONAL_CONVENIENCE_CONFIG,
  normalizePersonalConvenienceConfig,
  type PersonalConvenienceConfig,
} from '../../../core/personal-convenience/config';
import {
  DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES,
  DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES,
  DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN,
  createDeepSeekWebVisionFileFromSerializedImage,
  serializeDeepSeekWebVisionFile,
  type DeepSeekWebVisionSerializedImage,
} from '../../../core/deepseek/web-vision';
import type { ChatMessage as ChatMessageType, ChatToolEvent } from '../../../core/types';
import ChatMessage from '../components/ChatMessage';
import { StatusMessage, useConfirm } from '../components/settings/primitives';
import { consumePendingText, onPendingText } from '../pending-text';
import { useI18n } from '../i18n';

type ChatProvider = 'official-api' | 'deepseek-web' | null;

interface ChatAuthStatus {
  available?: boolean;
  provider?: ChatProvider;
  hasApiKey?: boolean;
  hasToken?: boolean;
}

interface ChatStreamMessage extends ChatAuthStatus {
  type: string;
  streamId?: string;
  text?: string;
  reasoningText?: string;
  toolEvents?: ChatToolEvent[];
  voiceSettings?: VoiceSettings;
  phase?: 'reasoning' | 'answer';
  done?: boolean;
  error?: string;
}

type ChatImageAttachmentSource = 'picker' | 'paste' | 'drop' | 'capture' | 'browser-control';

interface ChatImageAttachment {
  id: string;
  file: File;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
  source: ChatImageAttachmentSource;
}

interface PendingImageSubmission {
  attachments: ChatImageAttachment[];
  inputText: string;
  visibleText: string;
  optimisticMessageIndex: number;
}

interface CaptureCurrentTabImageResponse {
  ok?: boolean;
  image?: DeepSeekWebVisionSerializedImage;
  error?: string;
}

const MODEL_OPTIONS: Array<{ value: OfficialDeepSeekModel; labelKey: 'sidepanel.chatPage.modelFlash' | 'sidepanel.chatPage.modelPro' }> = [
  { value: 'deepseek-v4-flash', labelKey: 'sidepanel.chatPage.modelFlash' },
  { value: 'deepseek-v4-pro', labelKey: 'sidepanel.chatPage.modelPro' },
];

const EFFORT_OPTIONS: Array<{ value: OfficialDeepSeekReasoningEffort; labelKey: 'sidepanel.chatPage.effortHigh' | 'sidepanel.chatPage.effortMax' }> = [
  { value: 'high', labelKey: 'sidepanel.chatPage.effortHigh' },
  { value: 'max', labelKey: 'sidepanel.chatPage.effortMax' },
];
const SESSION_STRATEGY_SEQUENCE: Array<PersonalConvenienceConfig['sameSessionStrategy']> = ['last', 'current', 'new'];
const STREAM_BUFFER_FLUSH_MS = 32;
const CHAT_STREAM_WATCHDOG_MS = 110_000;
const CURRENT_TAB_CAPTURE_ORIGINS = ['<all_urls>'];

export default function ChatPage() {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [authStatus, setAuthStatus] = useState<ChatAuthStatus | null>(null);
  const [chatConfig, setChatConfig] = useState<OfficialApiChatConfig>(DEFAULT_OFFICIAL_API_CHAT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [personalConfig, setPersonalConfig] = useState<PersonalConvenienceConfig>(DEFAULT_PERSONAL_CONVENIENCE_CONFIG);
  const [imageAttachments, setImageAttachments] = useState<ChatImageAttachment[]>([]);
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const [isCapturingTab, setIsCapturingTab] = useState(false);
  const [isCapturingBrowserTarget, setIsCapturingBrowserTarget] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [msgSeq, setMsgSeq] = useState(0);
  const { confirm, node: confirmNode } = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessageType[]>([]);
  const shouldAutoScrollRef = useRef(true);
  const activeStreamIdRef = useRef<string | null>(null);
  const streamBufferRef = useRef({ text: '', reasoningText: '' });
  const streamFlushTimerRef = useRef<number | null>(null);
  const imageAttachmentsRef = useRef<ChatImageAttachment[]>([]);
  const pendingImageSubmissionRef = useRef<PendingImageSubmission | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceSettingsRef = useRef<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const streamWatchdogRef = useRef<number | null>(null);
  const voiceCapabilities = detectVoiceCapabilities(window);

  const imageUploadEnabled = authStatus?.hasToken === true;
  const apiControlsEnabled = authStatus?.provider === 'official-api' && imageAttachments.length === 0;

  function updateLastAssistant(update: (message: ChatMessageType) => ChatMessageType) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        const next = [...prev.slice(0, -1), update(last)];
        messagesRef.current = next;
        return next;
      }
      const next = [...prev, update({ role: 'assistant', text: '' })];
      messagesRef.current = next;
      return next;
    });
  }

  function isEmptyAssistantMessage(message: ChatMessageType | undefined) {
    return message?.role === 'assistant' &&
      message.text === '' &&
      !message.reasoningText &&
      !message.toolEvents?.length;
  }

  function appendAssistantText(text: string) {
    streamBufferRef.current.text += text;
    scheduleAssistantStreamFlush();
  }

  function getTerminalAssistantTextDelta(text: string): string {
    const last = messagesRef.current[messagesRef.current.length - 1];
    const visibleText = `${last?.role === 'assistant' ? last.text : ''}${streamBufferRef.current.text}`;
    if (!visibleText) return text;
    if (text.startsWith(visibleText)) return text.slice(visibleText.length);
    if (visibleText.endsWith(text)) return '';
    return text;
  }

  function appendAssistantReasoning(reasoningText: string) {
    streamBufferRef.current.reasoningText += reasoningText;
    scheduleAssistantStreamFlush();
  }

  function appendAssistantToolEvents(toolEvents: ChatToolEvent[]) {
    flushAssistantStreamBuffer();
    updateLastAssistant((message) => ({
      ...message,
      toolEvents: mergeChatToolEvents(message.toolEvents, toolEvents),
    }));
  }

  function scheduleAssistantStreamFlush() {
    if (streamFlushTimerRef.current !== null) return;
    streamFlushTimerRef.current = window.setTimeout(() => {
      streamFlushTimerRef.current = null;
      flushAssistantStreamBuffer();
    }, STREAM_BUFFER_FLUSH_MS);
  }

  function flushAssistantStreamBuffer() {
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }
    const { text, reasoningText } = streamBufferRef.current;
    if (!text && !reasoningText) return;
    streamBufferRef.current = { text: '', reasoningText: '' };
    updateLastAssistant((message) => ({
      ...message,
      text: text ? message.text + text : message.text,
      reasoningText: reasoningText
        ? `${message.reasoningText ?? ''}${reasoningText}`
        : message.reasoningText,
    }));
  }

  useEffect(() => {
    const text = consumePendingText();
    if (text) {
      setInputText(text);
      inputRef.current?.focus();
    }
    return onPendingText((pendingText) => {
      setInputText(pendingText);
      inputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
  }, [voiceSettings]);

  useEffect(() => {
    imageAttachmentsRef.current = imageAttachments;
  }, [imageAttachments]);

  useEffect(() => () => {
    clearStreamWatchdog();
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }
    revokeImageAttachmentPreviews(imageAttachmentsRef.current);
    revokeImageAttachmentPreviews(pendingImageSubmissionRef.current?.attachments ?? []);
    imageAttachmentsRef.current = [];
    pendingImageSubmissionRef.current = null;
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' })
      .then((resp: ChatAuthStatus | undefined) => {
        setAuthStatus(normalizeAuthStatus(resp));
      })
      .catch(() => setAuthStatus({ available: false, provider: null, hasApiKey: false, hasToken: false }));

    chrome.runtime.sendMessage({ type: 'GET_OFFICIAL_API_CHAT_CONFIG' })
      .then((result) => setChatConfig(normalizeOfficialApiChatConfig(result)))
      .catch(() => setChatConfig(DEFAULT_OFFICIAL_API_CHAT_CONFIG));

    chrome.runtime.sendMessage({ type: 'GET_VOICE_SETTINGS' })
      .then((result) => setVoiceSettings(normalizeVoiceSettings(result)))
      .catch(() => setVoiceSettings(DEFAULT_VOICE_SETTINGS));

    chrome.runtime.sendMessage({ type: 'GET_PERSONAL_CONVENIENCE_CONFIG' })
      .then((result) => setPersonalConfig(normalizePersonalConvenienceConfig(result?.config)))
      .catch(() => setPersonalConfig(DEFAULT_PERSONAL_CONVENIENCE_CONFIG));
  }, []);

  useEffect(() => {
    const handler = (msg: ChatStreamMessage) => {
      if (msg.type === 'CHAT_SET_INPUT_TEXT' && typeof msg.text === 'string') {
        setInputText(msg.text);
        inputRef.current?.focus();
        return;
      }

      if (msg.type === 'AUTH_STATUS_CHANGED') {
        setAuthStatus(normalizeAuthStatus(msg));
        return;
      }

      if (msg.type === 'VOICE_SETTINGS_UPDATED') {
        setVoiceSettings(normalizeVoiceSettings(msg.voiceSettings));
        return;
      }

      if (msg.type !== 'CHAT_STREAM_CHUNK') return;
      const activeStreamId = activeStreamIdRef.current;
      if (activeStreamId) {
        if (msg.streamId !== activeStreamId) return;
      } else if (msg.streamId) {
        return;
      }
      if (!msg.done && !msg.error) refreshStreamWatchdog();

      if (msg.toolEvents?.length) {
        appendAssistantToolEvents(msg.toolEvents);
      }

      if (msg.error) {
        flushAssistantStreamBuffer();
        finalizeRunningToolEvents(msg.error);
        restorePendingImageSubmission();
        setError(msg.error);
        setIsStreaming(false);
        clearStreamWatchdog();
        if (!msg.streamId || msg.streamId === activeStreamIdRef.current) {
          activeStreamIdRef.current = null;
        }
        return;
      }

      if (msg.reasoningText) {
        appendAssistantReasoning(msg.reasoningText);
      }

      if (msg.text) {
        appendAssistantText(msg.done ? getTerminalAssistantTextDelta(msg.text) : msg.text);
      }

      if (msg.done) {
        flushAssistantStreamBuffer();
        clearPendingImageSubmission();
        setIsStreaming(false);
        clearStreamWatchdog();
        if (!msg.streamId || msg.streamId === activeStreamIdRef.current) {
          activeStreamIdRef.current = null;
        }
        const currentVoiceSettings = voiceSettingsRef.current;
        if (currentVoiceSettings.readAloudEnabled && voiceCapabilities.speechSynthesis) {
          setTimeout(() => speakLatestAssistant(messagesRef.current, currentVoiceSettings), 0);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  useEffect(() => {
    if (listRef.current) {
      if (!shouldAutoScrollRef.current) return;
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  function handleMessageListScroll() {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 48;
  }

  const saveChatConfig = async (patch: Partial<OfficialApiChatConfig>) => {
    const next = normalizeOfficialApiChatConfig({ ...chatConfig, ...patch });
    setChatConfig(next);
    try {
      const saved = await chrome.runtime.sendMessage({ type: 'SAVE_OFFICIAL_API_CHAT_CONFIG', payload: next });
      setChatConfig(normalizeOfficialApiChatConfig(saved));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if ((!text && imageAttachments.length === 0) || isStreaming) return;
    if (imageAttachments.length > 0 && !imageUploadEnabled) {
      setError(t('sidepanel.chatPage.imageAuthRequired'));
      return;
    }
    const attachments = imageUploadEnabled ? imageAttachments : [];
    const visibleText = text || t('sidepanel.chatPage.imageOnlyDefaultPrompt');
    const optimisticMessageIndex = messagesRef.current.length;
    shouldAutoScrollRef.current = true;

    setMessages((prev) => {
      const next = [...prev, {
        role: 'user' as const,
        text: visibleText,
        attachments: attachments.map((attachment) => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        })),
      }, {
        role: 'assistant' as const,
        text: '',
      }];
      messagesRef.current = next;
      return next;
    });
    setMsgSeq((n) => n + 1);
    setInputText('');
    pendingImageSubmissionRef.current = attachments.length > 0
      ? { attachments, inputText: text, visibleText, optimisticMessageIndex }
      : null;
    setImageAttachments([]);
    setIsStreaming(true);
    const streamId = crypto.randomUUID();
    activeStreamIdRef.current = streamId;
    setError(null);
    startStreamWatchdog(streamId);

    try {
      const images: DeepSeekWebVisionSerializedImage[] = [];
      for (const attachment of attachments) {
        images.push(await serializeImageAttachment(attachment));
      }
      const response = await chrome.runtime.sendMessage({
        type: 'CHAT_SUBMIT_PROMPT',
        payload: {
          text: visibleText,
          streamId,
          ...(images.length > 0 ? { images } : {}),
          ...(apiControlsEnabled ? { config: chatConfig } : {}),
        },
      });
      if (response?.ok === false) {
        throw new Error(response.error || 'Chat request failed.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((prev) => {
        const next = [...prev];
        if (isEmptyAssistantMessage(next[optimisticMessageIndex + 1])) {
          next.splice(optimisticMessageIndex + 1, 1);
        }
        const optimistic = next[optimisticMessageIndex];
        if (optimistic?.role === 'user' && optimistic.text === visibleText) {
          next.splice(optimisticMessageIndex, 1);
        }
        messagesRef.current = next;
        return next;
      });
      setInputText(text);
      pendingImageSubmissionRef.current = null;
      setImageAttachments(attachments);
      setIsStreaming(false);
      clearStreamWatchdog();
      if (activeStreamIdRef.current === streamId) {
        activeStreamIdRef.current = null;
      }
    }
  };

  const newSession = async () => {
    // Confirm before discarding an in-progress conversation.
    if (messages.length > 0 && !personalConfig.reducedConfirmations) {
      const ok = await confirm({
        title: t('sidepanel.chatPage.newSessionTitle'),
        message: t('sidepanel.chatPage.newSessionConfirm'),
        confirmLabel: t('sidepanel.chatPage.newSession'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
    }
    chrome.runtime.sendMessage({ type: 'CHAT_NEW_SESSION' }).catch(() => {});
    flushAssistantStreamBuffer();
    messagesRef.current = [];
    clearStreamWatchdog();
    activeStreamIdRef.current = null;
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    stopVoiceInput();
    setImageAttachments((prev) => {
      revokeImageAttachmentPreviews(prev);
      return [];
    });
    clearPendingImageSubmission();
    inputRef.current?.focus();
  };

  function startStreamWatchdog(streamId: string) {
    clearStreamWatchdog();
    streamWatchdogRef.current = window.setTimeout(() => {
      if (activeStreamIdRef.current !== streamId) return;
      flushAssistantStreamBuffer();
      finalizeRunningToolEvents(t('sidepanel.chatPage.streamTimeoutToolStatus'));
      restorePendingImageSubmission();
      activeStreamIdRef.current = null;
      setIsStreaming(false);
      setError(t('sidepanel.chatPage.streamTimeout'));
      streamWatchdogRef.current = null;
    }, CHAT_STREAM_WATCHDOG_MS);
  }

  function refreshStreamWatchdog() {
    const activeStreamId = activeStreamIdRef.current;
    if (!activeStreamId) return;
    startStreamWatchdog(activeStreamId);
  }

  function clearStreamWatchdog() {
    if (streamWatchdogRef.current === null) return;
    window.clearTimeout(streamWatchdogRef.current);
    streamWatchdogRef.current = null;
  }

  function finalizeRunningToolEvents(timeoutSummary: string) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role !== 'assistant' || !last.toolEvents?.some((event) => event.status === 'running')) {
        return prev;
      }
      const next = [...prev.slice(0, -1), {
        ...last,
        toolEvents: last.toolEvents.map((event) => event.status === 'running'
          ? { ...event, status: 'error' as const, summary: timeoutSummary }
          : event),
      }];
      messagesRef.current = next;
      return next;
    });
  }

  const retryLast = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setInputText(lastUser.text);
    if (lastUser.attachments?.length) {
      setError('Image attachments must be reselected before retrying.');
    }
    inputRef.current?.focus();
  };

  const handleModelChange = (model: OfficialDeepSeekModel) => {
    if (!apiControlsEnabled || isStreaming) return;
    void saveChatConfig({ model });
  };

  const handleThinkingChange = (thinking: OfficialDeepSeekThinkingMode) => {
    if (!apiControlsEnabled || isStreaming) return;
    void saveChatConfig({ thinking });
  };

  const handleEffortChange = (reasoningEffort: OfficialDeepSeekReasoningEffort) => {
    if (!apiControlsEnabled || isStreaming || chatConfig.thinking !== 'enabled') return;
    void saveChatConfig({ reasoningEffort });
  };

  const startVoiceInput = () => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition || isListening) return;

    const recognition = new Recognition();
    recognition.lang = navigator.language || 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results as ArrayLike<SpeechRecognitionResultLike>)
        .map((result) => result[0]?.transcript ?? '')
        .join('')
        .trim();
      if (transcript) setInputText(transcript);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const stopVoiceInput = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const files = getImageFilesFromTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    addImageFiles(files, 'paste');
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (getImageFilesFromTransfer(event.dataTransfer).length === 0) return;
    event.preventDefault();
    setIsDraggingImages(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDraggingImages(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    const files = getImageFilesFromTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    setIsDraggingImages(false);
    addImageFiles(files, 'drop');
  };

  const captureCurrentTab = async () => {
    if (isStreaming || isCapturingTab) return;
    if (!imageUploadEnabled) {
      setError(t('sidepanel.chatPage.imageAuthRequired'));
      return;
    }

    setIsCapturingTab(true);
    try {
      if (!(await ensureCurrentTabCapturePermission())) {
        throw new Error(t('sidepanel.chatPage.captureCurrentTabFailed'));
      }
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_CURRENT_TAB_IMAGE',
      }) as CaptureCurrentTabImageResponse | undefined;
      if (!response?.ok || !response.image) {
        throw new Error(response?.error || t('sidepanel.chatPage.captureCurrentTabFailed'));
      }
      const file = createDeepSeekWebVisionFileFromSerializedImage(response.image);
      addImageFiles([file], 'capture');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sidepanel.chatPage.captureCurrentTabFailed'));
    } finally {
      setIsCapturingTab(false);
    }
  };

  const captureBrowserControlTarget = async () => {
    if (isStreaming || isCapturingBrowserTarget) return;
    if (!imageUploadEnabled) {
      setError(t('sidepanel.chatPage.imageAuthRequired'));
      return;
    }

    setIsCapturingBrowserTarget(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_BROWSER_CONTROL_TARGET_IMAGE',
      }) as CaptureCurrentTabImageResponse | undefined;
      if (!response?.ok || !response.image) {
        throw new Error(response?.error || t('sidepanel.chatPage.captureBrowserTargetFailed'));
      }
      const file = createDeepSeekWebVisionFileFromSerializedImage(response.image);
      addImageFiles([file], 'browser-control');
      if (!inputText.trim()) {
        setInputText(t('sidepanel.chatPage.browserViewPrompt'));
      }
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sidepanel.chatPage.captureBrowserTargetFailed'));
    } finally {
      setIsCapturingBrowserTarget(false);
    }
  };

  const addImageFiles = (
    files: FileList | File[] | null | undefined,
    source: ChatImageAttachmentSource,
  ) => {
    const candidates = Array.from(files ?? []);
    if (candidates.length === 0 || isStreaming) return;
    if (!imageUploadEnabled) {
      setError(t('sidepanel.chatPage.imageAuthRequired'));
      return;
    }

    const images = candidates.filter((file) =>
      DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase()) &&
      file.size > 0 &&
      file.size <= DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES
    );
    if (images.length === 0) {
      setError(t('sidepanel.chatPage.imageInvalid'));
      return;
    }

    const remaining = DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN - imageAttachments.length;
    if (remaining <= 0) {
      setError(t('sidepanel.chatPage.imageLimit', { count: DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN }));
      return;
    }

    const selected = images.slice(0, remaining);
    if (images.length > remaining) {
      setError(t('sidepanel.chatPage.imageLimit', { count: DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN }));
    } else {
      setError(null);
    }
    setImageAttachments((prev) => [
      ...prev,
      ...selected.map((file) => createImageAttachment(file, source)),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImageAttachment = (id: string) => {
    setImageAttachments((prev) => {
      const removed = prev.filter((attachment) => attachment.id === id);
      revokeImageAttachmentPreviews(removed);
      return prev.filter((attachment) => attachment.id !== id);
    });
  };

  const cycleSessionStrategy = async () => {
    const index = SESSION_STRATEGY_SEQUENCE.indexOf(personalConfig.sameSessionStrategy);
    const sameSessionStrategy = SESSION_STRATEGY_SEQUENCE[(index + 1) % SESSION_STRATEGY_SEQUENCE.length];
    const optimistic = normalizePersonalConvenienceConfig({ ...personalConfig, sameSessionStrategy });
    setPersonalConfig(optimistic);
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'SAVE_PERSONAL_CONVENIENCE_CONFIG',
        payload: { sameSessionStrategy },
      });
      setPersonalConfig(normalizePersonalConvenienceConfig(result?.config ?? optimistic));
    } catch {
      setPersonalConfig(personalConfig);
    }
  };

  const clearPendingImageSubmission = () => {
    const pending = pendingImageSubmissionRef.current;
    if (!pending) return;
    revokeImageAttachmentPreviews(pending.attachments);
    pendingImageSubmissionRef.current = null;
  };

  const restorePendingImageSubmission = () => {
    const pending = pendingImageSubmissionRef.current;
    if (!pending) return;
    pendingImageSubmissionRef.current = null;
    setMessages((prev) => {
      const next = [...prev];
      if (isEmptyAssistantMessage(next[pending.optimisticMessageIndex + 1])) {
        next.splice(pending.optimisticMessageIndex + 1, 1);
      }
      const optimistic = next[pending.optimisticMessageIndex];
      if (optimistic?.role === 'user' && optimistic.text === pending.visibleText) {
        next.splice(pending.optimisticMessageIndex, 1);
      }
      messagesRef.current = next;
      return next;
    });
    setInputText(pending.inputText);
    setImageAttachments(pending.attachments);
  };

  if (authStatus?.available === false) {
    return (
      <div className="ds-chat-auth-empty">
        <p className="text-sm mb-3" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.chatPage.authRequired')}
        </p>
        <p className="text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.chatPage.authHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="ds-chat-page">
      <header className="ds-chat-header">
        <div className="ds-chat-header-top">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--ds-text)' }}>
                {t('sidepanel.chatPage.title')}
              </span>
              <ProviderBadge provider={authStatus?.provider ?? null} />
              {authStatus?.provider === 'deepseek-web' && (
                <button
                  type="button"
                  className="ds-chat-provider-badge"
                  title={t('sidepanel.chatPage.changeSessionStrategy')}
                  aria-label={t('sidepanel.chatPage.changeSessionStrategy')}
                  disabled={isStreaming}
                  onClick={() => void cycleSessionStrategy()}
                >
                  {formatSessionStrategy(personalConfig.sameSessionStrategy, t)}
                </button>
              )}
            </div>
            <p className="ds-chat-subtitle">
              {apiControlsEnabled
                ? t('sidepanel.chatPage.apiDescription')
                : t('sidepanel.chatPage.webDescription')}
            </p>
          </div>

          <div className="ds-chat-header-actions">
            {voiceSettings.readAloudEnabled && voiceCapabilities.speechSynthesis && (
              <button
                type="button"
                onClick={() => speakLatestAssistant(messagesRef.current, voiceSettings)}
                className="ds-chat-text-button"
                title={t('sidepanel.chatPage.readLatest')}
              >
                {t('sidepanel.chatPage.read')}
              </button>
            )}
            <button
              type="button"
              onClick={newSession}
              className="ds-chat-icon-button"
              title={t('sidepanel.chatPage.newSessionTitle')}
              aria-label={t('sidepanel.chatPage.newSessionTitle')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>

        {apiControlsEnabled && (
          <div className="ds-chat-config-panel">
            <div className="ds-chat-control-group" aria-label={t('sidepanel.chatPage.modelLabel')}>
              {MODEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={isStreaming}
                  onClick={() => handleModelChange(option.value)}
                  className={`ds-chat-segment${chatConfig.model === option.value ? ' ds-chat-segment-active' : ''}`}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>

            <div className="ds-chat-control-row">
              <div className="ds-chat-control-group" aria-label={t('sidepanel.chatPage.thinkingLabel')}>
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={() => handleThinkingChange('disabled')}
                  className={`ds-chat-segment${chatConfig.thinking === 'disabled' ? ' ds-chat-segment-active' : ''}`}
                >
                  {t('sidepanel.chatPage.thinkingOff')}
                </button>
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={() => handleThinkingChange('enabled')}
                  className={`ds-chat-segment${chatConfig.thinking === 'enabled' ? ' ds-chat-segment-active' : ''}`}
                >
                  {t('sidepanel.chatPage.thinkingOn')}
                </button>
              </div>

              <select
                value={chatConfig.reasoningEffort}
                disabled={isStreaming || chatConfig.thinking !== 'enabled'}
                onChange={(e) => handleEffortChange(e.target.value as OfficialDeepSeekReasoningEffort)}
                className="ds-chat-effort-select"
                title={t('sidepanel.chatPage.effortLabel')}
                aria-label={t('sidepanel.chatPage.effortLabel')}
              >
                {EFFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </header>

      <div ref={listRef} className="ds-chat-messages" onScroll={handleMessageListScroll}>
        {confirmNode}

        {messages.length === 0 && !isStreaming && (
          <div className="ds-chat-empty">
            <div className="ds-empty-state-icon">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="ds-empty-state-title">{t('sidepanel.chatPage.empty')}</div>
            <div className="ds-empty-state-description">{t('sidepanel.chatPage.emptyHelp')}</div>
          </div>
        )}

        {messages.map((msg, index) => (
          <ChatMessage
            key={`${msg.role}-${index}-${msgSeq}`}
            message={msg}
            isStreaming={isStreaming && index === messages.length - 1 && msg.role === 'assistant'}
          />
        ))}

        {error && (
          <div className="ds-chat-error-wrap">
            <StatusMessage tone="error">
              {error}
              <button
                type="button"
                onClick={retryLast}
                className="ml-2 underline opacity-80 hover:opacity-100"
              >
                {t('common.retry')}
              </button>
            </StatusMessage>
          </div>
        )}
      </div>

      <footer className="ds-chat-composer-wrap">
        <div
          className={`ds-chat-composer${isDraggingImages ? ' ds-chat-composer-drop-active' : ''}`}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(event) => addImageFiles(event.currentTarget.files, 'picker')}
          />
          {imageAttachments.length > 0 && (
            <div className="ds-chat-attachment-tray" aria-label={t('sidepanel.chatPage.attachmentsLabel')}>
              {imageAttachments.map((attachment) => (
                <div key={attachment.id} className="ds-chat-attachment-card">
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    className="ds-chat-attachment-thumb"
                  />
                  <div className="ds-chat-attachment-meta">
                    <span className="ds-chat-attachment-name" title={attachment.name}>
                      {attachment.name}
                    </span>
                    <span className="ds-chat-attachment-size">
                      {formatBytes(attachment.sizeBytes)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeImageAttachment(attachment.id)}
                    aria-label={t('sidepanel.chatPage.removeImage', { name: attachment.name })}
                    title={t('sidepanel.chatPage.removeImage', { name: attachment.name })}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('sidepanel.chatPage.inputPlaceholder')}
            rows={1}
            className="ds-chat-input"
          />
          <div className="ds-chat-composer-actions">
            <span className="ds-chat-current-config">
              {apiControlsEnabled
                ? getConfigLabel(chatConfig, t)
                : t('sidepanel.chatPage.webProvider')}
            </span>
            <div className="ds-chat-composer-buttons">
              {imageUploadEnabled && (
                <>
                  <button
                    type="button"
                    onClick={captureBrowserControlTarget}
                    className="ds-chat-text-button"
                    disabled={isStreaming || isCapturingBrowserTarget}
                    title={t('sidepanel.chatPage.useBrowserView')}
                    aria-label={t('sidepanel.chatPage.useBrowserView')}
                  >
                    {isCapturingBrowserTarget
                      ? t('sidepanel.chatPage.capturingBrowserView')
                      : t('sidepanel.chatPage.browserView')}
                  </button>
                  <button
                    type="button"
                    onClick={captureCurrentTab}
                    className="ds-chat-mic-button"
                    disabled={isStreaming || isCapturingTab}
                    title={t('sidepanel.chatPage.captureCurrentTab')}
                    aria-label={t('sidepanel.chatPage.captureCurrentTab')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8a2 2 0 012-2h2l1.5-2h5L16 6h2a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13a3 3 0 106 0 3 3 0 00-6 0z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="ds-chat-mic-button"
                    disabled={isStreaming}
                    title={t('sidepanel.chatPage.attachImage')}
                    aria-label={t('sidepanel.chatPage.attachImage')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.5-4.5a2 2 0 012.8 0L16 16" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 14l1.5-1.5a2 2 0 012.8 0L20 14" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5h14v14H5z" />
                    </svg>
                  </button>
                </>
              )}
              {voiceSettings.inputEnabled && voiceCapabilities.speechRecognition && (
                <button
                  type="button"
                  onClick={isListening ? stopVoiceInput : startVoiceInput}
                  className={`ds-chat-mic-button${isListening ? ' ds-chat-mic-button-active' : ''}`}
                  title={isListening ? t('sidepanel.chatPage.stopListening') : t('sidepanel.chatPage.voiceInput')}
                  aria-label={isListening ? t('sidepanel.chatPage.stopListening') : t('sidepanel.chatPage.voiceInput')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4a3 3 0 00-3 3v5a3 3 0 006 0V7a3 3 0 00-3-3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 11a7 7 0 0014 0M12 18v3m-4 0h8" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={sendMessage}
                disabled={isStreaming || (!inputText.trim() && imageAttachments.length === 0)}
                className="ds-chat-send-button"
                title={t('sidepanel.chatPage.send')}
                aria-label={t('sidepanel.chatPage.send')}
              >
                {isStreaming ? (
                  <span className="ds-chat-send-dots" aria-hidden="true">...</span>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0-6 6m6-6 6 6" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function serializeImageAttachment(attachment: ChatImageAttachment): Promise<DeepSeekWebVisionSerializedImage> {
  return serializeDeepSeekWebVisionFile(attachment.file);
}

function createImageAttachment(file: File, source: ChatImageAttachmentSource): ChatImageAttachment {
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name || 'image',
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    source,
  };
}

function revokeImageAttachmentPreviews(attachments: readonly ChatImageAttachment[]) {
  const revoked = new Set<string>();
  for (const attachment of attachments) {
    if (revoked.has(attachment.previewUrl)) continue;
    revoked.add(attachment.previewUrl);
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function getImageFilesFromTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const itemFiles = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === 'file' && DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES.has(item.type.toLowerCase()))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (itemFiles.length > 0) return itemFiles;
  return Array.from(transfer.files ?? []).filter((file) =>
    DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase())
  );
}

async function ensureCurrentTabCapturePermission(): Promise<boolean> {
  if (!chrome.permissions?.contains || !chrome.permissions.request) return true;
  const origins = CURRENT_TAB_CAPTURE_ORIGINS;
  const granted = await chrome.permissions.contains({ origins }).catch(() => false);
  if (granted) return true;
  return chrome.permissions.request({ origins }).catch(() => false);
}

function normalizeAuthStatus(resp: ChatAuthStatus | undefined): ChatAuthStatus {
  return {
    available: resp?.available ?? resp?.hasToken ?? false,
    provider: resp?.provider ?? (resp?.hasToken ? 'deepseek-web' : null),
    hasApiKey: resp?.hasApiKey ?? false,
    hasToken: resp?.hasToken ?? false,
  };
}

function ProviderBadge({ provider }: { provider: ChatProvider }) {
  const { t } = useI18n();
  if (!provider) return null;
  const label = provider === 'official-api'
    ? t('sidepanel.chatPage.apiProvider')
    : t('sidepanel.chatPage.webProvider');
  return <span className="ds-chat-provider-badge">{label}</span>;
}

function formatSessionStrategy(
  strategy: PersonalConvenienceConfig['sameSessionStrategy'],
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (strategy === 'last') return t('sidepanel.chatPage.sessionStrategyLast');
  if (strategy === 'new') return t('sidepanel.chatPage.sessionStrategyNew');
  return t('sidepanel.chatPage.sessionStrategyCurrent');
}

function mergeChatToolEvents(
  current: ChatToolEvent[] | undefined,
  incoming: ChatToolEvent[],
): ChatToolEvent[] {
  const byId = new Map<string, ChatToolEvent>();
  for (const event of current ?? []) {
    byId.set(event.id, event);
  }
  for (const event of incoming) {
    byId.set(event.id, {
      ...byId.get(event.id),
      ...event,
    });
  }
  return Array.from(byId.values());
}

function getConfigLabel(
  config: OfficialApiChatConfig,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const model = config.model === 'deepseek-v4-pro'
    ? t('sidepanel.chatPage.modelPro')
    : t('sidepanel.chatPage.modelFlash');
  if (config.thinking !== 'enabled') {
    return `${model} · ${t('sidepanel.chatPage.thinkingOff')}`;
  }
  const effort = config.reasoningEffort === 'max'
    ? t('sidepanel.chatPage.effortMax')
    : t('sidepanel.chatPage.effortHigh');
  return `${model} · ${t('sidepanel.chatPage.thinkingOn')} · ${effort}`;
}

type SpeechRecognitionResultLike = {
  readonly 0: { transcript?: string };
};

type SpeechRecognitionEventLike = {
  results: Iterable<SpeechRecognitionResultLike> | ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const value = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return value.SpeechRecognition ?? value.webkitSpeechRecognition ?? null;
}

function speakLatestAssistant(messages: ChatMessageType[], settings: VoiceSettings) {
  if (!('speechSynthesis' in window)) return;
  const text = [...messages].reverse().find((message) => message.role === 'assistant')?.text.trim();
  if (!text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = settings.rate;
  utterance.pitch = settings.pitch;
  window.speechSynthesis.speak(utterance);
}
