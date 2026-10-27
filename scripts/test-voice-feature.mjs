import test from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { voiceEnabledFor, validateVoiceSettings } from '../packages/dsh-voice-plugin/voice-policy.mjs';
import { parseSocialDecision, resolveSocialDecision } from '../components/qq-bridge/src/core/decision-format.js';
import { replyDeliveryParts } from '../components/qq-bridge/src/core/message-buffer.js';
import { validateVoiceArtifact, HookOneBot } from './hook-onebot.mjs';
import { WechatOneBotAdapter } from '../components/qq-bridge/src/adapters/wechat/wechat-onebot-adapter.js';
import { ReverseOneBotServer } from '../components/qq-bridge/src/onebot/reverse-ws-server.js';
import { TextDeliveryStore } from './text-delivery-store.mjs';
import { apply as applyVoicePlugin } from '../packages/dsh-voice-plugin/index.mjs';
import { buildMimoTtsPayload, extractMimoWav, requestMimoWav } from '../packages/dsh-voice-plugin/voice-service.mjs';
import { getVoiceService } from '../packages/dsh-voice-plugin/registry.mjs';
import { chatSettingsSnapshot, applyChatSettings } from '../public/console/conversation-settings.mjs';
import { effectiveChatFeature } from '../public/console/layout-model.mjs';

const privateKey = 'wechat:private:123';
const groupKey = 'wechat:group:456';

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechatagent-voice-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  return root;
}

test('voice policy honors account defaults and per-chat overrides', () => {
  assert.equal(voiceEnabledFor({ voice: { enabled: false, chats: {} } }, privateKey), false);
  assert.equal(voiceEnabledFor({ voice: { enabled: true, chats: {} } }, privateKey), true);
  assert.equal(voiceEnabledFor({ voice: { enabled: true, chats: { [privateKey]: false } } }, privateKey), false);
  assert.equal(voiceEnabledFor({ voice: { enabled: false, chats: { [groupKey]: true } } }, groupKey), true);
  assert.equal(voiceEnabledFor({ voice: { enabled: true, chats: {} } }, 'wechat:private:not-numeric'), false);
  assert.throws(() => validateVoiceSettings({ enabled: true, chats: { [privateKey]: 'yes' } }), /Invalid per-chat voice setting/);
});


test('MiMo v2.5 TTS uses the OpenAI-compatible API payload with text in assistant role', () => {
  const payload = buildMimoTtsPayload('你好呀！', '茉莉', '温柔自然，像朋友聊天，语速稍慢。');
  assert.equal(payload.model, 'mimo-v2.5-tts');
  assert.deepEqual(payload.messages, [
    { role: 'user', content: '温柔自然，像朋友聊天，语速稍慢。' },
    { role: 'assistant', content: '你好呀！' },
  ]);
  assert.deepEqual(payload.audio, { format: 'wav', voice: '茉莉' });
  assert.equal(buildMimoTtsPayload('你好', 'zh-CN-XiaoyiNeural').audio.voice, '冰糖', 'legacy Edge voice must not leak into MiMo request');
});

test('MiMo WAV response decoding validates Base64 and RIFF/WAVE headers', () => {
  const wav = Buffer.alloc(48);
  wav.write('RIFF', 0, 'ascii'); wav.write('WAVE', 8, 'ascii');
  const parsed = extractMimoWav({ choices: [{ message: { audio: { data: wav.toString('base64') } } }] });
  assert.deepEqual(parsed, wav);
  assert.throws(() => extractMimoWav({ choices: [{ message: { audio: { data: 'not-base64!' } } }] }), /VOICE_MIMO_AUDIO_MISSING/);
  const invalid = Buffer.from('NOT_A_WAV'.padEnd(48, '!')).toString('base64');
  assert.throws(() => extractMimoWav({ choices: [{ message: { audio: { data: invalid } } }] }), /VOICE_MIMO_WAV_INVALID/);
});

