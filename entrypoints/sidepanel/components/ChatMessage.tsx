import ReactMarkdown from 'react-markdown';
import type { ChatMessage as ChatMessageType } from '../../../core/types';
import { useI18n } from '../i18n';

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
}

export default function ChatMessage({ message, isStreaming }: ChatMessageProps) {
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
              <div className="ds-chat-attachments">
                {message.attachments.map((attachment, index) => (
                  <span key={`${attachment.name}-${index}`} className="ds-chat-attachment-chip">
                    {attachment.name}
                  </span>
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
                <ReactMarkdown>{message.text}</ReactMarkdown>
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
