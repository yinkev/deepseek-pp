import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_OFFICIAL_API_CHAT_CONFIG,
  normalizeOfficialApiChatConfig,
  type OfficialApiChatConfig,
  type OfficialDeepSeekModel,
  type OfficialDeepSeekReasoningEffort,
  type OfficialDeepSeekThinkingMode,
} from '../../../core/chat/official-api-config';
import { setChatEnabled } from '../../../core/chat/store';
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
import type { CurrentDeepSeekConversation, ProjectContextState } from '../../../core/project';
import {
  DEEPSEEK_WEB_VISION_ACCEPTED_IMAGE_TYPES,
  DEEPSEEK_WEB_VISION_MAX_IMAGE_BYTES,
  DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN,
  createDeepSeekWebVisionFileFromSerializedImage,
  serializeDeepSeekWebVisionFile,
  type DeepSeekWebVisionSerializedImage,
} from '../../../core/deepseek/web-vision';
import type { ChatMessage as ChatMessageType, ChatToolEvent, Memory, SavedItem, Skill } from '../../../core/types';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import ChatMessage from '../components/ChatMessage';
import PageIntro from '../components/PageIntro';
import { StatusMessage, useConfirm } from '../components/settings/primitives';
import { consumePendingText, onPendingText } from '../pending-text';
import { useI18n } from '../i18n';
import { useGlobalOperationalContext } from '../global-operational-context';
import type { SidepanelNavigationTarget } from '../navigation';
import { getRuntimeErrorMessage, isRuntimeFailure } from '../runtime-response';

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
  label?: string;
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
  images?: Array<{
    label?: string;
    image?: DeepSeekWebVisionSerializedImage;
  }>;
  skippedNestedScrolls?: number;
  error?: string;
}

export interface ChatHomeContextItem {
  key: string;
  title: string;
  detailKey?: 'sidepanel.chatPage.currentDeepSeekConversation' | 'sidepanel.chatPage.projectConversation' | 'sidepanel.chatPage.recentProject';
  detailText?: string;
  projectId?: string;
}

interface ChatPageProps {
  onNavigate?: (target: SidepanelNavigationTarget) => void;
  chatEnabled?: boolean | null;
}

type ResponseModeValue = `${OfficialDeepSeekModel}:${OfficialDeepSeekThinkingMode}:${OfficialDeepSeekReasoningEffort}`;

const RESPONSE_MODE_OPTIONS: Array<{
  value: ResponseModeValue;
  labelKey:
    | 'sidepanel.chatPage.responseFlashInstant'
    | 'sidepanel.chatPage.responseFlashStandard'
    | 'sidepanel.chatPage.responseFlashMax'
    | 'sidepanel.chatPage.responseProInstant'
    | 'sidepanel.chatPage.responseProStandard'
    | 'sidepanel.chatPage.responseProMax';
}> = [
  { value: 'deepseek-v4-flash:disabled:high', labelKey: 'sidepanel.chatPage.responseFlashInstant' },
  { value: 'deepseek-v4-flash:enabled:high', labelKey: 'sidepanel.chatPage.responseFlashStandard' },
  { value: 'deepseek-v4-flash:enabled:max', labelKey: 'sidepanel.chatPage.responseFlashMax' },
  { value: 'deepseek-v4-pro:disabled:high', labelKey: 'sidepanel.chatPage.responseProInstant' },
  { value: 'deepseek-v4-pro:enabled:high', labelKey: 'sidepanel.chatPage.responseProStandard' },
  { value: 'deepseek-v4-pro:enabled:max', labelKey: 'sidepanel.chatPage.responseProMax' },
];
const STREAM_BUFFER_FLUSH_MS = 32;
const CHAT_STREAM_WATCHDOG_MS = 110_000;
const CURRENT_TAB_CAPTURE_ORIGINS = ['<all_urls>'];
const COMPOSER_SUGGESTION_LIMIT = 8;

type ComposerSuggestionMode = 'slash' | 'context';
type ChatSetupState = 'checking' | 'disabled' | 'needs-setup';
type ChatSetupRowTone = 'neutral' | 'ready' | 'attention' | 'muted';

interface ComposerTrigger {
  mode: ComposerSuggestionMode;
  start: number;
  end: number;
  query: string;
}

interface ComposerSuggestion {
  id: string;
  label: string;
  detail: string;
  insertText?: string;
  action?: () => void | Promise<void>;
}

interface ComposerSuggestionSourceIssue {
  id: string;
  mode: ComposerSuggestionMode;
  label: string;
  message: string;
}

interface ComposerSuggestionData {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  sourceIssues: ComposerSuggestionSourceIssue[];
  skills: Skill[];
  memories: Memory[];
  savedItems: SavedItem[];
  projectState: ProjectContextState | null;
  currentConversation: CurrentDeepSeekConversation | null;
}

const EMPTY_COMPOSER_SUGGESTION_DATA: ComposerSuggestionData = {
  loaded: false,
  loading: false,
  error: null,
  sourceIssues: [],
  skills: [],
  memories: [],
  savedItems: [],
  projectState: null,
  currentConversation: null,
};

