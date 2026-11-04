import type { ReactNode } from 'react';
import { LocationSearch } from '../components/LocationSearch';
import { FilteredLocationSummary, LocationPagination } from '../components/LocationTableControls';
import { LocationDetails } from '../components/LocationDetails';
import { TableSortHeader } from '../components/TableSortHeader';
import { useExposureTable } from '../exposure/ExposureTable';
import { downloadFile } from '../browser/download';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { workspaceModeFromUrl, type WorkspaceMode } from './navigation';
import { usePortfolios } from '../portfolios/usePortfolios';
import { emptyPortfolio } from '../portfolios/inventory';
import { PortfoliosWorkspace, type PortfolioLocationRequest } from '../portfolios/PortfoliosWorkspace';
import { useMonitor } from '../monitor/useMonitor';
import { monitorItems, visibleMonitorItems } from '../monitor/model';
import type { RecoveryContext } from '../recovery/RecoveryWorkbench';
import { useMonitorWorkspace } from '../monitor/useMonitorWorkspace';
import { useRecoveryWorkspace } from '../recovery/useRecoveryWorkspace';
import type { EventInput } from '../events/model';
import { contractSchema } from '../recovery/parametric/types';
import { mainContract } from '../recovery/data/fixtures';
import { earthquakeFromRecovery } from '../exposure/event-context';
import { sameRecoveryEvent } from '../events/model';
import { WorkbenchMap } from '../maps/WorkbenchMap';
import { RegionExposure } from '../exposure/RegionExposure';
import { filterExposure } from '../exposure/view';
import { SAMPLER_VERSION, intensityBand, intensityColor, type ExposureRow, type CapturedEvidence, type Earthquake } from '../exposure/model';
import { demoPortfolio } from '../exposure/fixtures';
import { InvestigationLifecycle } from '../exposure/lifecycle';
import { RecentEarthquakes } from '../exposure/RecentEarthquakes';
import { screenPortfolioRelevance } from '../exposure/relevance';
import { exposureCSV } from '../exposure/exports';
import '../workbench-theme.css';
import '../exposure/exposure.css';
import { WorkbenchLayout, type WorkspacePanel } from './WorkbenchLayout';
import './workbench.css';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const money = (amount: number, currency: string) => {
  try { return new Intl.NumberFormat('en-US',{style:'currency',currency,minimumFractionDigits:0,maximumFractionDigits:2}).format(amount); }
  catch { return `${currency} ${amount.toLocaleString('en-US')}`; }
};
const reasonText = { estimated:'Estimated shaking at this location from the captured evidence.', 'outside-grid':'Outside the captured grid. Intensity is unknown.', 'missing-samples':'The captured grid has missing readings here. Intensity is unknown.', 'evidence-unavailable':'Shaking evidence is unavailable. Intensity is unknown.' };

