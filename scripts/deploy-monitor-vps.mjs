import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

function command(name, args, { cwd, capture = false } = {}) {
  const result = spawnSync(name, args, {
    cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}` },
  });
  if (result.error || result.status !== 0) throw Error(`${name} failed. Check the service/deployment setup; credentials were not printed.`);
  return (result.stdout ?? '').trim();
}

async function healthy(token) {
  try {
    const url = 'http://127.0.0.1:3001/api/monitor/health';
    const refused = await fetch(url, { signal: AbortSignal.timeout(3000) });
    await refused.body?.cancel();
    if (refused.status !== 401) return false;
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) { await response.body?.cancel(); return false; }
    return (await response.json()).status === 'ok';
  } catch { return false; }
}

/** Called under the workflow's flock. Dependencies finish before the running release changes. */
export async function deployMonitor(root, sha, {
  run = command, checkHealth = healthy, pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  configuration = join(homedir(), '.config/catlas-monitor.env'), attempts = 15,
} = {}) {
  if (process.getuid?.() === 0) throw Error('Deploy as the unprivileged service user, not root.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Monitor requires Node 24+.');
  if (!/^[a-f0-9]{40}$/.test(sha) || !isAbsolute(root) || root === '/' || root !== resolve(root) || !/^\/[a-zA-Z0-9_./-]+$/.test(root)) throw Error('Invalid release root or commit.');
  if (realpathSync(root) !== root || lstatSync(root).uid !== process.getuid()) throw Error('Release root must be a real directory owned by the deployment user.');
  for (const name of ['incoming', 'releases']) {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true, mode: 0o750 });
    if (realpathSync(directory) !== directory) throw Error('Release subdirectories must not be symlinks.');
  }
  const unit = 'catlas-monitor.service';
  if (run('systemctl', ['show', unit, '--property=WorkingDirectory', '--value'], { capture: true }) !== join(root, 'current/backend') ||
      run('systemctl', ['show', unit, '--property=User', '--value'], { capture: true }) !== userInfo().username) throw Error('Install the release-based Monitor service for this user before deploying.');
  const mode = lstatSync(configuration);
  if (!mode.isFile() || mode.uid !== process.getuid() || (mode.mode & 0o077) !== 0) throw Error('Monitor configuration must be an owner-only file owned by the deployment user.');
  const config = parseEnv(readFileSync(configuration, 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(config.CATLAS_MONITOR_TOKEN ?? '') || config.CATLAS_MONITOR_HOSTED !== 'true' || (config.CATLAS_API_PORT ?? '3001') !== '3001') throw Error('Configure authenticated Monitor on port 3001 before deploying.');
  const current = join(root, 'current');
  let previous;
  try {
    if (!lstatSync(current).isSymbolicLink()) throw Error('The current release must be a symlink, not a directory.');
    previous = resolve(root, readlinkSync(current));
    if (dirname(previous) !== join(root, 'releases') || !/^[a-f0-9]{40}$/.test(previous.split('/').at(-1)) || realpathSync(previous) !== previous || readFileSync(join(previous, '.catlas-release'), 'utf8') !== previous.split('/').at(-1)) throw Error('Current release does not reference a prepared Monitor release.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; if (previous) throw Error('The previous release is incomplete; refusing deployment.'); }
  const release = join(root, 'releases', sha);
  let stage;
  try {
    let prepared = false;
    try {
      if (realpathSync(release) !== release || readFileSync(join(release, '.catlas-release'), 'utf8') !== sha) throw Error('Existing release is incomplete.');
      prepared = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; if (lstatExists(release)) throw Error('Existing release is incomplete; inspect it before retrying.'); }
    if (!prepared) {
      const archive = join(root, 'incoming', `${sha}.tar.gz`);
      if (!lstatSync(archive).isFile()) throw Error('A release archive must be uploaded first.');
      stage = mkdtempSync(join(root, 'releases', '.stage-'));
      run('tar', ['--extract', '--gzip', '--file', archive, '--directory', stage, '--no-same-owner', '--no-same-permissions']);
      run('npm', ['ci', '--omit=dev', '--workspace=@catlas/backend', '--workspace=@catlas/shared'], { cwd: stage });
      run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "const {createApp}=await import('./backend/src/app.ts'); const app=createApp({monitorToken:'0'.repeat(64)}); try {const r=await app.inject({url:'/api/monitor/health',headers:{authorization:'Bearer '+'0'.repeat(64)}}); if(r.statusCode!==200)throw Error('Runtime check failed');}finally{await app.close();}"], { cwd: stage });
      writeFileSync(join(stage, '.catlas-release'), sha, { flag: 'wx', mode: 0o640 });
      renameSync(stage, release); stage = undefined;
    }
    const activate = target => {
      const temporary = join(root, `.current-${process.pid}`);
      symlinkSync(target, temporary);
      try { renameSync(temporary, current); } finally { if (lstatExists(temporary)) unlinkSync(temporary); }
    };
    const waitHealthy = async () => {
      for (let i = 0; i < attempts; i++) {
        if (await checkHealth(config.CATLAS_MONITOR_TOKEN)) return true;
        if (i + 1 < attempts) await pause(2000);
      }
      return false;
    };
    activate(release);
    try {
      run('sudo', ['-n', '/usr/bin/systemctl', 'restart', unit]);
      if (!await waitHealthy()) throw Error('The new release failed its authenticated health check.');
    } catch {
      if (previous) {
        activate(previous);
        run('sudo', ['-n', '/usr/bin/systemctl', 'restart', unit]);
        if (!await waitHealthy()) throw Error('Deployment failed and the previous release did not recover. Check the VPS service.');
        throw Error('Deployment failed; the previous release was restored and passed its health check.');
      }
      run('sudo', ['-n', '/usr/bin/systemctl', 'stop', unit]);
      unlinkSync(current);
      throw Error('Initial deployment failed; Monitor was stopped. No previous release exists.');
    }
    console.log(`Monitor release ${sha} is active and authenticated health checks passed.`);
    return { release, previous };
  } finally { if (stage) rmSync(stage, { recursive: true, force: true }); }
}

function lstatExists(path) { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

if (process.argv[1] === '-' || resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { await deployMonitor(process.argv[2], process.argv[3]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