test('MiMo TTS API call uses HTTPS bearer auth, the documented request shape, and hides auth errors', async () => {
  const wav = Buffer.alloc(64);
  wav.write('RIFF', 0, 'ascii'); wav.write('WAVE', 8, 'ascii');
  let captured;
  const result = await requestMimoWav('晚上好呀', {
    apiKey: 'test-key-not-for-logs', voice: '茉莉', style: '自然温柔，像朋友聊天。',
    fetchImpl: async (url, options) => {
      captured = { url, options, payload: JSON.parse(options.body) };
      return new Response(JSON.stringify({ choices: [{ message: { audio: { data: wav.toString('base64') } } }] }), { status: 200 });
    },
  });
  assert.equal(captured.url, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.authorization, 'Bearer test-key-not-for-logs');
  assert.equal(captured.payload.model, 'mimo-v2.5-tts');
  assert.deepEqual(captured.payload.messages, [
    { role: 'user', content: '自然温柔，像朋友聊天。' },
    { role: 'assistant', content: '晚上好呀' },
  ]);
  assert.deepEqual(captured.payload.audio, { format: 'wav', voice: '茉莉' });
  assert.deepEqual(result, wav);

  await assert.rejects(() => requestMimoWav('你好呀', {
    apiKey: 'another-test-key',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }),
  }), error => error.code === 'VOICE_MIMO_AUTH_FAILED' && !error.message.includes('another-test-key'));
});

test('voice settings accept MiMo and explicit Edge providers without storing an API key', () => {
  assert.doesNotThrow(() => validateVoiceSettings({ enabled: true, ttsProvider: 'mimo-v2.5-tts', ttsVoice: '冰糖', ttsStyle: '自然的中文口语' }));
  assert.doesNotThrow(() => validateVoiceSettings({ ttsProvider: 'edge-tts', edgeVoice: 'zh-CN-XiaoyiNeural' }));
  assert.throws(() => validateVoiceSettings({ ttsProvider: 'unknown-tts' }), /Invalid TTS provider/);
  assert.throws(() => validateVoiceSettings({ ttsVoice: 'unknown-voice' }), /Invalid TTS voice/);
});

