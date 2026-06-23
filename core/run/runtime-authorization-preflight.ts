import {
  evaluateAutonomousDocResumptionGate,
  type AutonomousDocResumptionDocument,
  type AutonomousDocResumptionGateReason,
  type AutonomousDocResumptionGateStatus,
  type AutonomousDocResumptionMarkerCode,
} from './doc-resumption-gate';
import {
  evaluateAutonomousRuntimeResumeGate,
  type AutonomousRuntimeResumeGateInput,
  type AutonomousRuntimeResumeGateReason,
  type AutonomousRuntimeResumeGateStatus,
  type AutonomousRuntimeResumeScope,
} from './runtime-resume-gate';

export type AutonomousRuntimeAuthorizationPreflightStatus = 'blocked' | 'authorized';

export type AutonomousRuntimeAuthorizationPreflightReason =
  | AutonomousDocResumptionGateReason
  | AutonomousRuntimeResumeGateReason;

export interface AutonomousRuntimeAuthorizationPreflightInput {
  documents?: AutonomousDocResumptionDocument[] | null;
  runtime?: AutonomousRuntimeResumeGateInput;
}

export interface AutonomousRuntimeAuthorizationPreflightDecision {
  status: AutonomousRuntimeAuthorizationPreflightStatus;
  canStartRuntimeSlice: boolean;
  reason: AutonomousRuntimeAuthorizationPreflightReason;
  docGateStatus: AutonomousDocResumptionGateStatus;
  docGateReason: AutonomousDocResumptionGateReason;
  docMissingMarkerCodes: AutonomousDocResumptionMarkerCode[];
  runtimeGateStatus: AutonomousRuntimeResumeGateStatus;
  runtimeGateReason: AutonomousRuntimeResumeGateReason;
  checkedMarkerCount: number;
  missingMarkerCount: number;
  openP1Count: number;
  openP2Count: number;
  runtimeFilesChanged: boolean;
  authorizationPresent: boolean;
  authorizationExplicit: boolean;
  authorizationIdPresent: boolean;
  authorizationFresh: boolean;
  authorizationScope: AutonomousRuntimeResumeScope | null;
}

export function evaluateAutonomousRuntimeAuthorizationPreflight(
  input: AutonomousRuntimeAuthorizationPreflightInput = {},
): AutonomousRuntimeAuthorizationPreflightDecision {
  const docGate = evaluateAutonomousDocResumptionGate({ documents: input.documents });
  const runtimeGate = evaluateAutonomousRuntimeResumeGate(input.runtime);
  const canStartRuntimeSlice = docGate.status === 'passed' && runtimeGate.status === 'authorized';

  return {
    status: canStartRuntimeSlice ? 'authorized' : 'blocked',
    canStartRuntimeSlice,
    reason: docGate.status === 'blocked' ? docGate.reason : runtimeGate.reason,
    docGateStatus: docGate.status,
    docGateReason: docGate.reason,
    docMissingMarkerCodes: [...docGate.missingMarkerCodes],
    runtimeGateStatus: runtimeGate.status,
    runtimeGateReason: runtimeGate.reason,
    checkedMarkerCount: docGate.checkedMarkerCodes.length,
    missingMarkerCount: docGate.missingMarkerCodes.length,
    openP1Count: runtimeGate.openP1Count,
    openP2Count: runtimeGate.openP2Count,
    runtimeFilesChanged: runtimeGate.runtimeFilesChanged,
    authorizationPresent: runtimeGate.authorizationPresent,
    authorizationExplicit: runtimeGate.authorizationExplicit,
    authorizationIdPresent: runtimeGate.authorizationIdPresent,
    authorizationFresh: runtimeGate.authorizationFresh,
    authorizationScope: runtimeGate.authorizationScope,
  };
}
