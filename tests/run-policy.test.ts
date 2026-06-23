import { describe, expect, it } from 'vitest';
import {
  createAutonomousSafetyRedactionSummary,
  reviewAutonomousRunAction,
} from '../core/run/policy';
import type { AutonomousRun, AutonomousRunStep } from '../core/run/types';
import {
  DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
  DEFAULT_AUTONOMOUS_RUN_BUDGETS,
  DEFAULT_AUTONOMOUS_RUN_POLICY,
} from '../core/run/store';
import type { ToolDescriptor } from '../core/tool/types';

const NOW = 10_000;

describe('autonomous run policy and budget gate', () => {
  it('summarizes clean metadata-only safety export surfaces as safe', () => {
    expect(createAutonomousSafetyRedactionSummary({
      surface: 'telemetry',
      metadataOnly: true,
      redactionCandidates: ['status=running', { issueCount: 0 }],
    })).toEqual({
      status: 'safe',
      surface: 'telemetry',
      metadataOnly: true,
      redacted: false,
      issueCount: 0,
      issueCodes: [],
      issueCategories: [],
      policyGate: 'not_applicable',
    });
  });

  it('blocks unsafe export surfaces by default when metadata-only posture is absent', () => {
    expect(createAutonomousSafetyRedactionSummary({
      surface: 'pet_handoff',
      redactionCandidates: ['safe-looking aggregate'],
    })).toMatchObject({
      status: 'blocked',
      surface: 'pet_handoff',
      metadataOnly: false,
      redacted: false,
      issueCount: 1,
      issueCodes: ['unsafe_export_surface'],
      issueCategories: ['metadata'],
    });
  });

  it('flags redaction without returning raw secret candidates', () => {
    const summary = createAutonomousSafetyRedactionSummary({
      surface: 'worker_prompt',
      metadataOnly: true,
      redactionCandidates: [
        'Authorization: Bearer secret-token',
        'https://example.com/private?token=secret',
        { Cookie: 'sid=secret-session' },
      ],
    });

    expect(summary).toMatchObject({
      status: 'redacted',
      surface: 'worker_prompt',
      metadataOnly: true,
      redacted: true,
      issueCodes: ['redaction_applied'],
      issueCategories: ['privacy'],
      policyGate: 'not_applicable',
    });
    expect(JSON.stringify(summary)).not.toMatch(/secret-token|token=secret|secret-session|example\.com/);
  });

  it('blocks denied and manual-review policy gates in safety summaries', () => {
    expect(createAutonomousSafetyRedactionSummary({
      surface: 'action_policy',
      metadataOnly: true,
      policyDecision: 'deny',
    })).toMatchObject({
      status: 'blocked',
      redacted: false,
      issueCodes: ['policy_denied'],
      issueCategories: ['policy'],
      policyGate: 'deny',
    });

    expect(createAutonomousSafetyRedactionSummary({
      surface: 'action_policy',
      metadataOnly: true,
      policyDecision: 'manual_review',
    })).toMatchObject({
      status: 'blocked',
      redacted: false,
      issueCodes: ['manual_review_required'],
      issueCategories: ['policy'],
      policyGate: 'manual_review',
    });
  });

  it('false-positive probe: already-redacted candidates still cannot report clean', () => {
    expect(createAutonomousSafetyRedactionSummary({
      surface: 'telemetry',
      metadataOnly: true,
      redactionCandidates: ['command [redacted:secret] _redacted:id_'],
    })).toMatchObject({
      status: 'redacted',
      redacted: true,
      issueCodes: ['redaction_applied'],
    });
  });

  it('blocks declared raw-content presence and bounds issue codes to the known safety vocabulary', () => {
    const summary = createAutonomousSafetyRedactionSummary({
      surface: 'review_lane',
      metadataOnly: true,
      rawContentPresent: true,
      issueCodes: [
        'raw_content_present',
        'unsafe_export_surface',
        'policy_denied',
        'manual_review_required',
        'redaction_applied',
        'redaction_applied',
        'not_a_real_issue_code',
      ],
    });

    expect(summary).toEqual({
      status: 'blocked',
      surface: 'review_lane',
      metadataOnly: true,
      redacted: true,
      issueCount: 5,
      issueCodes: [
        'raw_content_present',
        'unsafe_export_surface',
        'policy_denied',
        'manual_review_required',
        'redaction_applied',
      ],
      issueCategories: ['privacy', 'metadata', 'policy'],
      policyGate: 'not_applicable',
    });
    expect(summary.issueCodes).not.toContain('not_a_real_issue_code');
  });

  it('allows low-risk allowlisted tools inside budgets', () => {
    const run = createRun({
      policy: {
        ...DEFAULT_AUTONOMOUS_RUN_POLICY,
        allowedTools: ['safe_tool'],
      },
    });

    expect(reviewAutonomousRunAction(run, [], {
      kind: 'tool_call',
      toolName: 'safe_tool',
      descriptor: createDescriptor('safe_tool', 'low'),
    }, NOW)).toEqual({ decision: 'allow', reason: 'allowed', error: null });
  });

  it('denies terminal or non-running actions', () => {
    expect(reviewAutonomousRunAction(createRun({ status: 'succeeded' }), [], { kind: 'model_turn' }, NOW).reason).toBe('run_terminal');
    expect(reviewAutonomousRunAction(createRun({ status: 'queued' }), [], { kind: 'model_turn' }, NOW).reason).toBe('run_not_running');
  });

  it('denies exhausted wall, model, tool, prompt, and observation budgets', () => {
    const run = createRun({
      budgets: {
        ...DEFAULT_AUTONOMOUS_RUN_BUDGETS,
        maxWallMs: 1,
        maxModelTurns: 1,
        maxToolCalls: 1,
        maxPromptBytesPerTurn: 10,
        maxObservationBytesPerTurn: 10,
      },
      startedAt: NOW - 2,
    });

    expect(reviewAutonomousRunAction(run, [], { kind: 'model_turn' }, NOW).reason).toBe('wall_budget_exhausted');
    expect(reviewAutonomousRunAction({ ...run, budgets: { ...run.budgets, maxWallMs: 100 } }, [
      createStep({ phase: 'model_turn' }),
    ], { kind: 'model_turn' }, NOW).reason).toBe('model_turn_budget_exhausted');
    expect(reviewAutonomousRunAction({ ...run, budgets: { ...run.budgets, maxWallMs: 100 } }, [
      createStep({ toolCallIds: ['tool-1'] }),
    ], { kind: 'tool_call', toolName: 'safe_tool', descriptor: createDescriptor('safe_tool', 'low') }, NOW).reason).toBe('tool_call_budget_exhausted');
    expect(reviewAutonomousRunAction({ ...run, budgets: { ...run.budgets, maxWallMs: 100 } }, [], { kind: 'model_turn', promptBytes: 11 }, NOW).reason).toBe('prompt_budget_exhausted');
    expect(reviewAutonomousRunAction({ ...run, budgets: { ...run.budgets, maxWallMs: 100 } }, [], { kind: 'model_turn', observationBytes: 11 }, NOW).reason).toBe('observation_budget_exhausted');
  });

  it('enforces denied tools, allowlists, and descriptor disabled mode', () => {
    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, deniedTools: ['bad_tool'] },
    }), [], {
      kind: 'tool_call',
      toolName: 'bad_tool',
      descriptor: createDescriptor('bad_tool', 'low'),
    }, NOW).reason).toBe('tool_denied');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, allowedTools: ['safe_tool'] },
    }), [], {
      kind: 'tool_call',
      toolName: 'other_tool',
      descriptor: createDescriptor('other_tool', 'low'),
    }, NOW).reason).toBe('tool_not_allowlisted');

    expect(reviewAutonomousRunAction(createRun(), [], {
      kind: 'tool_call',
      toolName: 'disabled_tool',
      descriptor: createDescriptor('disabled_tool', 'low', false),
    }, NOW).reason).toBe('tool_disabled');
  });

  it('requires verified target lease for browser mutation tools', () => {
    const run = createRun({ targetLeaseId: 'lease-1' });
    const descriptor = createDescriptor('browser_click', 'low');

    expect(reviewAutonomousRunAction(createRun(), [], {
      kind: 'tool_call',
      toolName: 'browser_click',
      descriptor,
      targetLeaseOk: true,
    }, NOW).reason).toBe('browser_target_lease_required');

    expect(reviewAutonomousRunAction(run, [], {
      kind: 'tool_call',
      toolName: 'browser_click',
      descriptor,
    }, NOW).reason).toBe('browser_target_lease_required');

    expect(reviewAutonomousRunAction(run, [], {
      kind: 'tool_call',
      toolName: 'browser_click',
      descriptor,
      targetLeaseOk: true,
    }, NOW).decision).toBe('allow');

    expect(reviewAutonomousRunAction(createRun(), [], {
      kind: 'tool_call',
      toolName: 'browser_evaluate_script',
      descriptor: createDescriptor('browser_evaluate_script', 'high', true, 'manual'),
    }, NOW).reason).toBe('browser_target_lease_required');
  });

  it('applies shell and memory persistence policy', () => {
    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, shellMode: 'disabled' },
    }), [], {
      kind: 'tool_call',
      toolName: 'shell_exec',
      descriptor: createDescriptor('shell_exec', 'high', true, 'manual'),
    }, NOW).reason).toBe('shell_disabled');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, shellMode: 'manual' },
    }), [], {
      kind: 'tool_call',
      toolName: 'shell_exec',
      descriptor: createDescriptor('shell_exec', 'low'),
    }, NOW).decision).toBe('manual_review');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, persistMemory: 'off' },
    }), [], {
      kind: 'tool_call',
      toolName: 'memory_save',
      descriptor: createDescriptor('memory_save', 'low', true, 'manual'),
    }, NOW).reason).toBe('memory_disabled');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, persistMemory: 'propose', approvalMode: 'confirm_high_risk' },
    }), [], {
      kind: 'tool_call',
      toolName: 'memory_update',
      descriptor: createDescriptor('memory_update', 'medium'),
    }, NOW).reason).toBe('memory_requires_review');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, persistMemory: 'off' },
    }), [], {
      kind: 'tool_call',
      toolName: 'memory_delete',
      descriptor: createDescriptor('memory_delete', 'medium'),
    }, NOW).reason).toBe('memory_disabled');
  });

  it('treats non-prefixed Shell Local tools as shell tools', () => {
    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, shellMode: 'disabled' },
    }), [], {
      kind: 'tool_call',
      toolName: 'local_folder_pick',
      descriptor: createDescriptor('local_folder_pick', 'low'),
    }, NOW).reason).toBe('shell_disabled');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, shellMode: 'allowlisted', allowedTools: ['local_folder_pick'] },
    }), [], {
      kind: 'tool_call',
      toolName: 'local_folder_pick',
      descriptor: createDescriptor('local_folder_pick', 'low'),
    }, NOW).decision).toBe('allow');
  });

  it('routes risk through approval mode', () => {
    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, approvalMode: 'confirm_high_risk' },
    }), [], {
      kind: 'tool_call',
      toolName: 'web_fetch',
      descriptor: createDescriptor('web_fetch', 'medium', true, 'manual'),
    }, NOW).reason).toBe('descriptor_requires_manual');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, deniedTools: ['web_fetch'] },
    }), [], {
      kind: 'tool_call',
      toolName: 'web_fetch',
      descriptor: createDescriptor('web_fetch', 'medium', true, 'manual'),
    }, NOW).reason).toBe('tool_denied');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, allowedTools: ['web_search'] },
    }), [], {
      kind: 'tool_call',
      toolName: 'web_fetch',
      descriptor: createDescriptor('web_fetch', 'medium', true, 'manual'),
    }, NOW).reason).toBe('tool_not_allowlisted');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, approvalMode: 'manual_all' },
    }), [], {
      kind: 'tool_call',
      toolName: 'safe_tool',
      descriptor: createDescriptor('safe_tool', 'low'),
    }, NOW).reason).toBe('manual_all');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, approvalMode: 'confirm_high_risk' },
    }), [], {
      kind: 'tool_call',
      toolName: 'danger_tool',
      descriptor: createDescriptor('danger_tool', 'high'),
    }, NOW).reason).toBe('risk_requires_review');

    expect(reviewAutonomousRunAction(createRun({
      policy: { ...DEFAULT_AUTONOMOUS_RUN_POLICY, approvalMode: 'auto_low_risk' },
    }), [], {
      kind: 'tool_call',
      toolName: 'medium_tool',
      descriptor: createDescriptor('medium_tool', 'medium'),
    }, NOW).reason).toBe('risk_requires_review');
  });
});

