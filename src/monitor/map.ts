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
    map.addSource('monitor-items',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addSource('monitor-cyclones',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'monitor-cones',type:'fill',source:'monitor-cyclones',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#a27bc3','fill-opacity':.16}});
    map.addLayer({id:'monitor-tracks',type:'line',source:'monitor-cyclones',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#7858a1','line-width':2,'line-dasharray':[3,2]}});
    map.addLayer({id:'monitor-items',type:'circle',source:'monitor-items',paint:{'circle-color':['match',['get','kind'],'earthquake','#bc7545','cyclone','#7858a1','#287d69'],'circle-radius':['case',['get','selected'],9,5],'circle-stroke-color':'#fff','circle-stroke-width':2}});
    map.on('click','monitor-items',event=>{const key=event.features?.[0]?.properties.key;if(key)selection.current?.(String(key));});
    map.on('mouseenter','monitor-items',()=>{map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave','monitor-items',()=>{map.getCanvas().style.cursor='';});
  },[ready,mapRef]);
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map)return;
    const items=active?monitor?.items??[]:[];
    (map.getSource('monitor-items') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:items.map(item=>({type:'Feature',properties:{key:item.key,kind:item.kind,selected:item.key===monitor?.state.selected},geometry:{type:'Point',coordinates:[item.longitude,item.latitude]}}))});
    (map.getSource('monitor-cyclones') as maplibre.GeoJSONSource).setData(cycloneFeatures(items.flatMap(item=>item.cyclone?[item.cyclone]:[])));
    for(const id of ['monitor-items','monitor-cones','monitor-tracks'])map.setLayoutProperty(id,'visibility',active?'visible':'none');
  },[ready,active,monitor?.items,monitor?.state.selected,mapRef]);
  useEffect(()=>{
    const map=mapRef.current, item=monitor?.items.find(item=>item.key===monitor.state.selected);
    if(ready&&active&&map&&item&&monitor!.state.focus>0)map.easeTo({center:[item.longitude,item.latitude],zoom:item.kind==='location'?7:5,duration:350});
  },[ready,active,monitor?.state.focus,mapRef]);
  const meta=monitor?.state.wind.data,time=monitor?.state.validTime,enabled=active&&monitor?.state.prefs.wind&&monitor?.state.online;
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
  return imageStatus;
}
