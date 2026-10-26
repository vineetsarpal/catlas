import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const directory = `${homedir()}/.config`;
const path = `${directory}/catlas-monitor.env`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(path, `CATLAS_MONITOR_HOSTED=true\nCATLAS_API_PORT=3001\nCATLAS_MONITOR_TOKEN=${randomBytes(32).toString('hex')}\nAISSTREAM_API_KEY=\nFIRMS_MAP_KEY=\n`, { mode: 0o600, flag: 'wx' });
console.log(`Created ${path} with owner-only permissions. Existing files are never overwritten. No credential was printed.`);
