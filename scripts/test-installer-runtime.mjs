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
  assert.match(deployment, /voiceStateFile = path\.join\(voiceStateDir, 'python\.json'\)/);
  assert.match(setup, /voice-python\\python\.exe/);
  assert.match(setup, /mode = 'bundled'/);
  assert.match(prepare, /33b448f95fecb7c6f802157dbd5e6b40a2ad9bfc8b95ca634a06ba4073ad1ac0/);
  assert.match(prepare, /notmatch '3 11 9 64'/);
});

test('Windows cloud workflow builds and verifies the update installer', () => {
  const workflow = read('.github/workflows/windows-voice-installer.yml');
  const installDoc = read('docs/VOICE_UPDATE_INSTALL.md');
  assert.match(installDoc, /仅升级/);
  assert.match(installDoc, /MIMO_API_KEY/);
  assert.match(installDoc, /不要在微信仍运行时替换/);
  assert.match(workflow, /runs-on: windows-2022/);
  assert.match(workflow, /setup-python@v6/);
  assert.match(workflow, /prepare-voice-runtime\.ps1/);
  assert.match(workflow, /npm run installer:build/);
  assert.match(workflow, /installerSha256/);
  assert.match(workflow, /upload-artifact@v4/);
});

test('portable voice runtime probes avoid nested quotes in Windows PowerShell native arguments', () => {
  const prepare = read('scripts/prepare-voice-runtime.ps1');
  const setup = read('scripts/setup-voice.ps1');
  assert.match(prepare, /print\(sys\.version_info\.major,sys\.version_info\.minor,sys\.version_info\.micro,struct\.calcsize\(chr\(80\)\)\*8\)/);
  assert.match(prepare, /notmatch '3 11 9 64'/);
  assert.match(setup, /chr\(46\).*struct\.calcsize\(chr\(80\)\)\*8/);
  assert.doesNotMatch(prepare + setup, /print\("%d\.%d %d"/);
});
