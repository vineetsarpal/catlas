import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { demoPortfolio, stressPortfolio } from '../exposure/fixtures';
import { CSV_TEMPLATE, previewPortfolio, type ImportPreview } from '../exposure/portfolio';
import { MAX_LOCATIONS, siteSchema, type InsuredLocation } from '../exposure/model';
import { downloadFile } from '../browser/download';
import { ExposureMap } from '../exposure/ExposureMap';
import { emptyPortfolio, inventoryCSV, planImport, type ImportMode, type ManagedPortfolio } from './inventory';
import { type MapPoint, type PlaceResult } from './geocoding';
import type { PortfoliosState } from './usePortfolios';
import { PlaceSearch } from './PlaceSearch';
import { ResizableLocationTable } from './ResizableLocationTable';
import { WorkspaceIcon, WorkspaceRail } from '../components/WorkspaceRail';
import { WorkbenchDialog } from '../components/WorkbenchDialog';
import './portfolios.css';
type PortfolioPanel = 'portfolios' | 'add' | 'import' | 'settings' | 'layers' | null;
const portfolioTools = [{ id: 'layers', label: 'Layers', icon: 'layers' as const }, { id: 'portfolios', label: 'Your portfolios', icon: 'portfolio' as const }, { id: 'add', label: 'Add locations', icon: 'add-location' as const }, { id: 'import', label: 'Import CSV', icon: 'import' as const }, { id: 'settings', label: 'Settings', icon: 'settings' as const }];

