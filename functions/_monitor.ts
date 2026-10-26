export type MonitorBridgeEnv = { MONITOR_API_ORIGIN?: string; MONITOR_API_TOKEN?: string };
const refuse = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** Forward only public Monitor routes; all credentials and routing stay on the server. */
export async function monitorBridge(request: Request, env: MonitorBridgeEnv, upstream: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const routes: Record<string, string[]> = {
    '/api/monitor/health': [], '/api/monitor/wind': [],
    '/api/monitor/wind/grid': ['runAt', 'validAt'],
    '/api/monitor/fires': [], '/api/monitor/perimeters': [], '/api/monitor/alerts': [],
    '/api/monitor/vessels': ['viewer', 'bbox'],
  };
  const keys = request.method === 'GET' && Object.hasOwn(routes, url.pathname) ? routes[url.pathname]
    : request.method === 'DELETE' && /^\/api\/monitor\/vessels\/[a-zA-Z0-9-]{1,80}$/.test(url.pathname) ? [] : null;
  if (!keys) return refuse('This Monitor route does not exist.', 404);
  const submitted = [...url.searchParams.keys()];
  if (url.search.length > 4096 || submitted.some(key => !keys.includes(key)) || new Set(submitted).size !== submitted.length || request.body) return refuse('Use only the supported Monitor query fields.', 400);
  let origin: URL;
  try { origin = new URL(env.MONITOR_API_ORIGIN ?? ''); } catch { return refuse('The Monitor connection is not configured.', 503); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port || origin.pathname !== '/' || origin.search || origin.hash || !/^[a-f0-9]{64}$/.test(env.MONITOR_API_TOKEN ?? '')) return refuse('The Monitor connection is not configured.', 503);
  const headers = new Headers({ authorization: `Bearer ${env.MONITOR_API_TOKEN}` });
  const client = request.headers.get('cf-connecting-ip');
  if (client && client.length <= 45) headers.set('x-catlas-client-ip', client);
  try {
    const result = await upstream(`${origin.origin}${url.pathname}${url.search}`, {
      method: request.method, headers, redirect: 'manual',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    });
    if (!result.ok) {
      await result.body?.cancel();
      const status = [400, 404, 429, 502, 503, 504].includes(result.status) ? result.status : 503;
      return refuse(status === 429 ? 'The Monitor request limit was reached. Retry shortly.' : 'The Monitor service is unavailable or refused this request. Retry shortly.', status);
    }
    const safe = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const key of ['content-type', 'x-wind-metadata']) { const value = result.headers.get(key); if (value) safe.set(key, value); }
    return new Response(result.body, { status: result.status, headers: safe });
  } catch { return refuse('The Monitor service is unavailable. Retry shortly.', 503); }
}
