import { VesselControls } from './VesselControls';
import { CYCLONE_COVERAGE } from './feeds';
import { LayerToggle } from './LayerToggle';
import type { MonitorState } from './useMonitor';
import { WindControls } from './WindControls';
import { backendEnabled } from './backend';

export function MonitorLayerControls({state,onFitPortfolio,canFitPortfolio}:{state:MonitorState;onFitPortfolio:()=>void;canFitPortfolio:boolean}) {
  const layers=[
    {key:'earthquakes',label:'Earthquakes',detail:'USGS · past 24 hours. Markers show reported event positions and magnitudes.'},
    {key:'cyclones',label:'Tropical cyclones',detail:`NOAA NHC / CPHC · ${CYCLONE_COVERAGE}. Matching advisory tracks and uncertainty cones are shown when available. Cones do not show the extent of damaging winds.`},
  ] as const;
  return <div className="monitor-map-layer-controls" aria-label="Monitoring layers">
    <section className="monitor-layer-group" aria-labelledby="monitor-portfolio-heading">
      <h3 id="monitor-portfolio-heading" className="exposure-eyebrow">PORTFOLIO</h3>
      <section className="monitor-map-layer" aria-label="Insured locations display">
        <LayerToggle label="Insured locations" checked={state.prefs.locations} onChange={locations=>state.setPrefs({locations})}/>
        {state.prefs.locations&&<>
          <p className="monitor-layer-details">Locations from your current portfolio. Hazard intensity is unassessed in Monitor.</p>
          <button className="monitor-layer-action" disabled={!canFitPortfolio} onClick={onFitPortfolio}>Fit portfolio</button>
        </>}
      </section>
      <VesselControls state={state}/>
    </section>
    <section className="monitor-layer-group" aria-labelledby="monitor-event-heading">
      <h3 id="monitor-event-heading" className="exposure-eyebrow">HAZARDS & WEATHER</h3>
      {layers.map(({key,label,detail})=><section key={key} className="monitor-map-layer" aria-label={`${label} display`}>
        <LayerToggle label={label} checked={state.prefs[key]} onChange={checked=>state.setPrefs({[key]:checked})}/>
        {state.prefs[key]&&<p className="monitor-layer-details">{detail}</p>}
      </section>)}
      <WindControls state={state}/>
      <section className="monitor-map-layer" aria-label="Catastrophe feed controls">
        <p className="monitor-layer-details">US regional fire and weather feeds</p>
        {!backendEnabled&&<p role="status">Fire and weather warning feeds require the Catlas backend.</p>}
        {([
          {key:'alerts',show:'showAlerts',label:'Weather warnings',detail:'NWS · watches, warnings and advisories. Published polygons or official forecast zones.'},
          {key:'perimeters',show:'showPerimeters',label:'Fire perimeters',detail:'NIFC WFIGS · published incident boundaries. Source age is shown separately from feed checks.'},
          {key:'fires',show:'showFires',label:'Fire detections',detail:'NASA FIRMS · past 24 hours. Satellite hotspots can indicate fire activity; they are not incident boundaries.'},
        ] as const).map(({key,show,label,detail})=><div className="monitor-hazard-control" key={key}>
          <LayerToggle label={label} checked={backendEnabled&&state.prefs[key]} disabled={!backendEnabled} onChange={checked=>state.setPrefs({[key]:checked})}/>
          {state.prefs[key]&&<><p className="monitor-layer-details">{detail}</p><label className="monitor-check"><input type="checkbox" disabled={!backendEnabled} checked={state.prefs[show]} onChange={e=>state.setPrefs({[show]:e.target.checked})}/> Show {label.toLowerCase()} on map</label></>}
        </div>)}
        <label className="monitor-fire-distance">Fire proximity (km)<input aria-label="Fire proximity (km)" type="number" min="0" max="100" step="1" value={state.prefs.fireDistanceKm} onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value))state.setPrefs({fireDistanceKm:Math.max(0,Math.min(100,value))});}}/></label>
        <p className="monitor-layer-details">Map visibility does not change portfolio attention. Disabling monitoring stops that feed and removes its current attention items.</p>
      </section>
    </section>
  </div>;
}
