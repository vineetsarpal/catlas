import { spawnSync } from 'node:child_process';

// package:offline has already created the independent ZIP and Pages download.
// Build the enabled hosted UI directly into Pages without touching the ZIP.
if (!process.env.npm_execpath) throw Error('Run this through npm run package:pages.');
if (process.env.VITE_CATLAS_BACKEND === 'true') {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build', '--workspace=@catlas/frontend', '--', '--outDir', '../release/pages', '--emptyOutDir', 'false'], {
    stdio: 'inherit', env: { ...process.env, VITE_CATLAS_BACKEND: 'true' },
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
