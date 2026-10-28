/// <reference path="../../services/exposure-archive/node_modules/@cloudflare/workers-types/index.d.ts" />
import { test, expect } from '@playwright/test';
import { createArchiveHandler } from '../../services/exposure-archive/src/archive';
import { createPostgresDatabase } from '../../services/exposure-archive/src/neon';
import type { ArchiveDependencies, ObjectBucket } from '../../services/exposure-archive/src/types';
import { archiveBridge } from '../../functions/_archive';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { openLocations } from '../helpers/exposure-workspace';
const exec=promisify(execFile);
const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55446','-U','catlas_test','-d','catlas_cat56_browser'];
const sql=async(query:string)=>{try{return (await exec('psql',[...args,'-c',query],{maxBuffer:32*1024*1024})).stdout;}catch(error){console.error((error as {stderr?:string}).stderr);throw error;}};
const literal=(v:unknown)=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
class FixtureLengthStream extends TransformStream<Uint8Array,Uint8Array>{constructor(expected:number){let bytes=0;super({transform(chunk,c){bytes+=chunk.byteLength;c.enqueue(chunk);},flush(){if(bytes!==expected)throw Error('Length mismatch');}});}}
Object.assign(globalThis,{FixedLengthStream:FixtureLengthStream});
const token='cat56-browser-public-token-32-characters',admin='cat56-browser-private-token-32-characters',env={PROOF_TOKEN:token,ADMIN_TOKEN:admin,MAX_MAINTENANCE_REQUESTS_PER_DAY:'100'};
const hash=(bytes:Buffer|ArrayBuffer)=>createHash('sha256').update(Buffer.from(bytes)).digest('hex');
function bucket(objects:Map<string,ArrayBuffer>,ops:Record<string,number>):ObjectBucket{return {
 async head(key){ops.head++;const b=objects.get(key);return b?{size:b.byteLength,checksums:{sha256:await crypto.subtle.digest('SHA-256',b)}}:null;},
 async get(key){ops.get++;const b=objects.get(key);return b?{size:b.byteLength,checksums:{sha256:await crypto.subtle.digest('SHA-256',b)},body:new Response(b).body!}:null;},
 async put(key,value,options){ops.put++;const b=value instanceof ArrayBuffer?value:await new Response(value).arrayBuffer();expect(hash(b)).toBe(options.sha256);objects.set(key,b);},
 async delete(key){ops.delete++;objects.delete(key);}
};}
const request=(path:string,body?:unknown)=>new Request('https://fixture.workers.dev'+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${path.startsWith('/api/maintenance/')?admin:token}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('a complete recovery point restores genuine originals into an empty archive and supports a browser-local assessment',async({page},info)=>{
 test.skip(process.env.CATLAS_BACKUP_BROWSER!=='1','Requires disposable local PostgreSQL recovery fixture.');
 test.setTimeout(180_000);page.setDefaultTimeout(30_000);const drillStart=Date.now();
 const schemas=[`backup_source_${info.project.name}`,`backup_target_${info.project.name}`];
 const schemaSql=await fs.readFile('services/exposure-archive/schema.sql','utf8');
 for(const schema of schemas)await sql(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema}; ${schemaSql}`);
 const database=(schema:string)=>createPostgresDatabase(async(text,params)=>JSON.parse(await sql(`SET search_path TO ${schema}; SELECT coalesce(json_agg(row_to_json(r)),'[]'::json) FROM (${text.replace(/\$(\d+)/g,(_,n)=>literal(params[Number(n)-1]))}) r`)));
 const detailBytes=await fs.readFile('frontend/public/evidence/ridgecrest-detail.geojson'),gridBytes=gunzipSync(await fs.readFile('frontend/public/evidence/shaking/ridgecrest-grid.xml.gz'));
 const detail=JSON.parse(detailBytes.toString());
 const objects=new Map<string,ArrayBuffer>(),operations={head:0,get:0,put:0,delete:0};let providerCalls=0,sourceGone=false;
 const handler=createArchiveHandler({database:database(schemas[0]),bucket:bucket(objects,operations),rateLimit:async()=>true,providerFetch:async input=>{providerCalls++;if(sourceGone)throw Error('Source unavailable during recovery');return new Response(new Uint8Array(String(input).includes('grid.xml')?gridBytes:detailBytes));}});
 const call=async(h:ReturnType<typeof createArchiveHandler>,path:string,body?:unknown)=>{const response=await h(request(path,body),env);const value=await response.json() as any;expect(response.status,JSON.stringify(value)).toBeLessThan(300);return value;};
 const capture=await call(handler,'/api/captures',{eventId:detail.id});sourceGone=true;const captureCalls=providerCalls;
 const started=await call(handler,'/api/maintenance/backups/start',{});let point=started;
 for(let n=0;point.state==='building'&&n<16;n++)point=await call(handler,'/api/maintenance/backups/advance',{id:point.id});
 expect(point.state).toBe('complete');expect(providerCalls).toBe(captureCalls);
 // Age only fixture metadata; invoke the real maintenance seam to remove live originals.
 await sql(`SET search_path TO ${schemas[0]}; UPDATE catlas_proof_captures SET captured_at=clock_timestamp()-interval '91 days'; UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days';`);
 const plan=await call(handler,'/api/maintenance/cleanup/preview',{});expect(plan.artifacts).toHaveLength(2);
 let cleanup=await call(handler,'/api/maintenance/cleanup/confirm',{planId:plan.planId,confirmation:plan.confirmation});
 for(let n=0;cleanup.state!=='completed'&&n<16;n++)cleanup=await call(handler,'/api/maintenance/cleanup/confirm',{planId:plan.planId,confirmation:plan.confirmation});
 expect(cleanup.state).toBe('completed');expect((await handler(request(`/api/captures/${detail.id}`),env)).status).toBe(410);
 // A fresh bucket receives only durable recovery objects; the source database is absent.
 const targetObjects=new Map([...objects].filter(([key])=>key.startsWith('backups/'))),targetOperations={head:0,get:0,put:0,delete:0};
 const target=createArchiveHandler({database:database(schemas[1]),bucket:bucket(targetObjects,targetOperations),rateLimit:async()=>true,providerFetch:async()=>{throw Error('Restore must not acquire public source data');}});
 const restoreStart=Date.now();let restore=await call(target,'/api/maintenance/backups/restore/start',{pointId:point.id,confirmation:'RESTORE_EMPTY_ARCHIVE'});
 for(let n=0;restore.state==='restoring'&&n<16;n++)restore=await call(target,'/api/maintenance/backups/restore/advance',{id:restore.id});
 expect(restore.state).toBe('complete');const restoreMs=Date.now()-restoreStart;
 const {cache:_cache,timings:_timings,...manifest}=capture;const {cache:_targetCache,timings:_targetTimings,...restoredManifest}=await call(target,`/api/captures/${detail.id}`);expect(restoredManifest).toEqual(manifest);
 for(const [name,bytes]of [['detail',detailBytes],['grid',gridBytes]] as const){const response=await target(request(capture.artifacts[name].path),env);expect(response.status).toBe(200);expect(hash(await response.arrayBuffer())).toBe(hash(bytes));}
 await page.route('**/api/exposure/**',async route=>{
  const r=route.request();
  if(new URL(r.url()).pathname.endsWith('/catalog'))return route.fulfill({json:{events:[{...capture.event,magnitude:detail.properties.mag,longitude:detail.geometry.coordinates[0],latitude:detail.geometry.coordinates[1],significance:detail.properties.sig??1646}],checkedAt:capture.capturedAt,range:{start:'2019-07-01T00:00:00.000Z',end:'2019-07-07T23:59:59.999Z'},offset:0,limit:50,hasMore:false,completeness:'complete',rejected:0}});
  const response=await archiveBridge(new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.method()==='POST'?{body:r.postData()!}:{})}),{ARCHIVE_API_ORIGIN:'https://fixture.workers.dev',ARCHIVE_PROOF_TOKEN:token},async(input,init)=>target(new Request(String(input),init),env));
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto('/exposure.html');await page.getByRole('button',{name:'Portfolios',exact:true}).click();await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();await page.getByRole('button',{name:/Ridgecrest Earthquake Sequence/}).click();
 await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();await expect(page.getByTestId('exposure-count')).toHaveText('11');await expect(page.getByTestId('exposure-unknown')).toHaveText('2');await page.getByRole('button',{name:'Save investigation',exact:true}).click();
 const download=async()=>{await openLocations(page);const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download self-contained case',exact:true}).click();return JSON.parse(gunzipSync(await fs.readFile((await(await pending).path())!)).toString());};
 const original=await download();expect(original.rawEventJson).toBe(detailBytes.toString());expect(hash(Buffer.from(original.rawXml))).toBe(hash(gridBytes));expect(original.record.summary.knownValueByCurrency).toEqual({USD:128000000});
 await page.reload();await page.getByRole('button',{name:'Saved',exact:true}).click();await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();expect(await download()).toEqual(original);
 // Measure real deduplication and rotation calls across 31 points. Only retention age is simulated.
 const beforeHistory={...operations};const points=[point];
 for(let day=1;day<=30;day++){let next=await call(handler,'/api/maintenance/backups/start',{});for(let batch=0;next.state==='building'&&batch<16;batch++)next=await call(handler,'/api/maintenance/backups/advance',{id:next.id});expect(next.state).toBe('complete');points.push(next);}
 const contentKeys=[...objects.keys()].filter(key=>key.startsWith('backups/content/'));expect(contentKeys).toHaveLength(2);
 await sql(`SET search_path TO ${schemas[0]}; UPDATE catlas_proof_recovery_points SET document=jsonb_set(document,'{createdAt}',to_jsonb((clock_timestamp()-interval '31 days')::text)) WHERE id='${point.id}';`);
 const rotated=await call(handler,'/api/maintenance/backups/rotate',{});expect(rotated.deleted).toBe(1);expect(objects.has(point.manifestKey)).toBe(false);for(const key of contentKeys)expect(objects.has(key)).toBe(true);
 const inventory=await call(handler,'/api/maintenance/backups/inventory');expect(inventory.points.filter((p:any)=>p.state==='complete')).toHaveLength(30);expect(providerCalls).toBe(captureCalls);
 const history={pointsCreated:31,retainedComplete:30,simulatedExpiredAgeDays:31,contentObjects:contentKeys.length,contentBytes:contentKeys.reduce((n,key)=>n+objects.get(key)!.byteLength,0),retainedRecoveryBytes:[...objects.entries()].filter(([key])=>key.startsWith('backups/')).reduce((n,[,bytes])=>n+bytes.byteLength,0),operations:Object.fromEntries(Object.entries(operations).map(([key,value])=>[key,value-beforeHistory[key as keyof typeof beforeHistory]]))};
 await fs.writeFile(`docs.local/research/cat56-restore-${info.project.name}.json`,JSON.stringify({history,drillElapsedMs:Date.now()-drillStart,snapshotAgeAtRestoreMs:restoreStart-Date.parse(point.createdAt),pointId:point.id,originalBytes:detailBytes.length+gridBytes.length,targetTotalObjectBytes:[...targetObjects.values()].reduce((n,b)=>n+b.byteLength,0),operations,targetOperations,restoreMs,sourceProviderCalls:providerCalls,point},null,2));
 for(const schema of schemas)await sql(`DROP SCHEMA ${schema} CASCADE;`);
});