test('the production social bridge wires the verified per-chat voice policy into decision parsing', () => {
  const engine = fs.readFileSync(new URL('../components/qq-bridge/src/core/social-engine.js', import.meta.url), 'utf8');
  const bridge = fs.readFileSync(new URL('../components/qq-bridge/src/social-bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /import \{ voiceEnabledFor as isVoiceEnabledFor \} from '\.\.\/\.\.\/\.\.\/packages\/dsh-voice-plugin\/voice-policy\.mjs';/);
  assert.match(bridge, /voiceEnabledFor: key => \{[^}]*isVoiceEnabledFor\(current,key\)/);
  assert.match(engine, /constructor\(\{ buffer, decide, send, sendVoice,/);
  assert.match(engine, /Object\.assign\(this, \{ buffer, decide, send, sendVoice,/);
  assert.match(engine, /voiceEnabledFor=\(\)=>false/);
  assert.match(engine, /voiceEnabledFor,/);
  assert.match(engine, /allowVoiceReply,log:this\.log/);
  assert.match(engine, /this\.voiceEnabledFor\(key\)===true/);
});

test('reverse OneBot actions accept a bounded per-action timeout override', async () => {
  const server = new ReverseOneBotServer({ timeoutMs: 45000 });
  server.connected = true;
  server.socket = { write(_frame, callback) { callback?.(); } };
  const pending = server.action('send_private_msg', {}, { timeoutMs: 175000 });
  const entry = [...server.pending.values()][0];
  assert.equal(entry.timer._idleTimeout, 175000);
  clearTimeout(entry.timer);
  server.pending.clear();
  void pending;
  const clamped = server.action('send_private_msg', {}, { timeoutMs: 900000 });
  const clampedEntry = [...server.pending.values()][0];
  assert.equal(clampedEntry.timer._idleTimeout, 180000);
  clearTimeout(clampedEntry.timer);
  server.pending.clear();
  void clamped;
});

test('the OneBot adapter submits native voice segments and preserves fallback and uncertain receipts', async t => {
  const adapter = new WechatOneBotAdapter();
  t.after(async () => adapter.stop());
  let call;
  adapter.server.action = async (action, params, options) => {
    call = { action, params, options };
    return { data: { receipt: 'wechat-server-id', delivered: 'database-confirmed', media_type: 'wechat-voice', message_id: 321 } };
  };
  const voice = await adapter.sendVoice({ kind: 'private', target: 123, text: '你好呀', deliveryId: 'a'.repeat(64) });
  assert.equal(call.action, 'send_private_msg');
  assert.equal(call.params.user_id, 123);
  assert.deepEqual(call.params.message, [{ type: 'wechat_voice', data: { text: '你好呀' } }]);
  assert.equal(call.params.wechatagent_delivery_id, 'a'.repeat(64));
  assert.equal(call.options.timeoutMs, 175000, 'voice TTS plus native receipt needs a longer action deadline than text');
  assert.equal(voice.media_type, 'wechat-voice');
  assert.equal(voice.receipt, 'wechat-server-id');
  assert.equal(adapter.stats.sends, 1);

  adapter.server.action = async () => ({ data: { receipt: 'wechat-server-id', delivered: 'database-confirmed', media_type: 'text-fallback', message_id: 322 } });
  const fallback = await adapter.sendVoice({ kind: 'group', target: 456, text: '你好呀' });
  assert.equal(fallback.media_type, 'text-fallback');
  assert.equal(fallback.delivered, 'database-confirmed');
  assert.equal(adapter.stats.sends, 2);

  adapter.server.action = async () => { throw Object.assign(new Error('voice delivery unconfirmed'), { code: 'VOICE_DELIVERY_UNCONFIRMED', data: { attempted: true } }); };
  const uncertainVoice = await adapter.sendVoice({ kind: 'private', target: 123, text: '稍等一下', deliveryId: 'b'.repeat(64) });
  assert.equal(uncertainVoice.delivered, 'unconfirmed');
  assert.equal(uncertainVoice.media_type, 'wechat-voice');

  adapter.server.action = async () => { throw Object.assign(new Error('text delivery unconfirmed'), { code: 'TEXT_DELIVERY_UNCONFIRMED', data: { attempted: true } }); };
  const uncertainFallback = await adapter.sendVoice({ kind: 'private', target: 123, text: '稍等一下', deliveryId: 'c'.repeat(64) });
  assert.equal(uncertainFallback.delivered, 'unconfirmed');
  assert.equal(uncertainFallback.media_type, 'text-fallback');
});

test('the model cannot force voice replies in chats where voice is disabled', () => {
  assert.deepEqual(parseSocialDecision('RESPOND_VOICE: 好呀，晚上见！'), { decision: 'INVALID', text: '' });
  assert.deepEqual(parseSocialDecision('RESPOND_VOICE: 好呀，晚上见！', {}, { allowVoiceReply: true }), {
    decision: 'RESPOND', text: '好呀，晚上见！', replyMode: 'voice',
  });
  const longText = '好'.repeat(121);
  assert.equal(parseSocialDecision(`RESPOND_VOICE: ${longText}`, {}, { allowVoiceReply: true }).replyMode, 'text');
  assert.equal(parseSocialDecision('RESPOND: 普通文字').replyMode, undefined);
});

test('format repair explicitly carries the trusted per-chat voice policy', async () => {
  let repairPrompt = '';
  const repaired = await resolveSocialDecision({
    rawOutput: 'RESPOND_VOICE: 好呀', key: privateKey, metadata: { batchId: 'b'.repeat(64) },
    decide: async (_key, prompt) => { repairPrompt = prompt; return 'RESPOND: 好呀'; },
    allowVoiceReply: false,
  });
  assert.equal(repaired.result.decision, 'RESPOND');
  assert.match(repairPrompt, /当前聊天未启用语音/);
  const enabled = parseSocialDecision('RESPOND_VOICE: 好呀', {}, { allowVoiceReply: true });
  const parts = replyDeliveryParts({ decision: 'RESPOND', text: enabled.text, replyMode: enabled.replyMode }, 'a'.repeat(64));
  assert.equal(parts[0].voice, true);
});


test('DSH plugin registers an optional voice service without making ASR mandatory at startup', async t => {
  const pluginSource = fs.readFileSync(new URL('../packages/dsh-voice-plugin/index.mjs', import.meta.url), 'utf8');
  assert.match(pluginSource, /export const inject = \['speechToText'\]/, 'the plugin must declare the DSH speech service dependency');
  const root = tempRoot(t);
  const providers = [{ id: 'sensevoice-local', preparation: { phase: 'ready' } }];
  const stt = { resolve: spec => spec, transcribe: async () => ({ text: 'ok' }), snapshot: () => ({ providers }) };
  const services = new Map();
  let dispose;
  const ctx = {
    root,
    get: name => name === 'speechToText' ? stt : services.get(name),
    provide: (name, service) => services.set(name, service),
    effect: register => { dispose = register(); },
    logger: () => ({ info() {} }),
  };
  applyVoicePlugin(ctx, { projectRoot: root });
  const service = getVoiceService(ctx);
  assert.ok(service);
  const previousMimoKey = process.env.MIMO_API_KEY;
  process.env.MIMO_API_KEY = 'test-only-key-must-never-be-returned';
  let status;
  try { status = await service.status(true); }
  finally {
    if (previousMimoKey === undefined) delete process.env.MIMO_API_KEY;
    else process.env.MIMO_API_KEY = previousMimoKey;
  }
  assert.equal(status.ok, true);
  assert.equal(status.asrServiceAvailable, true);
  assert.equal(status.asrProviderAvailable, true);
  assert.equal(status.ttsProvider, 'mimo-v2.5-tts');
  assert.equal(status.mimoApiKeyConfigured, true);
  assert.equal(JSON.stringify(status).includes('test-only-key-must-never-be-returned'), false, 'status must never expose the API key');
  assert.equal(status.ttsProvider, 'mimo-v2.5-tts');
  assert.equal(typeof status.mimoApiKeyConfigured, 'boolean');
  assert.equal(Object.hasOwn(status, 'apiKey'), false, 'status must never expose an API key');
  assert.equal(typeof service.transcribeSilk, 'function');
  assert.equal(typeof service.synthesizeSilk, 'function');
  await dispose?.();
  assert.equal(root[Symbol.for('wechatagent.dshVoiceService.v1')], undefined);
});


test('the current native Hook capability gate falls back to text without invoking TTS', async () => {
  const adapter = Object.create(HookOneBot.prototype);
  adapter.directory = process.cwd();
  adapter.project = { wechat: { whitelist: { private: ['123'], groups: [] }, voice: { enabled: true, chats: {} } } };
  adapter.hook = { maxConcurrentSends: 4 };
  adapter.status = { native_voice_send: false };
  adapter.reload = () => {};
  adapter.allowed = () => true;
  adapter.checkNative = async () => ({ account: 'account', selfId: 1 });
  adapter.send = async (_kind, _target, text) => ({ delivered: 'database-confirmed', text });
  adapter.dshRequest = async () => { throw new Error('TTS must not run without a native voice sender'); };
  const result = await adapter.sendVoice('private', '123', '你好呀', 'a'.repeat(64), null);
  assert.equal(result.media_type, 'text-fallback');
  assert.equal(result.voiceFallback, 'native_sender_unavailable');
  assert.equal(result.text, '你好呀');
});

test('a compatible native Hook sends generated SILK once and confirms a type-34 receipt', async t => {
  const root = tempRoot(t);
  const outgoing = path.join(root, 'state', 'voice', 'outgoing');
  fs.mkdirSync(outgoing, { recursive: true });
  const file = path.join(outgoing, `${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}.silk`);
  const audio = Buffer.concat([Buffer.from('#!SILK_V3', 'ascii'), Buffer.alloc(64, 9)]);
  fs.writeFileSync(file, audio);
  const adapter = Object.create(HookOneBot.prototype);
  adapter.directory = root;
  adapter.project = { wechat: { whitelist: { private: ['123'], groups: [] }, voice: { enabled: true, chats: {} } } };
  const clientDirectory = path.join(root, 'client');
  fs.mkdirSync(clientDirectory, { recursive: true });
  adapter.hook = { maxConcurrentSends: 4, receiptTimeoutMs: 1000, wechatExecutable: path.join(clientDirectory, 'Weixin.exe') };
  adapter.status = { native_voice_send: true, confirmed_sends: 0, last_error: '' };
  adapter.targetsSending = new Set();
  adapter.stopped = false;
  adapter.pollMs = 1;
  adapter.receiptOverride = 1000;
  adapter.textDeliveries = new TextDeliveryStore(path.join(root, 'state', 'text-deliveries'));
  adapter.reload = () => {};
  adapter.allowed = () => true;
  adapter.checkNative = async () => { adapter.status.native_voice_send = true; return { account: 'account', selfId: 1 }; };
  adapter.resolveTarget = async () => 'wxid_fixture';
  let messageCalls = 0, synthCalls = 0, nativeCalls = 0, receiptChecks = 0;
  const createdAt = Math.floor(Date.now()/1000);
  const expectedVoiceDigest = crypto.createHash('sha256').update(audio).digest('hex');
  adapter.messages = async () => {
    messageCalls++;
    if (messageCalls === 1) return [];
    const unrelated = { isSend: true, localType: 34, localId: '199', serverId: '654321', createTime: createdAt };
    const expected = { isSend: true, localType: 34, localId: '200', serverId: '123456', createTime: createdAt };
    return messageCalls === 2 ? [unrelated] : [unrelated, expected];
  };
  adapter.reader = async route => {
    const url = new URL(route, 'http://localhost');
    assert.equal(url.pathname, '/api/v1/voice-receipt');
    assert.equal(url.searchParams.get('talker'), 'wxid_fixture');
    receiptChecks++;
    return { success: true, sha256: url.searchParams.get('localId') === '199' ? 'f'.repeat(64) : expectedVoiceDigest };
  };
  adapter.dshRequest = async (route, body) => {
    assert.equal(route, '/voice/synthesize'); assert.equal(body.conversationKey, 'wechat:private:123');
    synthCalls++; return { path: file, bytes: audio.length, durationMs: 2500 };
  };
  const gateStates = [];
  adapter.native = async (route, body) => {
    if (route === '/Debug/VoiceSend') { gateStates.push(body.on); return { enabled: body.on, forceOn: body.on }; }
    assert.equal(route, '/SendVoiceMsg'); assert.equal(body.wxidorgid, 'wxid_fixture');
    assert.equal(body.str0Mode, 'bytes'); assert.equal(body.durationMs, 2500); nativeCalls++;
    assert.deepEqual(gateStates, [true], 'the native voice gate is open only for the one request');
    assert.equal(fs.existsSync(path.join(clientDirectory, 'hook-voice-send.on')), false, 'new sends do not create a persistent marker');
    return { ret: 0 };
  };
  const first = await adapter.sendVoice('private', '123', '你好呀', 'c'.repeat(64), null);
  assert.equal(fs.existsSync(path.join(clientDirectory, 'hook-voice-send.on')), false, 'no persistent voice marker is created');
  assert.deepEqual(gateStates, [true, false], 'the in-memory gate is closed immediately after native submission');
  assert.equal(first.media_type, 'wechat-voice');
  assert.equal(first.receipt, 'wechat-server-id');
  assert.equal(first.message_id, 200, 'an unrelated outgoing voice must not satisfy this send receipt');
  assert.equal(fs.existsSync(file), false, 'the generated SILK file is deleted after the native request and receipt check');
  assert.equal(receiptChecks, 2, 'each candidate is checked once, and the exact audio digest is matched');
  assert.equal(synthCalls, 1); assert.equal(nativeCalls, 1);
  const second = await adapter.sendVoice('private', '123', '你好呀', 'c'.repeat(64), null);
  assert.equal(second.reused, true);
  assert.equal(synthCalls, 1); assert.equal(nativeCalls, 1);
});

test('TTS output must be a bounded SILK file inside the generated-output directory', t => {
  const root = tempRoot(t);
  const outgoing = path.join(root, 'state', 'voice', 'outgoing');
  fs.mkdirSync(outgoing, { recursive: true });
  const filename = `${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}.silk`;
  const file = path.join(outgoing, filename);
  const audio = Buffer.concat([Buffer.from('#!SILK_V3', 'ascii'), Buffer.alloc(64, 7)]);
  fs.writeFileSync(file, audio);
  assert.deepEqual(validateVoiceArtifact(root, { path: file, bytes: audio.length, durationMs: 2500 }), {
    path: fs.realpathSync(file), bytes: audio.length, durationMs: 2500,
  });
  assert.throws(() => validateVoiceArtifact(root, { path: path.join(root, 'outside.silk'), bytes: 64, durationMs: 2500 }), /VOICE_OUTPUT_INVALID/);
  const wrong = path.join(outgoing, `${'f'.repeat(8)}-${'1'.repeat(4)}-${'2'.repeat(4)}-${'3'.repeat(4)}-${'4'.repeat(12)}.silk`);
  fs.writeFileSync(wrong, Buffer.concat([Buffer.from('NOT_SILK!', 'ascii'), Buffer.alloc(64)]));
  assert.throws(() => validateVoiceArtifact(root, { path: wrong, bytes: 73, durationMs: 2500 }), /VOICE_OUTPUT_INVALID/);
});

test('voice events are read from the media database through an authenticated, whitelist-checked reader route', () => {
  const reader = fs.readFileSync(new URL('./reader-api.py', import.meta.url), 'utf8');
  const hook = fs.readFileSync(new URL('./hook-onebot.mjs', import.meta.url), 'utf8');
  const bridge = fs.readFileSync(new URL('../packages/dsh-social-bridge-plugin/native-context.mjs', import.meta.url), 'utf8');
  assert.match(reader, /if payload\['type'\] == 34:/);
  assert.match(reader, /SELECT voice_data FROM VoiceInfo WHERE chat_name_id=\? AND local_id=\?/);
  assert.match(reader, /X-WeChatAgent-Voice-Format/);
  assert.match(reader, /def voice_receipt_digest/);
  assert.match(reader, /api\/v1\/voice-receipt/);
  assert.match(hook, /payload\?\.type===34\?this\.enqueueVoice\(payload\):this\.enqueuePlain\(payload\)/);
  assert.match(bridge, /\/voice\/transcribe/);
  assert.match(bridge, /\/voice\/synthesize/);
});

test('installer manifest includes the voice plugin, dependency setup and relocatable plugin path', () => {
  const build = fs.readFileSync(new URL('./build-installer.mjs', import.meta.url), 'utf8');
  assert.match(build, /addTree\('packages\/dsh-voice-plugin'/);
  assert.match(build, /'setup-voice\.ps1','voice-requirements\.txt'/);
  assert.match(build, /\(dsh-social-bridge-plugin\|dsh-voice-plugin\)/);
  const patch = fs.readFileSync(new URL('../packages/dsh-social-bridge-plugin/cordis.patch.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(patch, /file:\/\/\/mnt\/data\/work\/preview\//, 'the checked-in DSH patch must be portable outside the build container');
  assert.match(patch, /name: dsh-voice-plugin\/index\.mjs/);
  assert.match(patch, /name: dsh-social-bridge-plugin\/native-context\.mjs/);
  const hook = fs.readFileSync(new URL('./native-hook/wechatagent_hook.cpp', import.meta.url), 'utf8');
  const buildHook = fs.readFileSync(new URL('./build-hook.ps1', import.meta.url), 'utf8');
  assert.match(hook, /server\.Post\("\/SendVoiceMsg", \[authorized,voiceAccountAllowed\]/);
  assert.match(hook, /nativeVoiceSend",CoreVersion\(\)=="4\.1\.10\.27"/);
  assert.match(buildHook, /mengyunqwq\/wechat-hook/);
  assert.match(buildHook, /Route_SendVoiceMsg/);
});

test('a TTS or native preflight failure falls back to text, but uncertain native submissions are never duplicated', async () => {
  const adapter = Object.create(HookOneBot.prototype);
  adapter.directory = process.cwd();
  adapter.project = { wechat: { whitelist: { private: ['123'], groups: [] }, voice: { enabled: true, chats: {} } } };
  adapter.status = { last_error: '', failed_sends: 0 };
  adapter.activeActions = 0;
  adapter.reload = () => {};
  adapter.allowed = () => true;
  adapter.sendVoice = async () => { throw Object.assign(new Error('VOICE_TTS_FAILED'), { data: { attempted: false } }); };
  let textSends = 0;
  adapter.send = async (_kind, _target, text) => { textSends++; return { receipt: 'wechat-server-id', text, delivered: 'database-confirmed' }; };
  const fallback = await adapter.action({ action: 'send_private_msg', params: { user_id: 123, message: [{ type: 'wechat_voice', data: { text: '你好呀' } }] } });
  assert.equal(fallback.status, 'ok');
  assert.equal(fallback.data.media_type, 'text-fallback');
  assert.equal(fallback.data.text, '你好呀');

  adapter.sendVoice = async () => { throw Object.assign(new Error('VOICE_DELIVERY_UNCONFIRMED'), { data: { attempted: true } }); };
  const uncertain = await adapter.action({ action: 'send_private_msg', params: { user_id: 123, message: [{ type: 'wechat_voice', data: { text: '你好呀' } }] } });
  assert.equal(uncertain.status, 'failed');
  assert.equal(textSends, 1, 'an uncertain native submission must not trigger a duplicate text reply');
});


test('voice defaults remain off and per-chat overrides take precedence', () => {
  const config = { wechat: { voice: { enabled: false, chats: {} } } };
  assert.equal(effectiveChatFeature(config, privateKey, 'voice').enabled, false);
  config.wechat.voice.enabled = true;
  assert.equal(effectiveChatFeature(config, privateKey, 'voice').enabled, true);
  config.wechat.voice.chats[privateKey] = false;
  assert.equal(effectiveChatFeature(config, privateKey, 'voice').enabled, false);
  config.wechat.voice.chats[privateKey] = true;
  assert.equal(effectiveChatFeature(config, privateKey, 'voice').enabled, true);
});

test('per-chat voice settings round-trip through the validated conversation settings API', () => {
  const config = {
    wechat: {
      whitelist: { private: ['123'], groups: [] },
      voice: { enabled: false, chats: {} },
      stickers: { chats: {} }, search: { chats: {} },
      proactive: { chats: {} }, context: { chats: {} },
      dshAccess: { chats: {} },
    },
    persona: { default: '默认人格', chats: {} },
  };
  const snapshot = chatSettingsSnapshot(config, privateKey);
  assert.equal(snapshot.settings.voice, null, 'missing per-chat override inherits the account default');
  const settings = { ...snapshot.settings, voice: true };
  applyChatSettings(config, privateKey, settings, snapshot.access);
  assert.equal(config.wechat.voice.chats[privateKey], true);
  assert.equal(chatSettingsSnapshot(config, privateKey).settings.voice, true);
  const disabled = { ...chatSettingsSnapshot(config, privateKey).settings, voice: false };
  applyChatSettings(config, privateKey, disabled, chatSettingsSnapshot(config, privateKey).access);
  assert.equal(config.wechat.voice.chats[privateKey], false);
  const inherited = { ...chatSettingsSnapshot(config, privateKey).settings, voice: null };
  applyChatSettings(config, privateKey, inherited, chatSettingsSnapshot(config, privateKey).access);
  assert.equal(Object.hasOwn(config.wechat.voice.chats, privateKey), false);
});

test('console exposes account-default and per-chat voice controls, and the chat settings button is wired', () => {
  const consoleJs = fs.readFileSync(new URL('../public/console/console.js', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../public/console/workspace-layout.js', import.meta.url), 'utf8');
  const example = fs.readFileSync(new URL('../config/wechatagent.example.json', import.meta.url), 'utf8');
  assert.match(consoleJs, /chatSettingsSnapshot,mergeConversationSave/);
  assert.match(consoleJs, /function openChatSettings\(key\)/);
  assert.match(consoleJs, /button\.dataset\.chatSettings/);
  assert.match(consoleJs, /name="' \+ name \+ '"/);
  assert.match(consoleJs, /wechat\.voice\.enabled/);
  assert.match(workspace, /cards\.voice/);
  assert.match(workspace, /data-chat-settings=/);
  assert.match(workspace, /\['voice','语音识别与回复'\]/);
  assert.match(example, /"voice":\s*\{\s*"enabled":\s*false/s);
});
