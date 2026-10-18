import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { parseShakingGrid } from './evidence';
import { assessExposure, SAMPLER_VERSION } from './model';
import { stressPortfolio } from './fixtures';
it.skipIf(process.env.CATLAS_EXPOSURE_DIAGNOSTIC !== '1')('reports actual-grid baseline and larger diagnostic timings without a capacity/SLA claim',async()=>{
 const start=performance.now();
 const raw=gunzipSync(await fs.readFile('public/evidence/shaking/ridgecrest-grid.xml.gz')).toString('utf8');const grid=parseShakingGrid(raw).grid;
 const parseMs=performance.now()-start,measurements=[];
 for(const count of [1000,10000]){
   const portfolio=stressPortfolio(count),begin=performance.now(),result=assessExposure(portfolio,grid,{threshold:4,sampler:SAMPLER_VERSION});
   const durationMs=performance.now()-begin;expect(result.summary.total).toBe(count);expect(result.summary.meetingThreshold!+result.summary.belowThreshold!+result.summary.unknownIntensity).toBe(count);
   if(count===1000)expect(result.summary).toMatchObject({meetingThreshold:590,belowThreshold:300,unknownIntensity:110});
   measurements.push({locations:count,durationMs,summary:result.summary,supportedBaseline:count===1000});
 }
 await fs.mkdir('docs/verification',{recursive:true});await fs.writeFile('docs/verification/exposure-diagnostic.json',JSON.stringify({runAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,parseMs,measurements,declaration:'Node calculation timing only; 1,000-location supported baseline, 10,000 diagnostic only; not a browser FPS, memory or production SLA claim.'},null,2));
 console.log(JSON.stringify({parseMs,measurements}));
});
