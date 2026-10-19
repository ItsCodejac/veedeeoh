import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.npm_execpath) throw new Error('Run npm run build:selfhost from the repository root.');
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build', '--prefix', 'frontend'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, VEEDEEOH_TARGET: 'selfhost' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
