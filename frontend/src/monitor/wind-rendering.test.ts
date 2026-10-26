import { afterEach, expect, it, vi } from 'vitest';
import type { Map as AtlasMap } from 'maplibre-gl';
import { createWindFlow } from './wind-rendering';
import type { WindField } from './wind';

const field:WindField={nx:360,ny:181,lo1:0,la1:90,dx:1,dy:1,runAt:'2026-10-19T18:00:00.000Z',validAt:'2026-10-19T18:00:00.000Z',sourceURL:'fixture',decodeMs:1,u:new Float32Array(360*181).fill(5),v:new Float32Array(360*181).fill(2)};
function renderer(paused=false){
  const context={setTransform:vi.fn(),clearRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn()};
  const canvas={style:{},dataset:{} as Record<string,string>,setAttribute:vi.fn(),getContext:()=>context,remove:vi.fn(),width:0,height:0};
  let nextFrame:FrameRequestCallback|undefined;
  vi.stubGlobal('document',{createElement:()=>canvas,hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.stubGlobal('devicePixelRatio',1);
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{nextFrame=cb;return 1;});
  vi.stubGlobal('cancelAnimationFrame',()=>{nextFrame=undefined;});
  const events=new Map<string,()=>void>();
  const map={getCanvasContainer:()=>({append:vi.fn()}),getCanvas:()=>({clientWidth:1200,clientHeight:800}),getPaintProperty:()=>'',getProjection:()=>({type:'mercator'}),getZoom:()=>3,getCenter:()=>({lat:0,lng:0}),
    unproject:([x,y]:number[])=>({lng:x/1200*360-180,lat:60-y/800*120}),
    project:vi.fn((pos:number[]|{lng:number;lat:number})=>{const [lng,lat]=Array.isArray(pos)?pos:[pos.lng,pos.lat];return {x:(lng+180)/360*1200,y:(60-lat)/120*800};}),
    on:(event:string,cb:()=>void)=>events.set(event,cb),off:vi.fn(),getLayer:()=>null,getSource:()=>null};
  const ready=vi.fn();
  const dispose=createWindFlow(map as unknown as AtlasMap,field,{paused,shading:false,onReady:ready});
  return {context,canvas,map,ready,dispose,events,paint:()=>nextFrame?.(performance.now()+100)};
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('bounds canvas draw calls per animated frame independently of path count',async()=>{
  vi.useFakeTimers();const flow=renderer();await vi.runAllTimersAsync();
  expect(Number(flow.canvas.dataset.paths)).toBeGreaterThan(1000);
  expect(flow.map.project.mock.calls.length).toBeLessThan(90000);
  flow.context.stroke.mockClear();flow.paint();
  expect(flow.context.stroke.mock.calls.length).toBeLessThanOrEqual(7);
  flow.dispose();
});
it('yields path preparation and cancels unfinished work when disposed',async()=>{
  vi.useFakeTimers();const flow=renderer();
  expect(flow.ready).not.toHaveBeenCalled();
  flow.dispose();await vi.runAllTimersAsync();expect(flow.ready).not.toHaveBeenCalled();
});
it('stops pending preparation when the camera starts moving and rebuilds after it settles',async()=>{
  vi.useFakeTimers();const flow=renderer(true);flow.events.get('movestart')?.();
  await vi.runAllTimersAsync();expect(flow.ready).not.toHaveBeenCalled();
  flow.events.get('moveend')?.();await vi.runAllTimersAsync();
  expect(flow.ready).toHaveBeenCalledOnce();expect(flow.canvas.dataset.paused).toBe('true');
  flow.dispose();
});

it('resumes motion after a drag before the whole viewport has been rebuilt',async()=>{
  vi.useFakeTimers();const flow=renderer();await vi.runAllTimersAsync();
  flow.events.get('movestart')?.();flow.events.get('moveend')?.();
  flow.context.stroke.mockClear();flow.ready.mockClear();
  await vi.advanceTimersByTimeAsync(2);
  expect(flow.context.stroke).toHaveBeenCalled();
  expect(flow.ready).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();expect(flow.ready).toHaveBeenCalledOnce();
  flow.dispose();
});
