import { useEffect, useRef, type RefObject } from 'react';
import * as maplibre from 'maplibre-gl';
import { geoInterpolate } from 'd3-geo';
import type { Treaty } from './parametric/types';
import { triggerPolygon } from './parametric/assessment';

type RecoveryMapModel = {
  areas: Treaty['areas'];
  event: { id: string; longitude: number; latitude: number } | null;
  active: boolean;
  showZones: boolean;
  selectedArea: string;
  onSelectArea?: (id: string) => void;
};

/** Owns contractual reference points, distance bands and epicentre connectors. */
export function useRecoveryMap(mapRef: RefObject<maplibre.Map | null>, ready: boolean, model: RecoveryMapModel) {
  const { areas: recoveryAreas, event, active, showZones, selectedArea } = model;
  const selectAreaRef = useRef(model.onSelectArea); selectAreaRef.current = model.onSelectArea;
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map)return;
    if(!map.getSource('recovery-zones')) {
      map.addSource('recovery-zones',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      map.addSource('recovery-links',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      map.addLayer({id:'recovery-zone-fill',type:'fill',source:'recovery-zones',paint:{'fill-color':'#45836d','fill-opacity':.06}});
      map.addLayer({id:'recovery-zone-line',type:'line',source:'recovery-zones',paint:{'line-color':['match',['get','areaId'],'mojave','#27765c','#7773b9'],'line-width':2,'line-dasharray':[3,2]}});
      map.addLayer({id:'recovery-links',type:'line',source:'recovery-links',paint:{'line-color':'#ae8b49','line-width':1.5,'line-dasharray':[1,2]}});
    }
    (map.getSource('recovery-zones') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:recoveryAreas.flatMap(area=>[25,100].map(radius=>({type:'Feature' as const,properties:{areaId:area.id,radius},geometry:triggerPolygon(area,radius)})))});
    (map.getSource('recovery-links') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:event?recoveryAreas.map(area=>{const interpolate=geoInterpolate([area.longitude,area.latitude],[event.longitude,event.latitude]);return {type:'Feature' as const,properties:{},geometry:{type:'LineString' as const,coordinates:Array.from({length:33},(_,index)=>interpolate(index/32))}}}):[]});
    const visible=active&&showZones;
    for(const id of ['recovery-zone-fill','recovery-zone-line','recovery-links'])map.setLayoutProperty(id,'visibility',visible?'visible':'none');
    if(!active)return;
    const markers=recoveryAreas.map(area=>{const button=document.createElement('button');button.className=`shared-reference-marker ${selectedArea===area.id?'is-selected':''}`;button.textContent=`◆ ${area.name}`;button.setAttribute('aria-label',`${area.name} fixed reference`);button.onclick=()=>selectAreaRef.current?.(area.id);return new maplibre.Marker({element:button}).setLngLat([area.longitude,area.latitude]).addTo(map);});
    return()=>markers.forEach(marker=>marker.remove());
  },[ready,recoveryAreas,event?.id,event?.latitude,event?.longitude,active,showZones,selectedArea]);
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    const update = () => {
      if (!map.isStyleLoaded()) return;
      map.getContainer().dataset.zoneFeatures = String(new Set(map.queryRenderedFeatures({ layers: map.getLayer('recovery-zone-line') ? ['recovery-zone-line'] : [] }).map(feature => `${feature.properties.areaId}:${feature.properties.radius}`)).size);
    };
    map.on('idle', update);
    return () => { map.off('idle', update); };
  }, [mapRef, ready]);
}
