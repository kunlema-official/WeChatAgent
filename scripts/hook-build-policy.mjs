import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Fail before staging an installer if its native resource is stale or corrupt.
export function verifyHookBuild(directory) {
  const build = JSON.parse(fs.readFileSync(path.join(directory, 'build.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (build.targetVersion !== '4.1.10.27' || build.initialization !== 'deferred-module-v3' ||
      build.mutexCompatibility !== 'legacy-runtime-constructor-v1' ||
      build.exceptionDiagnostics !== 'seh-cpp-stage-v1' || build.logWriter !== 'win32-srw-v1') {
    throw new Error('Hook build is outdated: rebuild the native component before packaging.');
  }
  const dll = fs.readFileSync(path.join(directory, 'version.dll'));
  const actual = crypto.createHash('sha256').update(dll).digest('hex');
  if (actual !== build.sha256) throw new Error('Hook DLL does not match build.json; packaging stopped.');
  return build;
}
