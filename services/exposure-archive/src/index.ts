import { DurableObject } from 'cloudflare:workers';
import { createCoordinatorHandler } from './coordinator';
import type { Env as ArchiveEnv } from './archive';
import { routeRequest, type FrontDoorEnv } from './router';

/** SQLite-backed namespace; no alarms, scheduled work, insured data or archive replacement. */
export class CaptureCoordinator extends DurableObject<ArchiveEnv> {
  private readonly execute = createCoordinatorHandler();
  fetch(request: Request): Promise<Response> { return this.execute(request, this.env); }
}
export type Env = ArchiveEnv & FrontDoorEnv;
export { createArchiveHandler } from './archive';
export default { fetch: (request: Request, env: Env) => routeRequest(request, env) };