const money = (value: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
const failure = (error: unknown) => error instanceof Error ? error.message : String(error);
export function PortfoliosWorkspace({ state }: { state: PortfoliosState }) {
  const [layersTarget,setLayersTarget]=useState<HTMLDivElement|null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [creating, setCreating] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [draftPortfolio, setDraftPortfolio] = useState<ManagedPortfolio | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const retainDraft = useCallback((portfolio: ManagedPortfolio | null) => {
    setDraftPortfolio(previous => portfolio ? previous ?? portfolio : null);
  }, []);
  const displayed = draftPortfolio ?? state.active;
  const latestDraft = draftPortfolio && state.portfolios.find(portfolio => portfolio.id === draftPortfolio.id);
  const draftChanged = draftPortfolio && (!latestDraft || latestDraft.revision !== draftPortfolio.revision || state.activeId !== draftPortfolio.id);
  function discardDrafts() { setDraftPortfolio(null); setEditorEpoch(value => value + 1); setLeftPanel(null); setError(''); }
  const [leftPanel, setLeftPanel] = useState<PortfolioPanel>(() => window.innerWidth > 760 ? 'portfolios' : null);
  useEffect(() => {
    const mobile=window.matchMedia('(max-width:760px)');
    const change=(event:MediaQueryListEvent)=>{if(event.matches)setLeftPanel(null);};
    mobile.addEventListener('change',change);return()=>mobile.removeEventListener('change',change);
  }, []);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) setLeftPanel(null); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(failure(e)); } finally { setBusy(false); }
  }
  const list = <>
    <div className="atlas-panel-heading"><div><p className="exposure-eyebrow">MANAGE</p><h2>Your portfolios</h2></div><button aria-label="Close portfolio details" onClick={() => setLeftPanel(null)}>×</button></div>
    <div className="atlas-panel-scroll portfolio-sidebar-content"><div className="portfolio-list" aria-label="Your portfolios">{state.portfolios.map(p => <button key={p.id} disabled={busy} aria-pressed={state.activeId === p.id} onClick={() => void run(() => state.select(p.id))}><strong>{p.name}</strong><span>{p.data.locations.length} locations · {p.data.asOf}</span>{p.data.synthetic && <small>Demo · synthetic locations</small>}</button>)}</div>
      {state.active && <div className="portfolio-provenance"><p className="exposure-eyebrow">ACTIVE INVENTORY{state.active.data.synthetic ? ' · DEMO' : ''}</p><p>Source: {state.active.data.source}<br />As of {state.active.data.asOf}<br />Updated {new Date(state.active.updatedAt).toLocaleString()}</p><p>Changes apply to your working inventory. Saved investigations retain their snapshots.</p></div>}
      <details><summary>Demo portfolios</summary><div className="portfolio-actions"><button disabled={busy || Boolean(state.error)} onClick={() => void run(() => state.create('Demo · Ridgecrest locations', demoPortfolio))}>Use 18-location synthetic portfolio</button><button disabled={busy || Boolean(state.error)} onClick={() => void run(() => state.create('Demo · 1,000 locations', stressPortfolio()))}>Use 1,000 synthetic locations</button></div></details>
      <p className="portfolio-local-note">Stored in this browser. Export CSV to back up your locations. Vessel watch portfolio and reinsurance contracts remain separate.</p>
    </div>
  </>;
  return <main className="portfolios-page">
    <header className="atlas-case-header"><div className="atlas-case-title"><p className="exposure-eyebrow">PORTFOLIO MANAGEMENT</p><h1>{displayed?.name ?? 'Portfolios'}</h1></div><div className="atlas-case-context"><span>{displayed ? `${displayed.data.source} · as of ${displayed.data.asOf}` : 'Your insured locations'}</span></div><div className="atlas-case-actions"><button aria-expanded={Boolean(leftPanel)} onClick={() => setLeftPanel(value => value ? null : 'portfolios')}>{leftPanel?'Hide options':'Portfolio options'}</button><button className="exposure-primary" disabled={busy || state.loading || Boolean(state.error)} onClick={() => setCreating(true)}>Create portfolio</button></div></header>
    {(error || state.error) && <p ref={errorRef} tabIndex={-1} role="alert" className="atlas-message exposure-warning">{error || state.error}{state.error && <button onClick={state.retry}>Retry portfolio storage</button>}</p>}
    {draftChanged && <div role="status" className="atlas-message" aria-label="Retained portfolio draft">Unsaved work for “{draftPortfolio.name}” is retained. {!latestDraft ? 'This portfolio was deleted.' : latestDraft.revision !== draftPortfolio.revision ? 'This portfolio has changed since editing began.' : 'A different portfolio is active.'} Finish or cancel your edits before using the latest inventory. <button disabled={busy} onClick={discardDrafts}>Discard unsaved work and show active portfolio</button></div>}
    {displayed ? <PortfolioDetails key={`${displayed.id}:${editorEpoch}`} portfolio={displayed} busy={busy} run={run} onSave={state.save} onRemove={async id => { await state.remove(id); discardDrafts(); }} onDraftChange={retainDraft} sidebar={list} leftPanel={leftPanel} setLeftPanel={setLeftPanel} /> : <div className="atlas-work-area">
      <WorkspaceRail label="Portfolio tools" items={portfolioTools.filter(tool=>tool.id==='portfolios'||tool.id==='layers')} active={leftPanel} onSelect={id=>setLeftPanel(leftPanel===id?null:id as PortfolioPanel)} /><aside hidden={!leftPanel} className="atlas-side-panel portfolio-sidebar" aria-label="Portfolio options"><div hidden={leftPanel!=='portfolios'}>{list}</div><section hidden={leftPanel!=='layers'}><div className="atlas-panel-heading"><h2>Map layers</h2><button aria-label="Close map layers" onClick={()=>setLeftPanel(null)}>×</button></div><div className="atlas-panel-scroll" ref={setLayersTarget}/></section></aside>
      <div className="atlas-map-stage"><div className="atlas-map-surface"><ExposureMap controlsInSidebar layersTarget={layersTarget} mode="portfolio" evidence={null} event={null} rows={[]} selected="" onSelect={() => {}} /><section className="atlas-start-card"><p className="exposure-eyebrow">YOUR INSURED LOCATIONS</p><h2>What do you insure?</h2><p>{state.loading ? 'Loading portfolios…' : 'Create a portfolio, then search a place, drop a pin or import your locations.'}</p><button className="exposure-primary" disabled={busy || state.loading || Boolean(state.error)} onClick={() => void run(() => state.create('Demo · Ridgecrest locations', demoPortfolio))}>Use demo portfolio</button><small>Fictional locations and values · Saved only in this browser</small></section></div></div>
    </div>}
    {creating && <WorkbenchDialog title="Create portfolio" onClose={() => setCreating(false)}><form className="portfolio-form" aria-label="Create portfolio" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await state.create(String(form.get('name')), { ...emptyPortfolio, source: String(form.get('source')), asOf: String(form.get('asOf')) }); setCreating(false); }); }}><div className="portfolio-fields"><label>Portfolio name<input name="name" required maxLength={200} autoFocus /></label><label>Source<input name="source" required maxLength={500} defaultValue="Manual entry" /></label><label>As-of date<input name="asOf" type="date" required defaultValue={emptyPortfolio.asOf} /></label></div><div className="portfolio-actions"><button className="exposure-primary" disabled={busy}>Save portfolio</button><button type="button" disabled={busy} onClick={() => setCreating(false)}>Cancel</button></div>{error && <p role="alert">{error}</p>}</form></WorkbenchDialog>}
  </main>;
}

