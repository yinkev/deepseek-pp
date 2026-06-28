import ReactMarkdown from 'react-markdown';
import type { ChatMessage as ChatMessageType, ChatToolEvent } from '../../../core/types';
import { useI18n } from '../i18n';
import type { LocaleMessageKey, MessageParams } from '../../../core/i18n';

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
            {message.toolEvents && message.toolEvents.length > 0 && (
              <div className="ds-chat-tool-events">
                <ToolEventsDisclosure events={message.toolEvents} />
              </div>
            )}
            {message.text && (
              <div className="ds-chat-markdown">
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

function ToolEventsDisclosure({ events }: { events: ChatToolEvent[] }) {
  const { t } = useI18n();
  const summary = formatToolEventsSummary(events, t);
  return (
    <details className="ds-chat-tool-event">
      <summary>
        <span className="ds-chat-tool-icon" aria-hidden="true">&gt;_</span>
        <span className="ds-chat-tool-title">{summary}</span>
        <span className="ds-chat-tool-chevron" aria-hidden="true">v</span>
      </summary>
      <div className="ds-chat-tool-detail">
        {events.map((event) => (
          <div key={event.id} className={`ds-chat-tool-detail-item ds-chat-tool-detail-item-${event.status}`}>
            <div className="ds-chat-tool-detail-head">
              <span>{event.title}</span>
              <span>{formatToolEventStatus(event, t)}</span>
            </div>
            {event.detail?.trim() && (
              <div className="ds-chat-tool-detail-body">{event.detail.trim()}</div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function formatToolEventsSummary(events: ChatToolEvent[], t: (key: LocaleMessageKey, params?: MessageParams) => string): string {
  if (events.length === 1) {
    const event = events[0];
    const status = formatToolEventStatus(event, t);
    return status ? `${event.title} - ${status}` : event.title;
  }
  const runningCount = events.filter((event) => event.status === 'running').length;
  const errorCount = events.filter((event) => event.status === 'error').length;
  if (runningCount > 0) return `Using ${events.length} tools`;
  if (errorCount > 0) return `Used ${events.length} tools, ${errorCount} failed`;
  return `Used ${events.length} tools`;
}

function formatToolEventStatus(event: ChatToolEvent, t: (key: LocaleMessageKey, params?: MessageParams) => string): string {
  if (event.status === 'running') return event.summary || t('sidepanel.chatPage.toolRunning');
  if (event.status === 'error') return event.summary || t('sidepanel.chatPage.toolFailed');
  if (event.durationMs && event.durationMs >= 1000) return `${(event.durationMs / 1000).toFixed(1)}s`;
  return event.summary || t('sidepanel.chatPage.toolDone');
}
