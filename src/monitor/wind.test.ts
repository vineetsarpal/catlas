import { describe, expect, it } from 'vitest';
import { forecastURL, windRanges, readRange, sampleWind } from './wind';
const run='2026-10-19T18:00:00.000Z';
const index='1:0:d=2026101918:TMP:surface:6 hour fcst:\n2:100:d=2026101918:UGRD:10 m above ground:6 hour fcst:\n3:200:d=2026101918:VGRD:10 m above ground:6 hour fcst:\n4:350:d=2026101918:PRMSL:mean sea level:6 hour fcst:';

describe('browser wind acquisition and sampling',()=>{
  it('selects fixed NOAA objects and bounded surface-component ranges from the same run',()=>{
    expect(forecastURL(run,'2026-10-20T00:00:00Z')).toBe('https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261019/18/atmos/gfs.t18z.pgrb2.1p00.f006');
    expect(windRanges(index,run)).toEqual([{start:100,end:199},{start:200,end:349}]);
    expect(()=>windRanges(index,'2026-10-19T12:00:00Z')).toThrow('matching surface');
    expect(()=>windRanges(index.replace('VGRD','TMP'),run)).toThrow();
    expect(()=>windRanges(index.replace('3:200:','3:50:'),run)).toThrow('byte range');
    expect(()=>forecastURL(run,'2026-10-20T01:00:00Z')).toThrow('forecast step');
  });
  it('rejects full-file responses, short bodies and oversized ranges before decoding',async()=>{
    await expect(readRange(new Response(new Uint8Array(10),{status:200}),10)).rejects.toThrow('partial');
    await expect(readRange(new Response(new Uint8Array(5),{status:206}),10)).rejects.toThrow('incomplete');
    await expect(readRange(new Response(new Uint8Array(11),{status:206}),10)).rejects.toThrow('exceeds');
    expect(new Uint8Array(await readRange(new Response(new Uint8Array([1,2,3]),{status:206}),3))).toEqual(new Uint8Array([1,2,3]));
  });
  it('interpolates vectors across longitude wrap and rejects missing or impossible samples',()=>{
    const field={nx:4,ny:3,lo1:0,la1:90,dx:90,dy:90,u:new Float32Array([0,10,20,30,0,10,20,30,0,10,20,30]),v:new Float32Array(12).fill(4)};
    expect(sampleWind(field,-45,0)).toEqual({u:15,v:4});
    expect(sampleWind(field,315,0)).toEqual(sampleWind(field,-45,0));
    expect(sampleWind(field,45,45)).toEqual({u:5,v:4});
    expect(sampleWind(field,0,91)).toBeNull();
    field.u[0]=NaN;expect(sampleWind(field,0,90)).toBeNull();
  });
});
