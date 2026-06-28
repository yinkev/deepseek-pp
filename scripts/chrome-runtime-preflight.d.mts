export type ChromeProcessKind =
  | 'browser'
  | 'page-renderer'
  | 'extension-renderer'
  | 'gpu'
  | 'utility'
  | 'crashpad'
  | 'other';

export interface ChromeProcessRecord {
  pid: number;
  ppid: number;
  pcpu: number;
  pmem: number;
  rssKb: number;
  etime: string;
  kind: ChromeProcessKind;
  command: string;
}

export interface ChromeRuntimePreflightThresholds {
  browserCpu: number;
  pageRendererCpu: number;
  extensionRendererCpu: number;
  browserRssMb: number;
  pageRendererRssMb: number;
  extensionRendererRssMb: number;
}

export interface ChromeRuntimePreflightBlocker {
  code: string;
  message: string;
  pid?: number;
  kind?: ChromeProcessKind;
  pcpu?: number;
  threshold?: number;
}

export interface ChromeRuntimePreflightWarning {
  code: string;
  message: string;
  pid?: number;
  kind?: ChromeProcessKind;
  rssMb?: number;
  threshold?: number;
}

export interface ChromeProcessSummary {
  pid: number;
  ppid: number;
  kind: ChromeProcessKind;
  pcpu: number;
  pmem: number;
  rssMb: number;
  etime: string;
}

export interface ChromeRuntimePreflightResult {
  status: 'go' | 'no-go';
  thresholds: ChromeRuntimePreflightThresholds;
  blockers: ChromeRuntimePreflightBlocker[];
  warnings: ChromeRuntimePreflightWarning[];
  topProcesses: ChromeProcessSummary[];
}

export function parsePsOutput(output: string): ChromeProcessRecord[];
export function evaluateChromeRuntimePreflight(
  processes: ChromeProcessRecord[],
  thresholds?: Partial<ChromeRuntimePreflightThresholds>,
): ChromeRuntimePreflightResult;
export function formatChromeRuntimePreflightReport(result: ChromeRuntimePreflightResult): string;
