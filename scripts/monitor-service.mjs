import { homedir, userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';

const user = userInfo();
const releaseRoot = process.env.CATLAS_MONITOR_DEPLOY_ROOT;
if (releaseRoot && (!isAbsolute(releaseRoot) || releaseRoot === '/' || resolve(releaseRoot) !== releaseRoot)) throw Error('CATLAS_MONITOR_DEPLOY_ROOT must be a canonical absolute directory.');
const repository = releaseRoot ? `${releaseRoot}/current` : fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const node = process.execPath;
const configuration = `${homedir()}/.config/catlas-monitor.env`;
if (user.uid === 0) throw Error('Generate this unit as the unprivileged user who will run Monitor.');
if (![user.username, repository, node, configuration].every(value => /^[a-zA-Z0-9_./@+-]+$/.test(value))) throw Error('Service paths and username must not contain whitespace or systemd specifiers.');
console.log(`[Unit]
Description=Catlas Monitor API
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${user.username}
WorkingDirectory=${repository}/backend
Environment=NODE_ENV=production
Environment=CATLAS_MONITOR_HOSTED=true
EnvironmentFile=${configuration}
ExecStart=${node} --import tsx src/index.ts
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
UMask=0077
MemoryMax=1G
TasksMax=128

[Install]
WantedBy=multi-user.target`);
