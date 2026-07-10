#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

export const HOST_NAME = 'com.deepseek_pp.cursor_bridge';
export const DEFAULT_PORT = 8787;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const HOST_SOURCE = resolve(PACKAGE_ROOT, 'native', 'cursor-bridge-host.mjs');
const SUPPORTED_BROWSERS = new Set(['chrome', 'chromium', 'edge']);
const COMMANDS = new Set(['install', 'status', 'uninstall']);

export function parseArgs(argv) {
  const args = {
    command: 'install',
    extensionId: null,
    browser: 'chrome',
    port: DEFAULT_PORT,
  };
  const tokens = [...argv];

  if (tokens[0] && COMMANDS.has(tokens[0])) {
    args.command = tokens.shift();
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--extension-id' && tokens[i + 1]) args.extensionId = tokens[++i];
    else if (token === '--browser' && tokens[i + 1]) args.browser = tokens[++i].toLowerCase();
    else if (token === '--port' && tokens[i + 1]) args.port = Number(tokens[++i]);
    else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
  }

  if (!SUPPORTED_BROWSERS.has(args.browser)) {
    throw new Error(`Unsupported browser: ${args.browser}. Use chrome, chromium, or edge.`);
  }
  if (!Number.isFinite(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error(`Invalid --port: ${args.port}`);
  }

  return args;
}

function printHelp() {
  console.log(`DeepSeek++ Cursor Bridge Native Host installer

Usage:
  deepseek-pp-cursor-bridge-host install --browser chrome --extension-id <id>
  deepseek-pp-cursor-bridge-host status --browser chrome
  deepseek-pp-cursor-bridge-host uninstall --browser chrome

Options:
  --extension-id <id>  Chrome/Edge/Chromium extension ID (required for install)
  --browser <name>     chrome | chromium | edge (default: chrome)
  --port <number>      localhost OpenAI port written into the wrapper (default: ${DEFAULT_PORT})
  --help               Show this help

After install:
  1. Keep Chrome open with DeepSeek++ loaded
  2. Keep a logged-in chat.deepseek.com tab open
  3. Point CLIProxyAPI / Cursor at http://127.0.0.1:${DEFAULT_PORT}/v1
`);
}

function getAppDataRoot() {
  const home = homedir();
  if (platform() === 'darwin') return `${home}/Library/Application Support/DeepSeek++`;
  if (platform() === 'linux') return `${home}/.local/share/deepseek-pp`;
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || resolve(home, 'AppData', 'Local');
    return resolve(localAppData, 'DeepSeek++');
  }
  throw new Error(`Unsupported platform: ${platform()}`);
}

function getHostInstallDir() {
  const root = getAppDataRoot();
  return platform() === 'linux'
    ? resolve(root, 'cursor-bridge-host')
    : resolve(root, 'CursorBridgeHost');
}

function getManifestDir(browser) {
  const os = platform();
  const home = homedir();

  if (os === 'darwin') {
    switch (browser) {
      case 'chrome': return `${home}/Library/Application Support/Google/Chrome/NativeMessagingHosts`;
      case 'chromium': return `${home}/Library/Application Support/Chromium/NativeMessagingHosts`;
      case 'edge': return `${home}/Library/Application Support/Microsoft Edge/NativeMessagingHosts`;
      default: return `${home}/Library/Application Support/Google/Chrome/NativeMessagingHosts`;
    }
  }

  if (os === 'linux') {
    switch (browser) {
      case 'chrome': return `${home}/.config/google-chrome/NativeMessagingHosts`;
      case 'chromium': return `${home}/.config/chromium/NativeMessagingHosts`;
      case 'edge': return `${home}/.config/microsoft-edge/NativeMessagingHosts`;
      default: return `${home}/.config/google-chrome/NativeMessagingHosts`;
    }
  }

  if (os === 'win32') {
    return resolve(getAppDataRoot(), 'NativeMessagingHosts');
  }

  throw new Error(`Unsupported platform: ${os}`);
}

function getManifestPath(browser) {
  return resolve(getManifestDir(browser), `${HOST_NAME}.json`);
}

function getRegistryKey(browser) {
  switch (browser) {
    case 'chrome': return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
    case 'edge': return `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`;
    case 'chromium': return `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`;
    default: return null;
  }
}

