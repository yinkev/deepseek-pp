import { redactDurableToolString } from '../tool/redaction';
import type { AutomationFlightEvent, AutomationRun } from './types';

const DEFAULT_EVENT_LIMIT = 6;
const DEFAULT_TEXT_LIMIT = 900;

export interface AutomationReplayBriefOptions {
  eventLimit?: number;
  textLimit?: number;
}

export function createAutomationRunReplayBrief(
  run: AutomationRun,
  options: AutomationReplayBriefOptions = {},
): string {
  const eventLimit = Math.max(1, Math.min(20, Math.floor(options.eventLimit ?? DEFAULT_EVENT_LIMIT)));
  const textLimit = Math.max(120, Math.min(4000, Math.floor(options.textLimit ?? DEFAULT_TEXT_LIMIT)));
  const preflight = run.request?.preflight;
  const recorder = run.flightRecorder;
  const chain = run.request?.chain;
  const lines = [
    'Automation run replay brief',
    `Run: ${safeText(run.id, textLimit)}`,
    `Automation: ${safeText(run.automationId, textLimit)}`,
    `Trigger: ${run.trigger}`,
    `Status: ${run.status}`,
    `Attempt: ${run.attempt}`,
  ];

  if (chain) {
    lines.push(`Chain: depth ${chain.depth}, parent ${chain.parentAutomationId ?? 'none'}, parent run ${chain.parentRunId ?? 'none'}`);
  }

  if (preflight) {
    lines.push(`Preflight: ${preflight.grade} (${preflight.score}) ${preflight.status}`);
    lines.push(`Issues: ${formatList(preflight.issueCodes)}`);
    lines.push(`Auto-fixed: ${formatList(preflight.autoFixedIssueCodes)}`);
    lines.push(`Blocked: ${formatList(preflight.blockingIssueCodes)}`);
  }

  if (recorder) {
    lines.push(`Session source: ${recorder.session.source}`);
    lines.push(`Web auth: ${recorder.auth.hasWebAuth ? 'available' : 'missing'}`);
    lines.push(`Visual evidence: ${recorder.visual.attachedRefCount} ref(s), ${recorder.visual.evidencePackCount} pack(s), raw images stored: ${recorder.visual.rawImageStored}`);
    const events = recorder.events.slice(-eventLimit);
    if (events.length > 0) {
      lines.push('Events:');
      for (const event of events) {
        lines.push(`- ${formatEvent(event, textLimit)}`);
      }
    }
  }

  if (run.error) {
    lines.push(`Error: ${safeText(run.error.code, textLimit)} / ${run.error.phase} / retryable=${run.error.retryable}`);
    lines.push(`Error message: ${safeText(run.error.message, textLimit)}`);
  }

  if (run.result?.ok) {
    lines.push(`Assistant excerpt: ${safeText(run.result.assistantText, textLimit)}`);
    lines.push(`Tool executions: ${run.result.toolExecutions?.length ?? 0}`);
  } else if (run.result && !run.result.ok) {
    lines.push(`Runner failure: ${safeText(run.result.error.code, textLimit)} / ${run.result.error.phase}`);
    lines.push(`Runner message: ${safeText(run.result.error.message, textLimit)}`);
  }

  if (run.request?.prompt) {
    lines.push(`Prompt excerpt: ${safeText(run.request.prompt, textLimit)}`);
  }

  return lines.join('\n');
}

function formatEvent(event: AutomationFlightEvent, textLimit: number): string {
  return `${event.status} ${safeText(event.label, textLimit)} - ${safeText(event.summary, textLimit)}`;
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

function safeText(value: string, maxLength: number): string {
  const redacted = redactDurableToolString(value) ?? '';
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted;
}
