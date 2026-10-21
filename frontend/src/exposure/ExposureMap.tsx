import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import * as maplibre from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { intensityColor, type CapturedEvidence, type Earthquake, type ExposureRow } from './model';
import { contextMapStyle, renderedGeography, setGeographyTheme, setGeographyVisibility } from '../maps/geography';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Treaty } from '../domain/types';
import { triggerPolygon } from '../domain/assessment';
import { useMonitorMap, type MonitorMapProps } from '../monitor/map';
import { LayerToggle } from '../monitor/LayerToggle';
import { FireMapCard, FirePerimeterLegend } from '../monitor/FireMapCard';
import { MonitorLayerControls } from '../monitor/MonitorLayerControls';
import type { MapPoint } from '../portfolios/geocoding';
import { geoInterpolate } from 'd3-geo';
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
export function ExposureMap({ evidence, event, rows, selected, onSelect, focusRequest = 0, pulseRequest = 0, mode = 'exposure', recoveryAreas = [], selectedArea = '', onSelectArea, monitor, placement, controlsInSidebar=false, layersTarget }: { layersTarget?:HTMLElement|null; controlsInSidebar?:boolean; placement?: { point: MapPoint | null; enabled: boolean; onChange: (point: MapPoint) => void };  monitor?: MonitorMapProps; evidence: CapturedEvidence | null; event: Earthquake | null; rows: ExposureRow[]; selected: string; onSelect: (id: string) => void; focusRequest?: number; pulseRequest?: number; mode?: 'monitor'|'exposure'|'recovery'|'portfolio'; recoveryAreas?: Treaty['areas']; selectedArea?: string; onSelectArea?: (id:string)=>void }) {
  const element = useRef<HTMLDivElement>(null), mapRef = useRef<maplibre.Map | null>(null), callback = useRef(onSelect);
  const [ready,setReady] = useState(false), [error,setError] = useState(''), [show,setShow] = useState(true);
  const [showLocations,setShowLocations] = useState(true), [opacity,setOpacity] = useState(.75), [mapStyle,setMapStyle] = useState<'light'|'dark'>('light');
  const [terrain,setTerrain] = useState(false), [terrainStatus,setTerrainStatus] = useState('');
  const flatPitch = useRef(0);
  const [geography,setGeography] = useState({countries:true,states:true,labels:true});
  const [showZones,setShowZones]=useState(true),[globe,setGlobe]=useState(mode!=='portfolio');
  const [mapMenu,setMapMenu]=useState<'layers'|'appearance'|null>(null);
  const selectAreaRef=useRef(onSelectArea);selectAreaRef.current=onSelectArea;
  callback.current = onSelect;
  const placementRef=useRef(placement); placementRef.current=placement;
  const {windStatus,fireCardTarget}=useMonitorMap(mapRef,ready,mode==='monitor',monitor);
  useEffect(() => {
    if (!element.current) return;
    let map: maplibre.Map;
    try {
      map = new maplibre.Map({ container: element.current, renderWorldCopies:false, center:mode==='monitor'||mode==='portfolio'?[0,20]:[-118,35.5], zoom:mode==='monitor'||mode==='portfolio'?(element.current.clientWidth>=600?1.9:1.2):6, attributionControl:{}, style:{...contextMapStyle('light'),projection:{type:mode==='portfolio'?'mercator':'globe'}} });
      mapRef.current = map; map.addControl(new maplibre.NavigationControl());
      // Match visual and keyboard order: north, zoom in, zoom out.
      const compass=map.getContainer().querySelector('.maplibregl-ctrl-compass');
      if(compass)compass.parentElement?.prepend(compass);
      map.on('movestart',()=>{if(element.current)element.current.dataset.settled='false';});
      map.on('idle',()=>{
        if(!element.current||!map.isStyleLoaded())return;
        element.current.dataset.settled='true';
        const context=renderedGeography(map);
        element.current.dataset.boundaryFeatures=String(context.boundaries);
        element.current.dataset.geographicLabels=JSON.stringify(context.labels);
        element.current.dataset.landRendered=String(map.queryRenderedFeatures(undefined,{layers:['land']}).length>0);
        element.current.dataset.cameraZoom=String(map.getZoom());
        element.current.dataset.cameraLongitude=String(map.getCenter().lng);
        element.current.dataset.projection=String(map.getProjection()?.type??'mercator');
        element.current.dataset.zoneFeatures=String(new Set(map.queryRenderedFeatures({layers:map.getLayer('recovery-zone-line')?['recovery-zone-line']:[]}).map(feature=>`${feature.properties.areaId}:${feature.properties.radius}`)).size);
        element.current.dataset.shakingReady=String(Boolean(map.getSource('exposure-shaking')&&map.isSourceLoaded('exposure-shaking')));
        if(map.getLayer('monitor-fire-clusters')) {
          for(const [name,layer] of [['fireClusters','monitor-fire-clusters'],['fireDetections','monitor-fire-dots'],['selectedFires','monitor-fire-selected']] as const)
            element.current.dataset[name]=String(map.queryRenderedFeatures({layers:[layer]}).length);
        }
      });
      map.on('click',e=>{if(placementRef.current?.enabled){const point=e.lngLat.wrap();placementRef.current.onChange({longitude:point.lng,latitude:point.lat});}});
      map.once('load', () => {
        map.addSource('exposure-sites',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        map.addLayer({id:'exposure-sites',type:'circle',source:'exposure-sites',paint:{'circle-radius':['case',['get','selected'],9,6],'circle-color':['get','color'],'circle-stroke-color':'#f6f7ef','circle-stroke-width':['case',['get','selected'],3,1]}});
        map.addLayer({id:'exposure-selection-pulse',type:'circle',source:'exposure-sites',filter:['==',['get','selected'],true],paint:{'circle-radius':10,'circle-radius-transition':{duration:0},'circle-opacity':0,'circle-stroke-color':'#527f92','circle-stroke-width':2,'circle-stroke-opacity':0,'circle-stroke-opacity-transition':{duration:0}}});
        // Draw the selected dot last so nearby locations cannot obscure it.
        map.addLayer({id:'exposure-selected-site',type:'circle',source:'exposure-sites',filter:['==',['get','selected'],true],paint:{'circle-radius':8,'circle-color':['get','color'],'circle-stroke-color':'#ffffff','circle-stroke-width':2}});
        map.on('click','exposure-sites',e=>{if(!placementRef.current?.enabled&&e.features?.[0])callback.current(String(e.features[0].properties.id));});
        map.on('mouseenter','exposure-sites',()=>{map.getCanvas().style.cursor='pointer';});
        map.on('mouseleave','exposure-sites',()=>{map.getCanvas().style.cursor='';});
        setReady(true);
      });
      map.on('error', e => { if ('sourceId' in e && String(e.sourceId).startsWith('terrain-')) return; setError(`Map display: ${e.error.message}. Numeric results remain in the location list.`); });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    const observer = new ResizeObserver(() => {
      map.resize();
      if(map.getProjection()?.type==='mercator')map.setMinZoom(Math.max(0,Math.log2(Math.hypot(map.getCanvas().clientWidth,map.getCanvas().clientHeight)/512)));
    }); observer.observe(element.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  },[]);
  const draftMarker=useRef<maplibre.Marker|null>(null);
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map||!placement?.point)return;
    const marker=new maplibre.Marker({color:'#b86d24',draggable:true}).setLngLat([placement.point.longitude,placement.point.latitude]).addTo(map);
    marker.getElement().setAttribute('aria-label','Unsaved location preview pin');
    marker.on('dragend',()=>{const point=marker.getLngLat().wrap();placementRef.current?.onChange({longitude:point.lng,latitude:point.lat});});
    draftMarker.current=marker;
    return()=>{marker.remove();draftMarker.current=null;};
  },[ready,Boolean(placement?.point)]);
  useEffect(()=>{
    const map=mapRef.current,point=placement?.point;if(!ready||!map||!point)return;
    draftMarker.current?.setLngLat([point.longitude,point.latitude]);
    map.easeTo({center:[point.longitude,point.latitude],zoom:Math.max(map.getZoom(),10),offset:mode==='portfolio'&&window.innerWidth<=760?[0,-map.getCanvas().clientHeight*.2]:[0,0],duration:350});
  },[ready,placement?.point?.longitude,placement?.point?.latitude]);
  useEffect(()=>{if(ready&&mapRef.current)mapRef.current.getCanvas().style.cursor=placement?.enabled?'crosshair':'';},[ready,placement?.enabled]);
  const fittedPortfolio=useRef(false);
  useEffect(() => {
    if(mode==='portfolio'&&ready&&rows.length&&mapRef.current&&!fittedPortfolio.current) {
      fittedPortfolio.current=true;
      const bounds=new maplibre.LngLatBounds(); rows.forEach(row=>bounds.extend([row.longitude,row.latitude]));
      mapRef.current.fitBounds(bounds,{padding:50,maxZoom:8,duration:0});
    }
  },[ready,mode,rows.length]);
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    (map.getSource('exposure-sites') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:rows.map(r=>({type:'Feature',properties:{id:r.id,color:mode==='portfolio'?'#527f92':intensityColor(r.mmi),selected:r.id===selected},geometry:{type:'Point',coordinates:[r.longitude,r.latitude]}}))});
  },[ready,rows,selected,mode]);
  const selectedLocation = rows.find(row => row.id === selected);
  const lastPulseRequest = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || pulseRequest === lastPulseRequest.current) return;
    lastPulseRequest.current = pulseRequest;
    if (!selectedLocation || !showLocations || (mode !== 'portfolio' && mode !== 'exposure') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
  }, [ready, selected, selectedLocation?.longitude, selectedLocation?.latitude, pulseRequest, showLocations, mode]);
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    try {
      if (map.getLayer('exposure-shaking')) map.removeLayer('exposure-shaking');
      if (map.getSource('exposure-shaking')) map.removeSource('exposure-shaking');
      if (evidence) {
        const x=evidence.grid.longitudes,y=evidence.grid.latitudes;
        map.addSource('exposure-shaking',{type:'image',url:gridImage(evidence),coordinates:[[x[0],y.at(-1)!],[x.at(-1)!,y.at(-1)!],[x.at(-1)!,y[0]],[x[0],y[0]]]});
        map.addLayer({id:'exposure-shaking',type:'raster',source:'exposure-shaking',layout:{visibility:show&&mode==='exposure'?'visible':'none'},paint:{'raster-opacity':.75,'raster-fade-duration':0}},'country-boundaries');
      }
    } catch (e) { setError(e instanceof Error?e.message:String(e)); }
  },[ready,evidence]); // Presentation toggle does not regenerate evidence or analysis.
  useEffect(()=>{if(ready&&mapRef.current?.getLayer('exposure-shaking'))mapRef.current.setLayoutProperty('exposure-shaking','visibility',show&&mode==='exposure'?'visible':'none');},[ready,show,mode]);
  useEffect(()=>{if(ready&&mapRef.current?.getLayer('exposure-shaking'))mapRef.current.setPaintProperty('exposure-shaking','raster-opacity',opacity);},[ready,opacity,evidence]);
  useEffect(()=>{if(ready)for(const layer of ['exposure-sites','exposure-selection-pulse','exposure-selected-site'])mapRef.current?.setLayoutProperty(layer,'visibility',showLocations&&(mode==='exposure'||mode==='portfolio')?'visible':'none');},[ready,showLocations,mode]);
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map)return;
    setGeographyTheme(map,mapStyle);
    map.setPaintProperty('background','background-color',mapStyle==='light'?'#dce8ef':'#172731');
    map.setPaintProperty('land','fill-color',mapStyle==='light'?'#f6f5ee':'#263b43');
    map.setPaintProperty('land','fill-outline-color',mapStyle==='light'?'#a4b5bd':'#4c6268');
  },[ready,mapStyle]);
  useEffect(()=>{if(ready&&mapRef.current)setGeographyVisibility(mapRef.current,geography);},[ready,geography]);
  useEffect(() => {
    const map=mapRef.current;
    if(!ready||!map||!terrain)return;
    const failed=()=>{
      setTerrainStatus('Terrain unavailable. Showing the flat map; try again when connected.');
      setTerrain(false);
      map.easeTo({pitch:flatPitch.current,duration:350});
    };
    const onError=(event: maplibre.ErrorEvent)=>{
      if('sourceId' in event&&String(event.sourceId).startsWith('terrain-'))failed();
    };
    const onData=()=>{
      if(map.getSource('terrain-elevation')&&map.isSourceLoaded('terrain-elevation'))setTerrainStatus('Terrain on · real-scale elevation · zoom in to explore relief.');
    };
    map.on('error',onError);
    map.on('sourcedata',onData);
    setTerrainStatus('Loading elevation…');
    try {
      // Separate DEM sources avoid sharing terrain and hillshade render state.
      for(const id of ['terrain-elevation','terrain-shading'])map.addSource(id,{
        type:'raster-dem',url:'https://tiles.mapterhorn.com/tilejson.json',
      });
      map.addLayer({id:'terrain-hillshade',type:'hillshade',source:'terrain-shading',paint:{
        'hillshade-exaggeration':.5,'hillshade-shadow-color':'#655e50','hillshade-highlight-color':'#fff9e9',
      }},'country-boundaries');
      map.setTerrain({source:'terrain-elevation',exaggeration:1});
      map.easeTo({pitch:45,duration:600});
    } catch { failed(); }
    return()=>{
      if(mapRef.current!==map)return;
      map.off('error',onError);map.off('sourcedata',onData);
      map.setTerrain(null);
      if(map.getLayer('terrain-hillshade'))map.removeLayer('terrain-hillshade');
      for(const id of ['terrain-elevation','terrain-shading'])if(map.getSource(id))map.removeSource(id);
    };
  },[ready,terrain]);
  function changeTerrain(enabled:boolean){
    const map=mapRef.current;if(!ready||!map)return;
    if(enabled&&!navigator.onLine){setTerrainStatus('Terrain needs an internet connection to load elevation.');return;}
    if(enabled)flatPitch.current=map.getPitch();
    else {setTerrainStatus('');map.easeTo({pitch:flatPitch.current,duration:350});}
    setTerrain(enabled);
  }

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
    const visible=mode==='recovery'&&showZones;
    for(const id of ['recovery-zone-fill','recovery-zone-line','recovery-links'])map.setLayoutProperty(id,'visibility',visible?'visible':'none');
    if(mode!=='recovery')return;
    const markers=recoveryAreas.map(area=>{const button=document.createElement('button');button.className=`shared-reference-marker ${selectedArea===area.id?'is-selected':''}`;button.textContent=`◆ ${area.name}`;button.setAttribute('aria-label',`${area.name} fixed reference`);button.onclick=()=>selectAreaRef.current?.(area.id);return new maplibre.Marker({element:button}).setLngLat([area.longitude,area.latitude]).addTo(map);});
    return()=>markers.forEach(marker=>marker.remove());
  },[ready,recoveryAreas,event?.id,event?.latitude,event?.longitude,mode,showZones,selectedArea]);
  function changeProjection(enabled:boolean){
    const map=mapRef.current;if(!ready||!map)return;
    // A flat viewport spans at most one world, while longitude stays free to wrap.
    if(enabled)map.setProjection({type:'globe'});
    map.setRenderWorldCopies(!enabled);
    const minimum=enabled?0:Math.max(0,Math.log2(Math.hypot(map.getCanvas().clientWidth,map.getCanvas().clientHeight)/512));
    map.setMinZoom(minimum);
    if(!enabled)map.setProjection({type:'mercator'});
    setGlobe(enabled);
    if(enabled)map.easeTo({zoom:mode==='monitor'&&map.getCanvas().clientWidth>=600?1.9:1.2});
  }
  function fitLocations(){
    const map=mapRef.current;if(!map||!(mode==='recovery'?recoveryAreas.length:rows.length))return;
    changeProjection(false);
    const bounds=new maplibre.LngLatBounds();(mode==='recovery'?recoveryAreas:rows).forEach(row=>bounds.extend([row.longitude,row.latitude]));if(mode==='recovery'&&event)bounds.extend([event.longitude,event.latitude]);
    map.fitBounds(bounds,{padding:60,maxZoom:8,duration:350});
  }
  useEffect(()=>{
    const map=mapRef.current;if(!ready||!map||!event||mode==='monitor')return;
    const marker=new maplibre.Marker({color:'#ffffff'}).setLngLat([event.longitude,event.latitude]).setPopup(new maplibre.Popup().setText(`${event.name} · epicentre`)).addTo(map);
    map.easeTo({center:[event.longitude,event.latitude],zoom:6,duration:350});return()=>{marker.remove();};
  },[ready,event?.id,event?.latitude,event?.longitude,mode==='monitor']);
  useEffect(()=>{const row=rows.find(r=>r.id===selected);if(ready&&row&&focusRequest>0)mapRef.current?.easeTo({center:[row.longitude,row.latitude],duration:350});},[ready,focusRequest]);
  useEffect(()=>{if(mode==='monitor'&&monitor?.fitRequest)fitLocations();},[monitor?.fitRequest]);
  const layerControls = (
        <div className="exposure-map-layers" aria-label="Map layers">
          {mode==='recovery'&&<button disabled={!recoveryAreas.length||!ready} onClick={fitLocations}>Fit treaty references</button>}
          {(mode==='exposure'||mode==='portfolio')&&<>
            <label><input type="checkbox" checked={showLocations} onChange={e=>setShowLocations(e.target.checked)}/> Insured locations</label>
            {showLocations&&<button className="monitor-layer-action" disabled={!rows.length||!ready} onClick={fitLocations}>Fit visible locations</button>}
            {mode==='exposure'&&<label><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/> Shaking layer</label>}
            {show&&mode==='exposure'&&<label className="exposure-opacity">Opacity<input aria-label="Shaking opacity" type="range" min="0" max="100" step="5" value={Math.round(opacity*100)} onChange={e=>setOpacity(Number(e.target.value)/100)}/><output>{Math.round(opacity*100)}%</output></label>}
          </>}
          {mode==='recovery'&&<label><input type="checkbox" checked={showZones} onChange={e=>setShowZones(e.target.checked)}/> Treaty trigger zones</label>}
          {mode==='monitor'&&monitor&&<MonitorLayerControls state={monitor.state} onFitPortfolio={fitLocations} canFitPortfolio={ready&&rows.length>0}/>}
        </div>
  );
  return <section className="exposure-spatial" data-testid={mode==='recovery'?'analytical-map':undefined} data-ready={ready} aria-label={mode==='monitor'?'Live hazards and portfolio map':mode==='portfolio'?'Portfolio inventory map':mode==='exposure'?'Shaking and portfolio map':'Treaty trigger zone map'}>
    {controlsInSidebar&&layersTarget&&createPortal(layerControls,layersTarget)}
    <div className="exposure-map-menus" aria-label="Map controls">
      {!controlsInSidebar&&<details className="exposure-layer-menu" open={mapMenu==='layers'}>
        <summary onClick={e=>{e.preventDefault();setMapMenu(mapMenu==='layers'?null:'layers');}}>Layers</summary>
        {layerControls}
      </details>}
      <details className="exposure-layer-menu" open={mapMenu==='appearance'}>
        <summary onClick={e=>{e.preventDefault();setMapMenu(mapMenu==='appearance'?null:'appearance');}}>Appearance</summary>
        <div className="exposure-map-layers" aria-label="Map appearance">
          <div className="exposure-map-style" role="group" aria-label="Basemap appearance"><button aria-pressed={mapStyle==='light'} onClick={()=>setMapStyle('light')}>Light map</button><button aria-pressed={mapStyle==='dark'} onClick={()=>setMapStyle('dark')}>Dark map</button></div>
          <LayerToggle label="Globe view" checked={globe} onChange={changeProjection}/>
          <LayerToggle label="3D terrain" checked={terrain} onChange={changeTerrain}/>
          <label><input type="checkbox" checked={geography.countries} onChange={e=>setGeography({...geography,countries:e.target.checked})}/> Country borders</label>
          {geography.countries&&<label className="exposure-sub-option"><input type="checkbox" checked={geography.states} onChange={e=>setGeography({...geography,states:e.target.checked})}/> State / province borders</label>}
          <label><input type="checkbox" checked={geography.labels} onChange={e=>setGeography({...geography,labels:e.target.checked})}/> Place labels</label>
        </div>
      </details>
    </div>
    {placement?.enabled&&<button className="portfolio-map-center" onClick={()=>{const point=mapRef.current?.getCenter().wrap();if(point)placement.onChange({longitude:point.lng,latitude:point.lat});}}>Use map center</button>}
    <div ref={element} className="exposure-map" data-testid="exposure-map" data-ready={ready} aria-label={mode==='monitor'?'Interactive hazard map; items also available in Monitor details':'Interactive portfolio map; locations also available in the keyboard-accessible table'}/>
    {mode==='monitor'&&monitor&&fireCardTarget&&monitor.selectedItem&&createPortal(<FireMapCard item={monitor.selectedItem} state={monitor.state}/>,fireCardTarget)}
    {terrainStatus&&<div className="terrain-map-status" role="status">{terrainStatus}</div>}
    {error&&<p role="status" className="exposure-warning">{error}</p>}
    {mode==='monitor'&&<div className="monitor-map-status" role="status">{monitor?.state.vessels.demo?'DEMO FLEET · Fictional positions and trails · Not live AIS':!monitor?.state.online?'Offline · observations may be stale':monitor.state.prefs.wind?windStatus:'Latest source reports · see Feeds for freshness'}</div>}
    {(mode!=='monitor'||monitor?.state.prefs.locations||monitor?.state.prefs.earthquakes||monitor?.state.prefs.cyclones||monitor?.state.prefs.vessels||monitor?.state.prefs.fires||monitor?.state.prefs.perimeters||monitor?.state.prefs.alerts)&&<div className="exposure-legend" aria-label="Map legend">
      {mode==='monitor'?<>
        {monitor?.state.prefs.locations&&<span><i style={{background:'#287d69'}}/>Insured locations</span>}
        {monitor?.state.prefs.earthquakes&&<span><i style={{background:'#bc7545'}}/>Earthquakes</span>}
        {monitor?.state.prefs.vessels&&<>{(monitor.state.vessels.scope==='all'?[true,false]:[true]).map(inPortfolio=><span key={String(inPortfolio)}><svg width="12" height="16" viewBox="0 0 24 32" aria-hidden="true"><path d="M12 2 20 12 18 29H6L4 12Z" fill={inPortfolio?'#287d69':'#2674bb'}/><path d="M8 16h8v4H8z" fill="white"/></svg>{inPortfolio?'Portfolio vessels':'Other vessels'}</span>)}</>}
        {monitor?.state.prefs.fires&&<span><i style={{background:'#d35827'}}/>Fire detections</span>}
        {monitor?.state.prefs.perimeters&&<FirePerimeterLegend/>}
        {monitor?.state.prefs.alerts&&<span><i style={{background:'#b59424'}}/>Weather warnings</span>}
        {monitor?.state.prefs.cyclones&&<span><i style={{background:'#7858a1'}}/>Cyclones</span>}
      </>:mode==='recovery'?<span>◆ Fixed references · 25 km inner / 100 km outer bands</span>:mode==='portfolio'?<span>● Insured locations · unassessed</span>:[3,4,5,6,7,null].map((value,i)=><span key={i}><i style={{background:intensityColor(value)}}/>{['<4','4–<5','5–<6','6–<7','7+','Unknown'][i]}</span>)}
    </div>}

    <p className="exposure-map-note">{mode==='monitor'?'USGS · NOAA · NASA FIRMS · NIFC · NRCan CWFIS · ECCC. Portfolio attention only; no damage or loss assessment.':mode==='portfolio'?'Insured location inventory · No hazard assessment.':mode==='exposure'?'USGS shaking evidence · Shaking estimates do not establish property damage.':'Contractual fixed-reference distance bands · Not shaking contours or damage radii.'} Natural Earth geographic context.</p>
  </section>;
}
