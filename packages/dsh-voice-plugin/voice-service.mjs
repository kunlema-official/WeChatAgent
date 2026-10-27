import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_SILK_BYTES = 4 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 4000;
const DEFAULT_PROVIDER = 'sensevoice-local';
const DEFAULT_LANGUAGE = 'zh';
const DEFAULT_TTS_PROVIDER = 'mimo-v2.5-tts';
const DEFAULT_MIMO_VOICE = '冰糖';
const DEFAULT_EDGE_VOICE = 'zh-CN-XiaoxiaoNeural';
const DEFAULT_RATE = '+8%';
const DEFAULT_PITCH = '+0Hz';
const DEFAULT_TTS_STYLE = '用自然、亲切、轻松的普通话说话，语速适中，像微信好友日常聊天，不要播报腔。';
const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MAX_MIMO_WAV_BYTES = 24 * 1024 * 1024;
const MAX_MIMO_RESPONSE_BYTES = 34 * 1024 * 1024;
const MIMO_VOICES = new Set(['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean']);

function safeText(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}
function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw Object.assign(new Error('VOICE_AUDIO_INVALID'), { code: 'VOICE_AUDIO_INVALID' });
}
export function extractMimoWav(payload) {
  const encoded = payload?.choices?.[0]?.message?.audio?.data;
  if (typeof encoded !== 'string' || !encoded || encoded.length > Math.ceil(MAX_MIMO_WAV_BYTES * 4 / 3) + 16 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw Object.assign(new Error('VOICE_MIMO_AUDIO_MISSING'), { code: 'VOICE_MIMO_AUDIO_MISSING' });
  }
  const wav = Buffer.from(encoded, 'base64');
  if (wav.length < 46 || wav.length > MAX_MIMO_WAV_BYTES || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw Object.assign(new Error('VOICE_MIMO_WAV_INVALID'), { code: 'VOICE_MIMO_WAV_INVALID' });
  }
  return wav;
}

export function buildMimoTtsPayload(text, voice = DEFAULT_MIMO_VOICE, style = DEFAULT_TTS_STYLE) {
  const chosenVoice = MIMO_VOICES.has(voice) ? voice : DEFAULT_MIMO_VOICE;
  return {
    model: 'mimo-v2.5-tts',
    messages: [
      { role: 'user', content: safeText(style, 800) || DEFAULT_TTS_STYLE },
      { role: 'assistant', content: safeText(text, 240) },
    ],
    audio: { format: 'wav', voice: chosenVoice },
  };
}

async function readResponseTextLimited(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw Object.assign(new Error('VOICE_MIMO_RESPONSE_TOO_LARGE'), { code: 'VOICE_MIMO_RESPONSE_TOO_LARGE' });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export async function requestMimoWav(text, {
  voice = DEFAULT_MIMO_VOICE,
  style = DEFAULT_TTS_STYLE,
  apiKey = process.env.MIMO_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = 120000,
} = {}) {
  const key = String(apiKey ?? '').trim();
  if (!key) throw Object.assign(new Error('VOICE_MIMO_API_KEY_MISSING'), { code: 'VOICE_MIMO_API_KEY_MISSING' });
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('VOICE_MIMO_FETCH_UNAVAILABLE'), { code: 'VOICE_MIMO_FETCH_UNAVAILABLE' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(MIMO_API_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(buildMimoTtsPayload(text, voice, style)),
        signal: controller.signal,
      });
    } catch {
      const code = controller.signal.aborted ? 'VOICE_MIMO_TIMEOUT' : 'VOICE_MIMO_NETWORK_FAILED';
      throw Object.assign(new Error(code), { code });
    }
    let payload;
    try {
      const responseText = await readResponseTextLimited(response, response.ok ? MAX_MIMO_RESPONSE_BYTES : 64 * 1024);
      payload = JSON.parse(responseText);
    } catch (error) {
      if (error?.code === 'VOICE_MIMO_RESPONSE_TOO_LARGE') throw error;
      throw Object.assign(new Error('VOICE_MIMO_RESPONSE_INVALID'), { code: 'VOICE_MIMO_RESPONSE_INVALID' });
    }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? 'VOICE_MIMO_AUTH_FAILED'
        : response.status === 429 ? 'VOICE_MIMO_RATE_LIMITED'
          : response.status >= 500 ? 'VOICE_MIMO_SERVICE_ERROR' : 'VOICE_MIMO_REQUEST_REJECTED';
      throw Object.assign(new Error(code), { code, status: response.status });
    }
    return extractMimoWav(payload);
  } finally { clearTimeout(timer); }
}

