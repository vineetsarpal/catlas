import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { geoInterpolate } from 'd3-geo';
import type { FeatureCollection } from 'geojson';
import type { EventEvidence, Treaty } from '../domain/types';
import { triggerPolygon } from '../domain/assessment';
import { ridgecrest } from '../data/fixtures';
import { outerEvent } from '../data/outer-event';
import { contextLocations } from '../data/locations';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map-context.css';
maplibregl.setWorkerUrl(workerUrl);

export type WorkbenchMapProps = {
 event: EventEvidence | null; contract: Pick<Treaty,'areas'>; selectedArea: string;
 onSelectArea: (id: string) => void;
 onSelectEvent?: (event: EventEvidence) => void;
 onClearEvent?: () => void;
};
const empty: FeatureCollection = {type:'FeatureCollection', features:[]};
export function WorkbenchMap({event,contract,selectedArea,onSelectArea,onSelectEvent,onClearEvent}: WorkbenchMapProps) {
 const container=useRef<HTMLDivElement>(null), map=useRef<maplibregl.Map|null>(null);
 const [error,setError]=useState(''), [ready,setReady]=useState(false);
 const [view,setView]=useState<'world'|'regional'>(event?'regional':'world');
 const [projection,setProjection]=useState<'mercator'|'globe'>('mercator');
 const [layers,setLayers]=useState({events:true,locations:true,zones:true,references:true});
 const [locationId,setLocationId]=useState('');
 const location=contextLocations.find(l=>l.id===locationId);
 const viewRef=useRef(view);viewRef.current=view;
 const worldCamera=()=>({center:[0,15] as [number,number],zoom:Math.min(0.8,Math.log2(Math.max(1,Math.min(container.current?.clientWidth??400,container.current?.clientHeight??400))/512)-0.1)});
 const callbacks=useRef({onSelectArea,onSelectEvent});callbacks.current={onSelectArea,onSelectEvent};
 useEffect(()=>{
  if(!container.current)return;
  try {
   const m=new maplibregl.Map({container:container.current,...(event?{center:[-117.7,35.65] as [number,number],zoom:7.2}:worldCamera()),style:{version:8,sources:{land:{type:'geojson',data:`${import.meta.env.BASE_URL}map/land.geojson`}},layers:[{id:'ocean',type:'background',paint:{'background-color':'#111f2c'}},{id:'land',type:'fill',source:'land',paint:{'fill-color':'#1c303d','fill-outline-color':'#47606a'}}]},attributionControl:false});
   map.current=m;const observer=new ResizeObserver(()=>{m.resize();if(viewRef.current==='world')m.jumpTo(worldCamera());});observer.observe(container.current);
   m.addControl(new maplibregl.NavigationControl(),'top-right');
   m.on('moveend',()=>{if(container.current)container.current.dataset.cameraZoom=String(m.getZoom());});
   m.on('error',()=>setError('Map unavailable; all calculation and explanation controls remain available.'));
   m.on('load',()=>{
    m.addSource('zones',{type:'geojson',data:empty});m.addSource('connectors',{type:'geojson',data:empty});
    m.addLayer({id:'zone-fill',type:'fill',source:'zones',paint:{'fill-color':'#31b5b0','fill-opacity':0.045}});
    m.addLayer({id:'zone-line',type:'line',source:'zones',paint:{'line-color':['match',['get','areaId'],'mojave','#59d6bf','#bcb6ff'],'line-width':['case',['==',['get','radius'],25],2.5,1.7],'line-dasharray':[3,2]}});
    m.addLayer({id:'reference-connectors',type:'line',source:'connectors',paint:{'line-color':'#d7c090','line-width':1.5,'line-dasharray':[1,2]}});
    setReady(true);
   });
   return()=>{observer.disconnect();m.remove();map.current=null};
  } catch {setError('Map unavailable; all calculation and explanation controls remain available.');}
 // A stable map preserves camera and presentation state as evidence changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{
  const m=map.current;if(!m||!ready)return;
  (m.getSource('zones') as maplibregl.GeoJSONSource).setData({type:'FeatureCollection',features:contract.areas.flatMap(a=>[100,25].map(radius=>({type:'Feature',properties:{areaId:a.id,radius},geometry:triggerPolygon(a,radius)})))});
  (m.getSource('connectors') as maplibregl.GeoJSONSource).setData({type:'FeatureCollection',features:event?contract.areas.map(a=>{const interpolate=geoInterpolate([a.longitude,a.latitude],[event.longitude,event.latitude]);return {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:Array.from({length:33},(_,i)=>interpolate(i/32))}}}):[]});
  m.once('idle',()=>{if(container.current){container.current.dataset.zoneFeatures=String(new Set(m.queryRenderedFeatures({layers:['zone-line']}).map(f=>`${f.properties.areaId}:${f.properties.radius}`)).size);container.current.dataset.landRendered=String(m.queryRenderedFeatures({layers:['land']}).length>0);}});
 },[ready,contract,event]);
 useEffect(()=>{
  const m=map.current;if(!m||!ready)return;const markers:maplibregl.Marker[]=[];
  const marker=(lng:number,lat:number,text:string,label:string,className:string,click?:()=>void)=>{const el=document.createElement(click?'button':'div');el.className=className;el.textContent=text;el.setAttribute('aria-label',label);if(click)el.onclick=click;markers.push(new maplibregl.Marker({element:el}).setLngLat([lng,lat]).addTo(m));};
  if(layers.references)for(const a of contract.areas)marker(a.longitude,a.latitude,`◆ ${a.name}`,`${a.name} fixed reference`,'reference-marker',()=>callbacks.current.onSelectArea(a.id));
  if(layers.events){if(view==='world')marker(-117.85,35.8,'✦ 2','Explore California earthquake cluster','epicentre-marker discovery-marker event-cluster',()=>focus('regional'));else {for(const e of [outerEvent,ridgecrest])marker(e.longitude,e.latitude,'✦',`Select ${e.id==='SIM-OUTER-01'?'synthetic outer event':'Ridgecrest historical event'}`,'epicentre-marker discovery-marker',()=>callbacks.current.onSelectEvent?.(e));if(event&&event.id!==ridgecrest.id&&event.id!==outerEvent.id)marker(event.longitude,event.latitude,'✦','Selected earthquake epicentre','epicentre-marker');}}
  if(layers.locations)for(const l of contextLocations)marker(l.longitude,l.latitude,'●',`Synthetic location ${l.name}`,'context-location-marker',()=>setLocationId(l.id));
  return()=>markers.forEach(marker=>marker.remove());
 },[ready,contract,event,layers,view]);
 useEffect(()=>{const m=map.current;if(!m||!ready)return;for(const id of ['zone-fill','zone-line'])m.setLayoutProperty(id,'visibility',layers.zones?'visible':'none');m.setLayoutProperty('reference-connectors','visibility',layers.references?'visible':'none');},[ready,layers]);
 useEffect(()=>{const m=map.current;if(!m||!ready)return;m.setProjection({type:projection});},[ready,projection]);
 const focus=(mode:'world'|'regional')=>{setView(mode);map.current?.easeTo(mode==='world'?{...worldCamera(),duration:400}:{center:[-117.7,35.65],zoom:7.2,duration:400});};
 const selectEvent=(next:EventEvidence)=>{onSelectEvent?.(next);focus('regional');};
 useEffect(()=>{if(event&&ready){setView('regional');map.current?.easeTo({center:[-117.7,35.65],zoom:7.2,duration:400});}},[event,ready]);
 useEffect(()=>{const a=contract.areas.find(a=>a.id===selectedArea);if(a&&map.current&&view==='regional')map.current.easeTo({center:[a.longitude,a.latitude],zoom:7.2,duration:400});},[selectedArea,contract]);
 return <section className="map-explorer" aria-label="Map discovery and context">
  <div className="map-discovery"><span>{event?'Explore another event':'Choose an event to begin an assessment'}</span><button onClick={()=>selectEvent(ridgecrest)}>Ridgecrest historical replay · M7.1</button><button onClick={()=>selectEvent(outerEvent)}>Synthetic outer event · M7.1</button>{event&&onClearEvent&&<button onClick={()=>{onClearEvent();focus('world');}}>Clear event selection</button>}</div>
  <div className="map-tools"><div role="group" aria-label="Map extent"><button aria-pressed={view==='world'} onClick={()=>focus('world')}>World</button><button aria-pressed={view==='regional'} onClick={()=>focus('regional')}>Regional</button></div><div role="group" aria-label="Map projection"><button aria-pressed={projection==='mercator'} onClick={()=>setProjection('mercator')}>Map</button><button aria-pressed={projection==='globe'} onClick={()=>setProjection('globe')}>Globe</button></div></div>
  <fieldset className="map-layers"><legend>Contextual layers</legend>{(Object.keys(layers) as (keyof typeof layers)[]).map(key=><label key={key}><input type="checkbox" checked={layers[key]} onChange={e=>setLayers({...layers,[key]:e.target.checked})}/>{{events:'Earthquake events',locations:'Synthetic locations',zones:'Treaty trigger zones',references:'References and connectors'}[key]}</label>)}</fieldset>
  <div className="map-wrap" data-testid="analytical-map" data-ready={ready}><div ref={container} className="map" aria-label="Treaty trigger zone map"/><div className="map-key"><span>✦ Earthquake events · historical / synthetic</span><span>◆ Fixed references · ● synthetic locations</span><span className="mojave-key">Mojave · 25 km inner / 100 km outer</span><span className="western-key">Western · 25 km inner / 100 km outer</span></div>{error&&<p role="status">{error}</p>}<div className="map-caption">Treaty trigger zones · fixed-reference distance bands<br/>Not damage radii or property-coverage boundaries</div></div>
  <div className="location-context"><label htmlFor="context-location">Inspect synthetic location · 18 contextual sites</label><select id="context-location" value={locationId} onChange={e=>setLocationId(e.target.value)}><option value="">Choose a contextual location</option>{contextLocations.map(l=><option key={l.id} value={l.id}>{l.id} · {l.name}</option>)}</select>{location&&<p role="status"><strong>{location.name}</strong> · {location.id}<br/>Longitude {location.longitude}, latitude {location.latitude}{location.group&&<> · {location.group} portfolio grouping</>}<br/>Synthetic context only. Site selection does not change treaty references or recovery.</p>}<p>Each area contributes once. Inner and outer bands are exclusive; overlapping scheduled areas may both contribute. Camera and layer controls do not change assessment inputs.</p></div>
 </section>;
}
export const MapExplorer = WorkbenchMap;
