import type { MonitorState } from './useMonitor';
import { LayerToggle } from './LayerToggle';
import './map-filters.css';

export function MapFilters({state}:{state:MonitorState}) {
  return <section className="monitor-map-filters" role="group" aria-label="Map filters">
    <p className="monitor-filter-intro">Choose which events to focus on.</p>
    <div className="monitor-map-filter-option">
      <LayerToggle label="Relevant to portfolio" checked={state.prefs.nearPortfolio} onChange={nearPortfolio=>state.setPrefs({nearPortfolio})}/>
      <p className="monitor-filter-scope">Filters map and Attention.</p>
    </div>
    <div className="monitor-map-filter-option">
      <LayerToggle label="Watchlist items" checked={state.prefs.watchedOnly} onChange={watchedOnly=>state.setPrefs({watchedOnly})}/>
      <p className="monitor-filter-scope">Filters map only.</p>
    </div>
    {(state.prefs.nearPortfolio||state.prefs.watchedOnly)&&<button className="monitor-clear-filters" onClick={()=>state.setPrefs({nearPortfolio:false,watchedOnly:false})}>Clear filters</button>}
    <details className="monitor-matching-help"><summary>How matching works</summary>
      <ul>
        <li>Earthquakes and cyclones: within 250 km of an insured location.</li>
        <li>Fire activity: within {state.prefs.fireDistanceKm} km. Change this distance under Layers → Fires.</li>
        <li>Warnings use published alert areas. Fires use reported points or supplied boundaries, including labelled estimates.</li>
        <li>Relevant to portfolio filters Attention and the map. Watchlist items filters only the map; Attention and Locations remain available.</li>
      </ul>
      <p>Matches flag locations for attention; they do not establish damage or loss.</p>
    </details>
  </section>;
}

export function MapFilterSummary({state}:{state:MonitorState}) {
  return <div className="monitor-filter-summary" aria-label="Shared view filters">
    <div><span>{state.prefs.nearPortfolio?'Portfolio matches':'All enabled events'}</span>{state.prefs.watchedOnly&&<span>Watchlist items on map</span>}</div>
  </div>;
}
