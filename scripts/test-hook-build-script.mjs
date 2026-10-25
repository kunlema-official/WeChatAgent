import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-hook.ps1'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'windows-voice-hook.yml'), 'utf8');

test('Hook build pins the source revision seen in the failed Windows run', () => {
  assert.match(buildScript, /e3f6cfc45701c5233d87024813ea8842aa7bfb4b/);
  assert.match(buildScript, /git -C \$source fetch --depth 1 origin \$pinnedCommit/);
});

test('Hook build resolves a renamed initialization source by the HTTP startup anchor', () => {
  assert.match(buildScript, /g_httpServer\\s\*->\\s\*Start/);
  assert.match(buildScript, /Resolved moved initialization source/);
  assert.match(buildScript, /Replace-Checked \$inlineLoadBuildFile/);
  assert.doesNotMatch(buildScript, /Replace-Checked \(Join-Path \$build 'src\\inline_weixin_dll_load\.cpp'\)/);
});

test('Hook build safely handles multiple HTTP startup branches and restricts all to loopback', () => {
  assert.match(buildScript, /\$startMatches\.Count -lt 1/);
  assert.doesNotMatch(buildScript, /\$startMatches\.Count -ne 1/);
  assert.match(buildScript, /\[regex\]::Replace\(\$inlineText, \$startPattern, 'g_httpServer->Start\("127\.0\.0\.1", g_StartPort\);'\)/);
  assert.match(buildScript, /Restricted .*HTTP server start call\(s\) to 127\.0\.0\.1/);
});

test('Hook build preserves the upstream voice route before replacing the route registrar', () => {
  assert.match(buildScript, /Copy-Item -LiteralPath \(Join-Path \$build 'src\\http_routes\.cpp'\) -Destination \$voiceRouteCopy/);
  assert.match(buildScript, /RegisterUpstreamRoutes/);
  assert.match(buildScript, /src\\voice_send_route\.cpp/);
  assert.match(buildScript, /RegisterWeChatAgentRoutes\(server\)/);
});

test('GitHub Actions uses Node 24-compatible action releases', () => {
  assert.match(workflow, /actions\/checkout\@v5/);
  assert.match(workflow, /actions\/setup-node\@v5/);
});
