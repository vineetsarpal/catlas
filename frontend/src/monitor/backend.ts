import { z } from 'zod';
import type { WindMetadata } from './feeds';
export const WIND_BACKEND_REQUIRED='Wind requires the Catlas backend.';
export const backendEnabled=import.meta.env.VITE_CATLAS_BACKEND==='true';
export async function backendJSON(path:string,signal:AbortSignal){
  const response=await fetch(`/api/monitor/${path}`,{signal});
  if(!response.ok)throw Error(`Local backend unavailable (${response.status}). Check that it is running.`);
  return response.json();
}
export const windMetadataSchema=z.object({runAt:z.string().datetime(),defaultTime:z.string().datetime(),times:z.array(z.string().datetime()).min(1).max(17)});
export async function discoverBackendWind(signal:AbortSignal):Promise<WindMetadata>{if(!backendEnabled)throw new Error(WIND_BACKEND_REQUIRED);return windMetadataSchema.parse(await backendJSON('wind',signal));}
