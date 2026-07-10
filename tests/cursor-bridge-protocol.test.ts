import { describe, expect, it } from 'vitest';
import {
  createErrorResponse,
  createModelsResponse,
  createNonStreamCompletion,
  createStreamChunk,
  messagesToPrompt,
  modelThinkingEnabled,
  normalizeBridgeModel,
  parseChatCompletionsBody,
  readinessToError,
} from '../core/cursor-bridge';

describe('cursor-bridge protocol', () => {
  it('normalizes models and thinking flags', () => {
    expect(normalizeBridgeModel('deepseek-web')).toBe('deepseek-web');
    expect(normalizeBridgeModel('deepseek-web-thinking')).toBe('deepseek-web-thinking');
    expect(modelThinkingEnabled('deepseek-web-thinking')).toBe(true);
    expect(modelThinkingEnabled('deepseek-web')).toBe(false);
  });

  it('builds prompts from chat messages', () => {
    const prompt = messagesToPrompt([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'How are you?' },
    ]);
    expect(prompt).toContain('[system]\nBe brief.');
    expect(prompt).toContain('Hello');
    expect(prompt).toContain('[assistant]\nHi');
    expect(prompt).toContain('How are you?');
  });

  it('parses chat completion bodies and rejects empty prompts', () => {
    const ok = parseChatCompletionsBody({
      model: 'deepseek-web',
      stream: true,
      messages: [{ role: 'user', content: 'ping' }],
    }, 'job-1', 1);
    expect(ok.job?.id).toBe('job-1');
    expect(ok.job?.stream).toBe(true);
    expect(ok.job?.messages).toHaveLength(1);

    const bad = parseChatCompletionsBody({ messages: [] }, 'job-2');
    expect(bad.error?.code).toBe('invalid_request');
  });

  it('maps readiness failures to structured errors', () => {
    expect(readinessToError({
      ready: false,
      extensionAlive: false,
      hasDeepSeekTab: false,
      hasLogin: false,
      busy: false,
    }).code).toBe('not_ready');

    expect(readinessToError({
      ready: false,
      extensionAlive: true,
      hasDeepSeekTab: false,
      hasLogin: true,
      busy: false,
    }).code).toBe('missing_tab');

    expect(readinessToError({
      ready: false,
      extensionAlive: true,
      hasDeepSeekTab: true,
      hasLogin: false,
      busy: false,
    }).code).toBe('missing_login');
  });

  it('shapes OpenAI responses', () => {
    const models = createModelsResponse({
      ready: true,
      extensionAlive: true,
      hasDeepSeekTab: true,
      hasLogin: true,
      busy: false,
    });
    expect(models.data.map((m) => m.id)).toEqual(['deepseek-web', 'deepseek-web-thinking']);
    expect(models.data[0].available).toBe(true);

    const completion = createNonStreamCompletion('deepseek-web', 'hello', 'id-1', 10);
    expect(completion.choices[0].message.content).toBe('hello');

    const chunk = createStreamChunk('deepseek-web', 'id-1', 10, 'he', null);
    expect(chunk.choices[0].delta.content).toBe('he');

    const err = createErrorResponse({ code: 'missing_tab', message: 'no tab' });
    expect(err.status).toBe(503);
    expect(err.body.error.code).toBe('missing_tab');
  });
});
