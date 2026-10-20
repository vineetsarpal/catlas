import { useEffect, useRef, useState } from 'react';
import type { Earthquake, Portfolio } from '../exposure/model';
import { CYCLONE_COVERAGE, CYCLONE_SERVICE } from './feeds';
import type { MonitorState, Remote } from './useMonitor';
import type { MonitorItem } from './model';
import { LIVE_FEED } from '../exposure/live';
import './monitor.css';

export function FeedStatus({label,feed,enabled,online,now,maxAge}:{label:string;feed:Remote<unknown>;enabled:boolean;online:boolean;now:number;maxAge:number}) {
  const stale=Boolean(feed.checkedAt&&now-Date.parse(feed.checkedAt)>maxAge);
  return <div className="monitor-feed-status"><b>{label}</b><span>{!enabled?'Off':!online?'Offline · paused':feed.loading?'Checking…':feed.error?'Unavailable · previous data may be stale':stale?'Stale · awaiting refresh':feed.checkedAt?'Latest check succeeded':'Waiting for first check'}</span>{feed.checkedAt&&<small>Checked {new Date(feed.checkedAt).toLocaleString()}</small>}{enabled&&feed.error&&<small className="exposure-warning">{feed.error}</small>}</div>;
}
export function MonitorPanel({state,items,allItems,portfolio,busy,onCapture,onPortfolio}:{state:MonitorState;items:MonitorItem[];allItems:MonitorItem[];portfolio:Portfolio;busy:boolean;onCapture:(event:Earthquake)=>void;onPortfolio:()=>void}) {
  const [tab,setTab]=useState<'attention'|'portfolio'|'watchlist'|'layers'>('attention'),[query,setQuery]=useState('');
  const [limit,setLimit]=useState(30);
  const selectionRef=useRef<HTMLElement>(null);
  useEffect(()=>{selectionRef.current?.closest('.atlas-panel-scroll')?.scrollTo({top:0});},[state.selected,tab]);
  const selected=items.find(item=>item.key===state.selected);
  const watched=Boolean(selected&&state.prefs.watchlist.some(w=>w.key===selected.key));
  const locations=items.filter(item=>item.kind==='location'&&item.name.toLowerCase().includes(query.toLowerCase()));
  const hazards=items.filter(item=>item.kind!=='location'&&item.name.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.nearby-a.nearby||(b.earthquake?.occurredAt??'').localeCompare(a.earthquake?.occurredAt??''));
  return <section className="monitor-panel" aria-label="Live monitoring controls">
    <div className="monitor-tabs" role="group" aria-label="Monitor panels">{(['attention','portfolio','watchlist','layers'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>{setTab(t);setQuery('');setLimit(30);}}>{{attention:'Attention',portfolio:'Locations',watchlist:'Watchlist',layers:'Feeds'}[t]}</button>)}</div>
    {state.storageError&&<p role="status" className="exposure-warning">{state.storageError}</p>}
    {selected&&<section ref={selectionRef} className="monitor-selection" aria-label="Selected monitoring item"><button className="monitor-close-selection" onClick={()=>state.select('')}>Close item details</button><p className="exposure-eyebrow">{selected.kind.toUpperCase()}</p><h2>{selected.name}</h2><p>{selected.latitude.toFixed(3)}, {selected.longitude.toFixed(3)}</p>
      {selected.earthquake&&<><p>M{selected.earthquake.magnitude??'unknown'} · {new Date(selected.earthquake.occurredAt).toLocaleString()}</p><p>Source revised {new Date(selected.earthquake.updatedAt).toLocaleString()}</p><button className="exposure-primary" disabled={busy||!state.online} onClick={()=>onCapture(selected.earthquake!)}>Capture evidence & investigate exposure →</button><p>Captures current USGS details and supported ShakeMap. Your existing investigation remains unchanged until capture succeeds.</p></>}
      {selected.cyclone&&<><p>Advisory {selected.cyclone.advisory} · {selected.cyclone.advisoryLabel}</p><p>Reported maximum wind: {selected.cyclone.windKt??'unknown'} kt</p><p>GIS file updated {new Date(selected.cyclone.sourceUpdatedAt).toLocaleString()}{state.now-Date.parse(selected.cyclone.sourceUpdatedAt)>12*3600000?' · Stale advisory':''}</p><p>{selected.cyclone.track&&selected.cyclone.cone?'Track and cone match this advisory.':'Matching forecast geometry unavailable.'} Weather exposure assessment is not yet supported.</p><a href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">Official cyclone advisories ↗</a></>}
      {selected.kind==='location'&&<p>Portfolio location as of {portfolio.asOf}. No hazard intensity has been assessed in Monitor.</p>}
      <button disabled={!watched&&state.prefs.watchlist.length>=100} onClick={()=>state.toggleWatch(selected.key,selected.name)}>{watched?'Remove from watchlist':'Add to watchlist'}</button>{state.prefs.watchlist.length>=100&&<p>Watchlist limit: 100 items.</p>}
    </section>}
    {tab==='layers'?<div className="monitor-section"><p className="exposure-eyebrow">FEED STATUS & SOURCES</p><h2>Latest available evidence</h2>
      <p>Feeds refresh while Monitor is visible and online. Publication and source updates may lag events.</p>
      <button disabled={!state.online} onClick={state.refresh}>Refresh enabled feeds</button>
      <FeedStatus label="USGS earthquakes" feed={state.earthquakes} enabled={state.prefs.earthquakes} online={state.online} now={state.now} maxAge={120000}/>
      {!!state.earthquakes.data?.rejected&&<p>{state.earthquakes.data.rejected} unsupported earthquake records omitted.</p>}
      <FeedStatus label="NOAA NHC / CPHC" feed={state.cyclones} enabled={state.prefs.cyclones} online={state.online} now={state.now} maxAge={600000}/>
      <p>{CYCLONE_COVERAGE}. A forecast cone describes center-track uncertainty, not the extent of damaging winds.</p>
      <p>Map layers and their display controls are in the map’s <b>Layers</b> menu.</p>
      <FeedStatus label="NOAA GFS forecast" feed={state.wind} enabled={state.prefs.wind} online={state.online} now={state.now} maxAge={3600000}/>
      <p>Streamlines follow a 1° global forecast grid. Motion is accelerated for readability and does not advance forecast time. Pause motion to inspect static streamlines.</p>
      <p><a href={LIVE_FEED} target="_blank" rel="noreferrer">USGS source ↗</a> · <a href={CYCLONE_SERVICE} target="_blank" rel="noreferrer">NOAA source ↗</a> · <a href="https://www.nco.ncep.noaa.gov/pmb/products/gfs/" target="_blank" rel="noreferrer">GFS source ↗</a></p>
      <p>Data courtesy of NOAA/NCEP. The first wind load downloads a decoder of about 6.8 MB and can take a few seconds. No endorsement implied.</p>
      <a href="./monitor-sources.md" target="_blank" rel="noreferrer">Integration provenance & notices ↗</a>
    </div>:<>
      <div className="monitor-section"><p className="exposure-eyebrow">{tab==='watchlist'?'SAVED IN THIS BROWSER':'WHERE TO LOOK'}</p><h2>{tab==='watchlist'?'Your watchlist':tab==='portfolio'?'Portfolio locations':'Portfolio attention'}</h2>
        <label className="monitor-check"><input type="checkbox" checked={state.prefs.nearPortfolio} onChange={e=>state.setPrefs({nearPortfolio:e.target.checked})}/> Events within 250 km of portfolio locations</label>
        <label className="monitor-check"><input type="checkbox" checked={state.prefs.watchedOnly} onChange={e=>state.setPrefs({watchedOnly:e.target.checked})}/> Show watched items only on map</label>
        <p>Nearby counts use distance to reported event positions. They do not screen hazard footprints or establish affected exposure.</p>
        <p>{portfolio.locations.length} locations · {portfolio.synthetic?'Synthetic portfolio · ':''}as of {portfolio.asOf}. <button onClick={onPortfolio}>Manage portfolio</button></p>
        {!state.online&&<p role="status" className="exposure-warning">Offline. Monitoring is paused; retained observations may be stale.</p>}
        {(state.earthquakes.error||state.cyclones.error)&&<p role="status" className="exposure-warning">Some feeds are unavailable. Check Feeds for details; retained results may be stale.</p>}
        {state.prefs.cyclones&&state.cyclones.data?.warning&&<p role="status">{state.cyclones.data.warning}</p>}
      </div>
      {tab==='watchlist'?<div className="monitor-event-list">{!state.prefs.watchlist.length&&<p className="monitor-section">Select an event or location, then add it to your watchlist.</p>}{state.prefs.watchlist.map(w=>{
        const item=allItems.find(item=>item.key===w.key);
        return <article key={w.key}><button disabled={!item} onClick={()=>{state.setPrefs({nearPortfolio:false,watchedOnly:false});state.select(w.key);}}>{w.name}</button><small>{item?'Available in enabled feeds / portfolio':'Outside current feed or layer disabled · no current observation'}</small><button aria-label={`Remove ${w.name} from watchlist`} onClick={()=>state.toggleWatch(w.key,w.name)}>Remove</button></article>;
      })}</div>:<><label className="monitor-search">{tab==='portfolio'?'Find a location':'Find an event'}<input type="search" value={query} onChange={e=>{setQuery(e.target.value);setLimit(30);}} placeholder="Event name or place"/></label>
        <div className="monitor-event-list">{(tab==='portfolio'?locations:hazards).slice(0,limit).map(item=><article className={state.selected===item.key?'is-selected':''} key={item.key}><button onClick={()=>state.select(item.key)}>{item.earthquake?`M${item.earthquake.magnitude??'?'} · `:''}{item.name}</button><small>{item.kind==='location'?'Unassessed portfolio location':item.kind==='earthquake'?new Date(item.earthquake!.occurredAt).toLocaleString():`Advisory ${item.cyclone!.advisory} · ${item.cyclone!.advisoryLabel}`}</small>{item.kind!=='location'&&<span>{item.nearby} portfolio locations within 250 km</span>}</article>)}
        {!(tab==='portfolio'?locations:hazards).length&&<p className="monitor-section">{state.earthquakes.loading||state.cyclones.loading?'Checking enabled feeds…':'No events match this view. Check feed status and filters; this does not establish an absence of hazards.'}</p>}
        {(tab==='portfolio'?locations:hazards).length>limit&&<button onClick={()=>setLimit(v=>v+30)}>Show more ({(tab==='portfolio'?locations:hazards).length-limit} remaining)</button>}</div></>}
    </>}

  </section>;
}
