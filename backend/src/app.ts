import Fastify from 'fastify';
import { WindService } from './wind';
import { VesselRelay, validBounds } from './vessels';

export function createApp(options:{wind?:WindService;relay?:VesselRelay;apiKey?:string}={}) {
  const app=Fastify({logger:false,bodyLimit:1024});
  const wind=options.wind??new WindService(), relay=options.relay??new VesselRelay(options.apiKey??'');
  const viewers=new Map<string,{at:number;count:number}>();
  app.addHook('onRequest',async(req,reply)=>{
    const host=req.headers.host??'';
    if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))return reply.code(403).send({error:'Localhost access only'});
    const origin=req.headers.origin;
    if(origin&&!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))return reply.code(403).send({error:'Origin is not allowed'});
    const now=Date.now();for(const [id,v] of viewers)if(now-v.at>60000)viewers.delete(id);
    const id=req.ip,current=viewers.get(id)??{at:now,count:0};
    if(++current.count>240||(!viewers.has(id)&&viewers.size>=1000))return reply.code(429).send({error:'Too many requests'});
    viewers.set(id,current);reply.header('Cache-Control','no-store');
  });
  app.setErrorHandler((error,req,reply)=>{const status=error instanceof Error&&'statusCode' in error&&typeof error.statusCode==='number'?error.statusCode:502;reply.code(status).send({error:status<500&&error instanceof Error?error.message:'Provider unavailable; retry shortly'});});
  app.get('/api/monitor/health',()=>({status:'ok',vesselsConfigured:Boolean(options.apiKey),storage:'bounded memory; reset on restart'}));
  app.get('/api/monitor/wind',()=>wind.discover());
  app.get<{Querystring:{runAt?:string;validAt?:string}}>('/api/monitor/wind/grid',async(req,reply)=>{
    const {runAt,validAt}=req.query;
    if(!runAt||!validAt)return reply.code(400).send({error:'runAt and validAt required'});
    const {field,fetchedAt}=await wind.get(runAt,validAt);
    const {u,v,...metadata}=field;
    reply.header('X-Wind-Metadata',JSON.stringify({...metadata,fetchedAt}));
    const data=Buffer.allocUnsafe((u.length+v.length)*4);
    u.forEach((value,i)=>data.writeFloatLE(value,i*4));v.forEach((value,i)=>data.writeFloatLE(value,(u.length+i)*4));
    return reply.type('application/octet-stream').send(data);
  });
  const session=(id:unknown)=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(id);
  app.get<{Querystring:{viewer?:string;bbox?:string}}>('/api/monitor/vessels',(req,reply)=>{
    const bounds=req.query.bbox?.split(',').map(Number);
    if(!session(req.query.viewer)||!validBounds(bounds))return reply.code(400).send({error:'viewer and bbox=west,south,east,north required'});
    return relay.snapshot(req.query.viewer!,bounds);
  });
  app.delete<{Params:{viewer:string}}>('/api/monitor/vessels/:viewer',(req,reply)=>{
    if(!session(req.params.viewer))return reply.code(400).send({error:'Invalid viewer'});
    relay.release(req.params.viewer);return {status:'released'};
  });
  app.addHook('onClose',async()=>{relay.close();});
  return app;
}
