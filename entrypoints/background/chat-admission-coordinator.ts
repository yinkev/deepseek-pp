export interface ChatAdmissionLease {
  readonly token: symbol;
}

export interface ChatResetLease {
  readonly token: symbol;
}

export interface ChatAdmissionCoordinator {
  acquire(): ChatAdmissionLease | null;
  release(lease: ChatAdmissionLease): void;
  beginReset(): ChatResetLease;
  endReset(lease: ChatResetLease): void;
  isResetting(): boolean;
}

export function createChatAdmissionCoordinator(): ChatAdmissionCoordinator {
  let activeLease: ChatAdmissionLease | null = null;
  const resetLeases = new Set<ChatResetLease>();

  return Object.freeze({
    acquire() {
      if (activeLease || resetLeases.size > 0) return null;
      activeLease = { token: Symbol('chat-admission') };
      return activeLease;
    },
    release(lease: ChatAdmissionLease) {
      if (activeLease === lease) activeLease = null;
    },
    beginReset() {
      const lease = { token: Symbol('chat-reset') };
      resetLeases.add(lease);
      return lease;
    },
    endReset(lease: ChatResetLease) {
      resetLeases.delete(lease);
    },
    isResetting() {
      return resetLeases.size > 0;
    },
  });
}
