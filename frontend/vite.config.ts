import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { archiveBridge, type ArchiveBridgeEnv } from '../functions/_archive';

/** Read ignored operator configuration on the dev server only; never use VITE_ secret bindings. */
function archiveEnvironment(): ArchiveBridgeEnv {
  const privateValues: Record<string, string> = {};
  try {
    const source = readFileSync(new URL('../services/exposure-archive/.proof.env', import.meta.url), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const match = /^(ARCHIVE_BASE_URL|PROOF_TOKEN)=(.*)$/.exec(line.trim());
      if (match) privateValues[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* Missing private configuration becomes a truthful HTTP 503. */ }
  return { ARCHIVE_API_ORIGIN: process.env.CATLAS_ARCHIVE_API_ORIGIN ?? privateValues.ARCHIVE_BASE_URL, ARCHIVE_PROOF_TOKEN: process.env.CATLAS_ARCHIVE_PROOF_TOKEN ?? privateValues.PROOF_TOKEN };
}
function archiveProxy(): Plugin {
  return {
    name: 'catlas-public-archive-bridge',
    configureServer(server) {
      const env = archiveEnvironment();
      server.middlewares.use((incoming, outgoing, next) => {
        if (!incoming.url?.startsWith('/api/exposure/')) return next();
        void (async () => {
          const controller = new AbortController();
          incoming.on('aborted', () => controller.abort());
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          const init: RequestInit & { duplex?: 'half' } = { method: incoming.method, headers, signal: controller.signal };
          if (incoming.method !== 'GET' && incoming.method !== 'HEAD') { init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>; init.duplex = 'half'; }
          const request = new Request(new URL(incoming.url!, 'http://127.0.0.1'), init);
          const result = await archiveBridge(request, env);
          outgoing.statusCode = result.status;
          result.headers.forEach((value, key) => outgoing.setHeader(key, value));
          if (!result.body) { outgoing.end(); return; }
          const body = Readable.fromWeb(result.body as Parameters<typeof Readable.fromWeb>[0]);
          outgoing.on('close', () => { if (!outgoing.writableEnded) { controller.abort(); body.destroy(); } });
          body.on('error', () => outgoing.destroy());
          body.pipe(outgoing);
        })().catch(() => { if (!outgoing.headersSent) { outgoing.statusCode = 503; outgoing.setHeader('content-type', 'application/json'); outgoing.end(JSON.stringify({ error: { code: 'archive_unavailable', message: 'The public archive is unavailable. Retry explicitly.' } })); } else outgoing.destroy(); });
      });
    },
  };
}
export default defineConfig({ plugins: [react(), archiveProxy()], base: './', server:{proxy:{'/api/monitor':{target:'http://127.0.0.1:3001',changeOrigin:true}}}, build: { rollupOptions: { input: { main: 'index.html', exposure: 'exposure.html' } } }, test: { include: ['src/**/*.test.ts'] } } as Parameters<typeof defineConfig>[0]);
