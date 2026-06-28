#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_THRESHOLDS = {
  browserCpu: 80,
  pageRendererCpu: 50,
  extensionRendererCpu: 25,
  browserRssMb: 8192,
  pageRendererRssMb: 2048,
  extensionRendererRssMb: 1024,
};

export function parsePsOutput(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (!match) return null;
      const command = match[7];
      if (!isChromeProcess(command)) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pcpu: Number(match[3]),
        pmem: Number(match[4]),
        rssKb: Number(match[5]),
        etime: match[6],
        kind: classifyChromeProcess(command),
        command,
      };
    })
    .filter(Boolean);
}

export function evaluateChromeRuntimePreflight(processes, thresholds = DEFAULT_THRESHOLDS) {
  const effectiveThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const blockers = [];
  const warnings = [];
  const sorted = [...processes].sort((a, b) => b.pcpu - a.pcpu);

  if (processes.length === 0) {
    blockers.push({
      code: 'chrome_not_running',
      message: 'No Google Chrome processes were found.',
    });
  }

  for (const process of sorted) {
    if (process.kind === 'browser' && process.pcpu >= effectiveThresholds.browserCpu) {
      blockers.push(createHotProcessBlocker('chrome_main_cpu_hot', process, effectiveThresholds.browserCpu));
    }
    if (process.kind === 'page-renderer' && process.pcpu >= effectiveThresholds.pageRendererCpu) {
      blockers.push(createHotProcessBlocker('chrome_page_renderer_cpu_hot', process, effectiveThresholds.pageRendererCpu));
    }
    if (process.kind === 'extension-renderer' && process.pcpu >= effectiveThresholds.extensionRendererCpu) {
      blockers.push(createHotProcessBlocker('chrome_extension_renderer_cpu_hot', process, effectiveThresholds.extensionRendererCpu));
    }
    const rssMb = rssMegabytes(process);
    if (process.kind === 'browser' && rssMb >= effectiveThresholds.browserRssMb) {
      warnings.push(createHighMemoryWarning('chrome_main_rss_high', process, effectiveThresholds.browserRssMb));
    }
    if (process.kind === 'page-renderer' && rssMb >= effectiveThresholds.pageRendererRssMb) {
      warnings.push(createHighMemoryWarning('chrome_page_renderer_rss_high', process, effectiveThresholds.pageRendererRssMb));
    }
    if (process.kind === 'extension-renderer' && rssMb >= effectiveThresholds.extensionRendererRssMb) {
      warnings.push(createHighMemoryWarning('chrome_extension_renderer_rss_high', process, effectiveThresholds.extensionRendererRssMb));
    }
  }

  return {
    status: blockers.length === 0 ? 'go' : 'no-go',
    thresholds: effectiveThresholds,
    blockers,
    warnings,
    topProcesses: sorted.slice(0, 8).map(toPublicProcessSummary),
  };
}

export function formatChromeRuntimePreflightReport(result) {
  const lines = [
    `Chrome runtime preflight: ${result.status.toUpperCase()}`,
    `Thresholds: browser >= ${result.thresholds.browserCpu}% CPU, page renderer >= ${result.thresholds.pageRendererCpu}% CPU, extension renderer >= ${result.thresholds.extensionRendererCpu}% CPU.`,
    `Memory warnings: browser >= ${result.thresholds.browserRssMb} MB RSS, page renderer >= ${result.thresholds.pageRendererRssMb} MB RSS, extension renderer >= ${result.thresholds.extensionRendererRssMb} MB RSS.`,
  ];

  if (result.blockers.length > 0) {
    lines.push('', 'Blockers:');
    for (const blocker of result.blockers) {
      lines.push(`- ${blocker.code}: ${blocker.message}`);
    }
    lines.push('', 'Do not attach DevTools, automate Chrome, or run the live sidepanel smoke until this preflight returns GO.');
  }

  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of result.warnings) {
      lines.push(`- ${warning.code}: ${warning.message}`);
    }
  }

  if (result.topProcesses.length > 0) {
    lines.push('', 'Top Chrome processes:');
    for (const process of result.topProcesses) {
      lines.push(`- pid ${process.pid} ${process.kind} cpu ${process.pcpu}% rss ${process.rssMb} MB elapsed ${process.etime}`);
    }
  }

  return lines.join('\n');
}

function isChromeProcess(command) {
  return command.includes('/Google Chrome.app/')
    || command.includes('Google Chrome Helper')
    || command.includes('chrome-extension://');
}

