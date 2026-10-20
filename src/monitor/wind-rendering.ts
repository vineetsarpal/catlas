import type { Map as AtlasMap } from 'maplibre-gl';
import { sampleWind, type WindField } from './wind';

type Path={points:[number,number][];speed:number;phase:number};
const ramp=(knots:number)=>{
  const t=Math.max(0,Math.min(1,knots/60));
  const stops=[[64,125,156],[87,178,178],[153,207,173],[235,208,124],[212,135,105]];
  const i=Math.min(3,Math.floor(t*4)),f=t*4-i;
  return stops[i].map((n,j)=>Math.round(n+(stops[i+1][j]-n)*f));
};
export function windShade(field:WindField) {
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=720;
  const context=canvas.getContext('2d');if(!context)throw new Error('Wind shading is unavailable.');
  const image=context.createImageData(720,720);
  for(let y=0;y<720;y++){
    const lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/720)))*180/Math.PI;
    for(let x=0;x<720;x++){
      const wind=sampleWind(field,(x+.5)/720*360-180,lat);if(!wind)continue;
      const speed=Math.hypot(wind.u,wind.v),color=ramp(speed*1.94384),i=(y*720+x)*4;
      image.data[i]=color[0];image.data[i+1]=color[1];image.data[i+2]=color[2];image.data[i+3]=Math.round(40+Math.min(1,speed/25)*150);
    }
  }
  context.putImageData(image,0,0);return canvas;
}
// Bounded geographic integration inspired by God's Eye View's model/streamlines (MIT).
// Visual travel is accelerated; animation never changes the forecast valid time.
export function createWindFlow(map:AtlasMap,field:WindField,options:{paused:boolean;shading:boolean;onReady:(paths:number)=>void}) {
  const canvas=document.createElement('canvas');canvas.className='monitor-wind-flow';canvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'1'});
  map.getCanvasContainer().append(canvas);const context=canvas.getContext('2d');
  if(!context){canvas.remove();throw new Error('This browser cannot draw wind flow.');}
  let painted=0;
  canvas.dataset.decodeMs=String(Math.round(field.decodeMs));
  let paths:Path[]=[],frame=0,timer:ReturnType<typeof setTimeout>|undefined,disposed=false,moving=false,lastPaint=0,flowTime=0,lastTime=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const dark=()=>map.getPaintProperty('background','background-color')==='#172731';
  function front(lon:number,lat:number) {
    if(map.getProjection()?.type!=='globe')return true;
    const center=map.getCenter(),r=Math.PI/180;
    return Math.sin(center.lat*r)*Math.sin(lat*r)+Math.cos(center.lat*r)*Math.cos(lat*r)*Math.cos((lon-center.lng)*r)>.03;
  }
  function trace(lon:number,lat:number,direction:number) {
    const points:[number,number][]=[];
    for(let step=0;step<16;step++){
      const wind=sampleWind(field,lon,lat);if(!wind||Math.abs(lat)>84.5)break;
      const speed=Math.hypot(wind.u,wind.v);if(speed<.3)break;
      const mpp=40075016*Math.cos(lat*Math.PI/180)/(512*2**map.getZoom());
      const dt=direction*Math.min(6000,Math.max(1,mpp*3/speed));
      const nextLat=lat+wind.v*dt/111320,nextLon=lon+wind.u*dt/(111320*Math.max(.05,Math.cos(lat*Math.PI/180)));
      if(!front(nextLon,nextLat))break;
      const a=map.project([lon,lat]),b=map.project([nextLon,nextLat]);
      if(!Number.isFinite(b.x+b.y)||Math.hypot(b.x-a.x,b.y-a.y)>35)break;
      points.push([b.x,b.y]);lon=nextLon;lat=nextLat;
    }
    return points;
  }
  function bake(){
    if(disposed)return;
    const width=map.getCanvas().clientWidth,height=map.getCanvas().clientHeight,dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);context!.setTransform(dpr,0,0,dpr,0,0);
    paths=[];const count=width<600?360:Math.min(2400,Math.round(width*height/280)),spacing=Math.sqrt(width*height/count);
    let seed=0;
    for(let y=spacing*.5;y<height;y+=spacing)for(let x=spacing*.5;x<width;x+=spacing){
      const px=x+Math.sin(seed*2.4)*spacing*.35,py=y+Math.cos(seed*1.7)*spacing*.35;seed++;
      const pos=map.unproject([px,py]);if(!front(pos.lng,pos.lat)||Math.abs(pos.lat)>84.5)continue;
      const screen=map.project(pos);if(Math.hypot(screen.x-px,screen.y-py)>4)continue;
      const wind=sampleWind(field,pos.lng,pos.lat);if(!wind)continue;
      const backward=trace(pos.lng,pos.lat,-1).reverse(),forward=trace(pos.lng,pos.lat,1);
      const points:[number,number][]=[...backward,[px,py],...forward];
      if(points.length>5)paths.push({points,speed:Math.hypot(wind.u,wind.v),phase:(seed*.61803398875)%1});
    }
    canvas.dataset.paths=String(paths.length);canvas.dataset.validAt=field.validAt;canvas.dataset.runAt=field.runAt;
    options.onReady(paths.length);lastTime=0;moving=false;paint(performance.now());
  }
  function paint(now:number){
    frame=0;if(disposed||moving||document.hidden)return;
    const paused=options.paused||reduced.matches;
    if(!paused&&now-lastPaint<32){frame=requestAnimationFrame(paint);return;}
    const elapsed=lastTime?Math.min(.1,(now-lastTime)/1000):0;lastTime=now;lastPaint=now;if(!paused)flowTime+=elapsed;
    const width=map.getCanvas().clientWidth,height=map.getCanvas().clientHeight;context!.clearRect(0,0,width,height);
    context!.lineWidth=1.25;context!.lineCap='round';context!.lineJoin='round';
    const isDark=dark();
    for(const path of paths){
      const points=path.points,head=Math.floor((path.phase+flowTime*(.045+Math.min(path.speed,30)*.0015))%1*(points.length+7));
      context!.strokeStyle=isDark?'#bce9e0':'#286c78';
      if(paused){context!.globalAlpha=isDark?.65:.44;context!.beginPath();points.forEach(([x,y],i)=>i?context!.lineTo(x,y):context!.moveTo(x,y));context!.stroke();continue;}
      for(let tail=6;tail>=0;tail--){const i=head-tail;if(i<=0||i>=points.length)continue;context!.globalAlpha=(1-tail/7)*(isDark?.85:.7);context!.beginPath();context!.moveTo(...points[i-1]);context!.lineTo(...points[i]);context!.stroke();}
    }
    context!.globalAlpha=1;canvas.dataset.paused=String(paused);canvas.dataset.frame=String(Math.round(now));canvas.dataset.framesPainted=String(++painted);
    if(!paused)frame=requestAnimationFrame(paint);
  }
  function movingStart(){moving=true;cancelAnimationFrame(frame);context!.clearRect(0,0,canvas.width,canvas.height);}
  function schedule(){clearTimeout(timer);timer=setTimeout(bake,120);}
  function visibility(){cancelAnimationFrame(frame);if(!document.hidden){lastTime=0;paint(performance.now());}}
  function reducedChange(){cancelAnimationFrame(frame);lastTime=0;paint(performance.now());}
  map.on('movestart',movingStart);map.on('moveend',schedule);map.on('resize',schedule);document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',reducedChange);
  let shading:HTMLCanvasElement|null=null;
  const dispose=()=>{disposed=true;cancelAnimationFrame(frame);clearTimeout(timer);map.off('movestart',movingStart);map.off('moveend',schedule);map.off('resize',schedule);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',reducedChange);canvas.remove();if(map.getLayer('monitor-wind-field'))map.removeLayer('monitor-wind-field');if(map.getSource('monitor-wind-field'))map.removeSource('monitor-wind-field');shading?.remove();};
  try{
    if(options.shading){
      shading=windShade(field);map.addSource('monitor-wind-field',{type:'canvas',canvas:shading,animate:false,coordinates:[[-180,85.051129],[180,85.051129],[180,-85.051129],[-180,-85.051129]]});
      map.addLayer({id:'monitor-wind-field',type:'raster',source:'monitor-wind-field',paint:{'raster-opacity':.45,'raster-fade-duration':0}},'country-boundaries');
    }
    bake();return dispose;
  }catch(e){dispose();throw e;}
}