type DetailsProps = { portfolio: ManagedPortfolio; busy: boolean; run: (work: () => Promise<unknown>) => Promise<void>; onSave: (p: ManagedPortfolio) => Promise<void>; onRemove: (id: string) => Promise<void>; onDraftChange: (portfolio: ManagedPortfolio | null) => void; sidebar: ReactNode; leftPanel: PortfolioPanel; setLeftPanel: (panel: PortfolioPanel) => void };
function PortfolioDetails({ portfolio, busy, run, onSave, onRemove, onDraftChange, sidebar, leftPanel, setLeftPanel }: DetailsProps) {
  const [query, setQuery] = useState(''), [editing, setEditing] = useState<InsuredLocation | 'new' | null>(null), [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null), [mode, setMode] = useState<ImportMode>('merge'), [ack, setAck] = useState(false);
  const [notice, setNotice] = useState(''), [panel, setPanel] = useState<'inspect' | null>(null), [tableOpen, setTableOpen] = useState(false);
  const [candidate, setCandidate] = useState<(MapPoint & { name: string }) | null>(null), [placing, setPlacing] = useState(false), [focusRequest, setFocusRequest] = useState(0);
  const [layersTarget,setLayersTarget]=useState<HTMLDivElement|null>(null);
  const uploadRef = useRef<HTMLInputElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const [pulseRequest, setPulseRequest] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false), [importLoading, setImportLoading] = useState(false);
  const hasDraft = Boolean(editing || candidate || placing || settingsDirty || preview || importLoading);
  useEffect(() => { onDraftChange(hasDraft ? portfolio : null); }, [hasDraft, portfolio, onDraftChange]);
  useEffect(() => { if (leftPanel && window.innerWidth <= 760) setPanel(null); }, [leftPanel]);
  const full = portfolio.data.locations.length >= MAX_LOCATIONS;
  const visible = portfolio.data.locations.filter(row => [row.id,row.name,row.region,row.businessLine].some(text => text.toLowerCase().includes(query.toLowerCase())));
  const selectedLocation = portfolio.data.locations.find(row => row.id === selected);
  const totals = useMemo(() => {
    const values = new Map<string, number>();
    for (const row of portfolio.data.locations) if (row.value !== null) values.set(row.currency, (values.get(row.currency) ?? 0) + row.value);
    return [...values].sort(([a], [b]) => a.localeCompare(b));
  }, [portfolio]);
  let plan: ReturnType<typeof planImport> | null = null, planError = '';
  if (preview) { try { plan = planImport(portfolio.data, preview, mode); } catch { planError = `The resulting portfolio exceeds ${MAX_LOCATIONS.toLocaleString()} locations. Use replace or a smaller file.`; } }
  async function persist(next: ManagedPortfolio, text: string) { await onSave(next); setNotice(text); setTableOpen(true); }
  function openInspector() { if (window.innerWidth <= 760) setLeftPanel(null); setPanel('inspect'); }
  function selectTool(id: string) { setLeftPanel(leftPanel === id ? null : id as PortfolioPanel); if (window.innerWidth <= 760) setPanel(null); }
  function chooseLocation(id: string) { if(busy)return; setSelected(id); openInspector(); setEditing(null); setCandidate(null); setPlacing(false); setFocusRequest(value => value + 1); }
  function movePin(point: MapPoint) { if(busy)return; setCandidate(previous => ({ ...point, name: previous?.name ?? 'New location' })); openInspector(); setSelected(''); }
  function choosePlace(place: PlaceResult) { setTableOpen(false);setCandidate(place); openInspector(); setSelected(''); setEditing(null); setPlacing(false); }
  function closeInspector() { setPanel(null); setEditing(null); setCandidate(null); setPlacing(false); }
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) closeInspector(); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, []);
  return <>
    <div className="atlas-summary portfolio-summary" aria-label="Portfolio inventory summary"><span className="atlas-summary-scope">INVENTORY</span><div><span>Insured locations</span><strong>{portfolio.data.locations.length.toLocaleString()}</strong></div><div><span>Known insured value</span><strong>{totals.length ? totals.map(([currency,value]) => <span key={currency}>{money(value,currency)} {currency}</span>) : 'Not supplied'}</strong></div><div><span>Unknown insured value</span><strong>{portfolio.data.locations.filter(row => row.value === null).length}</strong></div><div><span>Import exclusions</span><strong>{portfolio.data.excludedRows}</strong></div></div>
    {notice && <div className="atlas-message" role="status">{notice}</div>}
    <div className="atlas-work-area portfolio-work-area">
      <WorkspaceRail label="Portfolio tools" items={portfolioTools} active={leftPanel} onSelect={selectTool}>
        <button className="portfolio-rail-details" aria-label="Location details" aria-expanded={Boolean(panel)} onClick={() => { if (panel) setPanel(null); else openInspector(); }}><WorkspaceIcon name="inspection"/><span>Details</span></button>
      </WorkspaceRail>
      <aside hidden={!leftPanel} className="atlas-side-panel portfolio-sidebar portfolio-options" aria-label="Portfolio options">
        <section hidden={leftPanel !== 'portfolios'}>{sidebar}</section>
        <section hidden={leftPanel !== 'layers'}><div className="atlas-panel-heading"><h2>Map layers</h2><button aria-label="Close map layers" onClick={()=>setLeftPanel(null)}>×</button></div><div className="atlas-panel-scroll" ref={setLayersTarget}/></section><section hidden={leftPanel !== 'add'}><div className="atlas-panel-heading"><h2>Add locations</h2><button aria-label="Close add locations" onClick={() => setLeftPanel(null)}>×</button></div><div className="atlas-panel-scroll portfolio-sidebar-content">
          <PlaceSearch inputRef={searchRef} active={leftPanel === 'add' && !placing} disabled={busy || full} onChoose={choosePlace} />
          <div className="portfolio-actions" onMouseDown={event => event.preventDefault()}><button aria-pressed={placing} disabled={busy || full} onClick={() => { setTableOpen(false); setPlacing(value => !value); setEditing(null); setCandidate(null); setSelected(''); setPanel(null); if (window.innerWidth <= 760) setLeftPanel(null); }}>Drop a pin</button><button disabled={busy || full} onClick={() => { setEditing('new'); setCandidate(null); setSelected(''); setPlacing(false); openInspector(); }}>Add location</button></div><p>Search for a place, choose a point on the map, or enter coordinates manually. Review each location in the details panel before saving.</p>
        </div></section>
                <section hidden={leftPanel !== 'settings'}><div className="atlas-panel-heading"><h2>Portfolio settings</h2><button aria-label="Close portfolio settings" onClick={() => setLeftPanel(null)}>×</button></div><div className="atlas-panel-scroll portfolio-sidebar-content">
    <div className="portfolio-card"><form key={portfolio.revision} className="portfolio-form" onChange={() => setSettingsDirty(true)} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await persist({ ...portfolio, name: String(form.get('name')), data: { ...portfolio.data, source: String(form.get('source')), asOf: String(form.get('asOf')) } }, 'Portfolio details saved in this browser.'); setSettingsDirty(false); }); }}><div className="portfolio-fields"><label>Portfolio name<input name="name" required maxLength={200} defaultValue={portfolio.name} /></label><label>Source<input name="source" required maxLength={500} defaultValue={portfolio.data.source} /></label><label>As-of date<input name="asOf" type="date" required defaultValue={portfolio.data.asOf} /></label></div><button disabled={busy}>Save details</button>{settingsDirty && <button type="button" disabled={busy} onClick={event => { event.currentTarget.form?.reset(); setSettingsDirty(false); }}>Cancel details</button>}</form></div>
          <p>The as-of date describes this inventory; it does not establish policy coverage.</p>
          {!!portfolio.data.warnings.length && <details><summary>Portfolio warnings</summary><ul>{portfolio.data.warnings.map((text,i) => <li key={i}>{text}</li>)}</ul></details>}
        <button disabled={busy} onClick={() => { if (window.confirm(`Delete “${portfolio.name}” from this browser? Saved investigations retain their snapshots. Export CSV first to keep current locations.`)) void run(() => onRemove(portfolio.id)); }}>Delete portfolio</button></div></section>        <section hidden={leftPanel !== 'import'}><div className="atlas-panel-heading"><h2>Import locations</h2><button aria-label="Close import locations" onClick={() => setLeftPanel(null)}>×</button></div><div className="atlas-panel-scroll portfolio-sidebar-content"><p>Preview a CSV, review changes and exclusions, then apply it to this portfolio.</p><button onClick={() => downloadFile('catlas-portfolio-template.csv',new Blob([CSV_TEMPLATE],{type:'text/csv'}))}>Download CSV template</button>
        <label className="portfolio-file">Preview portfolio CSV<input ref={uploadRef} type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; setPreview(null); setAck(false); if (file) { setImportLoading(true); void run(async () => { try { if (file.size > 2_000_000) throw new Error('CSV exceeds 2 MB.'); setPreview(previewPortfolio(await file.text())); setLeftPanel('import'); } finally { setImportLoading(false); } }); } }} /></label>
    {preview && <section className="portfolio-card" aria-label="CSV import preview"><h3>Review import</h3><label>Import behavior<select value={mode} disabled={busy} onChange={event => { setMode(event.target.value as ImportMode); setAck(false); }}><option value="merge">Add/update by location ID</option><option value="replace">Replace all locations</option></select></label><p>{preview.locations.length} usable rows of {preview.totalRows}; {preview.excluded.length} excluded.</p>{planError && <p role="alert">{planError}</p>}{plan && <><p>{plan.added.length} added · {plan.changed.length} changed · {plan.removed.length} removed · {plan.unchanged} unchanged. Result: {plan.data.locations.length} locations.</p><div className="portfolio-preview-changes">{[['Added',plan.added],['Changed',plan.changed],['Removed',plan.removed]].map(([label, rows]) => <details key={String(label)}><summary>{String(label)} locations</summary><ul>{(rows as InsuredLocation[]).map(row => <li key={row.id}>{row.id} · {row.name}{label==='Changed'&&<p>Before: {locationDescription(portfolio.data.locations.find(item=>item.id===row.id)!)}</p>}<p>{label==='Changed'?'After: ':''}{locationDescription(row)}</p></li>)}</ul></details>)}</div></>}
      <ul>{[...preview.excluded,...preview.warnings].map((text, i) => <li key={i}>{text}</li>)}</ul><label className="portfolio-check"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />I have reviewed the changes and excluded rows.</label><div className="portfolio-actions"><button className="exposure-primary" disabled={busy || !plan || !ack} onClick={() => { const next = plan; if (next) void run(async () => { await persist({ ...portfolio, data: next.data }, 'CSV import saved. Existing investigations retain their original snapshots.'); setPreview(null); setAck(false); }); }}>Apply import</button><button disabled={busy} onClick={() => setPreview(null)}>Cancel import</button></div>
    </section>}