export function Workbench({ initialMode = 'exposure' }: { initialMode?: WorkspaceMode }) {
  const [mode,setMode] = useState<WorkspaceMode>(initialMode);
  const exposureVisited=useRef(initialMode==='exposure');
  const monitor=useMonitor(mode==='monitor');
  const [layersTarget,setLayersTarget]=useState<HTMLDivElement|null>(null);
  const [monitorFitRequest,setMonitorFitRequest]=useState(0);
  const [recoverySelectionRequest,setRecoverySelectionRequest]=useState(0);
  const [lifecycle] = useState(() => new InvestigationLifecycle());
  const investigation = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot);
  useEffect(() => lifecycle.connect(), [lifecycle]);
  const sharedEvent = investigation.observation;
  const changeSharedEvent = useCallback((event: EventInput | null) => lifecycle.selectObservation(event), [lifecycle]);
  const [recovery,setRecovery] = useState<RecoveryContext>({kind:new URLSearchParams(location.search).get('recovery')==='parametric'?'parametric':'simple',selectedArea:'mojave',selectArea:()=>{}});
  const updateRecovery = useCallback((context:RecoveryContext)=>setRecovery(context),[]);
  function changeMode(next:WorkspaceMode) { setMode(next);if(next==='exposure'&&!exposureVisited.current){exposureVisited.current=true;setWorkspacePanel('events');}else if(next!=='exposure'&&next!=='portfolios')setWorkspacePanel(null);const url=new URL(location.href);url.searchParams.set('mode',next);window.history.pushState(null,'',url); }
  useEffect(()=>{const update=()=>{setMode(workspaceModeFromUrl(new URL(location.href)));};window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update);},[]);
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel>(initialMode==='exposure'?'events':null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [pulseRequest, setPulseRequest] = useState(0);
  const inventories=usePortfolios();
  const activePortfolio=inventories.active?.data??emptyPortfolio;
  const [portfolioLocationRequest,setPortfolioLocationRequest] = useState<PortfolioLocationRequest|null>(null);
  const { history, inspectionActive, inspection, inspectionReason, inspectionTarget, inspectionCheck, sourceCheck, pendingUpdate } = investigation;
  const record = investigation.opened?.record ?? null;
  const evidence = investigation.opened?.evidence ?? null;
  const [uiBusy, setUiBusy] = useState(''), [uiError, setUiError] = useState('');
  const uiRunning = useRef(false);
  useEffect(() => { if (investigation.busy) setUiError(''); }, [investigation.busy]);
  const busy = investigation.busy || uiBusy, error = investigation.error || uiError, notice = investigation.notice;
  const [screeningThreshold,setScreeningThreshold] = useState(4);
  const [threshold,setThreshold] = useState(4), [selected,setSelected] = useState(''), [filter,setFilter] = useState('all'), [currency,setCurrency] = useState('all'), [page,setPage] = useState(0);
  const [insuredValue,setInsuredValue]=useState<'all'|'known'|'unknown'>('all');
  const [query,setQuery] = useState(''), [region,setRegion] = useState<string|null>(null), [businessLine,setBusinessLine] = useState<string|null>(null);
  const [eventId,setEventId] = useState('');
  const currentRecord = lifecycle.currentRecord();
  const validThreshold=Number.isFinite(threshold)&&threshold>=1&&threshold<=10;
  const matchingInspection = lifecycle.matchingInspection();
  const portfolio=currentRecord?.portfolio??activePortfolio;
  const sourcePortfolio=currentRecord?.portfolioReference?inventories.portfolios.find(item=>item.id===currentRecord.portfolioReference!.id):undefined;
  const portfolioChanged=Boolean(currentRecord&&sourcePortfolio&&(sourcePortfolio.revision!==currentRecord.portfolioReference?.revision||JSON.stringify(sourcePortfolio.data)!==JSON.stringify(currentRecord.portfolio)));
  const saved=Boolean(record&&history.some(item=>item.id===record.id));
  const inventoryRows=useMemo<ExposureRow[]>(()=>activePortfolio.locations.map(location=>({...location,mmi:null,reason:'evidence-unavailable'})),[activePortfolio]);
  const rows=currentRecord?.rows??inventoryRows;
  const ordered=useMemo(()=>filterExposure(rows,currentRecord?.settings.threshold??4,{status:filter,insuredValue,currency,query,region,businessLine}),[rows,currency,filter,insuredValue,query,region,businessLine,currentRecord?.settings.threshold]);
  const exposureTable=useExposureTable(ordered,page,setPage);
  const selectedRow=rows.find(row=>row.id===selected);
  const hasViewFilters=insuredValue!=='all'||filter!=='all'||currency!=='all'||query.trim()!==''||region!==null||businessLine!==null;
  function clearViewFilters(){setInsuredValue('all');setFilter('all');setCurrency('all');setQuery('');setRegion(null);setBusinessLine(null);setPage(0);}
  function resetInvestigationView(){clearViewFilters();exposureTable.table.resetSorting(true);}
  const browsingContext=currentRecord?.id??inventories.activeId;
  const previousBrowsingContext=useRef(browsingContext);
  useEffect(()=>{
    if(previousBrowsingContext.current===browsingContext)return;
    previousBrowsingContext.current=browsingContext;
    if(!currentRecord){setSelected('');resetInvestigationView();}
  },[browsingContext]);
  async function openWorkingPortfolio(locationId?:string){
    const destination=currentRecord?sourcePortfolio:inventories.active;
    if(!destination)return;
    await action('Opening working portfolio…',async()=>{
      await inventories.select(destination.id);
      setPortfolioLocationRequest({portfolioId:destination.id,locationId,nonce:Date.now()});
      changeMode('portfolios');
    });
  }
  const workingLocation=selectedRow&&(currentRecord?sourcePortfolio:inventories.active)?.data.locations.find(row=>row.id===selectedRow.id);
  const locationDiffers=Boolean(currentRecord&&selectedRow&&workingLocation&&['name','latitude','longitude','value','currency','region','businessLine'].some(key=>selectedRow[key as keyof ExposureRow]!==workingLocation[key as keyof typeof workingLocation]));
  const totals=Object.entries(currentRecord?.summary.knownValueByCurrency??{});
  async function action(label: string, work: () => Promise<void>) {
    if (uiRunning.current || lifecycle.getSnapshot().busy) return;
    uiRunning.current = true; setUiBusy(label); setUiError('');
    try { await work(); } catch (error) { setUiError(message(error)); }
    finally { uiRunning.current = false; setUiBusy(''); }
  }
  const portfolioInput = { portfolio: activePortfolio, loading: inventories.loading,
    portfolioReference: inventories.active ? { id: inventories.active.id, name: inventories.active.name, revision: inventories.active.revision } : undefined };
  const replay = () => lifecycle.replayAssessment(async () => {
    const input = inventories.active ?? await inventories.create('Demo · Ridgecrest locations', demoPortfolio);
    return { portfolio: input.data, loading: inventories.loading, portfolioReference: { id: input.id, name: input.name, revision: input.revision } };
  }, threshold);
  const selectArchived = (event: Earthquake | string) => {
    if (!lifecycle.getSnapshot().busy) setWorkspacePanel('events');
    return lifecycle.inspect(event);
  };
  const capture = () => { if (eventId) void selectArchived(eventId); };
  const save = () => lifecycle.save();
  const resume = (snapshot: NonNullable<typeof record>) => lifecycle.resume(snapshot);
  const checkUpdate = () => lifecycle.checkUpdate();
  const exportBundle = async () => {
    const result = await lifecycle.exportBundle();
    if (result) downloadFile(`catlas-case-${result.record.event.id}-v${result.record.version}.json.gz`, result.blob);
  };
  const seenOpenRevision = useRef(investigation.openRevision);
  useLayoutEffect(() => {
    if (seenOpenRevision.current === investigation.openRevision) return;
    seenOpenRevision.current = investigation.openRevision;
    if (!record || !currentRecord) return;
    setThreshold(record.settings.threshold); setSelected(record.rows[0]?.id ?? '');
    resetInvestigationView();
    if (investigation.openKind !== 'import') setWorkspacePanel(null);
  }, [investigation.openRevision]);
  const [locationsRequest,setLocationsRequest] = useState(0);
  function showSummaryFilter(value:string){showFilter(value);setLocationsRequest(value=>value+1);setWorkspacePanel(null);}
  function showFilter(value:string){setFilter(value);setPage(0);}
  const selectedEarthquake=useMemo(()=>earthquakeFromRecovery(sharedEvent),[sharedEvent]);
  const screeningEvidence=[...new Set([inspection?.evidence,evidence,pendingUpdate?.evidence,...investigation.captures.map(item=>item.capture.evidence)].filter((item):item is CapturedEvidence=>Boolean(item)))];
  const screeningPortfolioLabel=inventories.active?`${inventories.active.name} · revision ${inventories.active.revision}`:'No current portfolio selected';
  const screeningEvent=inspectionActive&&inspectionTarget&&typeof inspectionTarget!=='string'?inspectionTarget:selectedEarthquake;
  const selectedRelevance=screeningEvent?screenPortfolioRelevance(screeningEvent,activePortfolio,screeningEvidence,screeningThreshold):null;
  const screeningObservationDiffers=Boolean(screeningEvent&&selectedEarthquake&&(Date.parse(screeningEvent.occurredAt)!==Date.parse(selectedEarthquake.occurredAt)||screeningEvent.magnitude!==selectedEarthquake.magnitude||screeningEvent.longitude!==selectedEarthquake.longitude||screeningEvent.latitude!==selectedEarthquake.latitude));
  const selectedRelevanceLabel=selectedRelevance?.kind==='match'?'Potential match':selectedRelevance?.kind==='below'?'Below screening threshold':'Unknown relevance';
  const recoveryAreas=useMemo(()=>{if(recovery.kind!=='parametric')return [];const parsed=contractSchema.shape.areas.safeParse(recovery.evaluation?.contract.areas??mainContract.areas);return parsed.success?parsed.data:[];},[recovery.evaluation?.contract,recovery.kind]);
  const recoveryMatches=Boolean(recovery.evaluation&&sameRecoveryEvent(recovery.evaluation.event,sharedEvent));
  const investigateSelected = (requireVerifiedCapture = false) => lifecycle.assessSelected(portfolioInput, threshold, requireVerifiedCapture);
  const allMonitorItems=useMemo(()=>monitorItems(monitor,activePortfolio),[monitor.vessels.rows,monitor.vessels.portfolio,monitor.earthquakes.data,monitor.cyclones.data,monitor.fires.data,monitor.perimeters.data,monitor.alerts.data,monitor.prefs,monitor.now,activePortfolio]);
  const visibleItems=useMemo(()=>visibleMonitorItems(allMonitorItems,monitor),[allMonitorItems,monitor.prefs]);
  const captureMonitored=(event:Earthquake)=>{changeMode('exposure');void selectArchived(event);};
  function inspectLocation(id: string) { setSelected(id);setPulseRequest(value=>value+1); if(mode==='exposure')setWorkspacePanel('inspection');if(mode==='recovery')setRecoverySelectionRequest(value=>value+1); }
  const filterPanel = (<section className="exposure-view-controls" aria-label="Map and location filters">        <div className="exposure-filters"><label>Show<select disabled={!currentRecord} value={filter} onChange={e=>showFilter(e.target.value)}><option value="all">All locations</option><option value="meeting">Meeting threshold</option><option value="unknown">Unknown intensity</option><option value="missing-value">Unknown screened value</option><option value="below">Below threshold</option></select></label><label>Insured value<select value={insuredValue} onChange={e=>{setInsuredValue(e.target.value as 'all'|'known'|'unknown');setPage(0);}}><option value="all">All values</option><option value="known">Known values</option><option value="unknown">Unknown values</option></select></label><label>Currency<select value={currency} onChange={e=>{setCurrency(e.target.value);setPage(0);}}><option value="all">All · values grouped by currency</option>{[...new Set(portfolio.locations.map(s=>s.currency))].sort().map(code=><option key={code}>{code}</option>)}</select></label><label>Region<select value={region===null?'':JSON.stringify(region)} onChange={e=>{setRegion(e.target.value===''?null:JSON.parse(e.target.value));setPage(0);}}><option value="">All regions</option>{[...new Set(portfolio.locations.map(row=>row.region))].sort().map(name=><option key={name} value={JSON.stringify(name)}>{name||'Not supplied'}</option>)}</select></label><label>Business line<select value={businessLine===null?'':JSON.stringify(businessLine)} onChange={e=>{setBusinessLine(e.target.value===''?null:JSON.parse(e.target.value));setPage(0);}}><option value="">All business lines</option>{[...new Set(portfolio.locations.map(row=>row.businessLine))].sort().map(name=><option key={name} value={JSON.stringify(name)}>{name||'Not supplied'}</option>)}</select></label><span role="status">{ordered.length} of {rows.length} {currentRecord?'assessed ':''}locations visible{hasViewFilters?' · filtered view':''}</span>{hasViewFilters&&<button onClick={clearViewFilters}>Clear filters</button>}</div><p>Filters apply to the map and location list. Summary totals and regional breakdown describe the full portfolio or assessment.</p></section>);
  const analysisPanel = <section className="exposure-analysis-settings" aria-label="Analysis settings"><p>Changes assess the portfolio again and create a new investigation version.</p><dl><dt>Current investigation threshold</dt><dd>{currentRecord?`MMI ≥ ${currentRecord.settings.threshold}`:'Not assessed'}</dd></dl><label>Threshold MMI ≥<input aria-label="Investigation threshold" type="number" min="1" max="10" step=".5" value={Number.isNaN(threshold)?'':threshold} onChange={e=>setThreshold(e.target.value===''?NaN:Number(e.target.value))}/></label><button disabled={!currentRecord||Boolean(busy)||!Number.isFinite(threshold)||threshold<1||threshold>10||threshold===currentRecord.settings.threshold} onClick={()=>void lifecycle.revise({ threshold })}>Apply threshold as new version</button><p>Event screening has its own threshold in Events. Viewing filters do not change either threshold.</p></section>;
  const mapPanel = (<WorkbenchMap assessed={Boolean(currentRecord)} monitor={{state:monitor,items:visibleItems,selectedItem:allMonitorItems.find(item=>item.key===monitor.selected),fitRequest:monitorFitRequest}} controlsInSidebar layersTarget={layersTarget} mode={mode==='portfolios'?'exposure':mode==='recovery'&&recovery.kind!=='parametric'?'exposure':mode} recoveryAreas={recoveryAreas} selectedArea={recovery.selectedArea} onSelectArea={id=>{setSelected('');recovery.selectArea(id);setRecoverySelectionRequest(value=>value+1);}} evidence={currentRecord?evidence:matchingInspection?.evidence??null} event={selectedEarthquake} rows={mode==='monitor'?inventoryRows:ordered} selected={selected} onSelect={inspectLocation} focusRequest={focusRequest} pulseRequest={pulseRequest}/>);
  const inspectorPanel = (<aside className="exposure-inspector" aria-label="Selected insured location"><p className="exposure-eyebrow">LOCATION INSPECTION</p>{selectedRow?<LocationDetails location={selectedRow} actions={<><button className="exposure-zoom-location" aria-label="Zoom to location" disabled={!ordered.some(row=>row.id===selected)} onClick={()=>setFocusRequest(v=>v+1)}>Zoom to location ↗</button>{(currentRecord?sourcePortfolio:inventories.active)?workingLocation?<button onClick={()=>void openWorkingPortfolio(selectedRow.id)}>Open in Portfolio</button>:<button onClick={()=>void openWorkingPortfolio()}>Open portfolio</button>:null}</>}>
        {!ordered.some(row=>row.id===selected)&&<div role="status"><p>This location is outside your current filters</p><button onClick={clearViewFilters}>Clear filters</button></div>}
        {currentRecord&&(!sourcePortfolio?<p>Source working portfolio unavailable. These location details belong to the saved investigation snapshot.</p>:!workingLocation?<p>This location is no longer in the current portfolio</p>:locationDiffers?<p>This location differs from the current portfolio. These details describe the investigation snapshot.</p>:null)}
        <section aria-label="Exposure assessment"><h3>Exposure assessment</h3>{currentRecord?<><span className="exposure-location-status" data-status={selectedRow.mmi===null?'unknown':selectedRow.mmi>=currentRecord.settings.threshold?'meeting':'below'}>{selectedRow.mmi===null?'Needs investigation':selectedRow.mmi>=currentRecord.settings.threshold?'Meets threshold':'Below threshold'}</span><div className="exposure-location-metrics"><div><span>Shaking intensity</span><strong style={{color:intensityColor(selectedRow.mmi)}}>{selectedRow.mmi===null?'Unknown':`MMI ${selectedRow.mmi.toFixed(2)}`}</strong><small>{selectedRow.mmi===null?'Intensity unavailable':`Band ${intensityBand(selectedRow.mmi)}`}</small></div><div><span>Insured value</span><strong>{selectedRow.value===null?'Unknown':money(selectedRow.value,selectedRow.currency)}</strong>{selectedRow.value===null&&<small>Value not supplied</small>}</div></div><p className="exposure-location-reason">{reasonText[selectedRow.reason]}</p><dl><dt>Evidence source</dt><dd>{currentRecord.evidence?.provider??'Unavailable'}</dd><dt>Investigation threshold</dt><dd>MMI ≥ {currentRecord.settings.threshold}</dd></dl><p className="exposure-caution">Regional shaking is estimated. It does not verify damage at this property or establish an insured loss.</p></>:<><p className="exposure-location-status">Not assessed</p><p>Select an earthquake and assess this portfolio to investigate potential exposure.</p></>}</section>
      </LocationDetails>:<><h2>Select a location</h2><p>Choose a location on the map or in the location list.</p></>}
        {currentRecord&&<details className="exposure-location-evidence" key={`${currentRecord.id}:${selectedRow?.id??''}`}><summary>Evidence</summary><div className="exposure-location-evidence-content"><h3>Calculation</h3><p>Where grid readings are available, intensity is estimated using bilinear interpolation. Threshold comparisons use the unrounded estimate.</p><dl><dt>Sampler</dt><dd><code>{currentRecord.settings.sampler}</code></dd>{selectedRow?.mmi!==null&&selectedRow&&<><dt>Unrounded MMI</dt><dd>{selectedRow.mmi}</dd></>}</dl>{currentRecord.evidence?<><h3>Captured source</h3><p>{currentRecord.evidence.retrospective?'Retrospective atlas product; not a reconstruction of the initial bulletin.':'Frozen source observations may be revised by the provider.'}</p><dl><dt>Product</dt><dd>{currentRecord.evidence.productId}</dd><dt>Processed</dt><dd>{currentRecord.evidence.processedAt}</dd><dt>Source updated</dt><dd>{currentRecord.evidence.productUpdatedAt}</dd><dt>Captured</dt><dd>{currentRecord.evidence.capturedAt}</dd><dt>Source SHA-256</dt><dd><code>{currentRecord.evidence.rawSha256}</code></dd></dl><a href={currentRecord.evidence.sourceUrl} target="_blank" rel="noreferrer">Original numeric grid ↗</a></>:<p>No supported numeric grid is attached to this assessment.</p>}<h3>Portfolio identity</h3><code>{currentRecord.portfolioHash}</code></div></details>}

      </aside>);
  const regionPanel = (currentRecord&&<RegionExposure rows={rows} threshold={currentRecord.settings.threshold} region={region} onRegion={value=>{setRegion(value);setPage(0);}}/>);
  const listPanel = (layoutActions:ReactNode) => (<section className="exposure-list-section" aria-label={currentRecord?"Assessed insured locations":"Unassessed insured locations"}><div className="exposure-section-title"><div><p className="exposure-eyebrow">PORTFOLIO TRIAGE</p><h2>Portfolio locations <span className="exposure-visible-count" aria-label="Visible locations">{ordered.length}/{rows.length}</span></h2></div><LocationSearch value={query} onChange={value=>{setQuery(value);setPage(0);}}/><div className="exposure-list-actions">{layoutActions}<details className="exposure-exports"><summary>Export</summary><div className="exposure-export-menu" onClick={event=>{if(event.target instanceof HTMLElement&&event.target.closest('button'))event.currentTarget.closest('details')?.removeAttribute('open');}}><button disabled={!currentRecord||Boolean(busy)} onClick={()=>{if(currentRecord)downloadFile(`catlas-exposure-${currentRecord.event.id}-v${currentRecord.version}.csv`,new Blob([exposureCSV(currentRecord)],{type:'text/csv;charset=utf-8'}));}}>Export all locations CSV</button><button disabled={!currentRecord||Boolean(busy)} onClick={()=>void exportBundle()}>Download self-contained case</button><button disabled={!currentRecord||Boolean(busy)} onClick={()=>window.print()}>Print impact summary</button></div></details></div></div>

        <FilteredLocationSummary rows={ordered} total={rows.length}/><div className="exposure-table-scroll">{exposureTable.table.getColumn('value')!.getIsSorted()&&<p className="exposure-table-sort-note">Currencies are grouped A–Z; insured values are ordered within each currency. Unknown values stay last.</p>}<table><thead><tr><TableSortHeader column={exposureTable.table.getColumn("name")!} label="Location"/><TableSortHeader column={exposureTable.table.getColumn("value")!} label="Insured value"/><TableSortHeader column={exposureTable.table.getColumn("region")!} label="Region"/><TableSortHeader column={exposureTable.table.getColumn("businessLine")!} label="Business line"/><TableSortHeader column={exposureTable.table.getColumn("mmi")!} label="MMI / band"/><th scope="col">Investigation</th></tr></thead><tbody>{exposureTable.pageRows.map(row=><tr key={row.id} className={selected===row.id?'exposure-selected':''}><td><button onClick={()=>{inspectLocation(row.id);}}>{row.name}</button><small>{row.id}</small></td><td>{row.value===null?'Unknown':money(row.value,row.currency)} {row.currency}</td><td>{row.region||'Not supplied'}</td><td>{row.businessLine||'Not supplied'}</td><td><i style={{background:intensityColor(row.mmi)}}/>{!currentRecord?'Not assessed':row.mmi===null?'Unknown':row.mmi.toFixed(2)}{currentRecord&&<small>{intensityBand(row.mmi)}</small>}</td><td><span className={`exposure-row-status ${row.mmi===null?'is-unknown':row.mmi>=(currentRecord?.settings.threshold??threshold)?'is-meeting':'is-below'}`}>{!currentRecord?'Not assessed':row.mmi===null?'Needs investigation':row.mmi>=(currentRecord?.settings.threshold??threshold)?'Meets threshold':'Below threshold'}</span>{currentRecord&&row.mmi===null&&<small>{reasonText[row.reason]}</small>}{row.value===null&&<small>Insured value not supplied</small>}</td></tr>)}</tbody></table></div>
        {!currentRecord&&<p>Not assessed · Select an earthquake to assess the loaded portfolio.</p>}{rows.length===0&&<div className="exposure-empty-view"><h3>No insured locations yet</h3><p>Create or select a portfolio in Portfolio to browse its insured locations.</p></div>}{rows.length>0&&ordered.length===0&&<div className="exposure-empty-view"><h3>No locations match this view</h3><p>Try another name, region or filter. The full investigation is unchanged.</p><button onClick={clearViewFilters}>Clear filters</button></div>}<LocationPagination table={exposureTable.table} page={exposureTable.page} total={ordered.length}/><small>{currentRecord?`CSV includes all ${rows.length} assessed rows`:'Not assessed'}</small>
      </section>);
  const discoveryPanel = (<section className="exposure-discovery" aria-label="Earthquake discovery"><RecentEarthquakes selectedId={sharedEvent?.id} busy={Boolean(busy)} onSelect={event=>void selectArchived(event)} portfolio={activePortfolio} screeningThreshold={screeningThreshold} onScreeningThreshold={setScreeningThreshold} availableEvidence={screeningEvidence} screenPortfolioLabel={screeningPortfolioLabel}/><div className="exposure-event-input"><label htmlFor="event-id">USGS event ID</label><input id="event-id" value={eventId} onChange={event=>setEventId(event.target.value.trim())} maxLength={100}/><button disabled={!eventId||Boolean(busy)} onClick={capture}>Capture earthquake evidence</button></div></section>);
  const identityPanel = (<section className="exposure-source-bar" aria-label="Investigation identity"><div><b>{currentRecord?.event.name??'No earthquake selected'}</b><span>{currentRecord?`${currentRecord.event.occurredAt} · M${currentRecord.event.magnitude??'unknown'}`:'Select the replay or capture a published event.'}</span></div><div><b>{currentRecord?.portfolioReference?.name??portfolio.source}</b><span>{portfolio.source} · Portfolio as of {portfolio.asOf} · {portfolio.locations.length.toLocaleString()} locations{portfolio.synthetic?' · synthetic':''}</span><small>The as-of date does not prove policy coverage at the earthquake time.</small></div><div><b>{currentRecord?`Investigation v${currentRecord.version} · ${saved?'Saved locally':'Not saved'}`:'Ready to investigate'}</b><span>{currentRecord?.evidence?`${currentRecord.evidence.provider} v${currentRecord.evidence.productVersion} · ${currentRecord.evidence.retrospective?'retrospective evidence':'captured public evidence'}`:currentRecord?'Shaking evidence unavailable':'No recovery or damage amount asserted'}</span></div></section>);
  const metricsPanel = (<section className="exposure-metrics" aria-label="Portfolio exposure summary">
        <div className="metric-screened"><button className="exposure-metric-action" aria-label="Show locations meeting threshold" aria-pressed={filter==='meeting'} disabled={!currentRecord} onClick={()=>showSummaryFilter(filter==='meeting'?'all':'meeting')}><span>Meeting investigation threshold</span><strong data-testid="exposure-count">{currentRecord?.summary.meetingThreshold??'—'}</strong><small>Estimated MMI ≥ {currentRecord?.settings.threshold??threshold}</small><span className="exposure-metric-link">View locations →</span></button></div>
        <div><span>Known value meeting threshold</span><strong className="exposure-value">{!currentRecord||currentRecord.summary.knownValueByCurrency===null?'Not determined':totals.length?totals.map(([code,value])=><span key={code}>{money(value,code)} {code}</span>):'No known value in selected locations'}</strong><small>{currentRecord?.summary.unknownValueCount??0} screened locations have unknown value · totals kept separate by currency</small>{Boolean(currentRecord?.summary.unknownValueCount)&&<button className="exposure-value-review" aria-pressed={filter==='missing-value'} onClick={()=>showSummaryFilter(filter==='missing-value'?'all':'missing-value')}>Review unknown values →</button>}</div>
        <div className="metric-unknown"><button className="exposure-metric-action" aria-label="Show locations with unknown intensity" aria-pressed={filter==='unknown'} disabled={!currentRecord} onClick={()=>showSummaryFilter(filter==='unknown'?'all':'unknown')}><span>Needs investigation</span><strong data-testid="exposure-unknown">{currentRecord?.summary.unknownIntensity??'—'}</strong><small>Unknown intensity is not zero</small><span className="exposure-metric-link">Investigate unknowns →</span></button></div>
        <div className="metric-below"><button className="exposure-metric-action" aria-label="Show locations below threshold" aria-pressed={filter==='below'} disabled={!currentRecord} onClick={()=>showSummaryFilter(filter==='below'?'all':'below')}><span>Below selected threshold</span><strong>{currentRecord?.summary.belowThreshold??'—'}</strong><small>Below threshold does not establish no damage</small><span className="exposure-metric-link">View locations →</span></button></div>
      </section>);
  const caseActionsPanel = (currentRecord&&<section className="exposure-case-actions" aria-label="Investigation actions"><button disabled={Boolean(busy)||saved} onClick={()=>void save()}>{saved?'Saved in this browser':'Save this investigation locally'}</button><button disabled={Boolean(busy)} onClick={()=>void checkUpdate()}>Check for newer source evidence</button>{pendingUpdate&&<button disabled={Boolean(busy)} onClick={()=>void lifecycle.revise({ applyEvidence: true })}>Apply captured update as new version</button>}<p>Saved versions retain exact results. Updating inputs creates a new version; refreshing does not silently update a saved case.</p></section>);
  const inputsPanel = (<section className="exposure-inputs">
        <div aria-label="Saved exposure cases"><h2>Saved investigation versions</h2><p>Local history is specific to this browser and URL origin. Self-contained case downloads include insured-location data.</p><label>Open a self-contained case<input type="file" accept=".gz,application/gzip" disabled={Boolean(busy)} onChange={e=>{const file=e.target.files?.[0];if(file)void lifecycle.importBundle(file);e.target.value='';}}/></label>
          {history.length===0?<p>No exposure cases saved yet.</p>:<ul className="exposure-history">{history.map(item=><li key={item.id}><strong>{item.event.name} · v{item.version}</strong><span>{item.portfolioReference?.name??item.portfolio.source} · {item.portfolio.locations.length} locations · MMI ≥{item.settings.threshold} · {item.summary.meetingThreshold===null?'Unknown assessment':`${item.summary.meetingThreshold} meeting threshold`}</span><span>Portfolio revision {item.portfolioReference?.revision??'not recorded in this older case'} · supplied as of {item.portfolio.asOf}</span>{item.evidence?<><small>Evidence {item.evidence.productId} · product version {item.evidence.productVersion} · source updated {item.evidence.productUpdatedAt}</small><code>{item.evidence.rawSha256}</code></>:<small>No compatible frozen shaking evidence recorded.</small>}<small>{new Date(item.createdAt).toLocaleString()}</small><button disabled={Boolean(busy)} onClick={()=>void resume(item)}>Open saved version {item.version}</button></li>)}</ul>}
          {currentRecord&&history.some(item=>item.caseId===currentRecord.caseId)&&<button disabled={Boolean(busy)} onClick={()=>{if(window.confirm('Delete this exposure case and every saved version from this browser? Download a case bundle first if you need to retain it.'))void lifecycle.deleteCase();}}>Delete this case and all saved versions</button>}
        </div></section>);
  const catalogPanel = <><div hidden={workspacePanel!=='events'}>{mode==='exposure'&&discoveryPanel}</div><div hidden={workspacePanel!=='history'}>{identityPanel}{caseActionsPanel}{inputsPanel}</div></>;
  const relevanceContext=selectedEarthquake&&selectedRelevance?<section className="portfolio-relevance-inspector" aria-label="Current portfolio relevance"><h3>{selectedRelevanceLabel}</h3><p>{screeningPortfolioLabel} · supplied as of {activePortfolio.asOf||'not supplied'} · screening MMI ≥ {Number.isFinite(screeningThreshold)?screeningThreshold:'invalid'}</p><p>{selectedRelevance.explanation}</p>{screeningObservationDiffers&&<p>Screening uses the requested catalog observation. The map retains an earlier captured observation; differing observations are not interchangeable.</p>}{selectedRelevance.evidence&&<p>Screening evidence: {selectedRelevance.evidence.productId} · product version {selectedRelevance.evidence.productVersion} · captured {selectedRelevance.evidence.capturedAt}. The map keeps its selected evidence version.</p>}{currentRecord&&<p>Catalog screening uses current holdings. The map and saved assessment retain their frozen portfolio and evidence until an explicit new-version action.</p>}</section>:null;
  const primaryAssessmentActions=<div className="archive-assessment-actions"><button disabled={Boolean(busy)||inventories.loading||Boolean(currentRecord)||!validThreshold||!matchingInspection?.evidence||!activePortfolio.locations.length} onClick={()=>void investigateSelected(true)}>Assess portfolio</button><button disabled={Boolean(busy)||!currentRecord||saved} onClick={()=>void save()}>Save investigation</button></div>;
  const assessmentPortfolio=currentRecord?.portfolio??activePortfolio;
  const assessmentReference=currentRecord?currentRecord.portfolioReference:inventories.active;
  const assessmentContext=<section className="assessment-context" aria-label="Assessment context"><h3>{currentRecord?'Frozen assessment snapshot':'Current portfolio to assess'}</h3>{!currentRecord&&!inventories.active?<p>No current portfolio selected. Choose a portfolio in Portfolio before assessment.</p>:<dl><dt>Portfolio</dt><dd>{assessmentReference?.name??assessmentPortfolio.source}</dd><dt>Portfolio revision</dt><dd>{assessmentReference?.revision??'Not recorded in this older case'}</dd><dt>Supplied portfolio as of</dt><dd>{assessmentPortfolio.asOf}</dd><dt>Consolidated insured locations</dt><dd>{assessmentPortfolio.locations.length}</dd></dl>}<dl><dt>Investigation threshold</dt><dd>{currentRecord?`MMI ≥ ${currentRecord.settings.threshold}`:validThreshold?`MMI ≥ ${threshold}`:'Choose a value from 1 through 10 in Analysis.'}</dd><dt>Numeric sampler</dt><dd>{currentRecord?.settings.sampler??SAMPLER_VERSION}</dd></dl>{currentRecord&&threshold!==currentRecord.settings.threshold&&<p>The draft threshold has changed. This snapshot still uses MMI ≥ {currentRecord.settings.threshold}; apply the threshold explicitly as a new version in Analysis.</p>}<p>Potentially affected exposure is an investigation screening measure. It does not establish damage, insured loss or reinsurance recovery. The supplied as-of date does not establish policy coverage at the earthquake occurrence.</p>{currentRecord&&<p>Assessment already created. Its inputs and results stay frozen; use explicit settings or latest-portfolio actions to create a new version.</p>}</section>;
  const pendingEvidencePanel=currentRecord&&pendingUpdate?.evidence?<section aria-label="Captured update to apply"><h3>Captured update to apply</h3><p>This selected capture has not changed the frozen assessment. Applying it creates a new version using this assessment’s original portfolio snapshot.</p><dl><dt>Product</dt><dd>{pendingUpdate.evidence.manifest.productId}</dd><dt>Product version</dt><dd>{pendingUpdate.evidence.manifest.productVersion}</dd><dt>Source updated</dt><dd>{pendingUpdate.evidence.manifest.productUpdatedAt}</dd><dt>Captured</dt><dd>{pendingUpdate.evidence.manifest.capturedAt}</dd></dl><code>{pendingUpdate.evidence.manifest.rawSha256}</code><button disabled={Boolean(busy)} onClick={()=>void lifecycle.revise({ applyEvidence: true })}>Apply selected evidence as new version</button></section>:null;
  const archiveInspector = <><p className="exposure-eyebrow">PUBLIC EVENT EVIDENCE</p><h2>{sharedEvent?.name??(inspectionActive&&typeof inspectionTarget==='string'?`USGS event ${inspectionTarget}`:'Select an earthquake')}</h2><p>{inspectionReason||'Inspect evidence before assessing or saving an investigation.'}</p>{assessmentContext}{pendingEvidencePanel}{relevanceContext}{matchingInspection?.evidence&&<><dl><dt>Occurred</dt><dd>{matchingInspection.event.occurredAt}</dd><dt>Source updated</dt><dd>{matchingInspection.evidence.manifest.productUpdatedAt}</dd><dt>Captured</dt><dd>{matchingInspection.evidence.manifest.capturedAt}</dd><dt>Product</dt><dd>{matchingInspection.evidence.manifest.productId}</dd></dl><p>{matchingInspection.evidence.manifest.retrospective?'Retrospective product; not evidence as known at occurrence.':'Captured public evidence; source observations may have been revised.'}</p><a href={matchingInspection.evidence.manifest.sourceUrl} target="_blank" rel="noreferrer">Original source grid</a><code>{matchingInspection.evidence.manifest.rawSha256}</code></>}{currentRecord&&sourceCheck?.recordId===currentRecord.id&&<section aria-label="Source update check"><p>{sourceCheck.reason}</p><dl><dt>Last source check</dt><dd><time dateTime={sourceCheck.attemptedAt}>{sourceCheck.attemptedAt}</time></dd>{sourceCheck.failedAt&&<><dt>Last failed source check</dt><dd><time dateTime={sourceCheck.failedAt}>{sourceCheck.failedAt}</time></dd></>}{sourceCheck.successfulAt&&<><dt>Last successful source check</dt><dd><time dateTime={sourceCheck.successfulAt}>{sourceCheck.successfulAt}</time></dd></>}</dl></section>}{inspectionCheck&&inspectionActive&&<dl><dt>Last evidence check</dt><dd><time dateTime={inspectionCheck.attemptedAt}>{inspectionCheck.attemptedAt}</time></dd>{inspectionCheck.successfulAt&&<><dt>Last successful check</dt><dd><time dateTime={inspectionCheck.successfulAt}>{inspectionCheck.successfulAt}</time></dd></>}{inspectionCheck.failedAt&&<><dt>Last failed check</dt><dd><time dateTime={inspectionCheck.failedAt}>{inspectionCheck.failedAt}</time></dd></>}</dl>}<div className="archive-evidence-actions">{currentRecord&&<button disabled={Boolean(busy)} onClick={()=>void checkUpdate()}>Check source for updates</button>}{inspectionActive&&inspectionTarget&&<button disabled={Boolean(busy)} onClick={()=>void selectArchived(inspectionTarget)}>Retry evidence retrieval</button>}</div>{currentRecord&&<p>Assessment v{currentRecord.version} · {saved?'Saved locally':'Not saved'}</p>}<p>Insured locations remain in this browser. Discovery and selection do not assess or save.</p>{inspectionActive&&!matchingInspection?.evidence&&<div><button disabled={Boolean(busy)} onClick={()=>void replay()}>Assess packaged Ridgecrest replay</button><p>Runs a separate historical demonstration using packaged evidence.</p></div>}</>;
  const filterChips = hasViewFilters || Boolean(query) || Boolean(selectedEarthquake && selectedRelevance) ? (<>
        {selectedEarthquake&&selectedRelevance&&<span className="portfolio-relevance-map" role="status" aria-label="Selected event portfolio relevance">{selectedRelevanceLabel} · {selectedEarthquake.id} · {Number.isFinite(screeningThreshold)?`Screening MMI ≥ ${screeningThreshold}`:'Invalid screening threshold'} · {screeningPortfolioLabel}. {screeningObservationDiffers?'Map retains an earlier captured observation; screening uses the catalog observation.':currentRecord?'Frozen assessment map; catalog screening uses current holdings.':'Map locations show current holdings; relevance is separate from an assessment.'}</span>}
        {filter!=='all'&&<button onClick={()=>showFilter('all')}>Status: {filter} ×</button>}
        {insuredValue!=='all'&&<button onClick={()=>{setInsuredValue('all');setPage(0);}}>Insured value: {insuredValue} ×</button>}
        {query&&<button onClick={()=>{setQuery('');setPage(0);}}>Search: {query} ×</button>}
        {region!==null&&<button onClick={()=>{setRegion(null);setPage(0);}}>{region||'Region not supplied'} ×</button>}
        {businessLine!==null&&<button onClick={()=>{setBusinessLine(null);setPage(0);}}>{businessLine||'Business line not supplied'} ×</button>}
        {currency!=='all'&&<button onClick={()=>{setCurrency('all');setPage(0);}}>{currency} ×</button>}
        {hasViewFilters&&<button onClick={clearViewFilters}>Clear filters</button>}
      </>) : null;
  const printProvenance = (currentRecord&&<section className="exposure-print-provenance"><h2>Impact summary · {currentRecord.event.name}</h2><p>Investigation {currentRecord.id} · version {currentRecord.version} · {currentRecord.createdAt}</p><p>{currentRecord.evidence?.productId??'Numeric shaking evidence unavailable'} · {currentRecord.evidence?.rawSha256}</p><p>Portfolio {currentRecord.portfolioHash} · {currentRecord.portfolio.source} · as of {currentRecord.portfolio.asOf}; {currentRecord.portfolio.excludedRows} excluded import rows. Sampler {currentRecord.settings.sampler}, threshold {currentRecord.settings.threshold}. Estimates describe exposure only, not damage, insured loss or contractual recovery. Table view may be filtered/paginated; export CSV for all locations.</p></section>);
  const simpleRecovery=recovery.simple&&sameRecoveryEvent(recovery.simple.event,sharedEvent)?recovery.simple:null;
  const monitorWorkspace = useMonitorWorkspace({
    active: mode === 'monitor', state: monitor, items: allMonitorItems, portfolio: activePortfolio,
    busy: Boolean(busy) || inventories.loading, onCapture: event => void captureMonitored(event),
    onPortfolio: () => changeMode('portfolios'), onFitPortfolio: () => setMonitorFitRequest(value => value + 1),
  });
  const recoveryWorkspace = useRecoveryWorkspace({
    active: mode === 'recovery', observation: sharedEvent, onObservationChange: changeSharedEvent,
    context: recovery, onContextChange: updateRecovery, selectedId: selected,
    location: ordered.find(site => site.id === selected), onClearLocation: () => setSelected(''),
    selectionRequest: recoverySelectionRequest, layersTargetRef: setLayersTarget,
  });
  return <WorkbenchLayout layersTargetRef={setLayersTarget} monitor={monitorWorkspace} recovery={recoveryWorkspace} mode={mode} onModeChange={changeMode}
    portfolios={<PortfoliosWorkspace state={inventories} hidden={mode!=='portfolios'} locationRequest={portfolioLocationRequest} onLocationRequestHandled={()=>setPortfolioLocationRequest(null)}/>}
    portfolioSelector={<label className="portfolio-selection">Active portfolio<select aria-label="Active portfolio" disabled={inventories.loading||Boolean(busy)} value={inventories.activeId??''} onChange={event=>void action('Selecting portfolio…',()=>inventories.select(event.target.value))}><option value="" disabled>{inventories.loading?'Loading…':'Create a portfolio'}</option>{inventories.portfolios.map(item=><option key={item.id} value={item.id}>{item.name} · {item.data.asOf}</option>)}</select></label>}
    snapshotNotice={<>{inventories.error&&<div role="alert">{inventories.error} <button onClick={inventories.retry}>Retry portfolio storage</button></div>}{currentRecord&&<div className="portfolio-snapshot-notice"><span>Investigation snapshot: {currentRecord.portfolioReference?.name??currentRecord.portfolio.source} · {currentRecord.portfolio.asOf} · {currentRecord.portfolio.locations.length} locations.{portfolioChanged?' Portfolio has changed since this assessment.':''}{!sourcePortfolio?' Source working portfolio unavailable; the frozen assessment is retained.':''}</span>{portfolioChanged&&sourcePortfolio&&<button disabled={Boolean(busy)||!sourcePortfolio.data.locations.length} onClick={()=>void lifecycle.revise({ portfolio: { portfolio: sourcePortfolio.data, portfolioReference: { id: sourcePortfolio.id, name: sourcePortfolio.name, revision: sourcePortfolio.revision } } })}>Investigate latest portfolio</button>}</div>}</>}
    onInvestigateSelected={()=>void investigateSelected()} hasSelectedEvent={Boolean(sharedEvent)}
    panel={workspacePanel} onPanel={setWorkspacePanel}
    locationsRequest={locationsRequest} assessmentActions={primaryAssessmentActions}
    evidenceSummary={<><strong>USGS ShakeMap</strong><span>{currentRecord?.evidence||matchingInspection?.evidence?<>Source updated <time dateTime={currentRecord?.evidence?.productUpdatedAt??matchingInspection?.evidence?.manifest.productUpdatedAt}>{new Date((currentRecord?.evidence?.productUpdatedAt??matchingInspection?.evidence?.manifest.productUpdatedAt)!).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})} UTC</time> · {currentRecord?'Frozen evidence':'Captured evidence'}</>:'No shaking evidence selected'}</span></>}
    catalog={catalogPanel} evidenceInspector={archiveInspector} map={mapPanel} analysis={analysisPanel} exposureFilterCount={[insuredValue!=='all',filter!=='all',currency!=='all',Boolean(query.trim()),region!==null,businessLine!==null].filter(Boolean).length} filters={filterPanel} inspector={inspectorPanel} regions={regionPanel} locations={listPanel}
    discovery={discoveryPanel} inputs={inputsPanel} actions={caseActionsPanel} identity={identityPanel} metrics={metricsPanel} chips={filterChips} printProvenance={mode==='monitor'?null:printProvenance}
    eventName={mode==='monitor'?'Monitor your portfolio':sharedEvent?.name??(mode==='recovery'&&recovery.kind!=='parametric'?'Assess event recovery':'Explore earthquake exposure')} magnitude={mode==='monitor'?null:sharedEvent?.magnitude} portfolioName={mode==='monitor'?inventories.active?.name??'No active portfolio':currentRecord?`${currentRecord.portfolioReference?.name??currentRecord.portfolio.source} · as of ${currentRecord.portfolio.asOf}`:inventories.active?.name??'No active portfolio'}

    version={mode==='monitor'?'Latest available':mode==='recovery'?(recovery.kind!=='parametric'?(simpleRecovery?.version?`Recovery v${simpleRecovery.version}`:'Provisional assessment') : recoveryMatches?`Recovery v${recovery.evaluation?.version}`:'Recovery not evaluated'):currentRecord?`Exposure v${currentRecord.version} · ${saved?'Saved locally':'Not saved'}`:sharedEvent?'Exposure not investigated':'No event selected'}
    hasLocationSelection={Boolean(selectedRow)} hasRecord={Boolean(currentRecord)} inspectionActive={inspectionActive} busy={Boolean(busy)||inventories.loading}
    onReplay={()=>{setWorkspacePanel(null);void replay();}} message={mode==='portfolios'?error:mode==='monitor'?busy||error:mode==='recovery'&&!workspacePanel?'':busy||error||(currentRecord&&!currentRecord.evidence?currentRecord.unavailableReason:'')||(notice.includes('New investigation version')?'':notice)} isError={Boolean(error)}
  />;
}
