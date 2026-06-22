import type { BrowserControlTarget } from '../browser-control/types';
import type {
  AutonomousEvidenceRecord,
  AutonomousRunError,
  AutonomousTargetLease,
} from './types';

export const DEFAULT_AUTONOMOUS_TARGET_LEASE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_AUTONOMOUS_EVIDENCE_TTL_MS = 2 * 60 * 1000;

export interface AutonomousTargetLeaseReview {
  ok: boolean;
  reason:
    | 'missing_lease'
    | 'inactive_lease'
    | 'expired_lease'
    | 'target_missing'
    | 'target_not_controllable'
    | 'tab_mismatch'
    | 'window_mismatch'
    | 'origin_mismatch'
    | null;
  error: AutonomousRunError | null;
}

export interface AutonomousEvidenceReview {
  ok: boolean;
  reason:
    | 'missing_evidence'
    | 'expired_evidence'
    | 'stale_evidence'
    | 'inactive_lease'
    | 'expired_lease'
    | 'lease_mismatch'
    | 'source_tab_mismatch'
    | 'source_window_mismatch'
    | 'missing_refs'
    | null;
  error: AutonomousRunError | null;
}

export function reviewAutonomousTargetLease(
  lease: AutonomousTargetLease | null,
  target: Pick<BrowserControlTarget, 'id' | 'windowId' | 'url' | 'controllable'> | null,
  now = Date.now(),
): AutonomousTargetLeaseReview {
  if (!lease) return leaseError('missing_lease', 'No target lease is attached to this autonomous run.', now);
  if (lease.status !== 'active') return leaseError('inactive_lease', 'Target lease is not active.', now);
  if (lease.expiresAt <= now) return leaseError('expired_lease', 'Target lease has expired.', now);
  if (!target) return leaseError('target_missing', 'Target tab is not available.', now);
  if (!target.controllable) return leaseError('target_not_controllable', 'Target tab is no longer controllable.', now);
  if (target.id !== lease.tabId) return leaseError('tab_mismatch', 'Target tab id no longer matches the lease.', now);
  if (target.windowId !== lease.windowId) return leaseError('window_mismatch', 'Target window id no longer matches the lease.', now);
  if (getOrigin(target.url) !== lease.origin) return leaseError('origin_mismatch', 'Target origin no longer matches the lease.', now);
  return { ok: true, reason: null, error: null };
}

export function reviewAutonomousEvidenceFreshness(
  evidence: AutonomousEvidenceRecord | null,
  lease: AutonomousTargetLease | null,
  now = Date.now(),
): AutonomousEvidenceReview {
  if (!evidence) return evidenceError('missing_evidence', 'No evidence record is available.', now);
  if (evidence.expiresAt <= now || evidence.freshness === 'expired') {
    return evidenceError('expired_evidence', 'Evidence has expired.', now);
  }
  if (evidence.freshness === 'stale') return evidenceError('stale_evidence', 'Evidence is marked stale.', now);
  if (lease?.status && lease.status !== 'active') {
    return evidenceError('inactive_lease', 'Evidence target lease is not active.', now);
  }
  if (lease && lease.expiresAt <= now) {
    return evidenceError('expired_lease', 'Evidence target lease has expired.', now);
  }
  if (lease && evidence.leaseId !== lease.id) {
    return evidenceError('lease_mismatch', 'Evidence does not belong to the active target lease.', now);
  }
  if (lease && typeof evidence.source.tabId === 'number' && evidence.source.tabId !== lease.tabId) {
    return evidenceError('source_tab_mismatch', 'Evidence source tab does not match the target lease.', now);
  }
  if (lease && typeof evidence.source.windowId === 'number' && evidence.source.windowId !== lease.windowId) {
    return evidenceError('source_window_mismatch', 'Evidence source window does not match the target lease.', now);
  }
  if (evidence.refs.length === 0) return evidenceError('missing_refs', 'Evidence has no durable metadata refs.', now);
  return { ok: true, reason: null, error: null };
}

export function getOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return '';
  }
}

function leaseError(
  reason: NonNullable<AutonomousTargetLeaseReview['reason']>,
  message: string,
  now: number,
): AutonomousTargetLeaseReview {
  return {
    ok: false,
    reason,
    error: {
      code: `target_lease_${reason}`,
      message,
      phase: 'policy',
      retryable: reason !== 'origin_mismatch',
      at: now,
    },
  };
}

function evidenceError(
  reason: NonNullable<AutonomousEvidenceReview['reason']>,
  message: string,
  now: number,
): AutonomousEvidenceReview {
  return {
    ok: false,
    reason,
    error: {
      code: `evidence_${reason}`,
      message,
      phase: 'verification',
      retryable: true,
      at: now,
    },
  };
}