</div></section>
      </aside>
      <div className="atlas-map-stage">
        <div className="atlas-map-surface portfolio-map-surface search-closed"><ExposureMap controlsInSidebar layersTarget={layersTarget} mode="portfolio" evidence={null} event={null} rows={visible.map(row => ({ ...row, mmi: null, reason: 'evidence-unavailable' }))} selected={selected} onSelect={chooseLocation} focusRequest={focusRequest} pulseRequest={pulseRequest} placement={{ point: candidate, enabled: placing, onChange: movePin }} />
          {placing && <p className="portfolio-placement-hint" role="status">Click the map or use its center to place a preview pin. Drag the pin to adjust it.</p>}
          {!portfolio.data.locations.length && !candidate && !placing && !editing && <div className="portfolio-empty-map"><h3>Your portfolio is empty</h3><p>Search a location, drop a pin or import CSV to start.</p></div>}
        </div>
        <div className="atlas-map-status"><span>{visible.length} of {portfolio.data.locations.length} locations visible · Unassessed inventory</span><button className="atlas-results-toggle" aria-expanded={tableOpen} aria-controls="portfolio-location-table" onClick={() => setTableOpen(value => !value)}>{tableOpen ? 'Hide locations' : 'Show locations'} <b>{visible.length}</b></button></div>
        <ResizableLocationTable open={tableOpen}>
          <div className="portfolio-table-tools"><label>Search locations<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, ID, region or business line" /></label><button disabled={!portfolio.data.locations.length} onClick={() => downloadFile(`catlas-portfolio-${portfolio.id}.csv`, new Blob([inventoryCSV(portfolio.data)], { type: 'text/csv;charset=utf-8' }))}>Export portfolio CSV</button></div>
    <div className="portfolio-table"><table><caption>Insured location inventory</caption><thead><tr><th>Location</th><th>Coordinates</th><th>Insured value</th><th>Region / business line</th><th>Actions</th></tr></thead><tbody>{visible.map(row => <tr key={row.id} className={selected === row.id ? 'portfolio-location-selected' : undefined}><td><button aria-current={selected === row.id ? 'true' : undefined} onClick={()=>{chooseLocation(row.id);setPulseRequest(value => value + 1);}}>{row.name}</button><small>{row.id}</small></td><td>{row.latitude}, {row.longitude}</td><td>{row.value === null ? 'Unknown' : money(row.value,row.currency)} {row.currency}</td><td>{row.region || 'Not supplied'}<small>{row.businessLine || 'Not supplied'}</small></td><td><button disabled={busy} aria-label={`Edit ${row.name}`} onClick={() => { setEditing(row);openInspector();setSelected(row.id);setCandidate(null);setPlacing(false); }}>Edit</button><button disabled={busy} aria-label={`Delete ${row.name}`} onClick={() => { if (window.confirm(`Delete ${row.name} from this portfolio? Saved investigations retain this location.`)) void run(() => persist({ ...portfolio, data: { ...portfolio.data, locations: portfolio.data.locations.filter(item => item.id !== row.id) } }, 'Location deleted.')); }}>Delete</button></td></tr>)}</tbody></table></div>
        </ResizableLocationTable>
      </div>
      <aside hidden={!panel} className={`atlas-side-panel portfolio-inspector${editing?' is-editing':''}`} aria-label="Portfolio location details"><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">PORTFOLIO</p><h2>{editing ? editing === 'new' ? 'Add location' : 'Edit location' : candidate ? 'Preview location' : 'Location details'}</h2></div><button aria-label="Close location details" onClick={closeInspector}>×</button></div><div className="atlas-panel-scroll portfolio-inspector-content">
        <>
          {editing ? <LocationForm key={editing === 'new' ? 'new' : editing.id} location={editing === 'new' ? null : editing} point={candidate} onPointChange={movePin} busy={busy} onCancel={closeInspector} onSave={row => void run(async () => {
            const original = editing === 'new' ? null : editing.id;
            if (portfolio.data.locations.some(item => item.id === row.id && item.id !== original)) throw new Error('Location ID already exists in this portfolio.');
            const locations = original ? portfolio.data.locations.map(item => item.id === original ? row : item) : [...portfolio.data.locations,row];
            await persist({ ...portfolio, data: { ...portfolio.data, locations } },'Location saved in this browser.'); setSelected(row.id); setEditing(null); setCandidate(null); setPlacing(false); setPanel(null);
          })} /> : candidate ? <><p className="exposure-eyebrow">UNSAVED PREVIEW</p><h3>{candidate.name}</h3><p>{candidate.latitude.toFixed(6)}, {candidate.longitude.toFixed(6)}</p><p>Review the position. Drag the pin to adjust it before adding insurance details.</p><button className="exposure-primary" disabled={busy || full} onClick={() => { setEditing('new'); setPlacing(false); }}>Add to portfolio</button><button onClick={closeInspector}>Discard preview</button></> : selectedLocation ? <><h3>{selectedLocation.name}</h3><p>{selectedLocation.id}</p><dl><dt>Coordinates</dt><dd>{selectedLocation.latitude}, {selectedLocation.longitude}</dd><dt>Insured value</dt><dd>{selectedLocation.value === null ? 'Unknown' : money(selectedLocation.value,selectedLocation.currency)} {selectedLocation.currency}</dd><dt>Region</dt><dd>{selectedLocation.region || 'Not supplied'}</dd><dt>Business line</dt><dd>{selectedLocation.businessLine || 'Not supplied'}</dd></dl><button onClick={() => setEditing(selectedLocation)}>Edit location</button></> : <p>{placing ? 'Choose the location on the map. Nothing is saved until you review and save the location form.' : 'Select a location on the map or in the table.'}</p>}
        </>
      </div></aside>
    </div>
  </>;
}

