import { z } from 'zod';

const position=z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)]);
const ring=z.array(position).min(4).refine(points=>points[0][0]===points.at(-1)![0]&&points[0][1]===points.at(-1)![1],'Ring must be closed');
export const hazardGeometrySchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('Polygon'),coordinates:z.array(ring).min(1)}),
  z.object({type:z.literal('MultiPolygon'),coordinates:z.array(z.array(ring).min(1)).min(1)}),
]);
export type HazardGeometry=z.infer<typeof hazardGeometrySchema>;
export const fireDetectionSchema=z.object({id:z.string().min(1),longitude:z.number().min(-180).max(180),latitude:z.number().min(-90).max(90),detectedAt:z.string().datetime(),source:z.string(),confidence:z.number().nullable()});
export type FireDetection=z.infer<typeof fireDetectionSchema>;
export const firePerimeterSchema=z.object({id:z.string().min(1),name:z.string(),geometry:hazardGeometrySchema.nullable(),updatedAt:z.string().datetime().nullable(),containment:z.number().min(0).max(100).nullable(),sourceUrl:z.string().url()});
export type FirePerimeter=z.infer<typeof firePerimeterSchema>;
export const weatherAlertSchema=z.object({id:z.string().min(1),references:z.array(z.string()),name:z.string(),event:z.string(),severity:z.string(),certainty:z.string(),urgency:z.string(),issuedAt:z.string().datetime(),updatedAt:z.string().datetime(),expiresAt:z.string().datetime(),active:z.boolean(),geometry:hazardGeometrySchema.nullable(),description:z.string(),sourceUrl:z.string().url()});
export type WeatherAlert=z.infer<typeof weatherAlertSchema>;
export type HazardSnapshot<T>={fetchedAt:string;stale:boolean;warning:string;rejected:number;rows:T[]};
const snapshot=<T extends z.ZodType>(row:T)=>z.object({fetchedAt:z.string().datetime(),stale:z.boolean(),warning:z.string(),rejected:z.number().int().nonnegative(),rows:z.array(row)});
export const fireSnapshotSchema=snapshot(fireDetectionSchema);
export const perimeterSnapshotSchema=snapshot(firePerimeterSchema);
export const alertSnapshotSchema=snapshot(weatherAlertSchema);
