import { backendEnabled, WIND_BACKEND_REQUIRED } from './backend';
import { LayerToggle } from './LayerToggle';
import type { MonitorState } from './useMonitor';

export function WindControls({state}:{state:MonitorState}) {
  return <section className="monitor-map-layer monitor-wind-controls" aria-label="Wind display">
    <LayerToggle label="Wind" disabled={!backendEnabled} checked={backendEnabled&&state.prefs.wind} onChange={checked=>state.setPrefs({wind:checked})}/>
    {!backendEnabled&&<p role="status">{WIND_BACKEND_REQUIRED}</p>}
    {backendEnabled&&state.prefs.wind&&<div className="monitor-wind-options">
      <p>NOAA GFS · 10 m surface wind forecast.</p>
      {state.wind.error&&<p role="status" className="exposure-warning">Wind unavailable: {state.wind.error}</p>}
      <button disabled={!state.online||state.wind.loading} onClick={state.refresh}>Retry wind forecasts</button>
      <label><input type="checkbox" checked={state.prefs.windPaused} onChange={e=>state.setPrefs({windPaused:e.target.checked})}/> Pause wind motion</label>
      <label><input type="checkbox" checked={state.prefs.windShading} onChange={e=>state.setPrefs({windShading:e.target.checked})}/> Show wind speed shading</label>
      {state.wind.data&&<>
        <label className="monitor-wind-time">Wind forecast valid time<select aria-label="Wind forecast valid time" value={state.validTime} onChange={e=>state.setForecastTime(e.target.value)}>{state.wind.data.times.map(t=><option key={t} value={t}>{new Date(t).toLocaleString()}</option>)}</select></label>
        <p>NOAA GFS model run {new Date(state.wind.data.runAt).toLocaleString()}{state.now-Date.parse(state.wind.data.runAt)>24*3600000?' · Old model run':''}</p>
        {state.prefs.windShading&&<div className="monitor-wind-scale"><span>Wind speed · knots</span><i/><span>0 · 15 · 30 · 45 · 60+</span></div>}
      </>}
      <p>Animation holds the selected forecast time fixed. Reduced-motion preferences pause flow automatically.</p>
    </div>}
  </section>;
}