function locationDescription(row: InsuredLocation) { return `${row.name} · ${row.latitude}, ${row.longitude} · ${row.value===null?'Unknown':row.value} ${row.currency} · ${row.region||'No region'} · ${row.businessLine||'No business line'}`; }

function LocationForm({ location, point, onPointChange, busy, onCancel, onSave }: { location: InsuredLocation | null; point: (MapPoint & { name?: string }) | null; onPointChange: (point: MapPoint) => void; busy: boolean; onCancel: () => void; onSave: (row: InsuredLocation) => void }) {
  const [error, setError] = useState('');
  const [latitude,setLatitude]=useState(String(point?.latitude??location?.latitude??'')),[longitude,setLongitude]=useState(String(point?.longitude??location?.longitude??''));
  useEffect(()=>{if(point){setLatitude(String(point.latitude));setLongitude(String(point.longitude));}},[point?.latitude,point?.longitude]);
  function coordinates(lat:string,lon:string){setLatitude(lat);setLongitude(lon);if(lat!==''&&lon!==''&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lon))<=180)onPointChange({latitude:Number(lat),longitude:Number(lon)});}
  return <form className="portfolio-card portfolio-form" aria-label={location ? 'Edit location' : 'Add location'} onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget), text = (key: string) => String(form.get(key) ?? '').trim();
    const parsed = siteSchema.safeParse({ id: text('id'), name: text('name'), latitude: Number(text('latitude')), longitude: Number(text('longitude')), value: text('value') === '' ? null : Number(text('value')), currency: text('currency').toUpperCase(), region: text('region'), businessLine: text('businessLine') });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')); return; }
    setError(''); onSave(parsed.data);
  }}><div className="portfolio-fields">
    <label>Location ID<input name="id" defaultValue={location?.id ?? ''} required maxLength={200} autoFocus /></label><label>Location name<input name="name" defaultValue={location?.name ?? point?.name ?? ''} required maxLength={500} /></label>
    <label>Latitude<input name="latitude" type="number" min={-90} max={90} step="any" value={latitude} onChange={event=>coordinates(event.target.value,longitude)} required /></label><label>Longitude<input name="longitude" type="number" min={-180} max={180} step="any" value={longitude} onChange={event=>coordinates(latitude,event.target.value)} required /></label>
    <label>Total insured value<input name="value" type="number" min={0} step="any" defaultValue={location?.value ?? ''} placeholder="Unknown" /></label><label>Currency<input name="currency" pattern="[A-Za-z]{3}" maxLength={3} defaultValue={location?.currency ?? 'USD'} required placeholder="USD" /></label>
    <label>Region<input name="region" maxLength={500} defaultValue={location?.region ?? ''} /></label><label>Business line<input name="businessLine" maxLength={500} defaultValue={location?.businessLine ?? ''} /></label>
  </div><p>Coordinates and currency are required. Blank insured value means unknown. Values stay separate by currency.</p>{error && <p role="alert">{error}</p>}<div className="portfolio-actions"><button className="exposure-primary" disabled={busy}>Save location</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div></form>;
}
