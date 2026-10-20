import { useEffect, useRef, useState, type ReactNode } from 'react';
import { WorkbenchHeader, type WorkspaceMode } from '../components/WorkbenchHeader';

export type WorkspacePanel = 'filters' | 'regions' | 'inspection' | 'events' | 'history' | null;
type ExposureWorkspaceProps = {
  mode: WorkspaceMode; onModeChange: (mode:WorkspaceMode)=>void;
  portfolios: ReactNode; portfolioSelector: ReactNode; snapshotNotice: ReactNode;
  monitorPanel: ReactNode; monitorMetrics: ReactNode; monitorInspector: ReactNode; monitorFocus: number;
  recoveryPanel: ReactNode; recoveryMetrics: ReactNode; hasSelectedEvent: boolean; onInvestigateSelected: ()=>void;
  panel: WorkspacePanel; onPanel: (value: WorkspacePanel) => void;
  map: ReactNode; filters: ReactNode; inspector: ReactNode; regions: ReactNode; locations: ReactNode;
  discovery: ReactNode; inputs: ReactNode; actions: ReactNode; identity: ReactNode; metrics: ReactNode; chips: ReactNode; printProvenance: ReactNode;
  eventName: string; magnitude?: number | null; portfolioName: string; version: string;
  hasRecord: boolean; visibleCount: number; busy: boolean; onReplay: () => void;
  message: string; isError: boolean;
};
const panelNames = { filters:'Filter locations', regions:'Explore regions', inspection:'Location details', events:'Choose an earthquake', history:'Investigation history' };
function Icon({name}: {name: 'filters' | 'regions' | 'inspection' | 'table'}) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name==='filters'?<><path d="M4 6h16M7 12h10M10 18h4"/></>:name==='regions'?<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></>:name==='table'?<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 10v10"/></>:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>}
  </svg>;
}
export function ExposureWorkspace(props: ExposureWorkspaceProps) {
  const {panel,onPanel} = props;
  const [recoveryOpen,setRecoveryOpen]=useState(true);
  const [monitorOpen,setMonitorOpen]=useState(()=>window.innerWidth>760);
  useEffect(()=>{if(props.monitorFocus>0&&window.innerWidth<=760)setMonitorOpen(false);},[props.monitorFocus]);
  const [tableOpen,setTableOpen] = useState(false), [tableHeight,setTableHeight] = useState(250);
  const modalRef = useRef<HTMLDivElement>(null);
  const modal = panel==='events'||panel==='history';
  const drawer = panel==='filters'||panel==='regions'||panel==='inspection';
  const drag = useRef<{y:number;height:number}|null>(null);
  useEffect(()=>{
    const close = (event: KeyboardEvent) => {
      if(event.key==='Escape') { if(panel)onPanel(null);else setTableOpen(false); }
    };
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[panel,onPanel]);
  useEffect(()=>{
    if(!modal)return;
    const previous = document.activeElement as HTMLElement|null;
    modalRef.current?.focus();
    return()=>{ if(previous?.isConnected)previous.focus(); };
  },[modal,panel]);
  const clampHeight = (height:number) => Math.max(160,Math.min(window.innerHeight*.5,height));
  return <div className={`exposure-page atlas-map-workspace is-${props.mode}`}>
    <WorkbenchHeader active={props.mode} onModeChange={props.onModeChange} portfolioSelector={props.portfolioSelector}/>
    {props.mode==='portfolios'&&props.message&&<div className="atlas-message" role="alert">{props.message}</div>}
    {props.mode==='portfolios'&&props.portfolios}
    <main hidden={props.mode==='portfolios'}>
      {props.mode==='exposure'&&props.snapshotNotice}
      <header className="atlas-case-header">
        <div className="atlas-case-title"><div className="atlas-title-eyebrow"><span className="exposure-eyebrow">{props.mode==='monitor'?'LIVE MONITORING':props.mode==='exposure'?'EXPOSURE INVESTIGATION':'PARAMETRIC RECOVERY'}</span><span className="atlas-case-version">{props.version}</span></div><h1>{props.eventName}{props.magnitude!=null&&<span> M{props.magnitude}</span>}</h1></div>
        <div className="atlas-case-context"><span title={props.portfolioName}>{props.portfolioName}</span></div>
        <div className="atlas-case-actions">{props.mode==='monitor'&&<><button aria-expanded={monitorOpen} aria-controls="atlas-monitor-panel" onClick={()=>setMonitorOpen(v=>!v)}>{monitorOpen?'Expand map':'Monitor details'}</button></>}{props.mode==='recovery'&&<button aria-expanded={recoveryOpen} aria-controls="atlas-recovery-panel" onClick={()=>setRecoveryOpen(value=>!value)}>{recoveryOpen?'Expand map':'Recovery details'}</button>}{props.mode==='exposure'&&props.hasRecord&&<button className="atlas-recovery-action" onClick={()=>props.onModeChange('recovery')}>Evaluate parametric recovery →</button>}{props.mode!=='monitor'&&<button onClick={()=>onPanel('events')}>Change event</button>}{props.mode==='exposure'?<><button onClick={()=>onPanel('history')}>History</button></>:props.mode==='recovery'&&<button onClick={()=>{setRecoveryOpen(true);requestAnimationFrame(()=>document.querySelector('#atlas-recovery-panel [aria-label="Retained evaluation history"]')?.scrollIntoView({block:'start'}));}}>Recovery history</button>}</div>
      </header>
      <div className="atlas-summary"><span className="atlas-summary-scope">{props.mode==='monitor'?'MONITOR':props.mode==='exposure'?'FULL PORTFOLIO':'CONTRACTUAL'}</span>{props.mode==='monitor'?props.monitorMetrics:props.mode==='exposure'?props.metrics:props.recoveryMetrics}</div>
      {!modal&&props.message&&<div className="atlas-message" role={props.isError?'alert':'status'}>{props.message}</div>}
      <div className="atlas-work-area">
        <nav hidden={props.mode!=='exposure'} className="atlas-tool-rail" aria-label="Investigation tools">{(['filters','regions','inspection'] as const).map(value=><button key={value} aria-label={panelNames[value]} aria-expanded={panel===value} aria-controls="atlas-side-panel" onClick={()=>onPanel(panel===value?null:value)}><Icon name={value}/><span>{value==='inspection'?'Details':value==='filters'?'Filters':'Regions'}</span></button>)}<div className="atlas-rail-spacer"/><button aria-label="Toggle location table" aria-expanded={tableOpen} aria-controls="atlas-location-table" onClick={()=>setTableOpen(value=>!value)}><Icon name="table"/><span>Table</span></button></nav>
        {props.mode==='exposure'&&drawer&&panel!=='inspection'&&<aside className="atlas-side-panel" id="atlas-side-panel" aria-label={panelNames[panel]}><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">INVESTIGATE</p><h2>{panelNames[panel]}</h2></div><button aria-label="Close side panel" onClick={()=>onPanel(null)}>×</button></div><div className="atlas-panel-scroll">{panel==='filters'?props.filters:props.regions||<p className="atlas-panel-empty">Choose an earthquake to see regional exposure.</p>}</div></aside>}
        <div className="atlas-map-stage">
          <div className="atlas-map-surface">{props.map}{props.mode==='monitor'&&props.monitorInspector}{props.mode==='exposure'&&!props.hasRecord&&<div className="atlas-start-card"><p className="exposure-eyebrow">START YOUR INVESTIGATION</p><h2>{props.hasSelectedEvent?'Investigate this earthquake.':'Put your portfolio in context.'}</h2><p>Choose an earthquake to explore shaking evidence and the locations that need attention.</p><button className="exposure-primary" disabled={props.busy} onClick={props.hasSelectedEvent?props.onInvestigateSelected:props.onReplay}>{props.hasSelectedEvent?'Investigate selected earthquake':'Investigate Ridgecrest replay'}</button><button onClick={()=>onPanel('events')}>Choose another earthquake →</button><small>Historical earthquake · Uses the selected portfolio</small></div>}</div>
          <div hidden={props.mode!=='exposure'} className="atlas-map-status"><div className="atlas-active-filters" aria-label="Active map filters">{props.chips}</div><button className="atlas-results-toggle" aria-expanded={tableOpen} aria-controls="atlas-location-table" onClick={()=>setTableOpen(value=>!value)}><Icon name="table"/>{tableOpen?'Hide locations':'Show locations'} <b>{props.visibleCount}</b><span aria-hidden="true">{tableOpen?'⌄':'⌃'}</span></button></div>
          <div id="atlas-location-table" className="atlas-results-drawer" hidden={!tableOpen||props.mode!=='exposure'} style={{height:tableHeight}}>
            <div className="atlas-table-resize" role="separator" aria-label="Resize location table" aria-orientation="horizontal" aria-valuemin={160} aria-valuemax={Math.floor(window.innerHeight*.5)} aria-valuenow={Math.round(tableHeight)} tabIndex={0}
              onPointerDown={event=>{drag.current={y:event.clientY,height:tableHeight};event.currentTarget.setPointerCapture(event.pointerId);}}
              onPointerMove={event=>{if(drag.current)setTableHeight(clampHeight(drag.current.height+drag.current.y-event.clientY));}}
              onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
              onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();setTableHeight(height=>clampHeight(height+(event.key==='ArrowUp'?30:-30)));}}}><span/></div>
            {props.locations}
          </div>
        </div>
        <aside id="atlas-monitor-panel" hidden={props.mode!=='monitor'||!monitorOpen} className="atlas-side-panel atlas-monitor-panel" aria-label="Monitor details"><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">MONITOR</p><h2>Hazards & portfolio</h2></div><button aria-label="Close monitor details" onClick={()=>setMonitorOpen(false)}>×</button></div><div className="atlas-panel-scroll">{props.mode==='monitor'&&props.monitorPanel}</div></aside>
        <aside id="atlas-recovery-panel" hidden={props.mode!=='recovery'||!recoveryOpen} className="atlas-recovery-panel" aria-label="Recovery investigation">{props.recoveryPanel}</aside>
        {props.mode==='exposure'&&panel==='inspection'&&<aside className="atlas-side-panel atlas-inspection-panel" id="atlas-side-panel" aria-label="Location details"><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">SELECTED LOCATION</p><h2>Location details</h2></div><button aria-label="Close side panel" onClick={()=>onPanel(null)}>×</button></div><div className="atlas-panel-scroll">{props.inspector}</div></aside>}
      </div>
      {props.printProvenance}
    </main>
    {modal&&<div className="atlas-modal-backdrop" onClick={event=>{if(event.target===event.currentTarget)onPanel(null);}}><div ref={modalRef} className={`atlas-modal atlas-modal-${panel}`} role="dialog" aria-modal="true" aria-labelledby="atlas-modal-title" tabIndex={-1}
      onKeyDown={event=>{if(event.key!=='Tab')return;const items=modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]');if(!items?.length)return;const first=items[0],last=items[items.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===modalRef.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===modalRef.current)){event.preventDefault();first.focus();}}}>
      <div className="atlas-panel-heading"><div><p className="exposure-eyebrow">INVESTIGATION WORKSPACE</p><h2 id="atlas-modal-title">{panelNames[panel]}</h2></div><button aria-label="Close dialog" onClick={()=>onPanel(null)}>×</button></div>
      <div className="atlas-modal-scroll">{props.message&&<div className="atlas-message" role={props.isError?'alert':'status'}>{props.message}</div>}{panel==='events'?<><button className="exposure-primary" disabled={props.busy} onClick={props.onReplay}>Investigate Ridgecrest replay</button>{props.discovery}</>:<>{props.identity}{panel==='history'&&props.actions}<div className="atlas-management-content">{props.inputs}</div></>}</div>
    </div></div>}
  </div>;
}
