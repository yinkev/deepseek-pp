import { describe, expect, it } from 'vitest';
import { stripToolCallsFromHistory } from '../core/interceptor/history-cleanup';
import { createArtifactToolDescriptors } from '../core/artifact';
import { createDefaultToolDescriptors } from '../core/tool';
import { createBrowserControlToolDescriptors } from '../core/browser-control/tool';

describe('history cleanup', () => {
  it('keeps inline-agent continuation prompt nodes but hides their internal prompt text', () => {
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 1,
              message_role: 'user',
              content: '看一下深圳的房价',
            },
            {
              message_id: 2,
              message_role: 'assistant',
              parent_message_id: 1,
              content: '我帮你查一下深圳最近的房价情况。',
            },
            {
              message_id: 3,
              message_role: 'user',
              content: [
                '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样继续推进。',
                '',
                '<original_task>',
                '看一下深圳的房价',
                '</original_task>',
                '',
                '<tool_results>',
                '[]',
                '</tool_results>',
              ].join('\n'),
            },
            {
              message_id: 4,
              message_role: 'assistant',
              parent_message_id: 3,
              content: '根据最新市场数据，深圳房价如下。',
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages.map((message: { message_id: number }) => message.message_id)).toEqual([1, 2, 3, 4]);
    expect(json.data.biz_data.chat_messages[2].content).toBe('\u200b');
    expect(json.data.biz_data.chat_messages[3].parent_message_id).toBe(3);
  });

  it('keeps system tool-continuation prompt nodes but hides internal tool results', () => {
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 5,
              message_role: 'user',
              content: 'Use the browser and tell me what loaded.',
            },
            {
              message_id: 6,
              message_role: 'assistant',
              parent_message_id: 5,
              content: '<browser_snapshot>{"targetLeaseId":"lease-1"}</browser_snapshot>',
            },
            {
              message_id: 7,
              message_role: 'user',
              content: [
                '[TOOL_RESULTS]',
                '[{"tool":"browser_snapshot","ok":true,"summary":"Loaded dashboard"}]',
                '[/TOOL_RESULTS]',
                '',
                'Continue from the tool results above. If the user\'s browser/page request is now satisfied, answer the user directly with the observed result.',
              ].join('\n'),
            },
            {
              message_id: 8,
              message_role: 'assistant',
              parent_message_id: 7,
              content: 'The dashboard loaded.',
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: [
        ...createDefaultToolDescriptors(),
        ...createBrowserControlToolDescriptors('en'),
      ],
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages.map((message: { message_id: number }) => message.message_id)).toEqual([5, 6, 7, 8]);
    expect(json.data.biz_data.chat_messages[2].content).toBe('\u200b');
    expect(JSON.stringify(json)).not.toContain('browser_snapshot');
    expect(json.data.biz_data.chat_messages[3].parent_message_id).toBe(7);
  });

  it('adds assistant message anchors to restored tool-call records', () => {
    const records: unknown[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 10,
              message_role: 'user',
              content: 'Save this',
            },
            {
              message_id: 11,
              message_role: 'assistant',
              parent_message_id: 10,
              content: [
                'Saved.',
                '<memory_save>',
                '{"type":"topic","name":"anchor","content":"ok","tags":[]}',
                '</memory_save>',
              ].join('\n'),
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      metadata: {
        messageId: 11,
        parentMessageId: 10,
        assistantMessageIndex: 0,
        role: 'assistant',
      },
    });
  });

  it('replaces inline-agent task_complete markers with their summary in restored history', () => {
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 39,
              message_role: 'user',
              content: [
                '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样继续推进。',
                '',
                '<original_task>',
                '整理回答',
                '</original_task>',
                '',
                '<tool_results>',
                '[]',
                '</tool_results>',
              ].join('\n'),
            },
            {
              message_id: 40,
              message_role: 'assistant',
              parent_message_id: 39,
              content: '<task_complete>{"summary":"回答已经整理完成。","artifacts":[]}</task_complete>',
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe('\u200b');
    expect(json.data.biz_data.chat_messages[1].content).toBe('回答已经整理完成。');
  });

  it('preserves user-authored task_complete examples in restored history', () => {
    const content = '<task_complete>{"summary":"保留原始示例。","artifacts":[]}</task_complete>';
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 41,
              message_role: 'user',
              content,
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe(content);
  });

  it('preserves non-inline-agent assistant task_complete examples in restored history', () => {
    const content = 'Example: <task_complete>{"summary":"保留原始示例。","artifacts":[]}</task_complete>';
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 42,
              message_role: 'assistant',
              parent_message_id: 41,
              content,
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe(content);
  });

  it('strips nested browser tool blocks from message_content parts without browser descriptors', () => {
    const records: unknown[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 50,
              message_role: 'assistant',
              message_content: {
                parts: [
                  {
                    content: 'Before < browser_snapshot >{} </ browser_snapshot > after',
                  },
                ],
              },
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(json.data.biz_data.chat_messages[0].message_content.parts[0].content).toBe('Before  after');
    expect(JSON.stringify(json)).not.toContain('browser_snapshot');
    expect(records).toHaveLength(0);
  });

  it('restores nested browser tool records when browser descriptors are available', () => {
    const records: any[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 51,
              message_role: 'assistant',
              parent_message_id: 49,
              message_content: {
                parts: [
                  {
                    content: 'Before <browser_snapshot>{}</browser_snapshot> after',
                  },
                ],
              },
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: [
        ...createDefaultToolDescriptors(),
        ...createBrowserControlToolDescriptors('en'),
      ],
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(json.data.biz_data.chat_messages[0].message_content.parts[0].content).toBe('Before  after');
    expect(records).toHaveLength(1);
    expect(records[0].calls[0].name).toBe('browser_snapshot');
    expect(records[0].metadata).toMatchObject({
      messageId: 51,
      parentMessageId: 49,
      role: 'assistant',
    });
  });

  it('restores and strips plain legacy browser wrapper records', () => {
    const records: any[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 54,
              message_role: 'assistant',
              parent_message_id: 49,
              message_content: {
                parts: [
                  {
                    content: [
                      'Before ',
                      '<tool_calls>',
                      '<invoke name="browser_snapshot">',
                      '<parameter name="targetLeaseId"></parameter>',
                      '<parameter name="snapshotId"></parameter>',
                      '</invoke>',
                      '<invoke name="browser_evaluate_script">',
                      '<parameter name="script"></parameter>',
                      '</invoke>',
                      '</tool_calls>',
                      ' after',
                    ].join(''),
                  },
                ],
              },
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: [
        ...createDefaultToolDescriptors(),
        ...createBrowserControlToolDescriptors('en'),
      ],
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(json.data.biz_data.chat_messages[0].message_content.parts[0].content).toBe('Before  after');
    expect(JSON.stringify(json)).not.toContain('tool_calls');
    expect(records).toHaveLength(1);
    expect(records[0].calls).toHaveLength(1);
    expect(records[0].calls[0].name).toBe('browser_snapshot');
    expect(records[0].calls[0].payload).toEqual({});
  });

  it('replaces inline-agent task_complete markers inside nested message_content parts', () => {
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 52,
              message_role: 'user',
              message_content: {
                parts: [{
                  content: [
                    '以下是工具续跑任务刚刚执行的工具结果。请像真正的 Agent 一样继续推进。',
                    '',
                    '<original_task>',
                    '整理回答',
                    '</original_task>',
                    '',
                    '<tool_results>',
                    '[]',
                    '</tool_results>',
                  ].join('\n'),
                }],
              },
            },
            {
              message_id: 53,
              message_role: 'assistant',
              parent_message_id: 52,
              message_content: {
                parts: [{
                  content: '<task_complete>{"summary":"回答已经整理完成。","artifacts":[]}</task_complete>',
                }],
              },
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: () => undefined,
    });

    expect(json.data.biz_data.chat_messages[0].message_content.parts[0].content).toBe('\u200b');
    expect(json.data.biz_data.chat_messages[1].message_content.parts[0].content).toBe('回答已经整理完成。');
  });

  it('does not parse or pass huge artifact payloads back through restore records', () => {
    const records: any[] = [];
    const html = '<!doctype html><html><body>' + 'x'.repeat(250_000) + '</body></html>';
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 20,
              message_role: 'assistant',
              content: [
                'Created < draft.',
                '<artifact_create>',
                JSON.stringify({
                  filename: 'demo.html',
                  content: html,
                  mimeType: 'text/html',
                }),
                '</artifact_create>',
              ].join('\n'),
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: [
        ...createDefaultToolDescriptors(),
        ...createArtifactToolDescriptors(),
      ],
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe('Created < draft.');
    expect(records).toHaveLength(1);
    expect(records[0].content).toBe('Created < draft.');
    expect(records[0].calls[0].name).toBe('artifact_create');
    expect(records[0].calls[0].raw).toBe('<artifact_create>\n...[restore payload omitted]\n</artifact_create>');
    expect(records[0].calls[0].payload).toEqual({});
  });

  it('strips huge legacy DSML blocks without parsing their payload content', () => {
    const records: any[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 30,
              message_role: 'assistant',
              content: [
                'Saved.',
                '<｜DSML｜tool_calls>',
                '<｜DSML｜invoke name="memory_save">',
                '<｜DSML｜parameter name="name" string="true">',
                'n'.repeat(130_000),
                '</｜DSML｜parameter>',
                '</｜DSML｜invoke>',
                '</｜DSML｜tool_calls>',
              ].join(''),
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe('Saved.');
    expect(records).toHaveLength(1);
    expect(records[0].calls[0].name).toBe('memory_save');
    expect(records[0].calls[0].raw).toBe('<memory_save>\n...[restore payload omitted]\n</memory_save>');
    expect(records[0].calls[0].payload).toEqual({});
  });

  it('strips huge whitespace-padded plain wrapper blocks without parsing payload content', () => {
    const records: any[] = [];
    const json = {
      data: {
        biz_data: {
          chat_messages: [
            {
              message_id: 31,
              message_role: 'assistant',
              content: [
                'Saved.',
                '< tool_calls >',
                '< invoke name="memory_save" >',
                '< parameter name="content" >',
                'x'.repeat(130_000),
                '</ parameter >',
                '</ invoke >',
                '</ tool_calls >',
              ].join(''),
            },
          ],
        },
      },
    };

    stripToolCallsFromHistory(json, {
      toolDescriptors: createDefaultToolDescriptors(),
      onToolCallsRestored: (next) => records.push(...next),
    });

    expect(json.data.biz_data.chat_messages[0].content).toBe('Saved.');
    expect(records).toHaveLength(1);
    expect(records[0].calls[0].name).toBe('memory_save');
    expect(records[0].calls[0].raw).toBe('<memory_save>\n...[restore payload omitted]\n</memory_save>');
    expect(records[0].calls[0].payload).toEqual({});
  });
});
