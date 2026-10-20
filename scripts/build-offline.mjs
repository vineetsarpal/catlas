import { spawnSync } from 'node:child_process';

// Local frontend .env settings must not enable an API dependency in the offline ZIP.
if (!process.env.npm_execpath) throw new Error('Run this script through npm run package:offline.');
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_CATLAS_BACKEND: 'false' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
