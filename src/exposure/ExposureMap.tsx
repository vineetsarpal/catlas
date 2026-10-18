import { useEffect, useRef, useState } from 'react';
import * as maplibre from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { intensityColor, type CapturedEvidence, type Earthquake, type ExposureRow } from './model';
import { contextMapStyle, renderedGeography, setGeographyTheme, setGeographyVisibility } from '../maps/geography';
import 'maplibre-gl/dist/maplibre-gl.css';
maplibre.setWorkerUrl(workerUrl);

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
export function ExposureMap({ evidence, event, rows, selected, onSelect }: { evidence: CapturedEvidence | null; event: Earthquake | null; rows: ExposureRow[]; selected: string; onSelect: (id: string) => void }) {
  const element = useRef<HTMLDivElement>(null), mapRef = useRef<maplibre.Map | null>(null), callback = useRef(onSelect);
  const [ready,setReady] = useState(false), [error,setError] = useState(''), [show,setShow] = useState(true);
  const [showLocations,setShowLocations] = useState(true), [opacity,setOpacity] = useState(.75), [mapStyle,setMapStyle] = useState<'light'|'dark'>('light');
  const [geography,setGeography] = useState({countries:true,states:true,labels:true});
  callback.current = onSelect;
  useEffect(() => {
    if (!element.current) return;
    let map: maplibre.Map;
    try {
      map = new maplibre.Map({ container: element.current, center:[-118,35.5], zoom:6, attributionControl:{}, style:contextMapStyle('light') });
      mapRef.current = map; map.addControl(new maplibre.NavigationControl());
      map.on('movestart',()=>{if(element.current)element.current.dataset.settled='false';});
      map.on('idle',()=>{
        if(!element.current||!map.isStyleLoaded())return;
        element.current.dataset.settled='true';
        const context=renderedGeography(map);
        element.current.dataset.boundaryFeatures=String(context.boundaries);
        element.current.dataset.geographicLabels=JSON.stringify(context.labels);
        element.current.dataset.landRendered=String(map.queryRenderedFeatures(undefined,{layers:['land']}).length>0);
        element.current.dataset.shakingReady=String(Boolean(map.getSource('exposure-shaking')&&map.isSourceLoaded('exposure-shaking')));
      });
      map.once('load', () => {
        map.addSource('exposure-sites',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        map.addLayer({id:'exposure-sites',type:'circle',source:'exposure-sites',paint:{'circle-radius':['case',['get','selected'],9,6],'circle-color':['get','color'],'circle-stroke-color':'#f6f7ef','circle-stroke-width':['case',['get','selected'],3,1]}});
        map.on('click','exposure-sites',e=>{if(e.features?.[0])callback.current(String(e.features[0].properties.id));});
        map.on('mouseenter','exposure-sites',()=>{map.getCanvas().style.cursor='pointer';});
        map.on('mouseleave','exposure-sites',()=>{map.getCanvas().style.cursor='';});
        setReady(true);
      });
      map.on('error', e => setError(`Map display: ${e.error.message}. Numeric results remain in the location list.`));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    const observer = new ResizeObserver(() => map.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  },[]);
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    (map.getSource('exposure-sites') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:rows.map(r=>({type:'Feature',properties:{id:r.id,color:intensityColor(r.mmi),selected:r.id===selected},geometry:{type:'Point',coordinates:[r.longitude,r.latitude]}}))});
  },[ready,rows,selected]);
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    try {
      if (map.getLayer('exposure-shaking')) map.removeLayer('exposure-shaking');
      if (map.getSource('exposure-shaking')) map.removeSource('exposure-shaking');
      if (evidence) {
        const x=evidence.grid.longitudes,y=evidence.grid.latitudes;
        map.addSource('exposure-shaking',{type:'image',url:gridImage(evidence),coordinates:[[x[0],y.at(-1)!],[x.at(-1)!,y.at(-1)!],[x.at(-1)!,y[0]],[x[0],y[0]]]});
        map.addLayer({id:'exposure-shaking',type:'raster',source:'exposure-shaking',layout:{visibility:show?'visible':'none'},paint:{'raster-opacity':.75,'raster-fade-duration':0}},'country-boundaries');
      }
    } catch (e) { setError(e instanceof Error?e.message:String(e)); }
  },[ready,evidence]); // Presentation toggle does not regenerate evidence or analysis.
  useEffect(()=>{if(ready&&mapRef.current?.getLayer('exposure-shaking'))mapRef.current.setLayoutProperty('exposure-shaking','visibility',show?'visible':'none');},[ready,show]);
  useEffect(()=>{if(ready&&mapRef.current?.getLayer('exposure-shaking'))mapRef.current.setPaintProperty('exposure-shaking','raster-opacity',opacity);},[ready,opacity,evidence]);
  useEffect(()=>{if(ready)mapRef.current?.setLayoutProperty('exposure-sites','visibility',showLocations?'visible':'none');},[ready,showLocations]);
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map)return;
    setGeographyTheme(map,mapStyle);
    map.setPaintProperty('background','background-color',mapStyle==='light'?'#dce8ef':'#172731');
    map.setPaintProperty('land','fill-color',mapStyle==='light'?'#f6f5ee':'#263b43');
    map.setPaintProperty('land','fill-outline-color',mapStyle==='light'?'#a4b5bd':'#4c6268');
  },[ready,mapStyle]);
  useEffect(()=>{if(ready&&mapRef.current)setGeographyVisibility(mapRef.current,geography);},[ready,geography]);
  function fitLocations(){
    const map=mapRef.current;if(!map||!rows.length)return;
    map.setProjection({type:'mercator'});
    const bounds=new maplibre.LngLatBounds();rows.forEach(row=>bounds.extend([row.longitude,row.latitude]));
    map.fitBounds(bounds,{padding:60,maxZoom:8,duration:350});
  }
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map||!event)return;
    const marker=new maplibre.Marker({color:'#ffffff'}).setLngLat([event.longitude,event.latitude]).setPopup(new maplibre.Popup().setText(`${event.name} · epicentre`)).addTo(map);
    map.easeTo({center:[event.longitude,event.latitude],zoom:6,duration:350});return()=>{marker.remove();};
  },[ready,event?.id]);
  useEffect(()=>{const row=rows.find(r=>r.id===selected);if(ready&&row)mapRef.current?.easeTo({center:[row.longitude,row.latitude],duration:350});},[ready,selected]);
  return <section className="exposure-spatial" aria-label="Shaking and portfolio map">
    <div className="exposure-map-toolbar"><strong>Estimated shaking · MMI</strong><button onClick={()=>{if(event){mapRef.current?.setProjection({type:'mercator'});mapRef.current?.easeTo({center:[event.longitude,event.latitude],zoom:6});}}}>Regional</button><button onClick={()=>{mapRef.current?.setProjection({type:'globe'});mapRef.current?.easeTo({center:[event?.longitude??0,event?.latitude??15],zoom:1.2});}}>World globe</button><button disabled={!rows.length||!ready} onClick={fitLocations}>Fit visible locations</button></div>
    <div className="exposure-map-layers" aria-label="Map display controls"><div className="exposure-map-style" role="group" aria-label="Basemap appearance"><button aria-pressed={mapStyle==='light'} onClick={()=>setMapStyle('light')}>Light map</button><button aria-pressed={mapStyle==='dark'} onClick={()=>setMapStyle('dark')}>Dark map</button></div><label><input type="checkbox" checked={showLocations} onChange={e=>setShowLocations(e.target.checked)}/> Insured locations</label><label><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/> Shaking layer</label>{(Object.keys(geography) as (keyof typeof geography)[]).map(key=><label key={key}><input type="checkbox" checked={geography[key]} onChange={e=>setGeography({...geography,[key]:e.target.checked})}/>{{countries:'Country borders',states:'State / province borders',labels:'Place labels'}[key]}</label>)}<label className="exposure-opacity">Opacity<input aria-label="Shaking opacity" type="range" min="0" max="100" step="5" value={Math.round(opacity*100)} disabled={!show} onChange={e=>setOpacity(Number(e.target.value)/100)}/><output>{Math.round(opacity*100)}%</output></label></div>
    <div ref={element} className="exposure-map" data-testid="exposure-map" data-ready={ready} aria-label="Interactive portfolio map; locations also available in the keyboard-accessible table"/>
    {error&&<p role="status" className="exposure-warning">{error}</p>}
    <div className="exposure-legend">{[3,4,5,6,7,null].map((value,i)=><span key={i}><i style={{background:intensityColor(value)}}/>{['<4','4–<5','5–<6','6–<7','7+','Unknown'][i]}</span>)}</div>
    <p className="exposure-map-note">USGS shaking evidence · Natural Earth boundaries and places (generalized geographic context). Shaking estimates do not establish property damage. Map controls do not change the assessment.</p>
  </section>;
}
