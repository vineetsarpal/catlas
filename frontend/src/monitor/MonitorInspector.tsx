import { useEffect, useState } from 'react';
import type { Earthquake, Portfolio } from '../exposure/model';
import type { MonitorItem } from './model';
import type { MonitorState } from './useMonitor';
import { fireEvidenceLabel } from './fire-display';
import { HazardEvidenceDetails } from './HazardDetails';
import { isMonitorItemWatched } from './model';

type Props = { state: MonitorState; items: MonitorItem[]; portfolio: Portfolio; busy: boolean; onCapture: (event: Earthquake) => void };
export function MonitorInspector(props: Props) {
  const selected = props.items.find(item => item.key === props.state.selected);
  return selected ? <SelectedItem key={selected.key} {...props} selected={selected}/> : null;
}
function SelectedItem({state,selected,portfolio,busy,onCapture}: Props & {selected: MonitorItem}) {
  const [collapsed,setCollapsed] = useState(false);
  const [locationLimit,setLocationLimit]=useState(20);
  const flaggedLocations=portfolio.locations.filter(site=>selected.relevance?.locationIds.includes(site.id));
  const location=selected.kind==='location'?portfolio.locations.find(site=>`location:${site.id}`===selected.key):undefined;
  const watched = isMonitorItemWatched(selected,state.prefs.watchlist);
  const alertSource=selected.alert?state.alerts.data?.sources?.find(source=>source.provider===(selected.alert?.provider??'NWS')):undefined;
  const fireSource=selected.perimeter?state.perimeters.data?.sources?.find(source=>source.provider===(selected.perimeter?.provider!=='CWFIS'?'NIFC':selected.perimeter.evidence==='reported-incident'?'CWFIS incidents':'CWFIS estimates')):selected.fire?state.fires.data?.sources?.find(source=>source.provider===(selected.fire?.provider==='CWFIS'?'CWFIS hotspots':'FIRMS')):undefined;
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) state.select('');
    };
    window.addEventListener('keydown',close);
    return () => window.removeEventListener('keydown',close);
  },[state.select]);
  return <aside className="monitor-inspector" aria-label="Selected monitoring item">
    <header className="monitor-inspector-heading">
      <div><p className="exposure-eyebrow">{selected.perimeter?fireEvidenceLabel(selected.perimeter).toUpperCase():selected.kind.toUpperCase()}</p><h2>{selected.name}</h2></div>
      <div className="monitor-inspector-controls">
        <button aria-label={collapsed?'Expand item details':'Collapse item details'} aria-expanded={!collapsed} aria-controls="monitor-inspector-body" onClick={()=>setCollapsed(value=>!value)}>{collapsed?'⌄':'−'}</button>
        <button aria-label="Close item details" onClick={()=>state.select('')}>×</button>
      </div>
    </header>
    <div id="monitor-inspector-body" className="monitor-inspector-body" hidden={collapsed}>
      {selected.hasPosition!==false&&<p className="monitor-inspector-coordinates">{selected.latitude.toFixed(3)}, {selected.longitude.toFixed(3)}</p>}
      <HazardEvidenceDetails item={selected} now={state.now}/>
      {fireSource&&(fireSource.stale||fireSource.warning)&&<p role="status" className="exposure-warning">{fireSource.provider} coverage is degraded. {fireSource.warning} See Feeds.</p>}
      {alertSource&&(alertSource.stale||alertSource.warning)&&<p role="status" className="exposure-warning">{alertSource.provider} coverage is degraded. {alertSource.warning} Retained evidence may be incomplete; see Feeds.</p>}
      {flaggedLocations.length>0&&<section aria-label="Flagged portfolio locations"><h3>Locations needing attention</h3><ul className="monitor-flagged-locations">{flaggedLocations.slice(0,locationLimit).map(site=><li key={site.id}><b>{site.name}</b><span>{site.value===null?'Insured value unknown':`${site.currency} ${site.value.toLocaleString()}`}</span></li>)}</ul>{flaggedLocations.length>locationLimit&&<button onClick={()=>setLocationLimit(value=>value+20)}>Show more locations ({flaggedLocations.length-locationLimit} remaining)</button>}</section>}
      {selected.earthquake&&<><p>Magnitude {selected.earthquake.magnitude??'unknown'} · {new Date(selected.earthquake.occurredAt).toLocaleString()}</p><p>Source revised {new Date(selected.earthquake.updatedAt).toLocaleString()}</p><button className="exposure-primary" disabled={busy||!state.online} onClick={()=>onCapture(selected.earthquake!)}>Inspect earthquake in Exposure →</button><p>Opens captured public evidence in Exposure. Assessment and saving require separate actions.</p></>}
      {selected.cyclone&&<><p>Advisory {selected.cyclone.advisory} · {selected.cyclone.advisoryLabel}</p><p>Reported maximum wind: {selected.cyclone.windKt??'unknown'} kt</p><p>GIS file updated {new Date(selected.cyclone.sourceUpdatedAt).toLocaleString()}{state.now-Date.parse(selected.cyclone.sourceUpdatedAt)>12*3600000?' · Stale advisory':''}</p><p>{selected.cyclone.track&&selected.cyclone.cone?'Track and cone match this advisory.':'Matching forecast geometry unavailable.'} Weather exposure assessment is not yet supported.</p><a href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">Official cyclone advisories ↗</a></>}
      {selected.vessel&&<><p>MMSI {selected.vessel.mmsi} · IMO {selected.vessel.imo||'unknown'} · {selected.inPortfolio?'In portfolio':'Context vessel'}</p><p>{state.vessels.demo?'DEMO · Fictional position created ':'Position reported '}{new Date(selected.vessel.reportedAt).toLocaleString()}{!state.vessels.demo&&state.now-Date.parse(selected.vessel.reportedAt)>5*60000?' · Stale position':''}</p><p>Speed {selected.vessel.speed??'unknown'} kt · Course {selected.vessel.course??'unknown'}°</p><p>{state.vessels.demo?'Simulated vessel, identifiers, position and trail. No live AIS or policy coverage is represented.':'AIS observations do not establish policy coverage or hazard exposure.'}</p></>}
      {selected.vessel&&!state.vessels.demo&&<><button className={selected.inPortfolio?'':'exposure-primary'} disabled={!selected.inPortfolio&&state.vessels.portfolio.length>=200} onClick={()=>state.vessels.togglePortfolio(selected.vessel!)}>{selected.inPortfolio?'Remove from vessel watch portfolio':'Add to vessel watch portfolio'}</button>{!selected.inPortfolio&&state.vessels.portfolio.length>=200&&<p>Vessel watch portfolio limit: 200.</p>}</>}
      {selected.kind==='location'&&<><p>Portfolio location as of {portfolio.asOf}. No hazard intensity has been assessed in Monitor.</p>{location&&<dl className="monitor-location-facts"><dt>Location ID</dt><dd>{location.id}</dd><dt>Insured value</dt><dd>{location.value===null?'Unknown':`${location.currency} ${location.value.toLocaleString()}`}</dd><dt>Region</dt><dd>{location.region||'Not supplied'}</dd><dt>Business line</dt><dd>{location.businessLine||'Not supplied'}</dd></dl>}</>}
      <button disabled={!watched&&state.prefs.watchlist.length>=100} onClick={()=>state.toggleWatch(selected.key,selected.name)}>{watched?'Remove from watchlist':'Add to watchlist'}</button>{state.prefs.watchlist.length>=100&&<p>Watchlist limit: 100 items.</p>}
    </div>
  </aside>;
}
