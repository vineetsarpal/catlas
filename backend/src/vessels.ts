import WebSocket from 'ws';
import type { Vessel, VesselSnapshot } from '@catlas/shared/vessels';
export type Bounds=[number,number,number,number];
export function validBounds(b:unknown):b is Bounds{return Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]>=-180&&b[0]<=180&&b[2]>=-180&&b[2]<=180&&b[1]>=-90&&b[3]<=90&&b[1]<b[3];}
export function inside(v:Pick<Vessel,'longitude'|'latitude'>,b:Bounds){return v.latitude>=b[1]&&v.latitude<=b[3]&&(b[0]<=b[2]?v.longitude>=b[0]&&v.longitude<=b[2]:v.longitude>=b[0]||v.longitude<=b[2]);}
const TTL=30*60000;
export class VesselRelay {
  private rows=new Map<string,Vessel>();
  private staticRows=new Map<string,{name:string;imo:string;at:number}>();
  private clients=new Map<string,{bounds:Bounds;at:number}>();
  private socket:WebSocket|null=null;
  private retryAt=0;
  private attempts=0;
  private subscription='';
  private lastSent=0;
  private timer:ReturnType<typeof setInterval>;
  private lastMessageAt:number|null=null;
  private startedAt:string|null=null;
  private status:VesselSnapshot['status']='idle';
  private message='No active viewers';
  constructor(private key:string,private options:{url?:string;now?:()=>number;maxRows?:number}={}) {
    this.timer=setInterval(()=>this.tick(),1000);this.timer.unref();
  }
  private now(){return this.options.now?.()??Date.now();}
  close(){clearInterval(this.timer);this.clients.clear();const ws=this.socket;this.socket=null;ws?.terminate();}
  release(id:string){this.clients.delete(id);this.tick();}
  snapshot(id:string,bounds:Bounds):VesselSnapshot {
    if(!this.clients.has(id)&&this.clients.size>=20)throw Object.assign(Error('Too many vessel viewers'),{statusCode:429});
    this.clients.set(id,{bounds,at:this.now()});this.tick();
    const rows=[...this.rows.values()].filter(v=>inside(v,bounds)).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
    return {status:this.key?this.status:'unconfigured',message:this.key?this.message:'Vessel feed is not configured. Add provider credentials to the local backend.',checkedAt:new Date(this.now()).toISOString(),lastMessageAt:this.lastMessageAt?new Date(this.lastMessageAt).toISOString():null,startedAt:this.startedAt,rows:rows.slice(0,1000),truncated:rows.length>1000};
  }
  private tick(){
    const now=this.now();
    for(const [id,c] of this.clients)if(now-c.at>45000)this.clients.delete(id);
    for(const [id,v] of this.rows)if(now-Date.parse(v.receivedAt)>TTL)this.rows.delete(id);
    for(const [id,v] of this.staticRows)if(now-v.at>TTL)this.staticRows.delete(id);
    if(!this.clients.size){const ws=this.socket;this.socket=null;ws?.terminate();this.status='idle';this.message='No active viewers';return;}
    if(!this.key)return;
    if(!this.socket&&now>=this.retryAt)this.connect();
    if(this.socket?.readyState===WebSocket.OPEN){
      const boxes=[...this.clients.values()].flatMap(({bounds:[w,s,e,n]})=>w<=e?[[[s,w],[n,e]]]:[[[s,w],[n,180]],[[s,-180],[n,e]]]);
      const subscription=JSON.stringify({APIKey:this.key,BoundingBoxes:boxes,FilterMessageTypes:['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','ShipStaticData','StaticDataReport']});
      if(subscription!==this.subscription&&now-this.lastSent>=1100){this.socket.send(subscription);this.subscription=subscription;this.lastSent=now;}
      const last=this.lastMessageAt??Date.parse(this.startedAt!);
      if(now-last>120000){this.status='stale';this.message='No recent reports; this region may be quiet or coverage unavailable';}
      if(now-last>600000)this.socket.terminate();
    }
  }
  private connect(){
    this.status='connecting';this.message='Connecting to AISStream';this.subscription='';this.lastSent=0;
    const ws=new WebSocket(this.options.url??'wss://stream.aisstream.io/v0/stream',{perMessageDeflate:true,maxPayload:256*1024,handshakeTimeout:10000});this.socket=ws;
    ws.on('open',()=>{if(this.socket!==ws)return;this.startedAt=new Date(this.now()).toISOString();this.lastMessageAt=null;this.tick();});
    ws.on('message',data=>{if(this.socket!==ws)return;try{this.ingest(JSON.parse(data.toString()));}catch{/* Ignore malformed provider frames. */}});
    ws.on('error',()=>{/* close performs bounded retry; never expose the key or provider frame. */});
    ws.on('close',()=>{if(this.socket!==ws)return;this.socket=null;this.status='error';this.message='AISStream disconnected; retrying';this.retryAt=this.now()+Math.min(300000,5000*2**Math.min(this.attempts++,6));});
  }
  private ingest(envelope:any){
    if(envelope.error||envelope.Error){this.status='error';this.message='AISStream rejected the subscription; check backend credentials and provider limits';this.retryAt=this.now()+300000;const ws=this.socket;this.socket=null;ws?.terminate();return;}
    const kind=envelope.MessageType,report=envelope.Message?.[kind],meta=envelope.MetaData??envelope.Metadata;
    if(!['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','ShipStaticData','StaticDataReport'].includes(kind)||!report||!meta)return;
    const mmsi=String(meta.MMSI??report.UserID??'');if(!/^\d{9}$/.test(mmsi))return;
    const rawTime=String(meta.time_utc??'').replace(/ \+0000 UTC$/,'Z').replace(/ UTC$/,'Z').replace(' ','T').replace(/(\.\d{3})\d+(?=Z$)/,'$1');
    const epoch=Date.parse(rawTime),now=this.now();
    if(!Number.isFinite(epoch)||epoch>now+5*60000||now-epoch>TTL)return;
    const name=String(report.Name??report.ReportA?.Name??meta.ShipName??'').trim().slice(0,120);
    const rawIMO=String(report.ImoNumber??report.IMO??''),imo=/^\d{7}$/.test(rawIMO)?rawIMO:'';
    if(kind==='ShipStaticData'||kind==='StaticDataReport'){
      const old=this.staticRows.get(mmsi);this.staticRows.delete(mmsi);this.staticRows.set(mmsi,{name:name||old?.name||mmsi,imo:imo||old?.imo||'',at:now});
      while(this.staticRows.size>(this.options.maxRows??5000))this.staticRows.delete(this.staticRows.keys().next().value!);
      const v=this.rows.get(mmsi);if(v){v.name=name||v.name;v.imo=imo||v.imo;}return;
    }
    const latitude=report.Latitude,longitude=report.Longitude;
    if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude+longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return;
    const old=this.rows.get(mmsi);if(old&&epoch<=Date.parse(old.reportedAt))return;
    const details=this.staticRows.get(mmsi),reportedAt=new Date(epoch).toISOString();
    const trail=old?.trail.filter(p=>now-Date.parse(p[2])<=TTL)??[];
    if(!trail.length||epoch-Date.parse(trail.at(-1)![2])>=30000)trail.push([longitude,latitude,reportedAt]);
    const finite=(v:unknown,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<max?v:null;
    this.rows.delete(mmsi);this.rows.set(mmsi,{mmsi,imo:imo||details?.imo||old?.imo||'',name:name||details?.name||old?.name||mmsi,longitude,latitude,speed:finite(report.Sog,102.3),course:finite(report.Cog,360),reportedAt,receivedAt:new Date(now).toISOString(),trail:trail.slice(-32)});
    while(this.rows.size>(this.options.maxRows??5000))this.rows.delete(this.rows.keys().next().value!);
    this.lastMessageAt=now;this.status='live';this.message='Latest available AIS reports; coverage and latency vary';this.attempts=0;
  }
}
