import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('installer supports update-only builds without redistributing the WeChat client', () => {
  const build = read('scripts/build-installer.mjs');
  const deployment = read('apps/console-desktop/deployment.cjs');
  assert.match(build, /const clientBundled = fs\.existsSync\(clientExecutable\)/);
  assert.match(build, /releaseType:clientBundled\?'full':'update-only'/);
  assert.match(build, /WeChatAgent-Voice-Update-\$\{version\}-\$\{arch\}/);
  assert.match(deployment, /if \(fs\.existsSync\(path\.join\(bundledClient, 'Weixin\.exe'\)\)\)/);
  assert.match(deployment, /更新包未包含微信程序/);
});

test('installer packages portable Python 3.11 and runtime bootstrap copies it', () => {
  const build = read('scripts/build-installer.mjs');
  const deployment = read('apps/console-desktop/deployment.cjs');
  const setup = read('scripts/setup-voice.ps1');
  const prepare = read('scripts/prepare-voice-runtime.ps1');
  assert.match(build, /runtime\/voice-python\/VOICE-RUNTIME\.json/);
  assert.match(build, /voicePython:'3\.11\.9'/);
  assert.match(deployment, /voiceRuntimeSource/);
  assert.match(deployment, /voice-python/);
  assert.match(deployment, /mode: 'bundled'/);
  assert.match(deployment, /state', 'voice', 'python\.json'/);
  assert.match(setup, /voice-python\\python\.exe/);
  assert.match(setup, /mode = 'bundled'/);
  assert.match(prepare, /33b448f95fecb7c6f802157dbd5e6b40a2ad9bfc8b95ca634a06ba4073ad1ac0/);
  assert.match(prepare, /VOICE_RUNTIME_OK/);
});

test('Windows cloud workflow builds and verifies the update installer', () => {
  const workflow = read('.github/workflows/windows-voice-installer.yml');
  assert.match(workflow, /runs-on: windows-2022/);
  assert.match(workflow, /setup-python@v6/);
  assert.match(workflow, /prepare-voice-runtime\.ps1/);
  assert.match(workflow, /npm run installer:build/);
  assert.match(workflow, /installerSha256/);
  assert.match(workflow, /upload-artifact@v4/);
});