function validateWav(buffer) {
  if (buffer.length < 46 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw Object.assign(new Error('VOICE_WAV_INVALID'), { code: 'VOICE_WAV_INVALID' });
  }
  const format = buffer.readUInt16LE(20), channels = buffer.readUInt16LE(22), rate = buffer.readUInt32LE(24), bits = buffer.readUInt16LE(34);
  if (format !== 1 || channels !== 1 || rate !== 16000 || bits !== 16) {
    throw Object.assign(new Error('VOICE_WAV_FORMAT_INVALID'), { code: 'VOICE_WAV_FORMAT_INVALID' });
  }
  return Math.max(0, (buffer.length - 44) / 32000);
}

export function createVoiceService(ctx, root, pluginConfig = {}) {
  const state = path.join(root, 'state', 'voice');
  const incoming = path.join(state, 'incoming');
  const outgoing = path.join(state, 'outgoing');
  const temp = path.join(state, 'tmp');
  const packageRoot = path.dirname(fileURLToPath(import.meta.url));
  const decoder = path.join(packageRoot, 'scripts', 'decode-wechat-voice.py');
  const synthesizer = path.join(packageRoot, 'scripts', 'tts-silk.py');
  const wavEncoder = path.join(packageRoot, 'scripts', 'wav-to-silk.py');
  const cache = new Map();
  let lastStatus = null;
  let lastStatusAt = 0;
  let inFlight = 0;
  let disposed = false;

  const projectConfig = () => readJson(path.join(root, 'config', 'wechatagent.json')) ?? {};
  const voiceConfig = () => ({ ...(projectConfig().wechat?.voice ?? {}), ...(pluginConfig.voice ?? {}) });
  const pythonPath = () => {
    const saved = readJson(path.join(state, 'python.json'));
    const config = voiceConfig();
    const project = projectConfig();
    const value = saved?.pythonPath ?? config.pythonExe ?? project.runtime?.python ?? 'python';
    return typeof value === 'string' && value.trim() ? value.trim() : 'python';
  };
  const speechService = () => {
    try {
      const service = typeof ctx?.get === 'function' ? ctx.get('speechToText') : null;
      return service && typeof service.resolve === 'function' && typeof service.transcribe === 'function' ? service : null;
    } catch { return null; }
  };
  async function ensureDirs() {
    await Promise.all([incoming, outgoing, temp].map(directory => fsp.mkdir(directory, { recursive: true })));
  }
  async function cleanupStale(directory, maxAgeMs = 60 * 60 * 1000) {
    let entries;
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { return; }
    const cutoff = Date.now() - maxAgeMs;
    await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
      const file = path.join(directory, entry.name);
      try { if ((await fsp.stat(file)).mtimeMs < cutoff) await fsp.unlink(file); } catch { /* a concurrent send may still own the file */ }
    }));
  }
  // Clean crash leftovers on startup and periodically; successful sends also delete their own artifact.
  void ensureDirs().then(() => Promise.all([incoming, outgoing, temp].map(directory => cleanupStale(directory)))).catch(() => {});
  const cleanupTimer = setInterval(() => {
    if (!disposed) void ensureDirs().then(() => Promise.all([incoming, outgoing, temp].map(directory => cleanupStale(directory)))).catch(() => {});
  }, 15 * 60 * 1000);
  cleanupTimer.unref?.();
  async function runPython(script, args, timeout) {
    const python = pythonPath();
    try {
      return await execFileAsync(python, ['-B', script, ...args], {
        cwd: root, windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, PYTHONUTF8: '1', WECHATAGENT_VOICE_TMP: temp },
      });
    } catch (error) {
      const code = error?.killed || error?.code === 'ETIMEDOUT' ? 'VOICE_PYTHON_TIMEOUT'
        : error?.code === 'ENOENT' ? 'VOICE_PYTHON_MISSING' : 'VOICE_PYTHON_FAILED';
      throw Object.assign(new Error(code), { code, cause: error });
    }
  }
  async function checkPython(provider = DEFAULT_TTS_PROVIDER) {
    try {
      const imports = provider === 'edge-tts' ? 'import pilk, edge_tts, imageio_ffmpeg' : 'import pilk, imageio_ffmpeg';
      await execFileAsync(pythonPath(), ['-B', '-c', imports], {
        cwd: root, windowsHide: true, timeout: 8000, maxBuffer: 65536,
        env: { ...process.env, PYTHONUTF8: '1' },
      });
      return { available: true, python: pythonPath() };
    } catch (error) {
      return { available: false, python: pythonPath(), reason: error?.code === 'ENOENT' ? 'VOICE_PYTHON_MISSING' : 'VOICE_DEPENDENCIES_MISSING' };
    }
  }
  async function ensureAsrReady(stt, providerId) {
    if (typeof stt.snapshot !== 'function') return;
    const snapshot = () => (stt.snapshot()?.providers ?? []).find(provider => String(provider.id) === providerId) ?? null;
    const first = snapshot();
    if (!first) throw Object.assign(new Error('VOICE_ASR_PROVIDER_MISSING'), { code: 'VOICE_ASR_PROVIDER_MISSING' });
    const phase = first.preparation?.phase;
    if (phase === 'ready' || phase === 'standby') return;
    if (typeof stt.prepare === 'function') {
      try { void Promise.resolve(stt.prepare(providerId)).catch(() => {}); } catch { /* transcribe will report the provider error */ }
    }
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !disposed) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const current = snapshot();
      const currentPhase = current?.preparation?.phase;
      if (currentPhase === 'ready' || currentPhase === 'standby') return;
      if (currentPhase === 'failed') throw Object.assign(new Error('VOICE_ASR_PREPARE_FAILED'), { code: 'VOICE_ASR_PREPARE_FAILED' });
    }
    throw Object.assign(new Error('VOICE_ASR_PREPARE_TIMEOUT'), { code: 'VOICE_ASR_PREPARE_TIMEOUT' });
  }
  async function transcribeSilk(audioValue, { messageId = '', providerId, language, maxSeconds } = {}) {
    if (disposed) throw Object.assign(new Error('VOICE_SERVICE_STOPPED'), { code: 'VOICE_SERVICE_STOPPED' });
    const audio = asBuffer(audioValue);
    if (!audio.length || audio.length > MAX_SILK_BYTES) throw Object.assign(new Error('VOICE_AUDIO_SIZE_INVALID'), { code: 'VOICE_AUDIO_SIZE_INVALID' });
    if (inFlight >= 2) throw Object.assign(new Error('VOICE_ASR_BUSY'), { code: 'VOICE_ASR_BUSY' });
    const digest = crypto.createHash('sha256').update(audio).digest('hex');
    const cacheKey = messageId ? String(messageId).slice(0, 160) : digest;
    const cached = cache.get(cacheKey);
    if (cached && cached.digest === digest && Date.now() - cached.at < 24 * 60 * 60 * 1000) return { ...cached.result, cached: true };
    inFlight++;
    const id = crypto.randomUUID();
    const silkPath = path.join(incoming, `${id}.silk`);
    const wavPath = path.join(incoming, `${id}.wav`);
    try {
      await ensureDirs();
      await cleanupStale(incoming);
      await fsp.writeFile(silkPath, audio, { flag: 'wx', mode: 0o600 });
      await runPython(decoder, ['--in', silkPath, '--out', wavPath], 60000);
      const wav = await fsp.readFile(wavPath);
      const audioSeconds = validateWav(wav);
      const settings = voiceConfig();
      const durationLimit = Number(maxSeconds ?? settings.maxSeconds ?? 120);
      if (audioSeconds <= 0 || audioSeconds > durationLimit) throw Object.assign(new Error('VOICE_DURATION_LIMIT'), { code: 'VOICE_DURATION_LIMIT' });
      const stt = speechService();
      if (!stt) throw Object.assign(new Error('VOICE_ASR_SERVICE_UNAVAILABLE'), { code: 'VOICE_ASR_SERVICE_UNAVAILABLE' });
      const id = String(providerId ?? settings.provider ?? DEFAULT_PROVIDER);
      await ensureAsrReady(stt, id);
      const spec = stt.resolve({ audio: new Uint8Array(wav), providerId: id, language: String(language ?? settings.language ?? DEFAULT_LANGUAGE) });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('VOICE_ASR_TIMEOUT')), 150000);
      try {
        const result = await stt.transcribe(spec, controller.signal);
        const text = safeText(result?.text, MAX_TRANSCRIPT_CHARS);
        if (!text) throw Object.assign(new Error('VOICE_TRANSCRIPT_EMPTY'), { code: 'VOICE_TRANSCRIPT_EMPTY' });
        const answer = { text, providerId: id, language: String(language ?? settings.language ?? DEFAULT_LANGUAGE), audioSeconds: Number(result?.audioSeconds ?? audioSeconds), inferenceSeconds: Number(result?.inferenceSeconds ?? 0), cached: false };
        cache.set(cacheKey, { digest, at: Date.now(), result: answer });
        while (cache.size > 500) cache.delete(cache.keys().next().value);
        return answer;
      } finally { clearTimeout(timer); }
    } finally {
      await Promise.all([silkPath, wavPath].map(file => fsp.unlink(file).catch(() => {})));
      inFlight = Math.max(0, inFlight - 1);
    }
  }
  function ttsProvider(settings, options) {
    const provider = String(options?.provider ?? settings.ttsProvider ?? DEFAULT_TTS_PROVIDER).trim();
    if (!['mimo-v2.5-tts', 'edge-tts'].includes(provider)) {
      throw Object.assign(new Error('VOICE_TTS_PROVIDER_UNSUPPORTED'), { code: 'VOICE_TTS_PROVIDER_UNSUPPORTED' });
    }
    return provider;
  }
  async function synthesizeMimoWav(text, { voice, style } = {}) {
    return requestMimoWav(text, { voice, style });
  }
  async function synthesizeSilk(textValue, options = {}) {
    if (disposed) throw Object.assign(new Error('VOICE_SERVICE_STOPPED'), { code: 'VOICE_SERVICE_STOPPED' });
    const text = safeText(textValue, 240);
    if ([...text].length < 2 || !/[\p{L}\p{N}]/u.test(text)) throw Object.assign(new Error('VOICE_TTS_TEXT_INVALID'), { code: 'VOICE_TTS_TEXT_INVALID' });
    await ensureDirs();
    await cleanupStale(outgoing);
    await cleanupStale(temp);
    const settings = voiceConfig();
    const provider = ttsProvider(settings, options);
    const id = crypto.randomUUID();
    const textPath = path.join(temp, `${id}.txt`);
    const wavPath = path.join(temp, `${id}.wav`);
    const outputPath = path.join(outgoing, `${id}.silk`);
    let voice;
    let meta = null;
    try {
      await fsp.writeFile(textPath, text, { flag: 'wx', mode: 0o600 });
      if (provider === 'mimo-v2.5-tts') {
        const requestedVoice = String(options.voice ?? settings.ttsVoice ?? DEFAULT_MIMO_VOICE);
        voice = MIMO_VOICES.has(requestedVoice) ? requestedVoice : DEFAULT_MIMO_VOICE;
        const wav = await synthesizeMimoWav(text, { voice, style: options.style ?? settings.ttsStyle ?? DEFAULT_TTS_STYLE });
        await fsp.writeFile(wavPath, wav, { flag: 'wx', mode: 0o600 });
        const result = await runPython(wavEncoder, ['--in', wavPath, '--out', outputPath], 120000);
        const metaLine = String(result.stdout ?? '').split(/\r?\n/).map(line => line.startsWith('JSON: ') ? line.slice(6) : '').find(Boolean);
        try { meta = metaLine ? JSON.parse(metaLine) : null; } catch { /* validate output file below */ }
      } else {
        // Backward-compatible optional Edge TTS backend; it is never invoked automatically after a MiMo failure.
        const legacyVoice = String(options.edgeVoice ?? settings.edgeVoice ?? (String(settings.ttsVoice ?? '').includes('Neural') ? settings.ttsVoice : DEFAULT_EDGE_VOICE));
        const result = await runPython(synthesizer, ['--text-file', textPath, '--out', outputPath,
          '--voice', legacyVoice,
          '--rate', String(options.rate ?? settings.ttsRate ?? DEFAULT_RATE),
          '--pitch', String(options.pitch ?? settings.ttsPitch ?? DEFAULT_PITCH)], 120000);
        const metaLine = String(result.stdout ?? '').split(/\r?\n/).map(line => line.startsWith('JSON: ') ? line.slice(6) : '').find(Boolean);
        try { meta = metaLine ? JSON.parse(metaLine) : null; } catch { /* validate output file below */ }
        voice = legacyVoice;
      }
      const stat = await fsp.stat(outputPath).catch(() => null);
      if (!stat?.isFile() || stat.size < 100 || stat.size > MAX_SILK_BYTES || meta?.ok === false) {
        throw Object.assign(new Error('VOICE_TTS_OUTPUT_INVALID'), { code: 'VOICE_TTS_OUTPUT_INVALID' });
      }
      const head = await fsp.open(outputPath, 'r');
      let magic;
      try { const buffer = Buffer.alloc(9); await head.read(buffer, 0, 9, 0); magic = buffer.toString('ascii'); }
      finally { await head.close(); }
      if (magic !== '#!SILK_V3') throw Object.assign(new Error('VOICE_TTS_OUTPUT_INVALID'), { code: 'VOICE_TTS_OUTPUT_INVALID' });
      return { path: outputPath, bytes: stat.size, durationMs: Number.isFinite(Number(meta?.durationMs)) ? Number(meta.durationMs) : null,
        provider, voice, expiresAfterMs: 60 * 60 * 1000 };
    } finally {
      await Promise.all([textPath, wavPath].map(file => fsp.unlink(file).catch(() => {})));
    }
  }
  async function status(force = false) {
    if (!force && lastStatus && Date.now() - lastStatusAt < 30000) return lastStatus;
    const settings = voiceConfig();
    const tts = ttsProvider(settings, {});
    const python = await checkPython(tts);
    const stt = speechService();
    const mimoApiKeyConfigured = !!String(process.env.MIMO_API_KEY ?? '').trim();
    let provider = null;
    try { provider = stt?.snapshot?.().providers?.find(item => String(item.id) === String(voiceConfig().provider ?? DEFAULT_PROVIDER)) ?? null; } catch { /* optional provider */ }
    lastStatus = { ok: true, python, ttsProvider: tts, ttsAvailable: python.available && (tts !== 'mimo-v2.5-tts' || mimoApiKeyConfigured),
      ttsProviderConfigured: tts !== 'mimo-v2.5-tts' || mimoApiKeyConfigured, mimoApiKeyConfigured,
      asrServiceAvailable: !!stt, asrProvider: String(settings.provider ?? DEFAULT_PROVIDER), asrProviderAvailable: !!provider,
      asrPhase: provider?.preparation?.phase ?? 'unknown', cacheEntries: cache.size,
      maxSilkBytes: MAX_SILK_BYTES, maxSeconds: Number(settings.maxSeconds ?? 120),
      note: !stt ? 'Enable DSH speechToText/SenseVoice provider to activate ASR.' : !python.available ? 'Install voice dependencies with scripts/setup-voice.ps1.' : tts === 'mimo-v2.5-tts' && !mimoApiKeyConfigured ? 'Set MIMO_API_KEY in the Windows user environment, then restart WeChatAgent and DSH.' : '' };
    lastStatusAt = Date.now();
    return lastStatus;
  }
  async function dispose() { disposed = true; clearInterval(cleanupTimer); cache.clear(); }
  return { status, transcribeSilk, synthesizeSilk, dispose };
}