export default function ChatPage({ onNavigate, chatEnabled = null }: ChatPageProps = {}) {
  const { t } = useI18n();
  const { projectState, currentConversation } = useGlobalOperationalContext();
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [authStatus, setAuthStatus] = useState<ChatAuthStatus | null>(null);
  const [chatConfig, setChatConfig] = useState<OfficialApiChatConfig>(DEFAULT_OFFICIAL_API_CHAT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [personalConfig, setPersonalConfig] = useState<PersonalConvenienceConfig>(DEFAULT_PERSONAL_CONVENIENCE_CONFIG);
  const [isEnablingChat, setIsEnablingChat] = useState(false);
  const [imageAttachments, setImageAttachments] = useState<ChatImageAttachment[]>([]);
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const [isCapturingTab, setIsCapturingTab] = useState(false);
  const [isCapturingBrowserTarget, setIsCapturingBrowserTarget] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [msgSeq, setMsgSeq] = useState(0);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerCursor, setComposerCursor] = useState(0);
  const [composerData, setComposerData] = useState<ComposerSuggestionData>(EMPTY_COMPOSER_SUGGESTION_DATA);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [dismissedSuggestionKey, setDismissedSuggestionKey] = useState<string | null>(null);
  const { confirm, node: confirmNode } = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestionPanelRef = useRef<HTMLDivElement>(null);
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
  const homeContextItems = createChatHomeContextItems(projectState, currentConversation);
  const composerStatus = apiControlsEnabled
    ? getConfigLabel(chatConfig, t)
    : t('sidepanel.chatPage.webProvider');

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

  useEffect(() => {
    const trigger = getComposerTrigger(inputText, composerCursor);
    if (trigger) void loadComposerSuggestionData();
  }, [inputText, composerCursor]);

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
    const payloadText = createVisionPromptText(visibleText, attachments);
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
          text: payloadText,
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

  const handleResponseModeChange = (value: ResponseModeValue) => {
    if (!apiControlsEnabled || isStreaming) return;
    void saveChatConfig(parseResponseModeValue(value));
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
      const remaining = DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN - imageAttachments.length;
      if (remaining <= 0) {
        throw new Error(t('sidepanel.chatPage.imageLimit', { count: DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN }));
      }
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_BROWSER_CONTROL_TARGET_IMAGE',
      }) as CaptureCurrentTabImageResponse | undefined;
      const captures = normalizeBrowserViewCaptureResponse(response).slice(0, remaining);
      if (!response?.ok || captures.length === 0) {
        throw new Error(response?.error || t('sidepanel.chatPage.captureBrowserTargetFailed'));
      }
      setImageAttachments((prev) => {
        const openSlots = DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN - prev.length;
        if (openSlots <= 0) return prev;
        const selected = captures.slice(0, openSlots);
        return [
          ...prev,
          ...selected.map((capture) =>
            createImageAttachment(createDeepSeekWebVisionFileFromSerializedImage(capture.image), 'browser-control', capture.label)
          ),
        ];
      });
      if (captures.length > remaining || (response.images?.length ?? 0) > remaining) {
        setError(t('sidepanel.chatPage.imageLimit', { count: DEEPSEEK_WEB_VISION_MAX_IMAGES_PER_TURN }));
      } else {
        setError(null);
      }
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

  const composerTrigger = getComposerTrigger(inputText, composerCursor);
  const composerTriggerKey = composerTrigger ? getComposerTriggerKey(composerTrigger) : null;
  const browserSuggestions: ComposerSuggestion[] = imageUploadEnabled
    ? [
      {
        id: 'action-browser-view',
        label: t('sidepanel.chatPage.useBrowserView'),
        detail: t('sidepanel.chatPage.composerSuggestionBrowserViewDetail'),
        action: captureBrowserControlTarget,
      },
      {
        id: 'action-current-tab',
        label: t('sidepanel.chatPage.captureCurrentTab'),
        detail: t('sidepanel.chatPage.composerSuggestionCurrentTabDetail'),
        action: captureCurrentTab,
      },
      {
        id: 'action-attach-image',
        label: t('sidepanel.chatPage.attachImage'),
        detail: t('sidepanel.chatPage.composerSuggestionAttachImageDetail'),
        action: () => fileInputRef.current?.click(),
      },
    ]
    : [];
  const composerSuggestions = createComposerSuggestions(composerTrigger, composerData, browserSuggestions, t);
  const composerSourceIssues = composerTrigger
    ? composerData.sourceIssues.filter((issue) => issue.mode === composerTrigger.mode)
    : [];
  const hasComposerSourceIssues = composerSourceIssues.length > 0;
  const showComposerSuggestions = Boolean(
    composerFocused &&
    composerTrigger &&
    composerTriggerKey !== dismissedSuggestionKey,
  );
  const composerSuggestionListId = 'ds-chat-composer-suggestions';
  const activeSuggestion = showComposerSuggestions
    ? composerSuggestions[activeSuggestionIndex]
    : undefined;
  const activeSuggestionId = showComposerSuggestions && composerSuggestions[activeSuggestionIndex]
    ? `${composerSuggestionListId}-${activeSuggestionIndex}`
    : undefined;

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [composerTriggerKey]);

  useEffect(() => {
    if (activeSuggestionIndex >= composerSuggestions.length) {
      setActiveSuggestionIndex(0);
    }
  }, [activeSuggestionIndex, composerSuggestions.length]);

  async function loadComposerSuggestionData(force = false) {
    if (!force && (composerData.loaded || composerData.loading)) return;
    setComposerData((current) => ({
      ...current,
      loaded: force ? false : current.loaded,
      loading: true,
      error: null,
      sourceIssues: force ? [] : current.sourceIssues,
    }));
    try {
      const [
        skillsResult,
        memoriesResult,
        savedItemsResult,
        projectStateResult,
        currentConversationResult,
      ] = await Promise.allSettled([
        chrome.runtime.sendMessage({ type: 'GET_SKILL_LIBRARY' }),
        chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }),
        chrome.runtime.sendMessage({ type: 'GET_SAVED_ITEMS' }),
        chrome.runtime.sendMessage({ type: 'GET_PROJECT_CONTEXT_STATE' }),
        chrome.runtime.sendMessage({ type: 'GET_CURRENT_DEEPSEEK_CONVERSATION' }),
      ]);
      const sourceIssues: ComposerSuggestionSourceIssue[] = [];
      const skills = readComposerArraySource<Skill>(
        skillsResult,
        'skills',
        'slash',
        t('sidepanel.chatPage.composerSuggestionSourceCommands'),
        sourceIssues,
        t,
      );
      const memories = readComposerArraySource<Memory>(
        memoriesResult,
        'memories',
        'context',
        t('sidepanel.chatPage.composerSuggestionSourceMemory'),
        sourceIssues,
        t,
      );
      const savedItems = readComposerArraySource<SavedItem>(
        savedItemsResult,
        'saved',
        'context',
        t('sidepanel.chatPage.composerSuggestionSourceSaved'),
        sourceIssues,
        t,
      );
      const loadedProjectState = readComposerOptionalSource<ProjectContextState>(
        projectStateResult,
        'projects',
        'context',
        t('sidepanel.chatPage.composerSuggestionSourceProjects'),
        isComposerProjectState,
        sourceIssues,
        t,
      );
      const loadedCurrentConversation = readComposerConversationSource(
        currentConversationResult,
        sourceIssues,
        t,
      );
      setComposerData({
        loaded: true,
        loading: false,
        error: null,
        sourceIssues,
        skills: Array.isArray(skills) ? skills.filter(isComposerSkill) : [],
        memories: Array.isArray(memories) ? memories.filter(isComposerMemory) : [],
        savedItems: Array.isArray(savedItems) ? savedItems.filter(isComposerSavedItem) : [],
        projectState: loadedProjectState ?? projectState,
        currentConversation: loadedCurrentConversation ?? currentConversation,
      });
    } catch (error) {
      setComposerData((current) => ({
        ...current,
        loaded: true,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        sourceIssues: [],
      }));
    }
  }

  function retryComposerSuggestionData() {
    void loadComposerSuggestionData(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleComposerRetryKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    retryComposerSuggestionData();
  }

  function syncComposerCursor(textarea: HTMLTextAreaElement | null = inputRef.current) {
    setComposerCursor(textarea?.selectionStart ?? inputText.length);
  }

  function handleComposerChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputText(event.target.value);
    setComposerCursor(event.target.selectionStart ?? event.target.value.length);
    setDismissedSuggestionKey(null);
  }

  function handleComposerFocus(event: React.FocusEvent<HTMLTextAreaElement>) {
    setComposerFocused(true);
    setComposerCursor(event.target.selectionStart ?? event.target.value.length);
  }

  function handleComposerBlur(event: React.FocusEvent<HTMLTextAreaElement>) {
    if (
      event.relatedTarget instanceof Node &&
      suggestionPanelRef.current?.contains(event.relatedTarget)
    ) {
      return;
    }
    setComposerFocused(false);
  }

  function selectComposerSuggestion(suggestion: ComposerSuggestion) {
    if (suggestion.action) {
      const next = composerTrigger
        ? replaceComposerTrigger(inputText, composerTrigger, '')
        : { text: inputText, cursor: composerCursor };
      const nextText = suggestion.id === 'action-browser-view' && !next.text.trim()
        ? t('sidepanel.chatPage.browserViewPrompt')
        : next.text;
      setInputText(nextText);
      setComposerCursor(Math.min(next.cursor, nextText.length));
      setComposerFocused(false);
      void suggestion.action();
      return;
    }
    if (!composerTrigger || !suggestion.insertText) return;
    const next = replaceComposerTrigger(inputText, composerTrigger, suggestion.insertText);
    setInputText(next.text);
    setComposerCursor(next.cursor);
    setDismissedSuggestionKey(null);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showComposerSuggestions && composerTrigger) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIndex((current) =>
          composerSuggestions.length === 0 ? 0 : (current + 1) % composerSuggestions.length
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIndex((current) =>
          composerSuggestions.length === 0
            ? 0
            : (current - 1 + composerSuggestions.length) % composerSuggestions.length
        );
        return;
      }
      if (e.key === 'Enter' && composerSuggestions[activeSuggestionIndex]) {
        e.preventDefault();
        selectComposerSuggestion(composerSuggestions[activeSuggestionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedSuggestionKey(getComposerTriggerKey(composerTrigger));
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

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

  const enableSidepanelChat = async () => {
    if (isEnablingChat) return;
    setIsEnablingChat(true);
    setError(null);
    try {
      await setChatEnabled(true);
    } catch {
      setError(t('sidepanel.chatPage.enableSidepanelChatFailed'));
    } finally {
      setIsEnablingChat(false);
    }
  };

  const renderRoutePanel = ({
    state,
    ariaLabel,
    title,
    description,
    rows,
    primaryAction,
    secondaryAction,
    showRecentContext = false,
  }: {
    state: ChatSetupState;
    ariaLabel: string;
    title: string;
    description: string;
    rows: Array<{ label: string; value: string; tone?: ChatSetupRowTone; loading?: boolean }>;
    primaryAction?: { label: string; onClick: () => void; disabled?: boolean };
    secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
    showRecentContext?: boolean;
  }) => {
    const statusBadge = state === 'checking'
      ? t('sidepanel.chatPage.statusChecking')
      : state === 'disabled'
        ? t('sidepanel.chatPage.sidepanelChatOff')
        : t('sidepanel.chatPage.setupNeedsSetup');

    return (
      <div className="ds-chat-page">
        <main className="ds-chat-setup">
          <Card
            size="sm"
            className="ds-chat-setup-card"
            data-state={state}
            aria-label={ariaLabel}
          >
            <CardHeader className="ds-chat-setup-header">
              <CardTitle className="ds-chat-setup-title">{title}</CardTitle>
              <CardDescription className="ds-chat-setup-description">
                {description}
              </CardDescription>
              <CardAction>
                <Badge
                  variant={state === 'needs-setup' ? 'outline' : 'secondary'}
                  className="ds-chat-setup-state-badge"
                >
                  {statusBadge}
                </Badge>
              </CardAction>
            </CardHeader>

            <CardContent className="ds-chat-setup-content">
              <div className="ds-chat-setup-status" aria-label={t('sidepanel.chatPage.routeStatus')}>
                {rows.map((row) => (
                  <div key={row.label} className="ds-chat-setup-status-row">
                    <span>{row.label}</span>
                    {row.loading ? (
                      <strong className="ds-chat-setup-status-loading">
                        <Skeleton className="ds-chat-setup-skeleton" aria-hidden="true" />
                        <span>{row.value}</span>
                      </strong>
                    ) : (
                      <Badge
                        variant={row.tone === 'attention' ? 'outline' : 'secondary'}
                        className="ds-chat-setup-status-badge"
                        data-tone={row.tone ?? 'neutral'}
                      >
                        {row.value}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
              {error && <StatusMessage tone="error">{error}</StatusMessage>}
            </CardContent>

            {(primaryAction || secondaryAction) && (
              <CardFooter className="ds-chat-setup-actions">
                {primaryAction && (
                  <Button
                    type="button"
                    onClick={primaryAction.onClick}
                    disabled={primaryAction.disabled}
                    className="ds-chat-setup-button"
                    size="sm"
                  >
                    {primaryAction.label}
                  </Button>
                )}
                {secondaryAction && (
                  <Button
                    type="button"
                    onClick={secondaryAction.onClick}
                    disabled={secondaryAction.disabled}
                    className="ds-chat-setup-button"
                    variant="outline"
                    size="sm"
                  >
                    {secondaryAction.label}
                  </Button>
                )}
              </CardFooter>
            )}
          </Card>

          {showRecentContext && homeContextItems.length > 0 && (
            <section className="ds-chat-home-context" aria-label={t('sidepanel.chatPage.recentContextLabel')}>
              <div className="ds-chat-home-context-header">
                <div>
                  <h2>{t('sidepanel.chatPage.recentContextTitle')}</h2>
                  <p>{t('sidepanel.chatPage.recentContextDescription')}</p>
                </div>
              </div>
              <div className="ds-chat-home-context-list">
                {homeContextItems.map((item) => {
                  const detail = item.detailText ?? (item.detailKey ? t(item.detailKey) : '');
                  return (
                    <div key={item.key} className="ds-chat-home-context-row">
                      <strong>{item.title}</strong>
                      <span>{detail}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </main>
      </div>
    );
  };

  if (chatEnabled === false) {
    const webValue = authStatus === null
      ? t('sidepanel.chatPage.statusChecking')
      : authStatus.hasToken
        ? t('sidepanel.chatPage.signedIn')
        : t('sidepanel.chatPage.notSignedIn');
    const apiValue = authStatus === null
      ? t('sidepanel.chatPage.statusChecking')
      : authStatus.hasApiKey
        ? t('sidepanel.chatPage.configured')
        : t('sidepanel.chatPage.notConfigured');
    return renderRoutePanel({
      state: 'disabled',
      ariaLabel: t('sidepanel.chatPage.chatDisabledTitle'),
      title: t('sidepanel.chatPage.chatDisabledTitle'),
      description: t('sidepanel.chatPage.chatDisabledDescription'),
      rows: [
        { label: t('sidepanel.chatPage.sidepanelChat'), value: t('sidepanel.chatPage.sidepanelChatOff'), tone: 'attention' },
        { label: t('sidepanel.chatPage.webSession'), value: webValue, tone: authStatus?.hasToken ? 'ready' : 'muted', loading: authStatus === null },
        { label: t('sidepanel.chatPage.apiKey'), value: apiValue, tone: authStatus?.hasApiKey ? 'ready' : 'muted', loading: authStatus === null },
      ],
      primaryAction: {
        label: isEnablingChat ? t('sidepanel.chatPage.statusChecking') : t('sidepanel.chatPage.enableSidepanelChat'),
        onClick: enableSidepanelChat,
        disabled: isEnablingChat,
      },
      secondaryAction: onNavigate
        ? {
          label: t('sidepanel.chatPage.apiSettings'),
          onClick: () => onNavigate({ tab: 'settings', settingsSubTab: 'api' }),
        }
        : undefined,
      showRecentContext: true,
    });
  }

  if (authStatus === null) {
    return renderRoutePanel({
      state: 'checking',
      ariaLabel: t('sidepanel.chatPage.setupCheckingTitle'),
      title: t('sidepanel.chatPage.setupCheckingTitle'),
      description: t('sidepanel.chatPage.setupCheckingDescription'),
      rows: [
        { label: t('sidepanel.chatPage.webSession'), value: t('sidepanel.chatPage.statusChecking'), loading: true },
        { label: t('sidepanel.chatPage.apiKey'), value: t('sidepanel.chatPage.statusChecking'), loading: true },
      ],
    });
  }

  if (authStatus.available === false) {
    return renderRoutePanel({
      state: 'needs-setup',
      ariaLabel: t('sidepanel.chatPage.setupTitle'),
      title: t('sidepanel.chatPage.setupTitle'),
      description: t('sidepanel.chatPage.setupDescription'),
      rows: [
        {
          label: t('sidepanel.chatPage.webSession'),
          value: authStatus.hasToken ? t('sidepanel.chatPage.signedIn') : t('sidepanel.chatPage.notSignedIn'),
          tone: authStatus.hasToken ? 'ready' : 'attention',
        },
        {
          label: t('sidepanel.chatPage.apiKey'),
          value: authStatus.hasApiKey ? t('sidepanel.chatPage.configured') : t('sidepanel.chatPage.notConfigured'),
          tone: authStatus.hasApiKey ? 'ready' : 'attention',
        },
      ],
      primaryAction: {
        label: t('sidepanel.chatPage.openDeepSeek'),
        onClick: () => chrome.tabs?.create?.({ url: 'https://chat.deepseek.com/', active: true }),
      },
      secondaryAction: onNavigate
        ? {
          label: t('sidepanel.chatPage.apiSettings'),
          onClick: () => onNavigate({ tab: 'settings', settingsSubTab: 'api' }),
        }
        : undefined,
      showRecentContext: true,
    });
  }

  return (
    <div className="ds-chat-page">
      <header className="ds-chat-header">
        <PageIntro
          title={t('sidepanel.chatPage.title')}
          description={apiControlsEnabled
            ? t('sidepanel.chatPage.apiDescription')
            : t('sidepanel.chatPage.webDescription')}
          meta={composerStatus}
          actions={(
            <>
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
            </>
          )}
        />

        {apiControlsEnabled && (
          <div className="ds-chat-mode-panel" aria-label={t('sidepanel.chatPage.modeStripLabel')}>
            <label className="ds-chat-mode-field">
              <span className="ds-chat-mode-label">
                {t('sidepanel.chatPage.responseModeLabel')}
              </span>
              <NativeSelect
                value={getResponseModeValue(chatConfig)}
                disabled={isStreaming}
                onChange={(e) => handleResponseModeChange(e.target.value as ResponseModeValue)}
                className="ds-chat-mode-select"
                aria-label={t('sidepanel.chatPage.responseModeLabel')}
                title={t('sidepanel.chatPage.responseModeLabel')}
              >
                {RESPONSE_MODE_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          </div>
        )}
      </header>

      <div ref={listRef} className="ds-chat-messages" onScroll={handleMessageListScroll}>
        {confirmNode}

        {messages.length === 0 && !isStreaming && (
          <HomeContextPanel
            items={homeContextItems}
            onNavigate={onNavigate}
          />
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
          <Textarea
            ref={inputRef}
            value={inputText}
            onChange={handleComposerChange}
            onKeyDown={handleKeyDown}
            onKeyUp={(event) => syncComposerCursor(event.currentTarget)}
            onClick={(event) => syncComposerCursor(event.currentTarget)}
            onSelect={(event) => syncComposerCursor(event.currentTarget)}
            onFocus={handleComposerFocus}
            onBlur={handleComposerBlur}
            aria-label={t('sidepanel.chatPage.inputLabel')}
            aria-autocomplete="list"
            aria-controls={showComposerSuggestions ? composerSuggestionListId : undefined}
            aria-expanded={showComposerSuggestions}
            aria-activedescendant={activeSuggestionId}
            placeholder={t('sidepanel.chatPage.inputPlaceholder')}
            rows={1}
            className="ds-chat-input"
          />
          {showComposerSuggestions && composerTrigger && (
            <div
              ref={suggestionPanelRef}
              className="ds-chat-suggestion-panel"
            >
              <Command
                id={composerSuggestionListId}
                role="listbox"
                aria-label={composerTrigger.mode === 'slash'
                  ? t('sidepanel.chatPage.composerSuggestionCommandsLabel')
                  : t('sidepanel.chatPage.composerSuggestionContextLabel')}
                shouldFilter={false}
                value={activeSuggestion?.id ?? ''}
                onValueChange={(value) => {
                  const nextIndex = composerSuggestions.findIndex((suggestion) => suggestion.id === value);
                  if (nextIndex >= 0) setActiveSuggestionIndex(nextIndex);
                }}
                className="ds-chat-suggestion-command"
              >
                <div className="ds-chat-suggestion-header">
                  <span>
                    {composerTrigger.mode === 'slash'
                      ? t('sidepanel.chatPage.composerSuggestionCommandsTitle')
                      : t('sidepanel.chatPage.composerSuggestionContextTitle')}
                  </span>
                  {composerData.loading && (
                    <span>{t('sidepanel.chatPage.composerSuggestionLoading')}</span>
                  )}
                </div>
                {composerData.error ? (
                  <Alert className="ds-chat-suggestion-source-issue">
                    <AlertTitle>{t('sidepanel.chatPage.composerSuggestionLoadFailed')}</AlertTitle>
                    <AlertDescription>{composerData.error}</AlertDescription>
                    <AlertAction>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onMouseDown={(event) => event.preventDefault()}
                        onKeyDown={handleComposerRetryKeyDown}
                        onClick={retryComposerSuggestionData}
                      >
                        {t('common.retry')}
                      </Button>
                    </AlertAction>
                  </Alert>
                ) : (
                  <>
                    {hasComposerSourceIssues && (
                      <Alert className="ds-chat-suggestion-source-issue">
                        <AlertTitle>{t('sidepanel.chatPage.composerSuggestionSourcesNeedRefresh')}</AlertTitle>
                        <AlertDescription>
                          <span>{t('sidepanel.chatPage.composerSuggestionSourcesNeedRefreshDescription')}</span>
                        </AlertDescription>
                        <AlertAction>
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onMouseDown={(event) => event.preventDefault()}
                            onKeyDown={handleComposerRetryKeyDown}
                            onClick={retryComposerSuggestionData}
                          >
                            {t('common.retry')}
                          </Button>
                        </AlertAction>
                        <div className="ds-chat-suggestion-source-list">
                          {composerSourceIssues.map((issue) => (
                            <div key={issue.id} className="ds-chat-suggestion-source-row">
                              <strong>{issue.label}</strong>
                              <span>{issue.message}</span>
                            </div>
                          ))}
                        </div>
                      </Alert>
                    )}
                    <CommandList className="ds-chat-suggestion-list">
                      {composerSuggestions.length > 0 ? (
                        <CommandGroup className="ds-chat-suggestion-group">
                          {composerSuggestions.map((suggestion, index) => (
                            <CommandItem
                              key={suggestion.id}
                              ref={(node) => {
                                if (node) node.id = `${composerSuggestionListId}-${index}`;
                              }}
                              id={`${composerSuggestionListId}-${index}`}
                              value={suggestion.id}
                              className={`ds-chat-suggestion-option${index === activeSuggestionIndex ? ' ds-chat-suggestion-option-active' : ''}`}
                              onMouseDown={(event) => event.preventDefault()}
                              onSelect={() => selectComposerSuggestion(suggestion)}
                            >
                              <span>{suggestion.label}</span>
                              <small>{suggestion.detail}</small>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ) : !hasComposerSourceIssues && (
                        <CommandEmpty className="ds-chat-suggestion-empty">
                          {composerTrigger.mode === 'slash'
                            ? t('sidepanel.chatPage.composerSuggestionNoCommands')
                            : t('sidepanel.chatPage.composerSuggestionNoContext')}
                        </CommandEmpty>
                      )}
                    </CommandList>
                  </>
                )}
              </Command>
            </div>
          )}
          <div className="ds-chat-composer-actions">
            <span className="ds-chat-composer-status">{composerStatus}</span>
            <div className="ds-chat-composer-buttons">
              {imageUploadEnabled && (
                <>
                  <Button
                    type="button"
                    onClick={captureBrowserControlTarget}
                    variant="outline"
                    size="icon"
                    className="ds-chat-mic-button"
                    disabled={isStreaming || isCapturingBrowserTarget}
                    title={t('sidepanel.chatPage.useBrowserView')}
                    aria-label={t('sidepanel.chatPage.useBrowserView')}
                    aria-busy={isCapturingBrowserTarget}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <rect x="4" y="5" width="16" height="11" rx="2" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 20h8M12 16v4" />
                    </svg>
                  </Button>
                  <Button
                    type="button"
                    onClick={captureCurrentTab}
                    variant="outline"
                    size="icon"
                    className="ds-chat-mic-button"
                    disabled={isStreaming || isCapturingTab}
                    title={t('sidepanel.chatPage.captureCurrentTab')}
                    aria-label={t('sidepanel.chatPage.captureCurrentTab')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8a2 2 0 012-2h2l1.5-2h5L16 6h2a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13a3 3 0 106 0 3 3 0 00-6 0z" />
                    </svg>
                  </Button>
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    variant="outline"
                    size="icon"
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
                  </Button>
                </>
              )}
              {voiceSettings.inputEnabled && voiceCapabilities.speechRecognition && (
                <Button
                  type="button"
                  onClick={isListening ? stopVoiceInput : startVoiceInput}
                  variant="outline"
                  size="icon"
                  className={`ds-chat-mic-button${isListening ? ' ds-chat-mic-button-active' : ''}`}
                  title={isListening ? t('sidepanel.chatPage.stopListening') : t('sidepanel.chatPage.voiceInput')}
                  aria-label={isListening ? t('sidepanel.chatPage.stopListening') : t('sidepanel.chatPage.voiceInput')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4a3 3 0 00-3 3v5a3 3 0 006 0V7a3 3 0 00-3-3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 11a7 7 0 0014 0M12 18v3m-4 0h8" />
                  </svg>
                </Button>
              )}
              <Button
                type="button"
                onClick={sendMessage}
                disabled={isStreaming || (!inputText.trim() && imageAttachments.length === 0)}
                size="icon"
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
              </Button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function HomeContextPanel({
  items,
  onNavigate,
}: {
  items: ChatHomeContextItem[];
  onNavigate?: (target: SidepanelNavigationTarget) => void;
}) {
  const { t } = useI18n();
  const hasContext = items.length > 0;
  const currentItems = items.filter((item) => item.detailKey === 'sidepanel.chatPage.currentDeepSeekConversation');
  const recentItems = items.filter((item) => item.detailKey !== 'sidepanel.chatPage.currentDeepSeekConversation');
  const groups = [
    { key: 'current', label: t('sidepanel.chatPage.homeCurrentGroup'), items: currentItems },
    { key: 'recent', label: t('sidepanel.chatPage.homeRecentGroup'), items: recentItems },
  ].filter((group) => group.items.length > 0);

  const renderContextRow = (item: ChatHomeContextItem) => {
    const detail = item.detailText ?? (item.detailKey ? t(item.detailKey) : '');
    const rowContent = (
      <>
        <strong>{item.title}</strong>
        <span>{detail}</span>
      </>
    );
    if (item.projectId && onNavigate) {
      return (
        <button
          key={item.key}
          type="button"
          className="ds-chat-home-context-row ds-chat-home-context-row-action"
          onClick={() => onNavigate({ tab: 'projects', projectId: item.projectId })}
        >
          {rowContent}
        </button>
      );
    }
    return (
      <div key={item.key} className="ds-chat-home-context-row">
        {rowContent}
      </div>
    );
  };

  return (
    <section className="ds-chat-home-context" aria-label={t('sidepanel.chatPage.recentContextLabel')}>
      <div className="ds-chat-home-context-header">
        <div>
          <h2>
            {hasContext
              ? t('sidepanel.chatPage.recentContextTitle')
              : t('sidepanel.chatPage.homeEmptyTitle')}
          </h2>
          <p>
            {hasContext
              ? t('sidepanel.chatPage.recentContextDescription')
              : t('sidepanel.chatPage.homeEmptyDescription')}
          </p>
        </div>
      </div>

      {hasContext ? (
        <div className="ds-chat-home-context-groups">
          {groups.map((group) => (
            <div key={group.key} className="ds-chat-home-context-group">
              {groups.length > 1 && (
                <span className="ds-chat-home-context-group-label">{group.label}</span>
              )}
              <div className="ds-chat-home-context-list">
                {group.items.map(renderContextRow)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        onNavigate && (
          <div className="ds-chat-home-actions">
            <button
              type="button"
              className="ds-btn-secondary ds-chat-home-action"
              onClick={() => onNavigate({ tab: 'projects' })}
            >
              {t('sidepanel.chatPage.homeProjectsAction')}
            </button>
            <button
              type="button"
              className="ds-btn-secondary ds-chat-home-action"
              onClick={() => onNavigate({ tab: 'skills' })}
            >
              {t('sidepanel.chatPage.homeSkillsAction')}
            </button>
          </div>
        )
      )}
    </section>
  );
}

function serializeImageAttachment(attachment: ChatImageAttachment): Promise<DeepSeekWebVisionSerializedImage> {
  return serializeDeepSeekWebVisionFile(attachment.file);
}

function createImageAttachment(file: File, source: ChatImageAttachmentSource, label?: string): ChatImageAttachment {
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name || 'image',
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    source,
    ...(label ? { label } : {}),
  };
}

function createVisionPromptText(baseText: string, attachments: readonly ChatImageAttachment[]): string {
  const browserViewLabels = attachments
    .filter((attachment) => attachment.source === 'browser-control' && attachment.label)
    .map((attachment, index) => `${index + 1}. ${attachment.label}`);
  if (browserViewLabels.length === 0) return baseText;
  return [
    'Browser view evidence attached:',
    ...browserViewLabels,
    '',
    baseText,
  ].join('\n');
}

function normalizeBrowserViewCaptureResponse(
  response: CaptureCurrentTabImageResponse | undefined,
): Array<{ label: string; image: DeepSeekWebVisionSerializedImage }> {
  const captures = Array.isArray(response?.images)
    ? response.images
      .map((item, index) => {
        if (!item?.image) return null;
        return {
          label: item.label?.trim() || `Browser view ${index + 1}`,
          image: item.image,
        };
      })
      .filter((item): item is { label: string; image: DeepSeekWebVisionSerializedImage } => Boolean(item))
    : [];
  if (captures.length > 0) return captures;
  return response?.image
    ? [{ label: 'Browser view', image: response.image }]
    : [];
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

export function createChatHomeContextItems(
  projectState: ProjectContextState | null,
  currentConversation: CurrentDeepSeekConversation | null,
): ChatHomeContextItem[] {
  const items: ChatHomeContextItem[] = [];
  const seenConversations = new Set<string>();
  const seenProjects = new Set<string>();

  const projectNameById = new Map(projectState?.projects.map((project) => [project.id, project.name]) ?? []);

  if (currentConversation) {
    const currentMembership = projectState?.conversations.find(
      (conversation) => conversation.conversationId === currentConversation.conversationId,
    );
    seenConversations.add(currentConversation.conversationId);
    if (currentMembership) seenProjects.add(currentMembership.projectId);
    items.push({
      key: `current-${currentConversation.conversationId}`,
      title: currentConversation.title || currentConversation.url,
      detailText: currentMembership ? projectNameById.get(currentMembership.projectId) : undefined,
      detailKey: 'sidepanel.chatPage.currentDeepSeekConversation',
      projectId: currentMembership?.projectId,
    });
  }

  if (!projectState) return items;

  const recentConversations = [...projectState.conversations]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .filter((conversation) => {
      if (seenConversations.has(conversation.conversationId)) return false;
      seenConversations.add(conversation.conversationId);
      seenProjects.add(conversation.projectId);
      return true;
    })
    .slice(0, 3 - items.length);

  for (const conversation of recentConversations) {
    items.push({
      key: `conversation-${conversation.conversationId}`,
      title: conversation.title || conversation.url,
      detailText: projectNameById.get(conversation.projectId) || undefined,
      detailKey: 'sidepanel.chatPage.projectConversation',
      projectId: conversation.projectId,
    });
  }

  if (items.length >= 3) return items;

  for (const project of [...projectState.projects].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (seenProjects.has(project.id)) continue;
    seenProjects.add(project.id);
    items.push({
      key: `project-${project.id}`,
      title: project.name,
      detailKey: 'sidepanel.chatPage.recentProject',
      projectId: project.id,
    });
    if (items.length >= 3) break;
  }

  return items;
}

function getComposerTrigger(text: string, cursor: number): ComposerTrigger | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  const beforeCursor = text.slice(0, end);
  const tokenStart = Math.max(
    beforeCursor.lastIndexOf(' '),
    beforeCursor.lastIndexOf('\n'),
    beforeCursor.lastIndexOf('\t'),
  ) + 1;
  const token = beforeCursor.slice(tokenStart);
  if (token.length === 0) return null;
  const marker = token[0];
  if (marker !== '/' && marker !== '@') return null;
  if (token.slice(1).includes('/') || token.slice(1).includes('@')) return null;
  return {
    mode: marker === '/' ? 'slash' : 'context',
    start: tokenStart,
    end,
    query: token.slice(1).trim().toLowerCase(),
  };
}

function getComposerTriggerKey(trigger: ComposerTrigger): string {
  return `${trigger.mode}:${trigger.start}:${trigger.query}`;
}

function replaceComposerTrigger(
  text: string,
  trigger: ComposerTrigger,
  insertText: string,
): { text: string; cursor: number } {
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const spacer = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const nextText = `${before}${spacer}${insertText}${after}`;
  return {
    text: nextText,
    cursor: before.length + spacer.length + insertText.length,
  };
}

function readComposerArraySource<T>(
  result: PromiseSettledResult<unknown>,
  id: string,
  mode: ComposerSuggestionMode,
  label: string,
  issues: ComposerSuggestionSourceIssue[],
  t: ReturnType<typeof useI18n>['t'],
): T[] {
  if (result.status === 'rejected') {
    issues.push({
      id,
      mode,
      label,
      message: getComposerSourceIssueMessage(result.reason, t('sidepanel.chatPage.composerSuggestionSourceInvalid')),
    });
    return [];
  }
  if (isRuntimeFailure(result.value)) {
    issues.push({
      id,
      mode,
      label,
      message: getComposerSourceIssueMessage(result.value.error, t('sidepanel.chatPage.composerSuggestionSourceInvalid')),
    });
    return [];
  }
  if (!Array.isArray(result.value)) {
    issues.push({
      id,
      mode,
      label,
      message: t('sidepanel.chatPage.composerSuggestionSourceInvalid'),
    });
    return [];
  }
  return result.value as T[];
}

function readComposerOptionalSource<T>(
  result: PromiseSettledResult<unknown>,
  id: string,
  mode: ComposerSuggestionMode,
  label: string,
  isValid: (value: unknown) => value is T,
  issues: ComposerSuggestionSourceIssue[],
  t: ReturnType<typeof useI18n>['t'],
): T | null {
  if (result.status === 'rejected') {
    issues.push({
      id,
      mode,
      label,
      message: getComposerSourceIssueMessage(result.reason, t('sidepanel.chatPage.composerSuggestionSourceInvalid')),
    });
    return null;
  }
  if (result.value === null || result.value === undefined) return null;
  if (isRuntimeFailure(result.value)) {
    issues.push({
      id,
      mode,
      label,
      message: getComposerSourceIssueMessage(result.value.error, t('sidepanel.chatPage.composerSuggestionSourceInvalid')),
    });
    return null;
  }
  if (!isValid(result.value)) {
    issues.push({
      id,
      mode,
      label,
      message: t('sidepanel.chatPage.composerSuggestionSourceInvalid'),
    });
    return null;
  }
  return result.value;
}

function readComposerConversationSource(
  result: PromiseSettledResult<unknown>,
  issues: ComposerSuggestionSourceIssue[],
  t: ReturnType<typeof useI18n>['t'],
): CurrentDeepSeekConversation | null {
  const id = 'current-chat';
  const mode: ComposerSuggestionMode = 'context';
  const label = t('sidepanel.chatPage.composerSuggestionSourceCurrentChat');
  if (result.status === 'rejected') {
    issues.push({
      id,
      mode,
      label,
      message: getComposerSourceIssueMessage(result.reason, t('sidepanel.chatPage.composerSuggestionSourceInvalid')),
    });
    return null;
  }
  const conversation = getComposerConversation(result.value);
  if (conversation) return conversation;
  if (result.value === null || result.value === undefined) return null;
  if (isRuntimeFailure(result.value)) {
    if (isNoActiveDeepSeekConversationError(result.value.error)) return null;
    issues.push({
      id,
      mode,
      label,
      message: getComposerSourceIssueMessage(result.value.error, t('sidepanel.chatPage.composerSuggestionSourceInvalid')),
    });
    return null;
  }
  issues.push({
    id,
    mode,
    label,
    message: t('sidepanel.chatPage.composerSuggestionSourceInvalid'),
  });
  return null;
}

function getComposerSourceIssueMessage(error: unknown, fallback: string): string {
  if (error === null || error === undefined) return fallback;
  const raw = getRuntimeErrorMessage(error).trim();
  if (!raw || raw === 'undefined' || raw === 'null') return fallback;
  if (/\bGET_[A-Z0-9_]+\b|schemaVersion|chrome\.runtime|chrome\.storage|IndexedDB|Bearer|Cookie|data:image/i.test(raw)) {
    return fallback;
  }
  return raw;
}

function isNoActiveDeepSeekConversationError(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  return getRuntimeErrorMessage(error).trim() === 'no_active_deepseek_conversation';
}

function createComposerSuggestions(
  trigger: ComposerTrigger | null,
  data: ComposerSuggestionData,
  browserSuggestions: ComposerSuggestion[],
  t: ReturnType<typeof useI18n>['t'],
): ComposerSuggestion[] {
  if (!trigger) return [];
  const suggestions = trigger.mode === 'slash'
    ? createSlashCommandSuggestions(data.skills, t)
    : createContextSuggestions(data, browserSuggestions, t);
  return suggestions
    .filter((suggestion) => matchesComposerQuery(suggestion, trigger.query))
    .slice(0, COMPOSER_SUGGESTION_LIMIT);
}

function createSlashCommandSuggestions(
  skills: readonly Skill[],
  t: ReturnType<typeof useI18n>['t'],
): ComposerSuggestion[] {
  return [...skills]
    .filter((skill) => skill.enabled !== false)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({
      id: `skill-${skill.name}`,
      label: `/${skill.name}`,
      detail: skill.description || t('sidepanel.chatPage.composerSuggestionCommandDetail'),
      insertText: `/${skill.name} `,
    }));
}

function createContextSuggestions(
  data: ComposerSuggestionData,
  browserSuggestions: readonly ComposerSuggestion[],
  t: ReturnType<typeof useI18n>['t'],
): ComposerSuggestion[] {
  const suggestions: ComposerSuggestion[] = [];
  const activeProjectId = data.projectState?.pendingProjectId ?? null;
  const projects = [...(data.projectState?.projects ?? [])]
    .sort((a, b) => {
      if (a.id === activeProjectId) return -1;
      if (b.id === activeProjectId) return 1;
      return b.updatedAt - a.updatedAt;
    });

  if (data.currentConversation) {
    suggestions.push({
      id: `chat-${data.currentConversation.conversationId}`,
      label: data.currentConversation.title || t('sidepanel.chatPage.composerSuggestionCurrentChat'),
      detail: t('sidepanel.chatPage.composerSuggestionCurrentChatDetail'),
      insertText: `@Chat: ${data.currentConversation.title || data.currentConversation.url} `,
    });
  }

  for (const project of projects) {
    suggestions.push({
      id: `project-${project.id}`,
      label: project.name,
      detail: project.id === activeProjectId
        ? t('sidepanel.chatPage.composerSuggestionActiveProjectDetail')
        : t('sidepanel.chatPage.composerSuggestionProjectDetail'),
      insertText: `@Project: ${project.name} `,
    });
  }

  for (const memory of [...data.memories].sort(sortMemoriesForSuggestions)) {
    suggestions.push({
      id: `memory-${memory.syncId}`,
      label: memory.name,
      detail: memory.description || t('sidepanel.chatPage.composerSuggestionMemoryDetail'),
      insertText: `@Memory: ${memory.name} `,
    });
  }

  for (const item of [...data.savedItems].sort((a, b) => b.updatedAt - a.updatedAt)) {
    suggestions.push({
      id: `saved-${item.id}`,
      label: item.title,
      detail: item.kind === 'bookmark'
        ? t('sidepanel.chatPage.composerSuggestionBookmarkDetail')
        : t('sidepanel.chatPage.composerSuggestionSavedDetail'),
      insertText: `@Saved: ${item.title} `,
    });
  }

  suggestions.push(...browserSuggestions);
  return suggestions;
}

function sortMemoriesForSuggestions(a: Memory, b: Memory): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}

function matchesComposerQuery(suggestion: ComposerSuggestion, query: string): boolean {
  if (!query) return true;
  const haystack = `${suggestion.label}\n${suggestion.detail}`.toLowerCase();
  return haystack.includes(query);
}

function isComposerSkill(value: unknown): value is Skill {
  if (!value || typeof value !== 'object') return false;
  const skill = value as Skill;
  return typeof skill.name === 'string' &&
    typeof skill.description === 'string' &&
    typeof skill.instructions === 'string';
}

function isComposerMemory(value: unknown): value is Memory {
  if (!value || typeof value !== 'object') return false;
  const memory = value as Memory;
  return typeof memory.syncId === 'string' &&
    typeof memory.name === 'string' &&
    typeof memory.content === 'string' &&
    Array.isArray(memory.tags);
}

function isComposerSavedItem(value: unknown): value is SavedItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as SavedItem;
  return typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.content === 'string' &&
    Array.isArray(item.tags);
}

function isComposerProjectState(value: unknown): value is ProjectContextState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ProjectContextState;
  return Array.isArray(state.projects) &&
    Array.isArray(state.conversations) &&
    (state.pendingProjectId === null || typeof state.pendingProjectId === 'string');
}

function getComposerConversation(value: unknown): CurrentDeepSeekConversation | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as { ok?: boolean; conversation?: CurrentDeepSeekConversation };
  const conversation = response.ok === true ? response.conversation : value as CurrentDeepSeekConversation;
  if (!conversation || typeof conversation !== 'object') return null;
  return typeof conversation.conversationId === 'string' &&
    typeof conversation.title === 'string' &&
    typeof conversation.url === 'string'
    ? conversation
    : null;
}

function normalizeAuthStatus(resp: ChatAuthStatus | undefined): ChatAuthStatus {
  return {
    available: resp?.available ?? resp?.hasToken ?? false,
    provider: resp?.provider ?? (resp?.hasToken ? 'deepseek-web' : null),
    hasApiKey: resp?.hasApiKey ?? false,
    hasToken: resp?.hasToken ?? false,
  };
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

function getResponseModeValue(config: OfficialApiChatConfig): ResponseModeValue {
  return `${config.model}:${config.thinking}:${config.reasoningEffort}`;
}

function parseResponseModeValue(value: ResponseModeValue): OfficialApiChatConfig {
  const [model, thinking, reasoningEffort] = value.split(':') as [
    OfficialDeepSeekModel,
    OfficialDeepSeekThinkingMode,
    OfficialDeepSeekReasoningEffort,
  ];
  return normalizeOfficialApiChatConfig({ model, thinking, reasoningEffort });
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
