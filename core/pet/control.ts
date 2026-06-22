import {
  type AutonomousRunCockpitSnapshot,
  getAutonomousRunCockpitSnapshot,
} from '../run/orchestrator';

export interface PetControlSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  readiness: {
    status: 'ready' | 'needs_attention' | 'blocked';
    blockers: string[];
    preparing: boolean;
  };
  run: {
    active: boolean;
    label: string | null;
    phase: 'idle' | 'thinking' | 'speaking' | 'working' | 'reviewing' | 'blocked' | 'done';
    nextAction: string | null;
  };
  target: {
    locked: boolean;
    label: string | null;
    stale: boolean;
  };
  safety: {
    leakIssueCount: number;
    highRiskArmed: boolean;
  };
}

export function createPetControlSnapshotFromRunCockpit(
  snapshot: AutonomousRunCockpitSnapshot,
): PetControlSnapshot {
  const activeRun = snapshot.activeRun;
  const cockpitStatus = snapshot.status;

  let readinessStatus: 'ready' | 'needs_attention' | 'blocked' = 'ready';
  const blockers: string[] = [];
  let preparing = false;

  let runActive = false;
  let runLabel: string | null = null;
  let runPhase: PetControlSnapshot['run']['phase'] = 'idle';
  let runNextAction: string | null = null;

  let targetLocked = false;
  let targetLabel: string | null = null;
  const targetStale = false;

  const leakIssueCount = 0;
  let highRiskArmed = false;

  if (activeRun) {
    runLabel = activeRun.goal ?? null;
    targetLocked = !!activeRun.targetLeaseId || (activeRun.targetLeaseCount > 0);
    targetLabel = targetLocked ? 'Target locked' : null;
  }

  // Safety defaults conservative; no high risk signal exposed in cockpit snapshot
  highRiskArmed = false;

  switch (cockpitStatus) {
    case 'idle':
      readinessStatus = 'ready';
      runActive = false;
      runPhase = 'idle';
      runNextAction = null;
      break;

    case 'queued':
      readinessStatus = 'ready';
      runActive = true;
      runPhase = 'thinking';
      runNextAction = 'Start or continue worker cycle';
      preparing = true;
      break;

    case 'running': {
      readinessStatus = 'ready';
      runActive = true;
      const latestPhase = activeRun?.latestStep?.phase;
      if (latestPhase === 'review') {
        runPhase = 'reviewing';
      } else if (latestPhase === 'plan') {
        runPhase = 'thinking';
      } else if (latestPhase === 'finish') {
        runPhase = 'done';
      } else if (
        latestPhase === 'model_turn' ||
        latestPhase === 'tool_selection' ||
        latestPhase === 'tool_execution' ||
        latestPhase === 'observation' ||
        latestPhase === 'verification' ||
        latestPhase === 'checkpoint'
      ) {
        runPhase = 'working';
      } else {
        runPhase = 'working';
      }
      runNextAction = 'Continue autonomous cycle';
      break;
    }

    case 'blocked':
      readinessStatus = 'blocked';
      runActive = true;
      runPhase = 'blocked';
      if (activeRun?.errorCode) {
        blockers.push(activeRun.errorCode);
      } else {
        blockers.push('run_blocked');
      }
      runNextAction = 'Review blocker to resume';
      break;

    case 'paused':
      readinessStatus = 'needs_attention';
      runActive = true;
      runPhase = 'blocked';
      blockers.push('run_paused');
      runNextAction = 'Resume or inspect run';
      break;

    case 'complete':
      readinessStatus = 'ready';
      runActive = !!activeRun;
      runPhase = 'done';
      runNextAction = activeRun ? 'Review result' : null;
      break;

    default:
      readinessStatus = 'ready';
      runActive = false;
      runPhase = 'idle';
      runNextAction = null;
      break;
  }

  return {
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    readiness: {
      status: readinessStatus,
      blockers,
      preparing,
    },
    run: {
      active: runActive,
      label: runLabel,
      phase: runPhase,
      nextAction: runNextAction,
    },
    target: {
      locked: targetLocked,
      label: targetLabel,
      stale: targetStale,
    },
    safety: {
      leakIssueCount,
      highRiskArmed,
    },
  };
}

export async function getPetControlSnapshot(
  now = Date.now(),
): Promise<PetControlSnapshot> {
  const cockpit = await getAutonomousRunCockpitSnapshot(now);
  return createPetControlSnapshotFromRunCockpit(cockpit);
}
