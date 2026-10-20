import { backendEnabled, WIND_BACKEND_REQUIRED } from './backend';
import { addVesselIcons } from './vessel-icon';
import { useEffect, useRef, useState, type RefObject } from 'react';
import * as maplibre from 'maplibre-gl';
import { cycloneFeatures } from './feeds';
import { loadWindField, type WindField } from './wind';
import { createWindFlow } from './wind-rendering';
import type { MonitorState } from './useMonitor';
import type { MonitorItem } from './model';

export type MonitorMapProps={state:MonitorState;items:MonitorItem[]};
export function useMonitorMap(mapRef:RefObject<maplibre.Map|null>,ready:boolean,active:boolean,monitor?:MonitorMapProps) {
  const selection=useRef(monitor?.state.select);selection.current=monitor?.state.select;
  const [imageStatus,setImageStatus]=useState('');
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map)return;
    addVesselIcons(map);
    map.addSource('monitor-items',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addSource('monitor-vessel-trails',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'monitor-vessel-trails',type:'line',source:'monitor-vessel-trails',paint:{'line-color':['case',['get','inPortfolio'],'#287d69','#2674bb'],'line-width':1.5,'line-opacity':0.6}});
    map.addSource('monitor-cyclones',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'monitor-cones',type:'fill',source:'monitor-cyclones',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#a27bc3','fill-opacity':.16}});
    map.addLayer({id:'monitor-tracks',type:'line',source:'monitor-cyclones',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#7858a1','line-width':2,'line-dasharray':[3,2]}});
    map.addLayer({id:'monitor-items',type:'circle',source:'monitor-items',filter:['!=',['get','kind'],'vessel'],paint:{'circle-color':['match',['get','kind'],'earthquake','#bc7545','cyclone','#7858a1','vessel','#2674bb','#287d69'],'circle-radius':['case',['get','selected'],14,['==',['get','kind'],'earthquake'],['interpolate',['linear'],['coalesce',['get','magnitude'],0],0,4,3,6,5,9,7,12],5],'circle-stroke-color':'#fff','circle-stroke-width':2}});
    map.addLayer({id:'monitor-vessels',type:'symbol',source:'monitor-items',filter:['==',['get','kind'],'vessel'],layout:{
      'icon-image':['case',['get','inPortfolio'],['case',['get','hasCourse'],'monitor-vessel-portfolio','monitor-vessel-portfolio-unknown'],['case',['get','hasCourse'],'monitor-vessel','monitor-vessel-unknown']],
      'icon-size':['interpolate',['linear'],['zoom'],2,['case',['get','selected'],1.5,['get','inPortfolio'],1.2,0.6],7,['case',['get','selected'],1.5,['get','inPortfolio'],1.2,1.1]],
      'icon-rotate':['get','course'],'icon-rotation-alignment':'map',
      'icon-pitch-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true,
      'symbol-sort-key':['case',['get','selected'],2,['get','inPortfolio'],1,0],
    }});
    map.addLayer({id:'monitor-earthquake-labels',type:'symbol',source:'monitor-items',
      filter:['all',['==',['get','kind'],'earthquake'],['any',['get','selected'],['get','labelEligible']]],
      layout:{'text-field':['get','magnitudeLabel'],'text-font':['Noto Sans Regular'],
        'text-size':12,'text-anchor':'bottom','text-offset':[0,-1.25],'text-padding':5,
        'text-pitch-alignment':'viewport','text-rotation-alignment':'viewport',
        'symbol-sort-key':['case',['get','selected'],-100,['-',0,['coalesce',['get','magnitude'],0]]],
      },paint:{'text-color':'#8e4727','text-halo-color':'#fffaf2','text-halo-width':2},
    });
    for(const layer of ['monitor-items','monitor-vessels','monitor-earthquake-labels']){
      map.on('click',layer,event=>{const key=event.features?.[0]?.properties.key;if(key)selection.current?.(String(key));});
      map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
      map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
    }
  },[ready,mapRef]);
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map)return;
    const items=active?monitor?.items??[]:[];
    const labelKeys=new Set(items.filter(item=>item.earthquake).sort((a,b)=>(b.earthquake!.magnitude??-Infinity)-(a.earthquake!.magnitude??-Infinity)||a.key.localeCompare(b.key)).slice(0,96).map(item=>item.key));
    (map.getSource('monitor-items') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:items.map(item=>({type:'Feature',properties:{key:item.key,kind:item.kind,inPortfolio:Boolean(item.inPortfolio),magnitude:item.earthquake?.magnitude??null,magnitudeLabel:item.earthquake?.magnitude!=null?`M${item.earthquake.magnitude.toFixed(1)}`:'M?',labelEligible:labelKeys.has(item.key),course:item.vessel?.course??0,hasCourse:item.vessel?.course!=null,selected:item.key===monitor?.state.selected},geometry:{type:'Point',coordinates:[item.longitude,item.latitude]}}))});
    (map.getSource('monitor-cyclones') as maplibre.GeoJSONSource).setData(cycloneFeatures(items.flatMap(item=>item.cyclone?[item.cyclone]:[])));
    (map.getSource('monitor-vessel-trails') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:items.flatMap(item=>{const points=item.vessel?.trail??[];if(points.length<2)return [];const lines:number[][][]=[[]];for(const [lon,lat] of points){const line=lines.at(-1)!;if(line.length&&Math.abs(line.at(-1)![0]-lon)>180)lines.push([]);lines.at(-1)!.push([lon,lat]);}return lines.filter(line=>line.length>=2).map(coordinates=>({type:'Feature' as const,properties:{inPortfolio:Boolean(item.inPortfolio)},geometry:{type:'LineString' as const,coordinates}}));})});
    for(const id of ['monitor-vessels','monitor-vessel-trails','monitor-items','monitor-earthquake-labels','monitor-cones','monitor-tracks'])map.setLayoutProperty(id,'visibility',active?'visible':'none');
  },[ready,active,monitor?.items,monitor?.state.selected,mapRef]);
  useEffect(()=>{
    const map=mapRef.current, item=monitor?.items.find(item=>item.key===monitor.state.selected);
    if(ready&&active&&map&&item&&monitor!.state.focus>0)map.easeTo({center:[item.longitude,item.latitude],zoom:item.kind==='location'?7:5,duration:350});
  },[ready,active,monitor?.state.focus,mapRef]);
  const demo=monitor?.state.vessels.demo;
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!active||!map||!demo)return;
    const rows=monitor?.state.vessels.rows??[];if(!rows.length)return;
    const bounds=new maplibre.LngLatBounds();rows.forEach(v=>bounds.extend([v.longitude,v.latitude]));
    map.fitBounds(bounds,{padding:90,maxZoom:7,duration:600});
  },[ready,active,demo,mapRef]);
  const setViewport=monitor?.state.vessels.setViewport;
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!active||!map||!setViewport)return;
    const update=()=>{const b=map.getBounds(),w=b.getWest(),e=b.getEast();const wrap=(n:number)=>((n+180)%360+360)%360-180;setViewport(e-w>=359.9?[-180,Math.max(-90,b.getSouth()),180,Math.min(90,b.getNorth())]:[wrap(w),Math.max(-90,b.getSouth()),wrap(e),Math.min(90,b.getNorth())]);};
    update();map.on('moveend',update);return()=>{map.off('moveend',update);};
  },[ready,active,mapRef,setViewport]);
  const meta=monitor?.state.wind.data,time=monitor?.state.validTime,enabled=backendEnabled&&active&&monitor?.state.prefs.wind&&monitor?.state.online&&!monitor?.state.wind.error;
  const [field,setField]=useState<WindField|null>(null);
  useEffect(()=>{
    if(!enabled||!meta||!time)return;
    const controller=new AbortController();setField(null);setImageStatus('Loading surface wind vectors…');
    void loadWindField(meta,time,AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]),status=>{if(!controller.signal.aborted)setImageStatus(status);})
      .then(value=>{if(!controller.signal.aborted){setField(value);setImageStatus(`NOAA GFS · forecast valid ${new Date(time).toLocaleString()}`);}})
      .catch(e=>{if(!controller.signal.aborted)setImageStatus(`Wind flow unavailable: ${e instanceof Error?e.message:String(e)}`);});
    return()=>controller.abort();
  },[enabled,meta,time]);
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map||!enabled||!field||field.validAt!==time||field.runAt!==meta?.runAt)return;
    try{return createWindFlow(map,field,{paused:monitor?.state.prefs.windPaused??false,shading:monitor?.state.prefs.windShading??false,onReady:count=>{if(!count)setImageStatus('No drawable wind flow in this view. Zoom out or change the forecast.');else setImageStatus(`NOAA GFS · forecast valid ${new Date(field.validAt).toLocaleString()}`);}});}
    catch(e){setImageStatus(`Wind flow unavailable: ${e instanceof Error?e.message:String(e)}`);}
  },[ready,enabled,field,time,meta?.runAt,monitor?.state.prefs.windPaused,monitor?.state.prefs.windShading,mapRef]);
  return !backendEnabled?WIND_BACKEND_REQUIRED:monitor?.state.wind.error?`Wind flow unavailable: ${monitor.state.wind.error}`:imageStatus;
}
