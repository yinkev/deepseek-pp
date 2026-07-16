import {
  Component,
  lazy,
  Suspense,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import type { ChatMessage as ChatMessageType } from '../../../core/types';
import { useI18n } from '../i18n';

const RichMessageContent = lazy(() => import('./RichMessageContent'));

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
  onRichContentRendered?: () => void;
}

interface RichMessageErrorBoundaryProps {
  children: ReactNode;
  text: string;
}

interface RichMessageErrorBoundaryState {
  failed: boolean;
}

export class RichMessageErrorBoundary extends Component<
  RichMessageErrorBoundaryProps,
  RichMessageErrorBoundaryState
> {
  state: RichMessageErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RichMessageErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Rich message rendering failed; using plain text.', error, info);
  }

  render() {
    if (this.state.failed) {
      return <PlainTextMessageContent text={this.props.text} />;
    }
    return this.props.children;
  }
}

export default function ChatMessage({
  message,
  isStreaming,
  onRichContentRendered,
}: ChatMessageProps) {
  const { t } = useI18n();
  const isUser = message.role === 'user';

  return (
    <div className={`ds-chat-message-row ${isUser ? 'ds-chat-message-row-user' : 'ds-chat-message-row-assistant'}`}>
      <div
        className={`ds-chat-message ${
          isUser
            ? 'ds-chat-message-user'
            : 'ds-chat-message-assistant'
        }`}
      >
        {isUser ? (
          <>
            {message.attachments && message.attachments.length > 0 && (
              <div className="ds-chat-message-attachments">
                {message.attachments.map((attachment, index) => (
                  <figure
                    key={`${attachment.kind}-${attachment.name}-${index}`}
                    className="ds-chat-message-attachment"
                    title={attachment.name}
                  >
                    {attachment.previewUrl ? (
                      <img src={attachment.previewUrl} alt={attachment.name} />
                    ) : (
                      <figcaption className="ds-chat-message-attachment-label">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                          <rect x="3" y="4" width="18" height="16" rx="2" />
                          <circle cx="8.5" cy="9" r="1.5" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="m5 17 4.5-4.5 3 3 2-2L19 18" />
                        </svg>
                        <span>{attachment.name}</span>
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}
            <span className="whitespace-pre-wrap">{message.text}</span>
          </>
        ) : (
          <>
            {message.reasoningText && (
              <details className="ds-chat-thinking" open={isStreaming && !message.text}>
                <summary>
                  {isStreaming && !message.text
                    ? t('sidepanel.chatPage.reasoningActive')
                    : t('sidepanel.chatPage.reasoningTitle')}
                </summary>
                <div className="whitespace-pre-wrap">{message.reasoningText}</div>
              </details>
            )}
            {message.text && (
              <div className="prose prose-sm max-w-none [&_pre]:overflow-x-auto [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:bg-[var(--ds-bg)] [&_code]:text-sm">
                <RichMessageErrorBoundary text={message.text}>
                  <Suspense fallback={<PlainTextMessageContent text={message.text} />}>
                    <RichMessageContent
                      text={message.text}
                      onRendered={onRichContentRendered}
                    />
                  </Suspense>
                </RichMessageErrorBoundary>
              </div>
            )}
          </>
        )}
        {isStreaming && !isUser && (
          <span className="ds-chat-caret" />
        )}
      </div>
    </div>
  );
}

function PlainTextMessageContent({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap" data-rich-message-fallback="plain-text">{text}</span>;
}
