import { spawn } from 'node:child_process';

const children = new Set();
const grouped = process.platform !== 'win32';
let stopping = false;
let forceStop;

function signal(child, name) {
  try {
    if (grouped) process.kill(-child.pid, name);
    else child.kill(name);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) signal(child, 'SIGTERM');
  forceStop = setTimeout(() => {
    for (const child of children) signal(child, 'SIGKILL');
  }, 5000);
  forceStop.unref();
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

for (const workspace of ['backend', 'frontend']) {
  const child = spawn(process.execPath, [
    process.env.npm_execpath,
    'run', 'dev', `--workspace=@catlas/${workspace}`, '--',
    ...(workspace === 'frontend' ? process.argv.slice(2) : []),
  ], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, VITE_CATLAS_BACKEND: 'true' },
    stdio: 'inherit',
    detached: grouped,
  });
  children.add(child);
  child.on('error', (error) => {
    console.error(`Could not start ${workspace}:`, error.message);
    children.delete(child);
    stop(1);
  });
  child.on('exit', (code, exitSignal) => {
    // Clean up any descendants left behind by npm before removing its group.
    signal(child, 'SIGTERM');
    children.delete(child);
    stop(code ?? (exitSignal ? 1 : 0));
    if (children.size === 0) clearTimeout(forceStop);
  });
}
