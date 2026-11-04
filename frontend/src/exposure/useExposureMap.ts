import { useEffect, useRef, useState, type RefObject } from 'react';
import * as maplibre from 'maplibre-gl';
import { intensityColor, type CapturedEvidence, type ExposureRow } from './model';

type ExposureMapModel = {
  evidence: CapturedEvidence | null;
  rows: ExposureRow[];
  selected: string;
  onSelect: (id: string) => void;
  assessed: boolean;
  active: boolean;
  showLocations: boolean;
  showShaking: boolean;
  opacity: number;
  pulseRequest: number;
  placementEnabled: boolean;
};

function gridImage(evidence: CapturedEvidence): string {
  const grid = evidence.grid, width = grid.longitudes.length, height = grid.latitudes.length;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Cannot create the shaking display. Numeric results remain available in the list.');
  const image = context.createImageData(width, height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const value = grid.values[(height - row - 1) * width + column], color = intensityColor(value);
    const index = (row * width + column) * 4;
    image.data[index] = parseInt(color.slice(1,3),16); image.data[index+1] = parseInt(color.slice(3,5),16); image.data[index+2] = parseInt(color.slice(5,7),16); image.data[index+3] = value === null ? 0 : value < 4 ? 110 : 180;
  }
  context.putImageData(image,0,0); return canvas.toDataURL();
}
/** Owns insured-location interaction and frozen shaking drawings on an existing map. */
export function useExposureMap(mapRef: RefObject<maplibre.Map | null>, ready: boolean, model: ExposureMapModel) {
  const { evidence, rows, selected, assessed, active, showLocations, showShaking, opacity, pulseRequest } = model;
  const callbacks = useRef(model); callbacks.current = model;
  const [error, setError] = useState('');
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    map.addSource('exposure-sites',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'exposure-sites',type:'circle',source:'exposure-sites',paint:{'circle-radius':['case',['get','selected'],9,6],'circle-color':['get','color'],'circle-stroke-color':'#f6f7ef','circle-stroke-width':['case',['get','selected'],3,1]}});
    map.addLayer({id:'exposure-selection-pulse',type:'circle',source:'exposure-sites',filter:['==',['get','selected'],true],paint:{'circle-radius':10,'circle-radius-transition':{duration:0},'circle-opacity':0,'circle-stroke-color':'#527f92','circle-stroke-width':2,'circle-stroke-opacity':0,'circle-stroke-opacity-transition':{duration:0}}});
    // Draw the selected dot last so nearby locations cannot obscure it.
    map.addLayer({id:'exposure-selected-site',type:'circle',source:'exposure-sites',filter:['==',['get','selected'],true],paint:{'circle-radius':8,'circle-color':['get','color'],'circle-stroke-color':'#ffffff','circle-stroke-width':2}});
    const select = (event: maplibre.MapLayerMouseEvent) => { if (!callbacks.current.placementEnabled && event.features?.[0]) callbacks.current.onSelect(String(event.features[0].properties.id)); };
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', 'exposure-sites', select);
    map.on('mouseenter', 'exposure-sites', enter);
    map.on('mouseleave', 'exposure-sites', leave);
    return () => { map.off('click', 'exposure-sites', select); map.off('mouseenter', 'exposure-sites', enter); map.off('mouseleave', 'exposure-sites', leave); };
  }, [mapRef, ready]);
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    (map.getSource('exposure-sites') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:rows.map(r=>({type:'Feature',properties:{id:r.id,color:assessed?intensityColor(r.mmi):'#527f92',selected:r.id===selected},geometry:{type:'Point',coordinates:[r.longitude,r.latitude]}}))});
  },[ready,rows,selected,assessed]);
  const selectedLocation = rows.find(row => row.id === selected);
  const lastPulseRequest = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || pulseRequest === lastPulseRequest.current) return;
    lastPulseRequest.current = pulseRequest;
    if (!selectedLocation || !showLocations || !active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - start) / 850);
      map.setPaintProperty('exposure-selection-pulse', 'circle-radius', 10 + 22 * (1 - (1 - progress) ** 2));
      map.setPaintProperty('exposure-selection-pulse', 'circle-stroke-opacity', .65 * (1 - progress) ** 2);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      if (map.getLayer('exposure-selection-pulse')) map.setPaintProperty('exposure-selection-pulse', 'circle-stroke-opacity', 0);
    };
  }, [ready, selected, selectedLocation?.longitude, selectedLocation?.latitude, pulseRequest, showLocations, active]);
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    try {
      if (map.getLayer('exposure-shaking')) map.removeLayer('exposure-shaking');
      if (map.getSource('exposure-shaking')) map.removeSource('exposure-shaking');
      if (evidence) {
        const x=evidence.grid.longitudes,y=evidence.grid.latitudes;
        map.addSource('exposure-shaking',{type:'image',url:gridImage(evidence),coordinates:[[x[0],y.at(-1)!],[x.at(-1)!,y.at(-1)!],[x.at(-1)!,y[0]],[x[0],y[0]]]});
        map.addLayer({id:'exposure-shaking',type:'raster',source:'exposure-shaking',layout:{visibility:showShaking?'visible':'none'},paint:{'raster-opacity':.75,'raster-fade-duration':0}},'country-boundaries');
      }
    } catch (e) { setError(e instanceof Error?e.message:String(e)); }
  },[ready,evidence]); // Presentation toggle does not regenerate evidence or analysis.
  useEffect(()=>{if(ready&&mapRef.current?.getLayer('exposure-shaking'))mapRef.current.setLayoutProperty('exposure-shaking','visibility',showShaking?'visible':'none');},[ready,showShaking]);
  useEffect(()=>{if(ready&&mapRef.current?.getLayer('exposure-shaking'))mapRef.current.setPaintProperty('exposure-shaking','raster-opacity',opacity);},[ready,opacity,evidence]);
  useEffect(()=>{if(ready)for(const layer of ['exposure-sites','exposure-selection-pulse','exposure-selected-site'])mapRef.current?.setLayoutProperty(layer,'visibility',showLocations&&active?'visible':'none');},[ready,showLocations,active]);
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    const update = () => {
      if (map.isStyleLoaded()) map.getContainer().dataset.shakingReady = String(Boolean(map.getSource('exposure-shaking') && map.isSourceLoaded('exposure-shaking')));
    };
    map.on('idle', update);
    return () => { map.off('idle', update); };
  }, [mapRef, ready]);
  return error;
}
