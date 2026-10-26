import { archiveBridge, type ArchiveBridgeEnv } from '../../_archive';

/** Pages keeps the archive origin and proof credential in server-side bindings. */
export const onRequest = (context: { request: Request; env: ArchiveBridgeEnv }): Promise<Response> => archiveBridge(context.request, context.env);
