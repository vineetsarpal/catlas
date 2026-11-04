import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import * as maplibre from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { intensityColor, type CapturedEvidence, type Earthquake, type ExposureRow } from '../exposure/model';
import { contextMapStyle, renderedGeography, setGeographyTheme, setGeographyVisibility } from './geography';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Treaty } from '../recovery/parametric/types';
import { useExposureMap } from '../exposure/useExposureMap';
import { useRecoveryMap } from '../recovery/useRecoveryMap';
import { useMonitorMap, type MonitorMapProps } from '../monitor/map';
import { LayerToggle } from '../monitor/LayerToggle';
import { REPORTED_FIRE_COLOR, REPORTED_FIRE_PATH, REPORTED_FIRE_INNER_PATH } from '../monitor/fire-icon';
import { FireMapCard, FirePerimeterLegend } from '../monitor/FireMapCard';
import { MonitorLayerControls } from '../monitor/MonitorLayerControls';
import type { MapPoint } from '../portfolios/geocoding';
maplibre.setWorkerUrl(workerUrl);

export function WorkbenchMap({ evidence, event, rows, selected, onSelect, focusRequest = 0, pulseRequest = 0, assessed = true, mode = 'exposure', recoveryAreas = [], selectedArea = '', onSelectArea, monitor, placement, controlsInSidebar=false, layersTarget }: { layersTarget?:HTMLElement|null; controlsInSidebar?:boolean; placement?: { point: MapPoint | null; enabled: boolean; onChange: (point: MapPoint) => void };  monitor?: MonitorMapProps; evidence: CapturedEvidence | null; event: Earthquake | null; rows: ExposureRow[]; selected: string; onSelect: (id: string) => void; assessed?: boolean; focusRequest?: number; pulseRequest?: number; mode?: 'monitor'|'exposure'|'recovery'|'portfolio'; recoveryAreas?: Treaty['areas']; selectedArea?: string; onSelectArea?: (id:string)=>void }) {
  const element = useRef<HTMLDivElement>(null), mapRef = useRef<maplibre.Map | null>(null);
  const [ready,setReady] = useState(false), [error,setError] = useState(''), [show,setShow] = useState(true);
  const [showLocations,setShowLocations] = useState(true), [opacity,setOpacity] = useState(.75), [mapStyle,setMapStyle] = useState<'light'|'dark'>('light');
  const [terrain,setTerrain] = useState(false), [terrainStatus,setTerrainStatus] = useState('');
  const flatPitch = useRef(0);
  const [geography,setGeography] = useState({countries:true,states:true,labels:true});
  const [showZones,setShowZones]=useState(true),[globe,setGlobe]=useState(mode!=='portfolio');
  const [mapMenu,setMapMenu]=useState<'layers'|'appearance'|null>(null);
  const mapMenusRef=useRef<HTMLDivElement>(null);
  useEffect(()=>setMapMenu(null),[mode]);

  const placementRef=useRef(placement); placementRef.current=placement;
  // Renderers register once the same mounted map is ready. Location drawings precede Monitor drawings.
  const exposureError = useExposureMap(mapRef, ready, { evidence, rows, selected, onSelect,
    assessed: mode !== 'portfolio' && (mode !== 'exposure' || assessed),
    active: mode === 'exposure' || mode === 'portfolio',
    showLocations, showShaking: show && mode === 'exposure', opacity, pulseRequest,
    placementEnabled: placement?.enabled ?? false });
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
      });
      map.on('click',e=>{if(placementRef.current?.enabled){const point=e.lngLat.wrap();placementRef.current.onChange({longitude:point.lng,latitude:point.lat});}});
      map.once('load', () => {
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

  useRecoveryMap(mapRef, ready, { areas: recoveryAreas, event, active: mode === 'recovery', showZones, selectedArea, onSelectArea });
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
  const selectedLocation = rows.find(row => row.id === selected);
  useEffect(()=>{const row=rows.find(r=>r.id===selected);if(ready&&row&&focusRequest>0)mapRef.current?.easeTo({center:[row.longitude,row.latitude],duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:350});},[ready,focusRequest]);
  useEffect(()=>{
    const map=mapRef.current;
    if(!ready||!map||(mode!=='exposure'&&mode!=='portfolio')||!selectedLocation||pulseRequest===0)return;
    const point:[number,number]=[selectedLocation.longitude,selectedLocation.latitude];
    if(!map.getBounds().contains(point))map.easeTo({center:point,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:350});
  },[ready,pulseRequest,mode]);
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
    <div ref={mapMenusRef} className="exposure-map-menus" aria-label="Map controls">
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
    {mode==='exposure'&&<button className="exposure-fit-results" disabled={!rows.length||!ready} onClick={fitLocations}>Fit results</button>}
    </div>
    {placement?.enabled&&<button className="portfolio-map-center" onClick={()=>{const point=mapRef.current?.getCenter().wrap();if(point)placement.onChange({longitude:point.lng,latitude:point.lat});}}>Use map center</button>}
    <div ref={element} className="exposure-map" data-testid="exposure-map" data-ready={ready} aria-label={mode==='monitor'?'Interactive hazard map; items also available in Monitor details':'Interactive portfolio map; locations also available in the keyboard-accessible table'}/>
    {mode==='monitor'&&monitor&&fireCardTarget&&monitor.selectedItem&&createPortal(<FireMapCard item={monitor.selectedItem} state={monitor.state}/>,fireCardTarget)}
    {terrainStatus&&<div className="terrain-map-status" role="status">{terrainStatus}</div>}
    {(error||exposureError)&&<p role="status" className="exposure-warning">{error||exposureError}</p>}
    {mode==='monitor'&&<div className="monitor-map-status" role="status">{monitor?.state.vessels.demo?'DEMO FLEET · Fictional positions and trails · Not live AIS':!monitor?.state.online?'Offline · observations may be stale':monitor.state.prefs.wind?windStatus:'Latest source reports · see Feeds for freshness'}</div>}
    {(mode!=='monitor'||monitor?.state.prefs.locations||monitor?.state.prefs.earthquakes||monitor?.state.prefs.cyclones||monitor?.state.prefs.vessels||monitor?.state.prefs.fires||monitor?.state.prefs.perimeters||monitor?.state.prefs.alerts)&&<div className="exposure-legend" aria-label="Map legend">
      {mode==='monitor'?<>
        {monitor?.state.prefs.locations&&<span><i style={{background:'#287d69'}}/>Insured locations</span>}
        {monitor?.state.prefs.earthquakes&&<span><i style={{background:'#bc7545'}}/>Earthquakes</span>}
        {monitor?.state.prefs.vessels&&<>{(monitor.state.vessels.scope==='all'?[true,false]:[true]).map(inPortfolio=><span key={String(inPortfolio)}><svg width="12" height="16" viewBox="0 0 24 32" aria-hidden="true"><path d="M12 2 20 12 18 29H6L4 12Z" fill={inPortfolio?'#287d69':'#2674bb'}/><path d="M8 16h8v4H8z" fill="white"/></svg>{inPortfolio?'Portfolio vessels':'Other vessels'}</span>)}</>}
        {monitor?.state.prefs.fires&&<span><i style={{background:'#d35827'}}/>Fire detections</span>}
        {monitor?.state.prefs.perimeters&&monitor.items.some(item=>item.perimeter?.evidence==='reported-incident')&&<span title="Reported fire location; no boundary supplied"><svg width="12" height="16" viewBox="0 0 24 32" aria-hidden="true"><path d={REPORTED_FIRE_PATH} fill={REPORTED_FIRE_COLOR}/><path d={REPORTED_FIRE_INNER_PATH} fill="#fff1d0"/></svg>Reported fires</span>}
        {monitor?.state.prefs.perimeters&&<FirePerimeterLegend/>}
        {monitor?.state.prefs.alerts&&<span><i style={{background:'#b59424'}}/>Weather warnings</span>}
        {monitor?.state.prefs.cyclones&&<span><i style={{background:'#7858a1'}}/>Cyclones</span>}
      </>:mode==='recovery'?<span>◆ Fixed references · 25 km inner / 100 km outer bands</span>:mode==='portfolio'||mode==='exposure'&&!assessed?<span>● Insured locations · Not assessed</span>:[3,4,5,6,7,null].map((value,i)=><span key={i}><i style={{background:intensityColor(value)}}/>{['<4','4–<5','5–<6','6–<7','7+','Unknown'][i]}</span>)}
    </div>}

    <p className="exposure-map-note">{mode==='monitor'?'USGS · NOAA · NASA FIRMS · NIFC · NRCan CWFIS · ECCC. Portfolio attention only; no damage or loss assessment.':mode==='portfolio'||mode==='exposure'&&!assessed?'Insured location inventory · Not assessed.':mode==='exposure'?'USGS shaking evidence · Shaking estimates do not establish property damage.':'Contractual fixed-reference distance bands · Not shaking contours or damage radii.'} Natural Earth geographic context.</p>
  </section>;
}
