export interface FrontDoorEnv { ASSETS?: Fetcher; CAPTURE_COORDINATOR?: DurableObjectNamespace }
/** The Free Worker only routes streams; acquisition and verification run in the coordinator. */
export async function routeRequest(request: Request, env: FrontDoorEnv): Promise<Response> {
  if (!new URL(request.url).pathname.startsWith('/api/')) {
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found.', { status: 404 });
  }
  try {
    if (!env.CAPTURE_COORDINATOR) throw new Error('Coordinator binding is absent');
    const id = env.CAPTURE_COORDINATOR.idFromName('catlas-exposure-proof');
    return await env.CAPTURE_COORDINATOR.get(id).fetch(request);
  } catch {
    return Response.json({ error: { code: 'coordinator_unavailable', message: 'The capture coordinator is unavailable. Previously saved local cases remain usable.' } }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Request-Id': crypto.randomUUID(), 'X-Content-Type-Options': 'nosniff' },
    });
  }
}
