import { backendEnabled, WIND_BACKEND_REQUIRED } from './backend';
import { addReportedFireIcon } from './fire-icon';
import { addVesselIcons } from './vessel-icon';
import { useEffect, useRef, useState, type RefObject } from 'react';
import * as maplibre from 'maplibre-gl';
import { cycloneFeatures } from './feeds';
import { loadWindField, type WindField } from './wind';
import { createWindFlow } from './wind-rendering';
import type { MonitorState } from './useMonitor';
import type { MonitorItem } from './model';
import { containmentBand, observationAge, perimeterBounds, fireEvidenceTime } from './fire-display';
import { addFireMapLayers, updateFireMapLayers } from './fire-map';

export type MonitorMapProps={state:MonitorState;items:MonitorItem[];selectedItem?:MonitorItem;fitRequest?:number};
export function useMonitorMap(mapRef:RefObject<maplibre.Map|null>,ready:boolean,active:boolean,monitor?:MonitorMapProps) {
  const selection=useRef(monitor?.state.select);selection.current=monitor?.state.select;
  const [imageStatus,setImageStatus]=useState('');
  const [fireCardTarget,setFireCardTarget]=useState<HTMLElement|null>(null);
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map)return;
    addVesselIcons(map);
    addReportedFireIcon(map);
    map.addSource('monitor-items',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addSource('monitor-vessel-trails',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'monitor-vessel-trails',type:'line',source:'monitor-vessel-trails',paint:{'line-color':['case',['get','inPortfolio'],'#287d69','#2674bb'],'line-width':1.5,'line-opacity':0.6}});
    map.addSource('monitor-hazards',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'monitor-hazard-areas',type:'fill',source:'monitor-hazards',paint:{'fill-color':['match',['get','kind'],'perimeter',['get','containmentColor'],'#b59424'],'fill-opacity':['case',['get','selected'],0.3,0.12]}});
    map.addLayer({id:'monitor-hazard-boundaries',type:'line',source:'monitor-hazards',paint:{'line-color':['match',['get','kind'],'perimeter',['get','containmentColor'],'#957610'],'line-width':['case',['get','selected'],3,1.5]}});
    map.addSource('monitor-cyclones',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'monitor-cones',type:'fill',source:'monitor-cyclones',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#a27bc3','fill-opacity':.16}});
    map.addLayer({id:'monitor-tracks',type:'line',source:'monitor-cyclones',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#7858a1','line-width':2,'line-dasharray':[3,2]}});
    map.addLayer({id:'monitor-items',type:'circle',source:'monitor-items',filter:['all',['!=',['get','kind'],'vessel'],['!=',['get','kind'],'perimeter'],['!=',['get','kind'],'alert'],['!=',['get','kind'],'fire']],paint:{'circle-color':['match',['get','kind'],'earthquake','#bc7545','cyclone','#7858a1','vessel','#2674bb','fire','#d35827','perimeter','#b85a2b','#287d69'],'circle-radius':['case',['get','selected'],14,['==',['get','kind'],'earthquake'],['interpolate',['linear'],['coalesce',['get','magnitude'],0],0,4,3,6,5,9,7,12],5],'circle-stroke-color':'#fff','circle-stroke-width':2}});
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
    map.addLayer({id:'monitor-reported-fires',type:'symbol',source:'monitor-items',
      filter:['all',['==',['get','kind'],'perimeter'],['==',['get','incidentPoint'],true]],
      layout:{'icon-image':'monitor-reported-fire','icon-size':['case',['get','selected'],1,.75],
        'icon-allow-overlap':true,'icon-ignore-placement':true,'symbol-sort-key':['case',['get','selected'],1,0]},
    });
    addFireMapLayers(map,key=>selection.current?.(key));
    map.addLayer({id:'monitor-fire-labels',type:'symbol',source:'monitor-items',minzoom:3,
      filter:['==',['get','kind'],'perimeter'],layout:{
        'text-field':['get','fireLabel'],'text-font':['Noto Sans Regular'],'text-size':11,
        'text-anchor':'top','text-offset':[0,1.5],'text-max-width':18,'text-padding':28,
        'symbol-sort-key':['case',['get','selected'],-1,['-',0,['get','nearby']]],
      },paint:{'text-color':'#8e4727','text-halo-color':'#fffaf2','text-halo-width':2},
    });
    for(const layer of ['monitor-items','monitor-vessels','monitor-reported-fires','monitor-earthquake-labels','monitor-hazard-areas','monitor-hazard-boundaries','monitor-fire-labels']){
      map.on('click',layer,event=>{
        const foreground=map.queryRenderedFeatures(event.point,{layers:['monitor-items','monitor-vessels','monitor-reported-fires','monitor-earthquake-labels']})[0];
        if(foreground?foreground.layer.id!==layer:map.queryRenderedFeatures(event.point,{layers:['monitor-fire-dots','monitor-fire-selected','monitor-fire-clusters']}).length)return;
        const key=event.features?.[0]?.properties.key;if(key)selection.current?.(String(key));
      });
      map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
      map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
    }
  },[ready,mapRef]);
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map)return;
    const items=active?monitor?.items??[]:[];
    const labelKeys=new Set(items.filter(item=>item.earthquake).sort((a,b)=>(b.earthquake!.magnitude??-Infinity)-(a.earthquake!.magnitude??-Infinity)||a.key.localeCompare(b.key)).slice(0,96).map(item=>item.key));
    (map.getSource('monitor-items') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:items.filter(item=>item.hasPosition!==false&&item.kind!=='fire').map(item=>({type:'Feature',properties:{key:item.key,kind:item.kind,nearby:item.nearby,incidentPoint:item.perimeter?.evidence==='reported-incident',fireLabel:item.perimeter?`${item.name} · ${observationAge(fireEvidenceTime(item.perimeter),monitor?.state.now??Date.now())}`:'',inPortfolio:Boolean(item.inPortfolio),magnitude:item.earthquake?.magnitude??null,magnitudeLabel:item.earthquake?.magnitude!=null?`M${item.earthquake.magnitude.toFixed(1)}`:'M?',labelEligible:labelKeys.has(item.key),course:item.vessel?.course??0,hasCourse:item.vessel?.course!=null,selected:item.key===monitor?.state.selected},geometry:{type:'Point',coordinates:[item.longitude,item.latitude]}}))});
    (map.getSource('monitor-hazards') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:items.flatMap(item=>{const geometry=item.perimeter?.geometry??item.alert?.geometry;if(!geometry)return [];return [{type:'Feature' as const,properties:{key:item.key,kind:item.kind,containmentColor:containmentBand(item.perimeter?.containment??null).color,selected:item.key===monitor?.state.selected},geometry}];})});
    updateFireMapLayers(map,items,monitor?.state.selected??'',active);
    (map.getSource('monitor-cyclones') as maplibre.GeoJSONSource).setData(cycloneFeatures(items.flatMap(item=>item.cyclone?[item.cyclone]:[])));
    (map.getSource('monitor-vessel-trails') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:items.flatMap(item=>{const points=item.vessel?.trail??[];if(points.length<2)return [];const lines:number[][][]=[[]];for(const [lon,lat] of points){const line=lines.at(-1)!;if(line.length&&Math.abs(line.at(-1)![0]-lon)>180)lines.push([]);lines.at(-1)!.push([lon,lat]);}return lines.filter(line=>line.length>=2).map(coordinates=>({type:'Feature' as const,properties:{inPortfolio:Boolean(item.inPortfolio)},geometry:{type:'LineString' as const,coordinates}}));})});
    for(const id of ['monitor-vessels','monitor-vessel-trails','monitor-items','monitor-reported-fires','monitor-earthquake-labels','monitor-cones','monitor-tracks','monitor-hazard-areas','monitor-hazard-boundaries','monitor-fire-labels'])map.setLayoutProperty(id,'visibility',active?'visible':'none');
  },[ready,active,monitor?.items,monitor?.state.selected,mapRef]);
  const selectedItem=monitor?.selectedItem??monitor?.items.find(item=>item.key===monitor.state.selected);
  useEffect(()=>{
    const map=mapRef.current, item=selectedItem;
    if(!ready||!active||!map||!item||item.hasPosition===false||!monitor?.state.focus)return;
    const small=map.getCanvas().clientWidth<600;
    const duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:350;
    if(item.perimeter?.geometry) {
      map.fitBounds(perimeterBounds(item.perimeter.geometry),{padding:small?75:100,maxZoom:11,duration});
    } else map.easeTo({center:[item.longitude,item.latitude],zoom:item.kind==='location'?7:item.kind==='fire'?9:5,duration});
  },[ready,active,monitor?.state.focus,mapRef]);
  const showFireCard=selectedItem?.kind==='perimeter'||selectedItem?.mapOnly
    ?monitor?.items.some(item=>item.key===selectedItem?.key)
    :selectedItem?.kind==='fire'&&monitor?.items.some(item=>item.mapOnly&&selectedItem.fireDetections?.some(fire=>fire.id===item.fire?.id));
  useEffect(()=>{
    const map=mapRef.current,item=selectedItem;
    if(!ready||!active||!map||!item||!showFireCard||item.hasPosition===false)return;
    const target=document.createElement('div');
    const popup=new maplibre.Popup({closeButton:false,closeOnClick:false,focusAfterOpen:false,maxWidth:'250px',offset:18,className:'monitor-fire-popup'})
      .setLngLat([item.longitude,item.latitude]).setDOMContent(target).addTo(map);
    setFireCardTarget(target);
    return()=>{popup.remove();setFireCardTarget(null);};
  },[ready,active,selectedItem?.key,selectedItem?.longitude,selectedItem?.latitude,showFireCard,mapRef]);
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
  return {windStatus:!backendEnabled?WIND_BACKEND_REQUIRED:monitor?.state.wind.error?`Wind flow unavailable: ${monitor.state.wind.error}`:imageStatus,fireCardTarget};
}
