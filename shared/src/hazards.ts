import { z } from 'zod';

const position=z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)]);
const ring=z.array(position).min(4).refine(points=>points[0][0]===points.at(-1)![0]&&points[0][1]===points.at(-1)![1],'Ring must be closed');
export const hazardGeometrySchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('Polygon'),coordinates:z.array(ring).min(1)}),
  z.object({type:z.literal('MultiPolygon'),coordinates:z.array(z.array(ring).min(1)).min(1)}),
]);
export type HazardGeometry=z.infer<typeof hazardGeometrySchema>;
export const fireDetectionSchema=z.object({id:z.string().min(1),longitude:z.number().min(-180).max(180),latitude:z.number().min(-90).max(90),detectedAt:z.string().datetime(),source:z.string(),confidence:z.number().nullable(),provider:z.enum(['FIRMS','CWFIS']).optional()});
export type FireDetection=z.infer<typeof fireDetectionSchema>;
export const firePerimeterSchema=z.object({id:z.string().min(1),name:z.string(),geometry:hazardGeometrySchema.nullable(),updatedAt:z.string().datetime().nullable(),containment:z.number().min(0).max(100).nullable(),sourceUrl:z.string().url(),provider:z.enum(['NIFC','CWFIS']).optional(),evidence:z.enum(['reported-perimeter','reported-incident','estimated-perimeter']).optional(),position:z.object({longitude:z.number().min(-180).max(180),latitude:z.number().min(-90).max(90)}).optional(),cwfis:z.object({agency:z.string(),status:z.string(),recordStart:z.string().datetime().optional(),recordEnd:z.string().datetime().optional(),lastDetectedAt:z.string().datetime().optional()}).optional()});
export type FirePerimeter=z.infer<typeof firePerimeterSchema>;
export const weatherAlertSchema=z.object({id:z.string().min(1),references:z.array(z.string()),name:z.string(),event:z.string(),severity:z.string(),certainty:z.string(),urgency:z.string(),issuedAt:z.string().datetime(),updatedAt:z.string().datetime(),expiresAt:z.string().datetime(),active:z.boolean(),geometry:hazardGeometrySchema.nullable(),description:z.string(),sourceUrl:z.string().url(),provider:z.enum(['NWS','ECCC']).optional(),eccc:z.object({area:z.string(),province:z.string(),alertType:z.string(),status:z.string(),riskColour:z.string(),impact:z.string(),confidence:z.string(),validAt:z.string().datetime().nullable(),eventEndAt:z.string().datetime().nullable(),nameFr:z.string(),descriptionFr:z.string()}).optional()});
export type WeatherAlert=z.infer<typeof weatherAlertSchema>;
export type HazardSnapshot<T>={fetchedAt:string;stale:boolean;warning:string;rejected:number;rows:T[]};
const snapshot=<T extends z.ZodType>(row:T)=>z.object({fetchedAt:z.string().datetime(),stale:z.boolean(),warning:z.string(),rejected:z.number().int().nonnegative(),rows:z.array(row)});
export const fireSourceStatusSchema=z.object({provider:z.enum(['FIRMS','NIFC','CWFIS hotspots','CWFIS incidents','CWFIS estimates']),fetchedAt:z.string().datetime(),stale:z.boolean(),warning:z.string(),rejected:z.number().int().nonnegative(),available:z.boolean()});
export type FireSourceStatus=z.infer<typeof fireSourceStatusSchema>;
export const fireSnapshotSchema=snapshot(fireDetectionSchema).extend({sources:z.array(fireSourceStatusSchema).max(2).optional()});
export const perimeterSnapshotSchema=snapshot(firePerimeterSchema).extend({sources:z.array(fireSourceStatusSchema).max(3).optional()});
export type FireSnapshot=z.infer<typeof fireSnapshotSchema>;
export type FirePerimeterSnapshot=z.infer<typeof perimeterSnapshotSchema>;
export const alertSourceStatusSchema=z.object({provider:z.enum(['NWS','ECCC']),fetchedAt:z.string().datetime(),stale:z.boolean(),warning:z.string(),rejected:z.number().int().nonnegative(),available:z.boolean().optional()});
export const alertSnapshotSchema=snapshot(weatherAlertSchema).extend({sources:z.array(alertSourceStatusSchema).max(2).optional()});
export type WeatherAlertSnapshot=z.infer<typeof alertSnapshotSchema>;

export const CWFIS_ESTIMATE_WINDOW=7*24*3600_000;
/** Time limits also apply to retained browser evidence when acquisition is unavailable. */
export function currentFireEvidence(row:FirePerimeter,now:number) {
  if(row.evidence==='estimated-perimeter') {
    const at=Date.parse(row.cwfis?.lastDetectedAt??'');
    return at>now-CWFIS_ESTIMATE_WINDOW&&at<=now;
  }
  if(row.evidence==='reported-incident')return Date.parse(row.cwfis?.recordStart??'')<=now&&Date.parse(row.cwfis?.recordEnd??'')>=now;
  return true;
}
