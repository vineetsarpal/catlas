import { backendEnabled, WIND_BACKEND_REQUIRED } from './backend';
import { useState, type ReactNode } from 'react';
import type { Portfolio } from '../exposure/model';
import { CYCLONE_COVERAGE, CYCLONE_SERVICE } from './feeds';
import type { MonitorState, Remote } from './useMonitor';
import { compareMonitorItems, isMonitorItemWatched, type MonitorItem } from './model';
import { fireEvidenceLabel, fireEvidenceTime, fireSourceLabel, fireTimeLabel } from './fire-display';
import { HazardRelevanceDetails } from './HazardDetails';
import { LIVE_FEED } from '../exposure/live';
import './monitor.css';

export function FeedStatus({label,feed,enabled,online,now,maxAge}:{label:string;feed:Remote<unknown>;enabled:boolean;online:boolean;now:number;maxAge:number}) {
  const sourceStale=Boolean(feed.data&&typeof feed.data==='object'&&'stale' in feed.data&&feed.data.stale);
  const sourceWarning=Boolean(feed.data&&typeof feed.data==='object'&&'warning' in feed.data&&feed.data.warning);
  const stale=Boolean(feed.checkedAt&&now-Date.parse(feed.checkedAt)>maxAge);
  return <div className="monitor-feed-status"><b>{label}</b><span>{!enabled?'Off':!online?'Offline · paused':feed.loading?'Checking…':feed.error?'Unavailable · previous data may be stale':sourceStale?'Source unavailable or stale · see details':sourceWarning?'Partial source coverage · see details':stale?'Stale · awaiting refresh':feed.checkedAt?'Latest check succeeded':'Waiting for first check'}</span>{feed.checkedAt&&<small>Checked {new Date(feed.checkedAt).toLocaleString()}</small>}{enabled&&feed.error&&<small className="exposure-warning">{feed.error}</small>}</div>;
}
export type MonitorPanelView='attention'|'portfolio'|'watchlist'|'layers'|'controls';
export function MonitorPanel({state,items,allItems,portfolio,onPortfolio,view,controls}:{state:MonitorState;items:MonitorItem[];allItems:MonitorItem[];portfolio:Portfolio;onPortfolio:()=>void;view?:MonitorPanelView;controls?:ReactNode}) {
  const [localTab,setTab]=useState<MonitorPanelView>('attention'),[query,setQuery]=useState('');
  const tab=view??localTab;
  const [hazardFilter,setHazardFilter]=useState('all');
  const [limit,setLimit]=useState(30);
  const locations=items.filter(item=>item.kind==='location'&&item.name.toLowerCase().includes(query.toLowerCase()));
  const hazards=items.filter(item=>item.kind!=='location'&&(hazardFilter==='all'||item.kind===hazardFilter)&&item.name.toLowerCase().includes(query.toLowerCase())).sort(compareMonitorItems);
  return <section className="monitor-panel" aria-label="Live monitoring controls">
    {!view&&<div className="monitor-tabs" role="group" aria-label="Monitor panels">{(['attention','portfolio','watchlist','layers'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>{setTab(t);setQuery('');setLimit(30);}}>{{attention:'Attention',portfolio:'Locations',watchlist:'Watchlist',layers:'Feeds'}[t]}</button>)}</div>}
    {state.storageError&&<p role="status" className="exposure-warning">{state.storageError}</p>}
    {tab==='controls'?<div className="monitor-section">{controls}</div>:tab==='layers'?<div className="monitor-section"><p className="exposure-eyebrow">FEED STATUS & SOURCES</p><h2>Latest available evidence</h2>
      <p>Feeds refresh while Monitor is visible and online. Publication and source updates may lag events.</p>
      <button disabled={!state.online} onClick={state.refresh}>Refresh enabled feeds</button>
      <FeedStatus label="USGS earthquakes" feed={state.earthquakes} enabled={state.prefs.earthquakes} online={state.online} now={state.now} maxAge={120000}/>
      {!!state.earthquakes.data?.rejected&&<p>{state.earthquakes.data.rejected} unsupported earthquake records omitted.</p>}
      <FeedStatus label="NOAA NHC / CPHC" feed={state.cyclones} enabled={state.prefs.cyclones} online={state.online} now={state.now} maxAge={600000}/>
      <p>{CYCLONE_COVERAGE}. A forecast cone describes center-track uncertainty, not the extent of damaging winds.</p>
      {!backendEnabled?<p role="status">Fire and weather warning feeds require the Catlas backend.</p>:<>
        <FeedStatus label="FIRMS / CWFIS fire detections" feed={state.fires} enabled={state.prefs.fires} online={state.online} now={state.now} maxAge={35*60000}/>
        <FeedStatus label="NIFC / CWFIS fire incidents and perimeters" feed={state.perimeters} enabled={state.prefs.perimeters} online={state.online} now={state.now} maxAge={10*60000}/>
        <FeedStatus label="NWS / ECCC weather alerts" feed={state.alerts} enabled={state.prefs.alerts} online={state.online} now={state.now} maxAge={2*60000}/>
      </>}
      {([['fires','Fire detections'],['perimeters','Fire incidents / perimeters'],['alerts','Weather alerts']] as const).map(([key,label])=>state.prefs[key]&&state[key].data&&<div key={key}>
        {state[key].data!.stale&&<p role="status" className="exposure-warning">{label}: retained source data is stale.</p>}
        {state[key].data!.warning&&<p role="status" className="exposure-warning">{label}: {state[key].data!.warning}</p>}
        {state[key].data!.rejected>0&&<p>{label}: {state[key].data!.rejected} unsupported records omitted.</p>}
        {!state[key].data?.sources?.length&&<p>{label} source acquired {new Date(state[key].data!.fetchedAt).toLocaleString()}</p>}
      </div>)}
      {(['fires','perimeters'] as const).flatMap(key=>state.prefs[key]?state[key].data?.sources?.map(source=><div className="monitor-feed-status" key={source.provider}>
        <b>{source.provider}</b><span>{source.stale?'Unavailable or stale · retained evidence may be incomplete':source.warning?'Partial source coverage':'Latest source acquisition succeeded'}</span>
        <small>{source.available?`Source acquired ${new Date(source.fetchedAt).toLocaleString()}`:'No source evidence acquired'}</small>
        {source.warning&&<small>{source.warning}</small>}
      </div>)??[]:[])}
      {state.prefs.alerts&&state.alerts.data?.sources?.map(source=><div className="monitor-feed-status" key={source.provider}>
        <b>{source.provider==='ECCC'?'ECCC · Canada':'NWS · United States'}</b>
        <span>{source.stale?'Unavailable or stale · retained evidence may be incomplete':source.warning?'Partial source coverage':'Latest source acquisition succeeded'}</span>
        <small>{source.available===false?'No source evidence acquired':`Source acquired ${new Date(source.fetchedAt).toLocaleString()}`}</small>
        {source.warning&&<small>{source.warning}</small>}
      </div>)}
      <p>FIRMS detections cover the US region, including Alaska and Hawaii, and may include neighboring areas. CWFIS adds Canadian hotspots, reported incident points and estimated burned areas. These can overlap and are not summed as distinct incidents or loss. Weather alerts cover US NWS and Canadian ECCC published areas. Fire perimeter and warning coverage is incomplete; an empty feed does not establish an absence of hazards.</p>
      <p>Map layers and their display controls are in the map’s <b>Layers</b> menu.</p>
      {!backendEnabled?<p role="status">{WIND_BACKEND_REQUIRED}</p>:<FeedStatus label="NOAA GFS forecast" feed={state.wind} enabled={state.prefs.wind} online={state.online} now={state.now} maxAge={3600000}/>}
      <p>Streamlines follow a 1° global forecast grid. Motion is accelerated for readability and does not advance forecast time. Pause motion to inspect static streamlines.</p>
      <p><a href={LIVE_FEED} target="_blank" rel="noreferrer">USGS source ↗</a> · <a href={CYCLONE_SERVICE} target="_blank" rel="noreferrer">NOAA source ↗</a> · <a href="https://www.nco.ncep.noaa.gov/pmb/products/gfs/" target="_blank" rel="noreferrer">GFS source ↗</a></p>
      <p>Data courtesy of NOAA/NCEP. {backendEnabled?'Wind decoding runs on the local backend.':WIND_BACKEND_REQUIRED} No endorsement implied.</p>
      <a href="./monitor-sources.md" target="_blank" rel="noreferrer">Integration provenance & notices ↗</a>
    </div>:<>
      <div className="monitor-section"><p className="exposure-eyebrow">{tab==='watchlist'?'SAVED IN THIS BROWSER':'WHERE TO LOOK'}</p><h2>{tab==='watchlist'?'Your watchlist':tab==='portfolio'?'Portfolio locations':'Portfolio attention'}</h2>
        <label className="monitor-check"><input type="checkbox" checked={state.prefs.nearPortfolio} onChange={e=>state.setPrefs({nearPortfolio:e.target.checked})}/> Events relevant to portfolio locations</label>
        <label className="monitor-check"><input type="checkbox" checked={state.prefs.watchedOnly} onChange={e=>state.setPrefs({watchedOnly:e.target.checked})}/> Show watched items only on map</label>
        <p>Earthquakes and cyclones use 250 km point proximity. Fires use the selected {state.prefs.fireDistanceKm} km distance; warnings use published areas; fire incidents use reported points or supplied boundaries, including labelled estimates. These are attention flags, not damage assessments.</p>
        <p>{portfolio.locations.length} locations · {portfolio.synthetic?'Synthetic portfolio · ':''}as of {portfolio.asOf}. <button onClick={onPortfolio}>Manage portfolio</button></p>
        {!state.online&&<p role="status" className="exposure-warning">Offline. Monitoring is paused; retained observations may be stale.</p>}
        {((state.prefs.earthquakes&&state.earthquakes.error)||(state.prefs.cyclones&&state.cyclones.error)||(state.prefs.fires&&(state.fires.error||state.fires.data?.stale||state.fires.data?.warning))||(state.prefs.perimeters&&(state.perimeters.error||state.perimeters.data?.stale||state.perimeters.data?.warning))||(state.prefs.alerts&&(state.alerts.error||state.alerts.data?.stale||state.alerts.data?.warning)))&&<p role="status" className="exposure-warning">Some feeds are unavailable. Check Feeds for details; retained results may be stale.</p>}
        {state.prefs.cyclones&&state.cyclones.data?.warning&&<p role="status">{state.cyclones.data.warning}</p>}
      </div>
      {tab==='watchlist'?<div className="monitor-event-list">{!state.prefs.watchlist.length&&<p className="monitor-section">Select an event or location, then add it to your watchlist.</p>}{state.prefs.watchlist.map(w=>{
        const item=allItems.find(item=>isMonitorItemWatched(item,[w]));
        return <article key={w.key}><button disabled={!item} onClick={()=>{state.setPrefs({nearPortfolio:false,watchedOnly:false});state.select(item!.key);}}>{w.name}</button><small>{item?'Available in enabled feeds / portfolio':'Ended, outside current feed or monitoring disabled · no current observation'}</small><button aria-label={`Remove ${w.name} from watchlist`} onClick={()=>state.toggleWatch(w.key,w.name)}>Remove</button></article>;
      })}</div>:<>{tab==='attention'&&<label className="monitor-search">Hazard filter<select aria-label="Hazard filter" value={hazardFilter} onChange={e=>{setHazardFilter(e.target.value);setLimit(30);}}><option value="all">All events</option><option value="earthquake">Earthquakes</option><option value="cyclone">Tropical cyclones</option><option value="perimeter">Fire incidents & areas</option><option value="fire">Fire detections</option><option value="alert">Weather warnings</option><option value="vessel">Vessels</option></select></label>}<label className="monitor-search">{tab==='portfolio'?'Find a location':'Find an event'}<input type="search" value={query} onChange={e=>{setQuery(e.target.value);setLimit(30);}} placeholder="Event name or place"/></label>
        <div className="monitor-event-list">{(tab==='portfolio'?locations:hazards).slice(0,limit).map(item=><article className={state.selected===item.key?'is-selected':''} key={item.key}><button onClick={()=>state.select(item.key)}>{item.earthquake?`M${item.earthquake.magnitude??'?'} · `:''}{item.name}</button><small>{item.kind==='location'?'Unassessed portfolio location':item.kind==='vessel'?`${state.vessels.demo?'Demo':'AIS'} · ${new Date(item.vessel!.reportedAt).toLocaleString()}${item.inPortfolio?' · In portfolio':''}`:item.kind==='earthquake'?new Date(item.earthquake!.occurredAt).toLocaleString():item.cyclone?`Advisory ${item.cyclone.advisory} · ${item.cyclone.advisoryLabel}`:item.alert?`${item.alert.provider??'NWS'} · ${item.alert.event} · expires ${new Date(item.alert.expiresAt).toLocaleString()}`:item.perimeter?`${fireSourceLabel(item.perimeter)} · ${fireEvidenceLabel(item.perimeter)} · ${fireTimeLabel(item.perimeter)} ${fireEvidenceTime(item.perimeter)?new Date(fireEvidenceTime(item.perimeter)!).toLocaleString():'at an unknown time'}`:'Satellite fire detections · past 24 hours'}</small><HazardRelevanceDetails item={item}/>{(item.kind==='earthquake'||item.kind==='cyclone')&&<span>{item.nearby} portfolio locations within 250 km</span>}</article>)}
        {!(tab==='portfolio'?locations:hazards).length&&<p className="monitor-section">{state.earthquakes.loading||state.cyclones.loading||state.fires.loading||state.perimeters.loading||state.alerts.loading?'Checking enabled feeds…':'No events match this view. Check feed status and filters; this does not establish an absence of hazards.'}</p>}
        {(tab==='portfolio'?locations:hazards).length>limit&&<button onClick={()=>setLimit(v=>v+30)}>Show more ({(tab==='portfolio'?locations:hazards).length-limit} remaining)</button>}</div></>}
    </>}

  </section>;
}