function classifyChromeProcess(command) {
  if (command.includes('chrome_crashpad_handler')) return 'crashpad';
  if (command.includes('--extension-process')) return 'extension-renderer';
  if (command.includes('--type=renderer')) return 'page-renderer';
  if (command.includes('--type=gpu-process')) return 'gpu';
  if (command.includes('--type=utility')) return 'utility';
  if (command.includes('/Google Chrome.app/Contents/MacOS/Google Chrome')) return 'browser';
  return 'other';
}

function createHotProcessBlocker(code, process, threshold) {
  return {
    code,
    pid: process.pid,
    kind: process.kind,
    pcpu: process.pcpu,
    threshold,
    message: `pid ${process.pid} ${process.kind} is at ${process.pcpu}% CPU, above the ${threshold}% threshold.`,
  };
}

function createHighMemoryWarning(code, process, threshold) {
  const rssMb = rssMegabytes(process);
  return {
    code,
    pid: process.pid,
    kind: process.kind,
    rssMb,
    threshold,
    message: `pid ${process.pid} ${process.kind} is using ${rssMb} MB RSS, above the ${threshold} MB warning threshold.`,
  };
}

function toPublicProcessSummary(process) {
  return {
    pid: process.pid,
    ppid: process.ppid,
    kind: process.kind,
    pcpu: process.pcpu,
    pmem: process.pmem,
    rssMb: rssMegabytes(process),
    etime: process.etime,
  };
}

function rssMegabytes(process) {
  return Math.round(process.rssKb / 1024);
}

function parseArgs(argv) {
  const options = {
    json: false,
    psFile: null,
    thresholds: { ...DEFAULT_THRESHOLDS },
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--ps-file') {
      options.psFile = argv[++index] ?? null;
    } else if (arg === '--browser-cpu') {
      options.thresholds.browserCpu = parsePositiveNumber(argv[++index], 'browser CPU threshold');
    } else if (arg === '--page-renderer-cpu') {
      options.thresholds.pageRendererCpu = parsePositiveNumber(argv[++index], 'page renderer CPU threshold');
    } else if (arg === '--extension-renderer-cpu') {
      options.thresholds.extensionRendererCpu = parsePositiveNumber(argv[++index], 'extension renderer CPU threshold');
    } else if (arg === '--browser-rss-mb') {
      options.thresholds.browserRssMb = parsePositiveNumber(argv[++index], 'browser RSS warning threshold');
    } else if (arg === '--page-renderer-rss-mb') {
      options.thresholds.pageRendererRssMb = parsePositiveNumber(argv[++index], 'page renderer RSS warning threshold');
    } else if (arg === '--extension-renderer-rss-mb') {
      options.thresholds.extensionRendererRssMb = parsePositiveNumber(argv[++index], 'extension renderer RSS warning threshold');
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parsePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return number;
}

function readPsSnapshot(psFile) {
  if (psFile) return readFileSync(psFile, 'utf8');
  return execFileSync('ps', ['-axo', 'pid,ppid,pcpu,pmem,rss,etime,command'], {
    encoding: 'utf8',
  });
}

function printHelp() {
  console.log(`Usage: node scripts/chrome-runtime-preflight.mjs [options]

Passive go/no-go gate before running DeepSeek++ live Chrome sidepanel smoke.

Options:
  --json                         Print JSON instead of text.
  --ps-file <path>               Read a saved ps snapshot instead of running ps.
  --browser-cpu <n>              Main Chrome CPU no-go threshold. Default: ${DEFAULT_THRESHOLDS.browserCpu}
  --page-renderer-cpu <n>        Page renderer CPU no-go threshold. Default: ${DEFAULT_THRESHOLDS.pageRendererCpu}
  --extension-renderer-cpu <n>   Extension renderer CPU no-go threshold. Default: ${DEFAULT_THRESHOLDS.extensionRendererCpu}
  --browser-rss-mb <n>           Main Chrome RSS warning threshold. Default: ${DEFAULT_THRESHOLDS.browserRssMb}
  --page-renderer-rss-mb <n>     Page renderer RSS warning threshold. Default: ${DEFAULT_THRESHOLDS.pageRendererRssMb}
  --extension-renderer-rss-mb <n>
                                  Extension renderer RSS warning threshold. Default: ${DEFAULT_THRESHOLDS.extensionRendererRssMb}
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const processes = parsePsOutput(readPsSnapshot(options.psFile));
  const result = evaluateChromeRuntimePreflight(processes, options.thresholds);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatChromeRuntimePreflightReport(result));
  }
  process.exit(result.status === 'go' ? 0 : 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
