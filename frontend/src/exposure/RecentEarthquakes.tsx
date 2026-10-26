import { useEffect, useRef, useState } from 'react';
import { archiveEvidenceFailure, discoverRecentEarthquakes, type CatalogEvent, type CatalogPage, type CatalogSearch } from './catalogue';

function searchContext(search:CatalogSearch):string {
  return search.eventId?`Source ID ${search.eventId}`:search.mode?`${search.start?.slice(0,10)} to ${search.end?.slice(0,10)} UTC${search.minMagnitude?` · magnitude ≥${search.minMagnitude}`:''}${search.maxMagnitude?` · magnitude ≤${search.maxMagnitude}`:''}${search.minLatitude?` · area south ${search.minLatitude}, north ${search.maxLatitude}, west ${search.minLongitude}, east ${search.maxLongitude}`:' · global'}`:'Last 90 days';
}

function mergeEvents(previous: CatalogEvent[], incoming: CatalogEvent[]): CatalogEvent[] {
  const result = [...previous];
  for (const event of incoming) {
    let merged = event;
    const identities = new Set([event.id, ...event.aliases]);
    let index: number;
    while ((index = result.findIndex(item => [item.id, ...item.aliases].some(id => identities.has(id)))) >= 0) {
      const [old] = result.splice(index,1);
      for (const id of [old.id,...old.aliases]) identities.add(id);
      if (old.updatedAt > merged.updatedAt) merged = old;
    }
    result.push({...merged,aliases:[...identities]});
  }
  return result.sort((a,b) => b.occurredAt.localeCompare(a.occurredAt));
}
export function RecentEarthquakes({ selectedId, busy, onSelect }: { selectedId?: string; busy: boolean; onSelect:(event:CatalogEvent)=>void }) {
  const [significantOnly,setSignificantOnly] = useState(true);
  const [mode,setMode] = useState<'recent'|'historical'>('recent');
  const [snapshot,setSnapshot] = useState<CatalogPage|null>(null);
  const [loadedSearch,setLoadedSearch] = useState<CatalogSearch>({significantOnly:true});
  const [loading,setLoading] = useState(false), [failure,setFailure] = useState(''), [query,setQuery] = useState('');
  const [lastCheck,setLastCheck] = useState<{at:string;outcome:'succeeded'|'failed'}|null>(null);
  const [failedAttempt,setFailedAttempt] = useState<{search:CatalogSearch;offset:number}|null>(null);
  const [dates,setDates] = useState({start:'',end:''});
  const [filters,setFilters] = useState({minMagnitude:'',maxMagnitude:'',minLatitude:'',maxLatitude:'',minLongitude:'',maxLongitude:''});
  const [sourceId,setSourceId] = useState('');
  const request = useRef<AbortController|null>(null);
  async function refresh(search:CatalogSearch={significantOnly},offset=0) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const submittedSearch = {...search,...(offset&&snapshot&&!search.mode&&!search.end?{end:snapshot.range.end}:{})};
    setLoading(true);setFailure('');
    try {
      const page = await discoverRecentEarthquakes({...submittedSearch, offset, signal:controller.signal });
      if (!controller.signal.aborted) { setSnapshot(old=>{const rejected=page.rejected+(offset?old?.rejected??0:0);return {...page,events:mergeEvents(offset?old?.events??[]:[],page.events),rejected,completeness:rejected>0||(offset&&old?.completeness==='partial')?'partial':page.completeness};});setLoadedSearch(submittedSearch);setLastCheck({at:new Date().toISOString(),outcome:'succeeded'});setFailedAttempt(null); }
    } catch (error) {
      if (!controller.signal.aborted) {setFailure(`${snapshot?'Event discovery failed. Previous successful results are retained and may be stale. Retry explicitly.':'Event discovery failed. No successful catalog results are available. Retry explicitly.'} ${archiveEvidenceFailure(error).message}`);setLastCheck({at:new Date().toISOString(),outcome:'failed'});setFailedAttempt({search:submittedSearch,offset});}
    } finally { if (!controller.signal.aborted)setLoading(false); }
  }
  useEffect(()=>{void refresh({significantOnly});return()=>request.current?.abort();},[significantOnly]);
  const events = snapshot?.events.filter(event=>`${event.name} ${event.id}`.toLowerCase().includes(query.toLowerCase()))??[];
  function historicalSearch() {
    if(sourceId.trim()) { void refresh({mode:'historical',eventId:sourceId.trim()}); return; }
    const start=dates.start+'T00:00:00.000Z',end=dates.end+'T23:59:59.999Z';
    if(!dates.start||!dates.end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||start>end) {setFailure('Choose a valid start and end date in order. Dates use UTC.');return;}
    const area=[filters.minLatitude,filters.maxLatitude,filters.minLongitude,filters.maxLongitude];
    if(area.some(Boolean)&&!area.every(Boolean)){setFailure('Supply all four geographic area bounds, or leave all four empty for global discovery.');return;}
    void refresh({mode:'historical',significantOnly:false,start,end,...Object.fromEntries(Object.entries(filters).filter(([,value])=>value!==''))});
  }
  const context=searchContext(loadedSearch);
  return <section className="recent-earthquakes" aria-label="Recent earthquake catalog">
    <h2>{mode==='recent'?'Recent earthquakes':'Historical earthquakes'}</h2>
    <div className="catalog-search-modes"><button aria-pressed={mode==='recent'} onClick={()=>setMode('recent')}>Recent events</button><button aria-pressed={mode==='historical'} onClick={()=>setMode('historical')}>Historical search</button></div>
    <p>{mode==='recent'?'Last 90 days · newest first. ':''}Catalog discovery does not establish usable shaking evidence. Global event discovery does not promise complete global hazard coverage.</p>
    {mode==='recent'?<>
      <label><input type="checkbox" aria-label="Catlas significance >600" checked={significantOnly} disabled={loading} onChange={event=>setSignificantOnly(event.target.checked)}/> Catlas significance &gt;600</label>
      <p className="catalog-filter-explanation">A removable Catlas discovery filter, not an assessment of portfolio exposure.</p>
      <button disabled={loading} onClick={()=>void refresh()}>{loading?'Retrieving events…':'Refresh events'}</button>
    </>:<form className="catalog-historical-search" onSubmit={event=>{event.preventDefault();historicalSearch();}}>
      <p>Search source-supported dates without a Catlas starting-year cutoff. Newest first; significance is not required.</p>
      <label>Source event ID<input value={sourceId} pattern="[a-zA-Z0-9_-]{1,100}" maxLength={100} onChange={event=>setSourceId(event.target.value)} /></label>
      <p>A source ID lookup uses only that identity, independently of dates, area, magnitude and recent significance.</p>
      <fieldset disabled={!!sourceId.trim()}><legend>Or search by date, area and magnitude</legend>
        <label>Start date (UTC)<input type="date" value={dates.start} onChange={event=>setDates({...dates,start:event.target.value})}/></label>
        <label>End date (UTC)<input type="date" value={dates.end} onChange={event=>setDates({...dates,end:event.target.value})}/></label>
        {([['minMagnitude','Minimum magnitude'],['maxMagnitude','Maximum magnitude'],['minLatitude','South latitude'],['maxLatitude','North latitude'],['minLongitude','West longitude'],['maxLongitude','East longitude']] as const).map(([key,label])=><label key={key}>{label}<input type="number" step="any" value={filters[key]} onChange={event=>setFilters({...filters,[key]:event.target.value})}/></label>)}
        <p>Leave area bounds empty for global discovery. Supply all four for a bounding box. Longitude bounds may extend to ±360° to cross the date line; span must be at most 360°.</p>
      </fieldset>
      <button disabled={loading} type="submit">{loading?'Retrieving events…':'Search historical earthquakes'}</button>
    </form>}
    {snapshot&&mode==='recent'&&loadedSearch.mode&&<p className="catalog-query-notice">Showing the previous historical query. Refresh events to retrieve the recent window.</p>}
    {snapshot&&mode==='historical'&&!loadedSearch.mode&&<p className="catalog-query-notice">Showing the previous recent query. Submit a historical search to retrieve older events.</p>}
    {failure&&<p role="alert">{failure}</p>}
    {lastCheck&&<p>Last discovery check {lastCheck.outcome}: <time dateTime={lastCheck.at}>{new Date(lastCheck.at).toLocaleString()}</time>.</p>}
    {failedAttempt&&<><p>Failed query: {searchContext(failedAttempt.search)}{failedAttempt.search.significantOnly?' · significance >600':''} · source offset {failedAttempt.offset}. Retry repeats this submitted query.</p><button disabled={loading} onClick={()=>void refresh(failedAttempt.search,failedAttempt.offset)}>Retry event discovery</button></>}
    {snapshot&&<><p className="catalog-query-context">Retrieved query: {context}{loadedSearch.significantOnly?' · significance >600':''}. Paging continues this retrieved query; editing fields requires a new search.</p><p role="status">Last successful retrieval: <time dateTime={snapshot.checkedAt}>{new Date(snapshot.checkedAt).toLocaleString()}</time>. {snapshot.events.length} events retrieved{loadedSearch.significantOnly?' with significance >600':''}. {snapshot.completeness==='complete'?'All matching results for this requested query were retrieved.':snapshot.completeness==='partial'?'Partial coverage: a request or result bound was reached.':'More results are available.'}{snapshot.rejected>0?` ${snapshot.rejected} unsupported source entries omitted.`:''} At most 50 source records per page and 500 per query; narrow the search when capped. Catalog coverage is distinct from usable shaking evidence.</p></>}
    <label>Filter retrieved events<input type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <p>Text filters only retrieved names, place descriptions and source IDs; it does not search a global name index.</p>
    {!loading&&snapshot&&!events.length&&!failure&&<p>No matching events in the retrieved results.</p>}
    <ul className="catalog-event-list">{events.map(event=><li key={event.id}><button aria-pressed={selectedId===event.id||event.aliases.includes(selectedId??'')} disabled={busy} onClick={()=>onSelect(event)}><strong>{event.name}</strong><span>M{event.magnitude??'unknown'} · {new Date(event.occurredAt).toLocaleDateString()}</span><small>{event.id} · Evidence not yet inspected</small></button></li>)}</ul>
    {snapshot?.hasMore&&<button disabled={loading||(!loadedSearch.mode&&loadedSearch.significantOnly!==significantOnly)} onClick={()=>void refresh(loadedSearch,snapshot.offset+snapshot.limit)}>Load more earthquakes</button>}
  </section>;
}
