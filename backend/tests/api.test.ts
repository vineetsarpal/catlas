import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { createApp } from '../src/app';
import { VesselRelay } from '../src/vessels';
import { WindService } from '../src/wind';

async function eventually(check:()=>boolean){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Condition did not arrive');}
const headers={host:'localhost:3001'};
test('localhost API rejects remote origins and invalid queries; missing AIS credentials are explicit',async()=>{
  const app=createApp();
  try{
    assert.equal((await app.inject({url:'/api/monitor/health',headers})).statusCode,200);
    assert.equal((await app.inject({url:'/api/monitor/health',headers:{host:'evil.example'}})).statusCode,403);
    assert.equal((await app.inject({url:'/api/monitor/health',headers:{...headers,origin:'https://evil.example'}})).statusCode,403);
    assert.equal((await app.inject({url:'/api/monitor/wind/grid?runAt=bad&validAt=bad',headers})).statusCode,400);
    assert.equal((await app.inject({url:'/api/monitor/vessels?viewer=x&bbox=0,0,999,1',headers})).statusCode,400);
    const res=await app.inject({url:'/api/monitor/vessels?viewer=x&bbox=-180,-90,180,90',headers});
    assert.equal(res.json().status,'unconfigured');assert.deepEqual(res.json().rows,[]);
  }finally{await app.close();}
});
test('one shared compressed AIS connection, bounds, stale state, trail/cache limits and expiry',async()=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1',perMessageDeflate:true});await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  let clock=Date.now(),connections=0;const subscriptions:any[]=[];
  server.on('connection',ws=>{connections++;ws.on('message',data=>subscriptions.push(JSON.parse(data.toString())));});
  const relay=new VesselRelay('test-secret',{url:`ws://127.0.0.1:${address.port}`,now:()=>clock,maxRows:2});
  const bounds:[number,number,number,number]=[-180,-80,180,80];
  const snap=()=>relay.snapshot('a',bounds);
  try{
    snap();relay.snapshot('b',bounds);await eventually(()=>subscriptions.length>0);
    assert.equal(connections,1);assert.equal(subscriptions[0].APIKey,'test-secret');
    const ws=[...server.clients][0];assert.ok(ws.extensions.includes('permessage-deflate'));
    const send=(mmsi:number,lon:number,epoch=clock)=>ws.send(JSON.stringify({MessageType:'PositionReport',MetaData:{MMSI:mmsi,ShipName:'Test vessel',time_utc:new Date(epoch).toISOString().replace('T',' ').replace('Z','000000 +0000 UTC')},Message:{PositionReport:{Latitude:10,Longitude:lon,Sog:12,Cog:90}}}));
    send(123456789,179);await eventually(()=>snap().rows.length===1);
    send(123456789,30,clock-60000);await new Promise(r=>setTimeout(r,20));assert.equal(snap().rows[0].longitude,179);
    assert.equal(relay.snapshot('c',[170,-20,-170,20]).rows.length,1);
    assert.equal(relay.snapshot('d',[-20,-20,20,20]).rows.length,0);
    for(let i=0;i<35;i++){clock+=31000;send(123456789,179-i/100);await eventually(()=>snap().rows[0].reportedAt===new Date(clock).toISOString());}
    assert.equal(snap().rows[0].trail.length,32);
    send(223456789,5);await eventually(()=>snap().rows.length===2);
    send(323456789,6);await eventually(()=>snap().rows.some(v=>v.mmsi==='323456789'));
    assert.equal(snap().rows.length,2);assert.ok(!snap().rows.some(v=>v.mmsi==='123456789'));
    assert.ok(!JSON.stringify(snap()).includes('test-secret'));
    clock+=121000;assert.equal(snap().status,'stale');
    clock+=31*60000;assert.equal(snap().rows.length,0);
    relay.release('a');relay.release('b');relay.release('c');relay.release('d');
  }finally{relay.close();for(const ws of server.clients)ws.terminate();await new Promise<void>(r=>server.close(()=>r()));}
});
test('wind requests coalesce, preserve source time and encode little-endian grids',async()=>{
  const now=new Date();now.setUTCMinutes(0,0,0);now.setUTCHours(Math.floor(now.getUTCHours()/6)*6);
  const run=now.toISOString(),stamp=run.slice(0,13).replaceAll('-','').replace('T','');let fetches=0,decodes=0;
  const fetcher:typeof fetch=async input=>{fetches++;if(String(input).endsWith('.idx'))return new Response(`1:0:d=${stamp}:UGRD:10 m above ground:\n2:2:d=${stamp}:VGRD:10 m above ground:\n3:4:d=${stamp}:TMP:surface:`);return new Response(new Uint8Array([1,2]),{status:206});};
  const wind=new WindService(fetcher,async()=>{decodes++;return {nx:360,ny:181,lo1:0,la1:90,dx:1,dy:1,u:new Float32Array(360*181).fill(1),v:new Float32Array(360*181).fill(2),decodeMs:1};});
  const [a,b]=await Promise.all([wind.get(run,run),wind.get(run,run)]);assert.equal(a,b);assert.equal(fetches,3);assert.equal(decodes,1);
  const app=createApp({wind});try{
    const response=await app.inject({url:`/api/monitor/wind/grid?${new URLSearchParams({runAt:run,validAt:run})}`,headers});
    assert.equal(response.statusCode,200);assert.equal(response.rawPayload.length,360*181*8);
    assert.equal(response.rawPayload.readFloatLE(0),1);assert.equal(response.rawPayload.readFloatLE(360*181*4),2);
    assert.equal(JSON.parse(response.headers['x-wind-metadata'] as string).runAt,run);
  }finally{await app.close();}
});
test('provider failures do not poison wind cache or expose provider details',async()=>{
  const wind=new WindService(async()=>{throw Error('private provider failure');});
  const app=createApp({wind});try{
    const response=await app.inject({url:'/api/monitor/wind',headers});
    assert.equal(response.statusCode,502);assert.ok(!response.body.includes('private'));
  }finally{await app.close();}
});
test('AIS disconnects retry with backoff and viewers release their shared connection',async()=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1',perMessageDeflate:true});await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');let clock=Date.now(),connections=0;
  server.on('connection',()=>{connections++;});
  const relay=new VesselRelay('test-key',{url:`ws://127.0.0.1:${address.port}`,now:()=>clock});
  const snap=()=>relay.snapshot('viewer',[-10,-10,10,10]);
  try{
    snap();await eventually(()=>connections===1);[...server.clients][0].close();
    await eventually(()=>snap().status==='error');assert.equal(connections,1);
    clock+=6000;snap();await eventually(()=>connections===2);
    relay.release('viewer');await eventually(()=>server.clients.size===0);
  }finally{relay.close();for(const ws of server.clients)ws.terminate();await new Promise<void>(r=>server.close(()=>r()));}
});
