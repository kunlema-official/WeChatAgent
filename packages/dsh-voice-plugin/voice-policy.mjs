const own = (value, key) => Object.hasOwn(value ?? {}, key);
const CHAT_KEY = /^wechat:(?:private|group):\d+$/;

export function voiceEnabledFor(wechat, conversationKey) {
  if (typeof conversationKey !== 'string' || !CHAT_KEY.test(conversationKey)) return false;
  const voice = wechat?.voice;
  if (!voice || typeof voice !== 'object' || Array.isArray(voice)) return false;
  if (own(voice.chats, conversationKey)) return voice.chats[conversationKey] === true;
  return voice.enabled === true;
}

export function validateVoiceSettings(voice) {
  if (voice === undefined) return;
  const fail = message => { throw new Error(message); };
  if (!voice || typeof voice !== 'object' || Array.isArray(voice)) fail('wechat.voice must be an object');
  if (voice.enabled !== undefined && typeof voice.enabled !== 'boolean') fail('wechat.voice.enabled must be boolean');
  if (voice.chats !== undefined && (!voice.chats || typeof voice.chats !== 'object' || Array.isArray(voice.chats))) fail('wechat.voice.chats must be an object');
  for (const [key, value] of Object.entries(voice.chats ?? {})) {
    if (!CHAT_KEY.test(key) || typeof value !== 'boolean') fail('Invalid per-chat voice setting');
  }
  if (voice.provider !== undefined && (typeof voice.provider !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(voice.provider))) fail('Invalid voice provider');
  if (voice.language !== undefined && !['zh', 'en', 'ja', 'yue', 'auto'].includes(voice.language)) fail('Invalid voice language');
  if (voice.maxSeconds !== undefined && (!Number.isInteger(voice.maxSeconds) || voice.maxSeconds < 1 || voice.maxSeconds > 300)) fail('voice.maxSeconds must be between 1 and 300');
  if (voice.maxReplyChars !== undefined && (!Number.isInteger(voice.maxReplyChars) || voice.maxReplyChars < 10 || voice.maxReplyChars > 240)) fail('voice.maxReplyChars must be between 10 and 240');
  if (voice.pythonExe !== undefined && (typeof voice.pythonExe !== 'string' || voice.pythonExe.length > 1024 || /[\0\r\n]/.test(voice.pythonExe))) fail('Invalid voice.pythonExe');
  if (voice.ttsProvider !== undefined && !['mimo-v2.5-tts', 'edge-tts'].includes(voice.ttsProvider)) fail('Invalid TTS provider');
  const mimoVoices = ['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'];
  const legacyEdgeVoice = typeof voice.ttsVoice === 'string' && /^zh-CN-[A-Za-z]+Neural$/.test(voice.ttsVoice);
  if (voice.ttsVoice !== undefined && typeof voice.ttsVoice !== 'string') fail('Invalid TTS voice');
  if (voice.ttsVoice !== undefined && !mimoVoices.includes(voice.ttsVoice) && !legacyEdgeVoice) fail('Invalid TTS voice');
  if (voice.edgeVoice !== undefined && (typeof voice.edgeVoice !== 'string' || !/^zh-CN-[A-Za-z]+Neural$/.test(voice.edgeVoice))) fail('Invalid Edge TTS voice');
  if (voice.ttsStyle !== undefined && (typeof voice.ttsStyle !== 'string' || voice.ttsStyle.length > 800 || /[\0]/.test(voice.ttsStyle))) fail('Invalid TTS style');
  if (voice.ttsRate !== undefined && (typeof voice.ttsRate !== 'string' || !/^[+-]\d{1,2}%$/.test(voice.ttsRate))) fail('Invalid TTS rate');
  if (voice.ttsPitch !== undefined && (typeof voice.ttsPitch !== 'string' || !/^[+-]\d{1,3}Hz$/.test(voice.ttsPitch))) fail('Invalid TTS pitch');
}
