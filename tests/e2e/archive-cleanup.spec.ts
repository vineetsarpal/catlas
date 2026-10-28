/// <reference path="../../services/exposure-archive/node_modules/@cloudflare/workers-types/index.d.ts" />
import { test, expect } from '@playwright/test';
import { createArchiveHandler } from '../../services/exposure-archive/src/archive';
import { createPostgresDatabase } from '../../services/exposure-archive/src/neon';
import { type ArchiveDependencies } from '../../services/exposure-archive/src/types';
import { archiveBridge } from '../../functions/_archive';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { openLocations } from '../helpers/exposure-workspace';

const exec=promisify(execFile);
// Explicitly opt in to this one disposable local database; never use DATABASE_URL.
const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55446','-U','catlas_test','-d','catlas_cat55_browser'];
const sql=async(query:string)=>(await exec('psql',[...args,'-c',query])).stdout;
const literal=(value:unknown)=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
class FixtureLengthStream extends TransformStream<Uint8Array,Uint8Array>{constructor(expected:number){let bytes=0;super({transform(chunk,controller){bytes+=chunk.byteLength;controller.enqueue(chunk);},flush(){if(bytes!==expected)throw Error('Length mismatch');}});}}
Object.assign(globalThis,{FixedLengthStream:FixtureLengthStream});

