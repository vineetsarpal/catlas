import { eventSchema } from '../domain/types';
/** Deliberately synthetic in-coverage occurrence, not a historical USGS observation. */
export const outerEvent = eventSchema.parse({schemaVersion:1,id:'SIM-OUTER-01',name:'Synthetic outer-band earthquake',evidenceVersion:'synthetic-outer-v1',magnitude:7.1,magnitudeType:'mw',longitude:-118.065,latitude:35.8,occurredAt:'2019-07-07T12:00:00.000Z',provenance:{kind:'synthetic',declaration:'Fictional demonstration event and occurrence time; not USGS evidence.',fixtureDecision:'CAT-5 two-area amendment',coordinateOrder:'longitude, latitude'}});
