import { describe, expect, it } from 'vitest';
import { planAutonomousReviewLanes } from '../core/run/review-scheduler';

describe('autonomous review lane scheduler', () => {
  it('returns idle for defaults or no runnable run and allows no roles', () => {
    expect(planAutonomousReviewLanes()).toEqual({
      action: 'idle',
      selectedRoles: [],
      canRunWorker: false,
      reason: 'no_runnable_run',
      blockingPriority: null,
      blockingLaneCount: 0,
      maxParallel: 2,
    });

    expect(planAutonomousReviewLanes({ runStatus: 'paused' })).toMatchObject({
      action: 'idle',
      selectedRoles: [],
      canRunWorker: false,
      reason: 'no_runnable_run',
    });
  });

  it('returns idle for non-runnable runs even with a stale blocked gate', () => {
    expect(planAutonomousReviewLanes({
      runStatus: 'succeeded',
      reviewLaneGate: {
        status: 'blocked',
        reason: 'p1',
        canProceed: false,
        blockingPriority: 'P1',
        blockingLaneCount: 9,
      },
      workerAdvanced: true,
      risk: { shell: true },
      oracleRequested: true,
    })).toEqual({
      action: 'idle',
      selectedRoles: [],
      canRunWorker: false,
      reason: 'no_runnable_run',
      blockingPriority: null,
      blockingLaneCount: 0,
      maxParallel: 2,
    });
  });

  it('halts on P1, P2, or block recommendation before dispatching roles', () => {
    const cases = [
      {
        gate: { status: 'attention' as const, reason: 'p1', canProceed: true, blockingPriority: null, blockingLaneCount: 3 },
        priority: 'P1',
        reason: 'review_gate_p1',
      },
      {
        gate: { status: 'clear' as const, reason: 'none' as const, canProceed: true, blockingPriority: 'P2' as const, blockingLaneCount: 2 },
        priority: 'P2',
        reason: 'review_gate_p2',
      },
      {
        gate: { status: 'attention' as const, reason: 'block_recommendation', canProceed: true, blockingPriority: null, blockingLaneCount: 1 },
        priority: null,
        reason: 'review_gate_block_recommendation',
      },
    ];

    for (const testCase of cases) {
      expect(planAutonomousReviewLanes({
        runStatus: 'queued',
        reviewLaneGate: testCase.gate,
        workerAdvanced: true,
        risk: { shell: true, ui: true },
        oracleRequested: true,
      })).toMatchObject({
        action: 'halt',
        selectedRoles: [],
        canRunWorker: false,
        reason: testCase.reason,
        blockingPriority: testCase.priority,
        blockingLaneCount: testCase.gate.blockingLaneCount,
      });
    }
  });

  it('halts on contradictory blocked gate fields before any dispatch', () => {
    expect(planAutonomousReviewLanes({
      runStatus: 'running',
      reviewLaneGate: {
        status: 'blocked',
        reason: 'none',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 0,
      },
      workerAdvanced: true,
    })).toMatchObject({
      action: 'halt',
      selectedRoles: [],
      canRunWorker: false,
      reason: 'review_gate_blocked',
    });

    expect(planAutonomousReviewLanes({
      runStatus: 'running',
      reviewLaneGate: {
        status: 'clear',
        reason: 'none',
        canProceed: false,
        blockingPriority: null,
        blockingLaneCount: Number.NaN,
      },
    })).toMatchObject({
      action: 'halt',
      blockingLaneCount: 0,
      reason: 'review_gate_blocked',
    });
  });

  it('does not halt on attention gates and can still dispatch', () => {
    for (const reason of ['active_review', 'failed_lane', 'blocked_lane'] as const) {
      expect(planAutonomousReviewLanes({
        runStatus: 'queued',
        reviewLaneGate: {
          status: 'attention',
          reason,
          canProceed: true,
          blockingPriority: null,
          blockingLaneCount: 0,
        },
      })).toMatchObject({
        action: 'dispatch',
        selectedRoles: ['implementer'],
        canRunWorker: true,
        reason: 'dispatch_lanes',
      });
    }
  });

  it('holds when active lane count is already at maxParallel', () => {
    expect(planAutonomousReviewLanes({
      runStatus: 'queued',
      maxParallel: 2,
      lanes: [
        { role: 'reviewer', status: 'running' },
        { role: 'safety', status: 'active' },
      ],
      risk: { ui: true },
    })).toMatchObject({
      action: 'hold',
      selectedRoles: [],
      canRunWorker: true,
      reason: 'at_capacity',
      maxParallel: 2,
    });
  });

  it('counts unknown active lanes against maxParallel without leaking the role', () => {
    const input = {
      runStatus: 'queued',
      maxParallel: 1,
      lanes: [
        {
          role: 'SECRET_UNKNOWN_ROLE',
          status: 'running',
          prompt: 'SECRET_PROMPT',
        },
      ],
      workerAdvanced: true,
      risk: { shell: true },
    } as any;

    const plan = planAutonomousReviewLanes(input);

    expect(plan).toMatchObject({
      action: 'hold',
      selectedRoles: [],
      canRunWorker: true,
      reason: 'at_capacity',
      maxParallel: 1,
    });
    expect(JSON.stringify(plan)).not.toMatch(/SECRET_UNKNOWN_ROLE|SECRET_PROMPT/);
  });

  it('dispatches implementer first for queued or running work', () => {
    expect(planAutonomousReviewLanes({
      runStatus: 'queued',
      maxParallel: 1,
      workerAdvanced: true,
      risk: { shell: true },
      oracleRequested: true,
    })).toMatchObject({
      action: 'dispatch',
      selectedRoles: ['implementer'],
    });

    expect(planAutonomousReviewLanes({ runStatus: 'running' }).selectedRoles[0]).toBe('implementer');
  });

  it('dispatches reviewer after worker progress when implementer is occupied', () => {
    expect(planAutonomousReviewLanes({
      runStatus: 'running',
      lanes: [{ role: 'implementer', status: 'passed' }],
      workerApplied: true,
    })).toMatchObject({
      action: 'dispatch',
      selectedRoles: ['reviewer'],
    });

    expect(planAutonomousReviewLanes({
      runStatus: 'running',
      lanes: [{ role: 'implementer', status: 'passed' }],
      workerAdvanced: true,
    })).toMatchObject({
      selectedRoles: ['reviewer'],
    });
  });

  it('dispatches safety for shell, browser, or memory risk', () => {
    for (const risk of [{ shell: true }, { browser: true }, { memory: true }]) {
      expect(planAutonomousReviewLanes({
        runStatus: 'running',
        lanes: [
          { role: 'implementer', status: 'passed' },
          { role: 'reviewer', status: 'passed' },
        ],
        risk,
      })).toMatchObject({
        action: 'dispatch',
        selectedRoles: ['safety'],
      });
    }
  });

  it('dispatches ux for ui risk', () => {
    expect(planAutonomousReviewLanes({
      runStatus: 'running',
      lanes: [
        { role: 'implementer', status: 'passed' },
        { role: 'reviewer', status: 'passed' },
        { role: 'safety', status: 'passed' },
      ],
      risk: { ui: true },
    })).toMatchObject({
      action: 'dispatch',
      selectedRoles: ['ux'],
    });
  });

  it('dispatches oracle only when requested and capacity remains', () => {
    const completedCoreLanes = [
      { role: 'implementer' as const, status: 'passed' as const },
      { role: 'reviewer' as const, status: 'passed' as const },
      { role: 'safety' as const, status: 'passed' as const },
      { role: 'ux' as const, status: 'passed' as const },
    ];

    expect(planAutonomousReviewLanes({
      runStatus: 'running',
      lanes: completedCoreLanes,
      oracleRequested: false,
    })).toMatchObject({
      action: 'idle',
      selectedRoles: [],
      canRunWorker: true,
      reason: 'no_pending_lanes',
    });

    expect(planAutonomousReviewLanes({
      runStatus: 'running',
      lanes: completedCoreLanes,
      oracleRequested: true,
    })).toMatchObject({
      action: 'dispatch',
      selectedRoles: ['oracle'],
    });

    expect(planAutonomousReviewLanes({
      runStatus: 'running',
      maxParallel: 1,
      lanes: [{ role: 'reviewer', status: 'running' }],
      oracleRequested: true,
    })).toMatchObject({
      action: 'hold',
      selectedRoles: [],
    });
  });

  it('caps role selection by maxParallel', () => {
    expect(planAutonomousReviewLanes({
      runStatus: 'running',
      maxParallel: 2,
      workerAdvanced: true,
      risk: { shell: true, ui: true },
      oracleRequested: true,
    })).toMatchObject({
      action: 'dispatch',
      selectedRoles: ['implementer', 'reviewer'],
      maxParallel: 2,
    });
  });

  it('keeps raw secret fields out of planner output JSON', () => {
    const input = {
      runStatus: 'running',
      workerAdvanced: true,
      risk: { shell: true, browser: true, memory: true, ui: true, rawUrl: 'https://secret.invalid/path' },
      oracleRequested: true,
      lanes: [
        {
          role: 'implementer',
          status: 'passed',
          label: 'SECRET_LABEL',
          transcript: 'SECRET_TRANSCRIPT',
          prompt: 'SECRET_PROMPT',
          url: 'https://secret.invalid/token',
          id: 'SECRET_ID',
        },
      ],
      rawMessage: 'SECRET_MESSAGE',
    } as any;

    expect(JSON.stringify(input)).toMatch(/SECRET_LABEL|SECRET_TRANSCRIPT|SECRET_PROMPT|secret\.invalid|SECRET_MESSAGE/);
    expect(JSON.stringify(planAutonomousReviewLanes(input))).not.toMatch(
      /SECRET_LABEL|SECRET_TRANSCRIPT|SECRET_PROMPT|secret\.invalid|SECRET_MESSAGE|SECRET_ID/,
    );
  });

  it('adversarial probe: halt plans never dispatch roles or allow worker execution', () => {
    const plan = planAutonomousReviewLanes({
      runStatus: 'queued',
      reviewLaneGate: {
        status: 'clear',
        reason: 'p2',
        canProceed: true,
        blockingPriority: null,
        blockingLaneCount: 1,
      },
      workerAdvanced: true,
      risk: { shell: true, browser: true, memory: true, ui: true },
      oracleRequested: true,
    });

    expect(plan).toMatchObject({
      action: 'halt',
      selectedRoles: [],
      canRunWorker: false,
      blockingPriority: 'P2',
      blockingLaneCount: 1,
    });
  });
});