function buildManifest(args, wrapperPath) {
  if (!args.extensionId) {
    throw new Error('--extension-id is required for Chrome/Edge/Chromium.');
  }
  return {
    name: HOST_NAME,
    description: 'DeepSeek++ Cursor Bridge — localhost OpenAI API via browser-origin DeepSeek web',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${args.extensionId}/`],
  };
}

function copyHostScript(installDir) {
  const hostPath = resolve(installDir, 'cursor-bridge-host.mjs');
  mkdirSync(installDir, { recursive: true });
  copyFileSync(HOST_SOURCE, hostPath);
  if (platform() !== 'win32') chmodSync(hostPath, 0o755);
  return hostPath;
}

function createWrapper(hostPath, port) {
  const installDir = dirname(hostPath);
  const nodePath = process.execPath;

  if (platform() === 'win32') {
    const wrapperPath = resolve(installDir, 'cursor-bridge-host.bat');
    const content = `@echo off\r\nset "CURSOR_BRIDGE_PORT=${port}"\r\n"${nodePath}" "${hostPath}" %*\r\n`;
    writeFileSync(wrapperPath, content);
    return wrapperPath;
  }

  const wrapperPath = resolve(installDir, 'cursor-bridge-host');
  const content = `#!/bin/sh\nexport CURSOR_BRIDGE_PORT=${port}\nexec "${nodePath}" "${hostPath}" "$@"\n`;
  writeFileSync(wrapperPath, content, { mode: 0o755 });
  return wrapperPath;
}

function writeWindowsRegistry(browser, manifestPath) {
  const regKey = getRegistryKey(browser);
  if (!regKey) return;
  try {
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'pipe' });
    console.log(`Registry: ${regKey}`);
  } catch {
    console.error('Warning: Failed to write registry key.');
    console.error(`  Manual: reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
  }
}

function removeWindowsRegistry(browser) {
  const regKey = getRegistryKey(browser);
  if (!regKey) return;
  try {
    execSync(`reg delete "${regKey}" /f`, { stdio: 'pipe' });
    console.log(`Removed registry key: ${regKey}`);
  } catch {
    // ignore
  }
}

function install(args) {
  const manifestPath = getManifestPath(args.browser);
  const manifestDir = dirname(manifestPath);
  const hostPath = copyHostScript(getHostInstallDir());
  const wrapperPath = createWrapper(hostPath, args.port);
  const manifest = buildManifest(args, wrapperPath);

  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  if (platform() === 'win32') {
    writeWindowsRegistry(args.browser, manifestPath);
  }

  console.log('\nInstalled cursor bridge native messaging host:');
  console.log(`  ${manifestPath}\n`);
  console.log(`Host script: ${hostPath}`);
  console.log(`Wrapper:     ${wrapperPath}`);
  console.log(`Host name:   ${HOST_NAME}`);
  console.log(`Browser:     ${args.browser}`);
  console.log(`HTTP port:   ${args.port}`);
  console.log(`Origin:      ${manifest.allowed_origins[0]}`);
  console.log('\nRestart Chrome, open chat.deepseek.com, then:');
  console.log(`  curl http://127.0.0.1:${args.port}/v1/models`);
}

function status(args) {
  const manifestPath = getManifestPath(args.browser);
  console.log(`Host name:   ${HOST_NAME}`);
  console.log(`Manifest:    ${manifestPath}`);
  console.log(`Exists:      ${existsSync(manifestPath)}`);
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    console.log(`Path:        ${manifest.path}`);
    console.log(`Origins:     ${(manifest.allowed_origins || []).join(', ')}`);
  }
  const hostDir = getHostInstallDir();
  console.log(`Install dir: ${hostDir}`);
  console.log(`Host file:   ${existsSync(resolve(hostDir, 'cursor-bridge-host.mjs'))}`);
}

function uninstall(args) {
  const manifestPath = getManifestPath(args.browser);
  rmSync(manifestPath, { force: true });
  if (platform() === 'win32') removeWindowsRegistry(args.browser);
  const hostDir = getHostInstallDir();
  rmSync(hostDir, { recursive: true, force: true });
  console.log(`Uninstalled cursor bridge host for ${args.browser}.`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'install') install(args);
  else if (args.command === 'status') status(args);
  else if (args.command === 'uninstall') uninstall(args);
  else throw new Error(`Unknown command: ${args.command}`);
}
