import manifest from './evidence-manifest.json';
import { eventSchema } from './model';
export const ridgecrest = eventSchema.parse({schemaVersion:1,id:'ci38457511',name:'Ridgecrest, California',evidenceVersion:manifest.files[0].sha256,magnitude:7.1,magnitudeType:'mw',latitude:35.7695,longitude:-117.5993333,occurredAt:'2019-07-06T03:19:53.040Z',provenance:{kind:'historical',...manifest}});
export { manifest };
