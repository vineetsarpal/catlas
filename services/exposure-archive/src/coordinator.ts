import archive, { type Env, type CaptureAdmission } from './archive';
export type ArchiveExecution = (request: Request, env: Env, admission: CaptureAdmission) => Promise<Response>;
/** Single-instance proof execution; external evidence and manifests remain in R2/Neon. */
export function createCoordinatorHandler(execute: ArchiveExecution = archive.fetch) {
  let captureInFlight = false;
  const admission: CaptureAdmission = {
    enter() { if (captureInFlight) return false; captureInFlight = true; return true; },
    leave() { captureInFlight = false; },
  };
  return async (request: Request, env: Env): Promise<Response> => {
    const result = await execute(request, env, admission);
    const response = new Response(result.body, result);
    response.headers.set('X-Catlas-Executor', 'durable-object');
    return response;
  };
}
