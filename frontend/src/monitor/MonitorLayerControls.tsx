import { VesselControls } from './VesselControls';
import { CYCLONE_COVERAGE } from './feeds';
import { LayerToggle } from './LayerToggle';
import type { MonitorState } from './useMonitor';
import { WindControls } from './WindControls';

export function MonitorLayerControls({state,onFitPortfolio,canFitPortfolio}:{state:MonitorState;onFitPortfolio:()=>void;canFitPortfolio:boolean}) {
  const layers=[
    {key:'locations',label:'Insured locations',detail:'Locations from your current portfolio. Hazard intensity is unassessed in Monitor.'},
    {key:'earthquakes',label:'Earthquakes',detail:'USGS · past 24 hours. Markers show reported event positions and magnitudes.'},
    {key:'cyclones',label:'Tropical cyclones',detail:`NOAA NHC / CPHC · ${CYCLONE_COVERAGE}. Matching advisory tracks and uncertainty cones are shown when available. Cones do not show the extent of damaging winds.`},
  ] as const;
  return <div className="monitor-map-layer-controls" aria-label="Monitoring layers">
    {layers.map(({key,label,detail})=><section className="monitor-map-layer" key={key} aria-label={`${label} display`}>
      <LayerToggle label={label} checked={state.prefs[key]} onChange={checked=>state.setPrefs({[key]:checked})}/>
      {state.prefs[key]&&<>
        <p className="monitor-layer-details">{detail}</p>
        {key==='locations'&&<button className="monitor-layer-action" disabled={!canFitPortfolio} onClick={onFitPortfolio}>Fit portfolio</button>}
      </>}
    </section>)}
    <VesselControls state={state}/><WindControls state={state}/>
  </div>;
}
