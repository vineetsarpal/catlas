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
      <h3 id="monitor-event-heading" className="exposure-eyebrow">HAZARDS</h3>
      {layers.map(({key,label,detail})=><section key={key} className="monitor-map-layer" aria-label={`${label} display`}>
        <LayerToggle label={label} checked={state.prefs[key]} onChange={checked=>state.setPrefs({[key]:checked})}/>
        {state.prefs[key]&&<p className="monitor-layer-details">{detail}</p>}
      </section>)}
      <section className="monitor-map-layer monitor-fire-group" aria-labelledby="monitor-fires-heading">
        <h4 id="monitor-fires-heading">Fires</h4>
        <p className="monitor-layer-details">Fire feeds: US & Canada</p>
        {!backendEnabled&&<p role="status">Fire feeds require the Catlas backend.</p>}
        {([
          {key:'perimeters',label:'Fire perimeters',detail:'NIFC WFIGS (US) · CWFIS (Canada). Includes Canadian reported fire locations and satellite-estimated areas with activity in the past seven days. Estimates are distinct from published incident boundaries.'},
          {key:'fires',label:'Fire detections',detail:'NASA FIRMS (US region) · CWFIS (Canada) · past 24 hours. Satellite hotspots can indicate fire activity; they are not incident boundaries.'},
        ] as const).map(({key,label,detail})=><div className="monitor-hazard-control" key={key}>
          <LayerToggle label={label} checked={backendEnabled&&state.prefs[key]} disabled={!backendEnabled} onChange={checked=>state.setPrefs({[key]:checked})}/>
          {state.prefs[key]&&<p className="monitor-layer-details">{detail}</p>}
        </div>)}
        {backendEnabled&&(state.prefs.fires||state.prefs.perimeters)&&<label className="monitor-fire-distance"><span>Flag locations within</span><span><input aria-label="Fire activity distance (km)" type="number" min="0" max="100" step="1" value={state.prefs.fireDistanceKm} onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value))state.setPrefs({fireDistanceKm:Math.max(0,Math.min(100,value))});}}/> km of fire activity</span></label>}
      </section>
    </section>
    <section className="monitor-layer-group" aria-labelledby="monitor-weather-heading">
      <h3 id="monitor-weather-heading" className="exposure-eyebrow">WEATHER</h3>
      <section className="monitor-map-layer" aria-label="Weather warnings display">
        <p className="monitor-layer-details">Weather alerts: US & Canada</p>
        {!backendEnabled&&<p role="status">Weather warning feeds require the Catlas backend.</p>}
        <div className="monitor-hazard-control">
          <LayerToggle label="Weather warnings" checked={backendEnabled&&state.prefs.alerts} disabled={!backendEnabled} onChange={alerts=>state.setPrefs({alerts})}/>
          {state.prefs.alerts&&<p className="monitor-layer-details">NWS (US) · ECCC (Canada). Official alert areas, including watches, warnings and advisories.</p>}
        </div>
      </section>
      <WindControls state={state}/>
    </section>
  </div>;
}