function createRun(overrides: Partial<AutonomousRun> = {}): AutonomousRun {
  return {
    id: 'run-1',
    goal: 'Autonomous worker',
    mode: 'unattended',
    status: 'running',
    modelAdapter: 'deepseek_web',
    targetLeaseId: null,
    budgets: DEFAULT_AUTONOMOUS_RUN_BUDGETS,
    policy: DEFAULT_AUTONOMOUS_RUN_POLICY,
    proofContract: DEFAULT_AUTONOMOUS_PROOF_CONTRACT,
    checkpoint: {
      providerConversationId: null,
      parentMessageId: null,
      latestStepId: null,
      resumableSummary: '',
      unresolvedQuestions: [],
    },
    error: null,
    createdAt: NOW,
    startedAt: NOW,
    completedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function createStep(overrides: Partial<AutonomousRunStep> = {}): AutonomousRunStep {
  return {
    id: 'step-1',
    runId: 'run-1',
    seq: 1,
    phase: 'tool_execution',
    status: 'succeeded',
    modelTurnId: null,
    toolCallIds: [],
    observationRefs: [],
    evidenceRefs: [],
    progressScore: 0,
    proofDelta: [],
    error: null,
    startedAt: NOW,
    endedAt: NOW,
    ...overrides,
  };
}

function createDescriptor(
  name: string,
  risk: ToolDescriptor['execution']['risk'],
  enabled = true,
  mode: ToolDescriptor['execution']['mode'] = enabled ? 'auto' : 'disabled',
): Pick<ToolDescriptor, 'name' | 'execution'> {
  return {
    name,
    execution: {
      enabled,
      mode,
      risk,
    },
  };
}
