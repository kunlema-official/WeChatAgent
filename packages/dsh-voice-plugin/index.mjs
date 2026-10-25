import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVoiceService } from './voice-service.mjs';
import { registerVoiceService } from './registry.mjs';

export const name = 'dsh-voice-plugin';
export const inject = [];

export function apply(ctx, config = {}) {
  const packageRoot = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = typeof config.projectRoot === 'string' && path.isAbsolute(config.projectRoot)
    ? path.resolve(config.projectRoot)
    : path.resolve(packageRoot, '..', '..');
  const service = createVoiceService(ctx, projectRoot, config);
  const unregister = registerVoiceService(ctx, service);
  try {
    const logger = typeof ctx.logger === 'function' ? ctx.logger('dsh-voice-plugin') : ctx.logger;
    logger?.info?.('Voice service registered (ASR provider is resolved lazily).');
  } catch { /* logging must not prevent service startup */ }
  ctx.effect?.(() => async () => {
    unregister();
    await service.dispose();
  });
}

export default apply;
