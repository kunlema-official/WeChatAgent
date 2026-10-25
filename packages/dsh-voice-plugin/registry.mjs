const VOICE_SERVICE_KEY = Symbol.for('wechatagent.dshVoiceService.v1');

export function registerVoiceService(ctx, service) {
  const root = ctx?.root ?? ctx;
  if (root && (typeof root === 'object' || typeof root === 'function')) root[VOICE_SERVICE_KEY] = service;
  try { ctx?.provide?.('wechatVoice', service); } catch { /* registry below keeps compatibility with Cordis contexts */ }
  return () => {
    if (root?.[VOICE_SERVICE_KEY] === service) delete root[VOICE_SERVICE_KEY];
  };
}

export function getVoiceService(ctx) {
  try {
    const service = ctx?.get?.('wechatVoice');
    if (service && typeof service.transcribeSilk === 'function' && typeof service.synthesizeSilk === 'function') return service;
  } catch { /* an optional service must never block DSH startup */ }
  const root = ctx?.root ?? ctx;
  const service = root?.[VOICE_SERVICE_KEY];
  return service && typeof service.transcribeSilk === 'function' && typeof service.synthesizeSilk === 'function' ? service : null;
}