test('private confirmed cleanup expires public originals while a saved local case reopens exact',async({page},info)=>{
 test.skip(process.env.CATLAS_CLEANUP_BROWSER!=='1','Requires isolated local PostgreSQL cleanup fixture.');
 // One database per project inside this isolated disposable database avoids parallel mutation.
 const schema=`browser_${info.project.name}`;
 await sql(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`);
 const source=await fs.readFile('services/exposure-archive/schema.sql','utf8');
 await sql(`SET search_path TO ${schema}; ${source}`);
 const database=createPostgresDatabase(async(text,params)=>{
  const bound=text.replace(/\$(\d+)/g,(_match,index:string)=>literal(params[Number(index)-1]));
  return JSON.parse(await sql(`SET search_path TO ${schema}; SELECT coalesce(json_agg(row_to_json(result)),'[]'::json) FROM (${bound}) result`));
 });
 const objects=new Map<string,{bytes:ArrayBuffer;hash:ArrayBuffer}>();let sourceGone=false;
 const grid='<shakemap_grid event_id="cat55-local" shakemap_version="1" process_timestamp="2026-10-24T12:00:00Z"><event event_id="cat55-local"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>-124 40 6\n-110 40 6\n-124 30 6\n-110 30 6</grid_data></shakemap_grid>';
 const detail={id:'cat55-local',properties:{mag:6.2,place:'Synthetic cleanup earthquake',time:1562383193000,updated:1792843200000,sig:900,ids:',cat55-local,',products:{shakemap:[{id:'cat55-product',source:'us',code:'cat55-local',status:'UPDATE',updateTime:1792843200000,contents:{'download/grid.xml':{url:'https://earthquake.usgs.gov/product/shakemap/cat55-local/us/1/download/grid.xml'}}}]}},geometry:{coordinates:[-117.5,35.5,8]}};
 const deps:ArchiveDependencies={database,rateLimit:async()=>true,providerFetch:async input=>{
  const url=new URL(String(input));
  if(sourceGone&&url.searchParams.has('eventid'))return new Response('not available',{status:503});
  return url.pathname.endsWith('grid.xml')?new Response(grid):Response.json(url.searchParams.has('eventid')?detail:{type:'FeatureCollection',features:[detail]});
 },bucket:{async head(key){const item=objects.get(key);return item?{size:item.bytes.byteLength,checksums:{sha256:item.hash}}:null;},async put(key,value){const bytes=value instanceof ArrayBuffer?value:await new Response(value).arrayBuffer();objects.set(key,{bytes,hash:await crypto.subtle.digest('SHA-256',bytes)});},async get(key){const item=objects.get(key);return item?{size:item.bytes.byteLength,checksums:{sha256:item.hash},body:new Response(item.bytes).body!}:null;},async delete(key:string){objects.delete(key);}}};
 const token='cat55-fixture-public-token-32-characters',admin='cat55-fixture-private-token-32-characters';
 const handler=createArchiveHandler(deps),env={PROOF_TOKEN:token,ADMIN_TOKEN:admin};
 await page.route('**/api/exposure/**',async route=>{
  const request=route.request();
  const response=await archiveBridge(new Request(request.url(),{method:request.method(),headers:request.headers(),...(request.method()==='POST'?{body:request.postData()!}:{})}),{ARCHIVE_API_ORIGIN:'https://fixture.workers.dev',ARCHIVE_PROOF_TOKEN:token},async(input,init)=>handler(new Request(String(input),init),env));
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto('/exposure.html');await page.getByRole('button',{name:'Portfolios',exact:true}).click();await page.getByRole('button',{name:'Use demo portfolio',exact:true}).click();await page.getByRole('button',{name:'Exposure',exact:true}).click();await page.getByRole('button',{name:/Synthetic cleanup earthquake/}).click();await expect(page.getByRole('button',{name:'Assess portfolio',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Assess portfolio',exact:true}).click();await page.getByRole('button',{name:'Save investigation',exact:true}).click();
 const download=async()=>{await openLocations(page);const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download self-contained case',exact:true}).click();return JSON.parse(gunzipSync(await fs.readFile((await(await pending).path())!)).toString());};
 const original=await download();
 // External fixture ages public captures; all assertions still use HTTP/browser seams.
 await sql(`SET search_path TO ${schema}; UPDATE catlas_proof_captures SET captured_at=clock_timestamp()-interval '91 days'; UPDATE catlas_proof_capture_versions SET captured_at=clock_timestamp()-interval '91 days';`);
 const server=createServer(async(request,response)=>{
  try{
   const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
   const headers=new Headers();for(const [key,value]of Object.entries(request.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
   const result=await handler(new Request(`https://fixture.workers.dev${request.url}`,{method:request.method,headers,...(request.method==='GET'?{}:{body:Buffer.concat(chunks).toString()})}),env);
   response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));
  }catch{response.writeHead(500);response.end();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing fixture address');
  const directory=await fs.mkdtemp('/private/tmp/catlas-cat55-browser-cli-');
  const cliEnv={PATH:process.env.PATH,ADMIN_TOKEN:admin,ARCHIVE_BASE_URL:`http://127.0.0.1:${address.port}`};
  const run=async(args:string[])=>exec(process.execPath,['services/exposure-archive/scripts/cleanup.mjs',...args,'--allow-local'],{env:cliEnv});
  const preview=await run(['preview','--output',`${directory}/plan.json`]);expect(preview.stdout).toContain('No deletion requested');
  const plan=JSON.parse(await fs.readFile(`${directory}/plan.json`,'utf8')).plan;expect(plan.artifacts).toHaveLength(2);
  const confirmed=await run(['confirm','--plan',`${directory}/plan.json`,'--confirm',plan.confirmation,'--output',`${directory}/receipt.json`]);
  expect(confirmed.stdout).not.toContain(admin);expect(confirmed.stderr).not.toContain(admin);
  expect(JSON.parse(await fs.readFile(`${directory}/receipt.json`,'utf8')).result.state).toBe('completed');
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 const expired=await handler(new Request('https://fixture.workers.dev/api/captures/cat55-local',{headers:{authorization:`Bearer ${token}`}}),env);expect(expired.status).toBe(410);expect(await expired.json()).toMatchObject({error:{code:'artifact_expired'}});
 sourceGone=true;
 await page.getByRole('button',{name:'Events',exact:true}).click();await page.getByRole('button',{name:/Synthetic cleanup earthquake/}).click();
 const inspector=page.getByRole('complementary',{name:'Earthquake evidence inspector'});
 await expect(inspector).toContainText('removed by private archive cleanup');await expect(inspector).toContainText('Public earthquake source unavailable');
 await page.getByRole('button',{name:'Saved',exact:true}).click();await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();expect(await download()).toEqual(original);
 await page.reload();await page.getByRole('button',{name:'Saved',exact:true}).click();await page.getByRole('button',{name:'Open saved version 1',exact:true}).click();expect(await download()).toEqual(original);
 await sql(`DROP SCHEMA ${schema} CASCADE;`);
});
