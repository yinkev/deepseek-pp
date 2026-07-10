// Barrel for bridge modules. Callers: tests, runtime entrypoints.
// User: "proceed" — export eni-prompt (storage override + reinject-on-change).
export * from './protocol';
export * from './openai';
export * from './worker';
export * from './runtime';
export * from './thread-store';
export * from './tool-loop';
export * from './harness';
export * from './eni-prompt';
export * from './openai-tools';
export * from './eni-policy';
export * from './eni-memory';
export * from './eni-bond';
export * from './eni-tools-policy';
export * from './eni-life';
// Multi-account vault (user: multiple accounts / stop spamming one login).
export * from './account-vault';
export * from './host-vault-bridge';
