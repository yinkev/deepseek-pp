export {
  browserControlService,
  createBrowserControlToolDescriptors,
  executeBrowserControlToolCall,
  getBrowserControlState,
  isBrowserControlToolName,
} from './tool';

export {
  DEFAULT_BROWSER_CONTROL_SETTINGS,
  getBrowserControlSettings,
  normalizeBrowserControlSettings,
  saveBrowserControlSettings,
  setBrowserControlEnabled,
} from './settings';

export {
  createBrowserActVerifyPrompt,
  shouldVerifyAfterBrowserAction,
} from './act-verify';

export type {
  BrowserActionResult,
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
  BrowserControlTargetHint,
  BrowserControlTargetLock,
  BrowserControlTargetPreparation,
  BrowserControlToolName,
  BrowserScreenshotCaptureResult,
  BrowserSnapshotNode,
  BrowserSnapshotResult,
} from './types';
