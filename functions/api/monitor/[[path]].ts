import { monitorBridge, type MonitorBridgeEnv } from '../../_monitor';

export const onRequest = (context: { request: Request; env: MonitorBridgeEnv }): Promise<Response> => monitorBridge(context.request, context.env);
