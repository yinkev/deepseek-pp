/**
 * Thin bridge from extension vault → host disk vault via native port.
 * Callers: account-vault (push), runtime (register post + apply snapshot).
 * Tabs are NOT required. Host never calls DeepSeek.
 */

export type HostVaultPost = (message: Record<string, unknown>) => void;

let postToHost: HostVaultPost | null = null;

export function setHostVaultPost(fn: HostVaultPost | null): void {
  postToHost = fn;
}

function post(message: Record<string, unknown>): void {
  try {
    postToHost?.(message);
  } catch {
    // host optional
  }
}

/** Fire-and-forget upsert to host disk vault. */
export function pushVaultUpsertToHost(
  headers: Record<string, string>,
  options?: { label?: string; makeDefault?: boolean },
): void {
  if (!headers?.Authorization) return;
  post({
    type: 'vault_upsert',
    requestId: `vu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    headers: { ...headers },
    label: options?.label,
    makeDefault: options?.makeDefault === true,
  });
}

export function pushVaultRemoveToHost(accountId: string): void {
  const id = (accountId ?? '').trim();
  if (!id) return;
  post({
    type: 'vault_remove',
    requestId: `vr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    accountId: id,
  });
}

export function pushVaultMarkUsedToHost(accountId: string): void {
  const id = (accountId ?? '').trim();
  if (!id) return;
  post({
    type: 'vault_mark_used',
    requestId: `vm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    accountId: id,
  });
}

/** Ask host to send vault_snapshot (runtime handles response). */
export function requestHostVaultSnapshot(): void {
  post({
    type: 'vault_get',
    requestId: `vg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
}
