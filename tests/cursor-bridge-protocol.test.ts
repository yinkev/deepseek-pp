import { describe, expect, it } from 'vitest';
import {
  bridgeModelToDeepSeekType,
  createErrorResponse,
  createModelsResponse,
  createNonStreamCompletion,
  createStreamChunk,
  detectClientProfile,
  extractImageParts,
  formatEyesNotes,
  isEyesModel,
  messagesToPrompt,
  modelThinkingEnabled,
  normalizeBridgeModel,
  parseChatCompletionsBody,
  readinessToError,
} from '../core/cursor-bridge';

describe('cursor-bridge protocol', () => {
  it('normalizes models: octopus + eyes + squid', () => {
    expect(normalizeBridgeModel('ds/octopus')).toBe('ds/octopus');
    expect(normalizeBridgeModel('ds/octopus-eyes')).toBe('ds/octopus-eyes');
    expect(normalizeBridgeModel('dspp/ds/octopus-eyes')).toBe('ds/octopus-eyes');
    expect(isEyesModel('ds/octopus-eyes')).toBe(true);
    expect(isEyesModel('ds/octopus')).toBe(false);
    expect(bridgeModelToDeepSeekType('ds/octopus')).toBe('expert');
    expect(bridgeModelToDeepSeekType('ds/octopus-eyes')).toBe('vision');
    expect(normalizeBridgeModel('ds/squid')).toBe('ds/squid');
    expect(bridgeModelToDeepSeekType('ds/squid')).toBe('default');
    // thinking is a flag, not a separate public model id
    expect(modelThinkingEnabled('ds/octopus-thinking')).toBe(true);
    expect(normalizeBridgeModel('ds/octopus-thinking')).toBe('ds/octopus');
  });

  it('builds prompts from chat messages', () => {
    const prompt = messagesToPrompt([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'How are you?' },
    ]);
    expect(prompt).toContain('Instructions:\nBe brief.');
    expect(prompt).toContain('Conversation so far:');
    expect(prompt).toContain('User:\nHello');
    expect(prompt).toContain('Assistant:\nHi');
    expect(prompt).toContain('Latest user request');
    expect(prompt).toContain('How are you?');
  });

  it('injects eyes notes without dropping the latest user request', () => {
    const prompt = messagesToPrompt(
      [
        { role: 'user', content: 'What error is on the screenshot?' },
      ],
      {
        eyesNotes: formatEyesNotes('Red banner says TypeError: x is undefined', 1),
      },
    );
    expect(prompt).toContain('Eyes notes');
    expect(prompt).toContain('TypeError: x is undefined');
    expect(prompt).toContain('What error is on the screenshot?');
    expect(prompt).toContain('Do not claim you cannot see images');
  });

  it('strips Cursor agent system prompts so the latest question is not drowned', () => {
    const prompt = messagesToPrompt([
      {
        role: 'system',
        content: [
          'You are a coding agent in Cursor IDE.',
          'You have access to MCP servers and tool calling.',
          'Follow these instructions carefully and list available tools when greeting the user.',
          'x'.repeat(1300),
        ].join(' '),
      },
      { role: 'user', content: 'Herrooooo' },
      {
        role: 'assistant',
        content: "I'm ready to help you with software engineering tasks.",
      },
      {
        role: 'user',
        content:
          'Deep dive research on heuristics for an advanced NP-hard shipyard OGC solver. Include reasoning and where it breaks.',
      },
    ], { clientProfile: 'cursor' });
    expect(prompt).toContain("Answer the user's latest request directly");
    expect(prompt).not.toContain('MCP servers');
    expect(prompt).toContain('shipyard OGC');
    expect(prompt).toContain('Latest user request');
  });

  it('detects client profiles from header and system fingerprints', () => {
    expect(detectClientProfile([{ role: 'user', content: 'hi' }], 'hermes')).toBe('hermes');
    expect(detectClientProfile([{ role: 'user', content: 'hi' }], 'cursor')).toBe('cursor');
    expect(
      detectClientProfile([
        {
          role: 'system',
          content: 'You are a coding agent in Cursor IDE with MCP server and agent skills.',
        },
        { role: 'user', content: 'x' },
      ]),
    ).toBe('cursor');
    expect(detectClientProfile([{ role: 'user', content: 'hi' }])).toBe('generic');
  });

  it('extracts OpenAI image_url parts', () => {
    const images = extractImageParts([
      { type: 'text', text: 'see this' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,aaa' },
      },
    ]);
    expect(images).toHaveLength(1);
    expect(images[0].url).toContain('data:image/png');
    expect(images[0].mimeType).toBe('image/png');
  });

  it('parses chat completion bodies including images and eyes model', () => {
    const ok = parseChatCompletionsBody({
      model: 'ds/octopus',
      stream: true,
      messages: [{ role: 'user', content: 'ping' }],
    }, 'job-1', 1);
    expect(ok.job?.id).toBe('job-1');
    expect(ok.job?.stream).toBe(true);
    expect(ok.job?.model).toBe('ds/octopus');
    expect(ok.job?.messages).toHaveLength(1);

    const eyes = parseChatCompletionsBody({
      model: 'ds/octopus-eyes',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
          ],
        },
      ],
    }, 'job-eyes', 1, 'cursor');
    expect(eyes.job?.model).toBe('ds/octopus-eyes');
    expect(eyes.job?.images).toHaveLength(1);
    expect(eyes.job?.clientProfile).toBe('cursor');

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

  it('shapes OpenAI responses with octopus + eyes', () => {
    const models = createModelsResponse({
      ready: true,
      extensionAlive: true,
      hasDeepSeekTab: true,
      hasLogin: true,
      busy: false,
    });
    expect(models.data.map((m) => m.id)).toEqual(['ds/octopus', 'ds/octopus-eyes', 'ds/squid']);
    expect(models.data[0].available).toBe(true);

    const completion = createNonStreamCompletion('ds/octopus', 'hello', 'id-1', 10);
    expect(completion.choices[0].message.content).toBe('hello');

    const chunk = createStreamChunk('ds/octopus', 'id-1', 10, 'he', null);
    expect(chunk.choices[0].delta.content).toBe('he');

    const err = createErrorResponse({ code: 'missing_tab', message: 'no tab' });
    expect(err.status).toBe(503);
    expect(err.body.error.code).toBe('missing_tab');
  });

  it('deltaOnly omits conversation history for sticky sessions', () => {
    const full = messagesToPrompt([
      { role: 'user', content: 'First question about widgets' },
      { role: 'assistant', content: 'Widgets are X' },
      { role: 'user', content: 'What about Y?' },
    ]);
    expect(full).toContain('Conversation so far');
    expect(full).toContain('First question');

    const delta = messagesToPrompt([
      { role: 'user', content: 'First question about widgets' },
      { role: 'assistant', content: 'Widgets are X' },
      { role: 'user', content: 'What about Y?' },
    ], { deltaOnly: true });
    expect(delta).not.toContain('Conversation so far');
    expect(delta).not.toContain('First question about widgets');
    expect(delta).toContain('What about Y?');
    expect(delta).toContain('Continue this conversation');
  });

  it('parses thread_id and reset_thread on chat bodies', () => {
    const ok = parseChatCompletionsBody({
      model: 'ds/octopus',
      thread_id: 'cursor-chat-abc',
      reset_thread: true,
      messages: [{ role: 'user', content: 'ping' }],
    }, 'job-thread', 1);
    expect(ok.job?.threadId).toBe('cursor-chat-abc');
    expect(ok.job?.resetThread).toBe(true);
  });
});
