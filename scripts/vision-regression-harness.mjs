#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

const background = read('entrypoints/background.ts');
const browserSettings = read('core/browser-control/settings.ts');
const actVerify = read('core/browser-control/act-verify.ts');
const evidence = read('core/deepseek/vision-evidence.ts');
const history = read('core/tool/history.ts');
const restore = read('core/tool/execution-restore.ts');

assert.match(browserSettings, /enabled:\s*true/);
assert.match(browserSettings, /allowVisionCapture:\s*true/);
assert.match(browserSettings, /verifyAfterActions:\s*true/);
assert.match(browserSettings, /collectEvidencePacks:\s*true/);
assert.match(background, /shouldVerifyAfterBrowserAction\(call\.name\)/);
assert.match(background, /browserControlService\.captureScreenshotForVision\(\)/);
assert.match(background, /createDeepSeekWebVisionEvidencePack/);
assert.match(background, /ensurePersonalRuntimeReady\(undefined,\s*'startup'\)/);
assert.match(background, /case 'ENSURE_PERSONAL_RUNTIME_READY'/);
assert.match(background, /source === 'manual' && personalRuntimeReadySource === 'startup'/);
assert.match(background, /!isDeepSeekWebTargetUrl\(browserState\.target\.url\)/);
assert.match(background, /updateAutomationRun\(request\.runId,\s*\{\s*request:\s*preparedRequest\s*\}\)/s);
assert.match(evidence, /schemaVersion:\s*typeof DEEPSEEK_WEB_VISION_EVIDENCE_SCHEMA_VERSION/);
assert.match(evidence, /id:\s*string/);
assert.match(evidence, /storage:\s*'metadata_only'/);
assert.match(evidence, /rawImageStored:\s*false/);
assert.match(history, /redactDurableToolValue/);
assert.match(restore, /redactDurableToolValue/);

const forbiddenPromptPhrases = [
  /reply exactly/i,
  /can you read this image/i,
  /marker/i,
  /probe/i,
];
for (const phrase of forbiddenPromptPhrases) {
  assert.doesNotMatch(actVerify, phrase);
}

const durableCaptureWindow = background.slice(
  background.indexOf('async function uploadBrowserScreenshotCapture'),
  background.indexOf('function createCapturedTabSerializedImage'),
);
assert.doesNotMatch(durableCaptureWindow, /chrome\.storage\.(local|session)\.set/);
assert.doesNotMatch(durableCaptureWindow, /appendToolCallHistory/);

const ensureReadyWindow = background.slice(
  background.indexOf('async function runEnsurePersonalRuntimeReady'),
  background.indexOf('async function getRuntimeDoctorStorageSnapshot'),
);
assert.doesNotMatch(ensureReadyWindow, /captureScreenshotForVision/);
assert.doesNotMatch(ensureReadyWindow, /uploadDeepSeekWebVisionImage/);
assert.doesNotMatch(ensureReadyWindow, /createAutomation\(/);

const startupAuthBranch = ensureReadyWindow.slice(
  ensureReadyWindow.indexOf("source === 'startup'"),
  ensureReadyWindow.indexOf('} else {', ensureReadyWindow.indexOf("source === 'startup'")),
);
assert.doesNotMatch(startupAuthBranch, /clearSidepanelWebAuthRejected/);
assert.doesNotMatch(startupAuthBranch, /refreshClientHeadersFromDeepSeekTabs/);

console.log('vision regression harness: ok');
