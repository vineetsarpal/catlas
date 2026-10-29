import { useEffect, useRef, useState, type ReactNode } from 'react';
import { WorkspaceIcon, WorkspaceRail } from '../components/WorkspaceRail';
import type { MonitorPanelView } from '../monitor/MonitorPanel';
import type { RecoveryView } from '../recovery/RecoveryInspector';
import { WorkbenchHeader, type WorkspaceMode } from '../components/WorkbenchHeader';

export type WorkspacePanel = 'filters' | 'regions' | 'inspection' | 'events' | 'history' | 'layers' | 'analysis' | null;
const preferenceKey = 'catlas.exposure.layout.v1';
function readLayout(): {open: boolean; height: number} {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null');
    return {open: typeof value?.open==='boolean'?value.open:value?.layout!=='map', height: Number.isFinite(value?.height) ? Math.max(160, Math.min(window.innerHeight * .5, value.height)) : Math.max(160, Math.min(250, window.innerHeight * .25))};
  } catch { return {open:true, height:Math.max(160, Math.min(250, window.innerHeight * .25))}; }
}
type ExposureWorkspaceProps = {
  layersTargetRef:(node:HTMLDivElement|null)=>void;
  mode: WorkspaceMode; onModeChange: (mode:WorkspaceMode)=>void;
  portfolios: ReactNode; portfolioSelector: ReactNode; snapshotNotice: ReactNode;
  monitorView: MonitorPanelView; onMonitorViewChange:(view:MonitorPanelView)=>void; monitorHasSelection:boolean; monitorLive:boolean;
  recoveryView:RecoveryView; onRecoveryViewChange:(view:RecoveryView)=>void; recoveryInspectorTargetRef:(node:HTMLDivElement|null)=>void; recoveryLocationDetails:ReactNode; recoveryFocus:string;
  monitorPanel: ReactNode; monitorMetrics: ReactNode; monitorInspector: ReactNode; monitorFocus: number; monitorFilterCount:number;
  recoveryPanel: ReactNode; recoveryMetrics: ReactNode; hasSelectedEvent: boolean; onInvestigateSelected: ()=>void;
  panel: WorkspacePanel; onPanel: (value: WorkspacePanel) => void;
  evidenceSummary: ReactNode; assessmentActions: ReactNode; locationsRequest: number; locationsExpanded: boolean; onRestoreLocations: ()=>void;
  catalog?: ReactNode; evidenceInspector?: ReactNode; map: ReactNode; analysis: ReactNode; exposureFilterCount:number; filters: ReactNode; inspector: ReactNode; regions: ReactNode; locations: (onHide:()=>void)=>ReactNode;
  discovery: ReactNode; inputs: ReactNode; actions: ReactNode; identity: ReactNode; metrics: ReactNode; chips: ReactNode; printProvenance: ReactNode;
  eventName: string; magnitude?: number | null; portfolioName: string; version: string;
  hasRecord: boolean; inspectionActive?: boolean; busy: boolean; onReplay: () => void;
  message: string; isError: boolean;
};
const panelNames = { analysis:'Analysis settings', filters:'Filter locations', regions:'Explore regions', inspection:'Location details', events:'Choose an earthquake', history:'Investigation history', layers:'Map layers' };
export function ExposureWorkspace(props: ExposureWorkspaceProps) {
  const {panel,onPanel} = props;
  useEffect(()=>{document.querySelector('#atlas-side-panel .atlas-panel-scroll')?.scrollTo({top:0});},[panel]);
  const [recoveryLayers,setRecoveryLayers]=useState(false);
  const [recoveryOpen,setRecoveryOpen]=useState(()=>window.innerWidth>760);
  const [monitorInspectOpen,setMonitorInspectOpen]=useState(false),[recoveryInspectOpen,setRecoveryInspectOpen]=useState(false);
  const [monitorOpen,setMonitorOpen]=useState(()=>window.innerWidth>760);
  useEffect(()=>{if(props.monitorFocus>0){setMonitorInspectOpen(true);if(window.innerWidth<=760)setMonitorOpen(false);}},[props.monitorFocus]);
  useEffect(()=>{if(!props.monitorHasSelection)setMonitorInspectOpen(false);},[props.monitorHasSelection]);
  useEffect(()=>{if(props.recoveryFocus){setRecoveryInspectOpen(true);if(window.innerWidth<=760)setRecoveryOpen(false);}},[props.recoveryFocus]);
  useEffect(()=>{
    const mobile=window.matchMedia('(max-width:760px)');
    const change=(event:MediaQueryListEvent)=>{if(event.matches){setMonitorOpen(false);setRecoveryOpen(false);}};
    mobile.addEventListener('change',change);return()=>mobile.removeEventListener('change',change);
  },[]);
  const openMonitor=(view:MonitorPanelView)=>{const close=monitorOpen&&props.monitorView===view;props.onMonitorViewChange(view);setMonitorOpen(!close);if(window.innerWidth<=760)setMonitorInspectOpen(false);};
  const openRecovery=(view:RecoveryView|'layers')=>{const close=recoveryOpen&&(view==='layers'?recoveryLayers:!recoveryLayers&&props.recoveryView===view);setRecoveryLayers(view==='layers');if(view!=='layers')props.onRecoveryViewChange(view);setRecoveryOpen(!close);if(window.innerWidth<=760)setRecoveryInspectOpen(false);};
  const [preferences] = useState(readLayout);
  const [tableOpen,setTableOpen] = useState(()=>window.innerWidth>760&&preferences.open);
  const [mobile,setMobile] = useState(()=>window.innerWidth<=760);
  const [tableHeight,setTableHeight] = useState(preferences.height);
  const [evidenceOpen,setEvidenceOpen] = useState(false);
  const toggleTable = () => {props.onRestoreLocations();setTableOpen(value=>!value);setEvidenceOpen(false);if(mobile)onPanel(null);};
  useEffect(()=>{if(mobile)return;try {localStorage.setItem(preferenceKey,JSON.stringify({open:tableOpen,height:tableHeight}));}catch {/* Viewing preferences remain usable without storage. */}},[tableOpen,tableHeight,mobile]);
  useEffect(()=>{if(props.locationsRequest>0){setTableOpen(true);setEvidenceOpen(false);}},[props.locationsRequest]);
  useEffect(()=>{const query=window.matchMedia('(max-width:760px)');const update=()=>setMobile(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
  useEffect(()=>{if(panel)setEvidenceOpen(false);},[panel]);
  const stageRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const modal = props.mode!=='exposure'&&(panel==='events'||panel==='history');
  const drag = useRef<{y:number;height:number}|null>(null);
  useEffect(()=>{
    const close = (event: KeyboardEvent) => {
      if(event.key==='Escape') { if(panel)onPanel(null);else if(props.mode==='monitor'){setMonitorOpen(false);setMonitorInspectOpen(false);}else if(props.mode==='recovery'){setRecoveryOpen(false);setRecoveryInspectOpen(false);}else if(evidenceOpen)setEvidenceOpen(false);else if(props.locationsExpanded)props.onRestoreLocations();else setTableOpen(false); }
    };
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[panel,onPanel,props.mode,evidenceOpen,mobile,props.locationsExpanded,props.onRestoreLocations]);
  useEffect(()=>{
    if(!modal)return;
    const previous = document.activeElement as HTMLElement|null;
    modalRef.current?.focus();
    return()=>{ if(previous?.isConnected)previous.focus(); };
  },[modal,panel]);
  const clampHeight = (height:number) => Math.max(160,Math.min(window.innerHeight*.5,Math.max(160,(stageRef.current?.clientHeight??window.innerHeight)-260),height));
  return <div className={`exposure-page atlas-map-workspace is-${props.mode}`}>
    <WorkbenchHeader active={props.mode} onModeChange={props.onModeChange} portfolioSelector={props.portfolioSelector}/>
    {props.mode==='portfolios'&&props.message&&<div className="atlas-message" role="alert">{props.message}</div>}
    {props.mode==='portfolios'&&props.portfolios}
    <main hidden={props.mode==='portfolios'}>
      {props.mode==='exposure'&&props.snapshotNotice}
      <header className="atlas-case-header">
        <div className="atlas-case-title"><div className="atlas-title-eyebrow">{props.mode!=='monitor'&&<span className="exposure-eyebrow">{props.mode==='exposure'?'EXPOSURE INVESTIGATION':'EVENT RECOVERY'}</span>}{props.mode==='monitor'?<><span className={`monitor-live-badge${props.monitorLive?' is-live':''}`} title={props.monitorLive?'Automatic feed checks are enabled. Source publication may lag; see Feeds for availability.':'Monitoring paused while offline or all feeds are off.'}><span className="monitor-live-dot" aria-hidden="true"/>{props.monitorLive?'Live':'Paused'}</span><span className="exposure-eyebrow">MONITORING</span></>:<span className="atlas-case-version">{props.version}</span>}</div><h1>{props.eventName}{props.magnitude!=null&&<span> M{props.magnitude}</span>}</h1></div>
        <div className="atlas-case-context"><span title={props.portfolioName}>{props.portfolioName}</span></div>
        <div className="atlas-case-actions">{props.mode==='exposure'&&props.assessmentActions}{props.mode==='monitor'&&<><button aria-expanded={monitorOpen} aria-controls="atlas-monitor-panel" onClick={()=>{setMonitorOpen(v=>!v);if(window.innerWidth<=760)setMonitorInspectOpen(false);}}>{monitorOpen?'Hide options':'Monitor options'}</button></>}{props.mode==='recovery'&&<button aria-expanded={recoveryOpen} aria-controls="atlas-recovery-panel" onClick={()=>{setRecoveryOpen(value=>!value);if(window.innerWidth<=760)setRecoveryInspectOpen(false);}}>{recoveryOpen?'Hide options':'Recovery options'}</button>}{props.mode==='exposure'&&props.hasRecord&&<button className="atlas-recovery-action" onClick={()=>props.onModeChange('recovery')}>Evaluate recovery →</button>}{props.mode!=='monitor'&&<button onClick={()=>onPanel('events')}>Change event</button>}{props.mode==='exposure'?<><button onClick={()=>onPanel('history')}>History</button></>:props.mode==='recovery'&&<button onClick={()=>{setRecoveryLayers(false);props.onRecoveryViewChange('history');setRecoveryOpen(true);if(window.innerWidth<=760)setRecoveryInspectOpen(false);requestAnimationFrame(()=>document.querySelector('#atlas-recovery-panel [aria-label="Retained recovery assessments"], #atlas-recovery-panel [aria-label="Retained evaluation history"]')?.scrollIntoView({block:'start'}));}}>Recovery history</button>}</div>
      </header>
      {props.mode==='exposure'&&<div className="atlas-evidence-bar"><div>{props.evidenceSummary}</div><button aria-expanded={evidenceOpen} aria-controls="atlas-evidence-drawer" onClick={()=>{setEvidenceOpen(value=>!value);if(panel&&(mobile||panel==='inspection'))onPanel(null);}}>Evidence {evidenceOpen?'−':'+'}</button></div>}
      <div className="atlas-summary"><span className="atlas-summary-scope">{props.mode==='monitor'?'MONITOR':props.mode==='exposure'?'FULL PORTFOLIO':'CONTRACTUAL'}</span>{props.mode==='monitor'?props.monitorMetrics:props.mode==='exposure'?props.metrics:props.recoveryMetrics}</div>
      {!modal&&props.message&&<div className="atlas-message" role={props.isError?'alert':'status'}>{props.message}</div>}
      <div className={`atlas-work-area${props.mode==='exposure'&&props.catalog?` has-event-catalog${panel&&panel!=='inspection'?' has-exposure-sidebar':''}`:''}`}>
        {props.mode==='exposure'&&<nav className="atlas-tool-rail" aria-label="Investigation tools">{(['events','history','layers','filters','analysis','regions'] as const).map(value=><button key={value} aria-label={value==='events'?'Events':value==='history'?'Saved':value==='layers'?'Layers':panelNames[value]} aria-expanded={panel===value} aria-controls="atlas-side-panel" onClick={()=>{setEvidenceOpen(false);onPanel(panel===value?null:value);}}><WorkspaceIcon name={value==='analysis'?'settings':value}/><span>{value==='events'?'Events':value==='history'?'Saved':value==='filters'?'Filters':value==='analysis'?'Analysis':value==='layers'?'Layers':'Regions'}</span>{value==='filters'&&props.exposureFilterCount>0&&<b className="workspace-rail-badge" aria-hidden="true">{props.exposureFilterCount}</b>}</button>)}<button aria-label="Locations" aria-expanded={tableOpen} aria-controls="atlas-location-table" onClick={toggleTable}><WorkspaceIcon name="table"/><span>Locations</span></button><div className="atlas-rail-spacer"/><button aria-label="Location details" aria-expanded={panel==='inspection'} aria-controls="atlas-exposure-inspector" onClick={()=>{setEvidenceOpen(false);onPanel(panel==='inspection'?null:'inspection');}}><WorkspaceIcon name="inspection"/><span>Details</span></button></nav>}
        {props.mode==='exposure'&&<aside hidden={!panel||panel==='inspection'} className="atlas-side-panel atlas-exposure-panel atlas-catalog-panel" id="atlas-side-panel" aria-label={panel==='history'?'Saved investigations':panel==='events'?'Earthquake catalog':panel?panelNames[panel]:'Exposure tools'}><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">EXPOSURE</p><h2>{panel==='history'?'Saved investigations':panel==='events'?'Events':panel==='regions'?'Regional exposure':panel?panelNames[panel]:'Exposure tools'}</h2></div><button aria-label="Close side panel" onClick={()=>onPanel(null)}>×</button></div><div className="atlas-panel-scroll"><div hidden={panel!=='events'&&panel!=='history'}>{panel==='events'&&<button className="atlas-catalog-replay" disabled={props.busy} onClick={props.onReplay}>Investigate Ridgecrest replay</button>}{props.catalog}</div><div hidden={panel!=='layers'} ref={props.layersTargetRef}/><div hidden={panel!=='filters'}>{props.filters}</div><div hidden={panel!=='analysis'}>{props.analysis}</div><div hidden={panel!=='regions'}>{props.regions||<p className="atlas-panel-empty">Assess an earthquake to see regional exposure.</p>}</div></div></aside>}
        {props.mode==='monitor'&&<WorkspaceRail label="Monitor tools" active={monitorOpen?props.monitorView:null} onSelect={id=>openMonitor(id as MonitorPanelView)} items={[{id:'controls',label:'Layers',icon:'layers'},{id:'filters',label:'Map filters',icon:'filters',badge:props.monitorFilterCount},{id:'attention',label:'Attention',icon:'attention'},{id:'portfolio',label:'Locations',icon:'locations'},{id:'watchlist',label:'Watchlist',icon:'watchlist'},{id:'layers',label:'Feeds',icon:'feeds'}]}><div className="atlas-rail-spacer"/><button aria-label="Item details" aria-expanded={monitorInspectOpen} onClick={()=>{setMonitorInspectOpen(value=>!value);if(window.innerWidth<=760)setMonitorOpen(false);}}><WorkspaceIcon name="inspection"/><span>Details</span></button></WorkspaceRail>}
        {props.mode==='recovery'&&<WorkspaceRail label="Recovery tools" active={recoveryOpen?(recoveryLayers?'layers':props.recoveryView):null} onSelect={id=>openRecovery(id as RecoveryView|'layers')} items={[{id:'layers',label:'Layers',icon:'layers'},{id:'assessment',label:'Assessment',icon:'assessment'},{id:'history',label:'History',icon:'history'}]}><div className="atlas-rail-spacer"/><button aria-label="Recovery details" aria-expanded={recoveryInspectOpen} onClick={()=>{setRecoveryInspectOpen(value=>!value);if(window.innerWidth<=760)setRecoveryOpen(false);}}><WorkspaceIcon name="inspection"/><span>Details</span></button></WorkspaceRail>}
        <aside id="atlas-monitor-panel" hidden={props.mode!=='monitor'||!monitorOpen} className="atlas-side-panel atlas-monitor-panel" aria-label="Monitor details"><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">MONITOR</p><h2>{{attention:'Portfolio attention',portfolio:'Portfolio locations',watchlist:'Watchlist',layers:'Feed status',controls:'Map layers',filters:'Map filters'}[props.monitorView]}</h2></div><button aria-label="Close monitor details" onClick={()=>setMonitorOpen(false)}>×</button></div><div className="atlas-panel-scroll">{props.mode==='monitor'&&props.monitorPanel}</div></aside>
        <aside id="atlas-recovery-panel" hidden={props.mode!=='recovery'||!recoveryOpen} className="atlas-side-panel atlas-recovery-panel" aria-label="Recovery investigation"><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">RECOVERY</p><h2>{recoveryLayers?'Map layers':props.recoveryView==='history'?'Recovery history':'Recovery assessment'}</h2></div><button aria-label="Close recovery options" onClick={()=>setRecoveryOpen(false)}>×</button></div><div className="atlas-panel-scroll"><div hidden={recoveryLayers}>{props.recoveryPanel}</div><div hidden={!recoveryLayers} ref={props.mode==='recovery'?props.layersTargetRef:undefined}/></div></aside>
        <div ref={stageRef} className={`atlas-map-stage${props.mode==='exposure'?` exposure-layout-${tableOpen?(mobile||props.locationsExpanded?'list':'split'):'map'}`:''}`}>
          <div className="atlas-map-surface">{props.map}{props.mode==='exposure'&&panel!=='events'&&!props.hasRecord&&!props.inspectionActive&&<div className="atlas-start-card"><p className="exposure-eyebrow">START YOUR INVESTIGATION</p><h2>{props.hasSelectedEvent?'Investigate this earthquake.':'Put your portfolio in context.'}</h2><p>Choose an earthquake to explore shaking evidence and the locations that need attention.</p><button className="exposure-primary" disabled={props.busy} onClick={props.hasSelectedEvent?props.onInvestigateSelected:props.onReplay}>{props.hasSelectedEvent?'Investigate selected earthquake':'Investigate Ridgecrest replay'}</button><button onClick={()=>onPanel('events')}>Choose another earthquake →</button><small>Historical earthquake · Uses the selected portfolio</small></div>}</div>
          <div hidden={props.mode!=='exposure'} className="atlas-map-status"><div className="atlas-active-filters" aria-label="Active map filters">{props.chips}</div></div>
          <div id="atlas-location-table" className="atlas-results-drawer" hidden={!tableOpen||props.mode!=='exposure'} style={{height:tableHeight}}>
            <div className="atlas-table-resize" role="separator" aria-label="Resize location table" aria-orientation="horizontal" aria-valuemin={160} aria-valuemax={Math.floor(window.innerHeight*.5)} aria-valuenow={Math.round(tableHeight)} tabIndex={0}
              onPointerDown={event=>{drag.current={y:event.clientY,height:tableHeight};event.currentTarget.setPointerCapture(event.pointerId);}}
              onPointerMove={event=>{if(drag.current)setTableHeight(clampHeight(drag.current.height+drag.current.y-event.clientY));}}
              onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
              onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();setTableHeight(height=>clampHeight(height+(event.key==='ArrowUp'?30:-30)));}}}><span/></div>
            {props.locations(()=>{props.onRestoreLocations();setTableOpen(false);})}
          </div>
        </div>
        {props.mode==='exposure'&&panel==='inspection'&&<aside id="atlas-exposure-inspector" className="atlas-side-panel atlas-inspection-panel atlas-exposure-inspection" aria-label="Location details"><div className="atlas-panel-heading"><h2>Location details</h2><button aria-label="Close location details" onClick={()=>onPanel(null)}>×</button></div><div className="atlas-panel-scroll">{props.inspector}</div></aside>}
        {props.mode==='exposure'&&props.evidenceInspector&&<aside id="atlas-evidence-drawer" hidden={!evidenceOpen} className="atlas-evidence-panel" aria-label="Earthquake evidence inspector"><div className="atlas-panel-heading"><strong>Evidence</strong><button aria-label="Close evidence" onClick={()=>setEvidenceOpen(false)}>×</button></div>{props.evidenceInspector}</aside>}
        <aside hidden={props.mode!=='monitor'||!monitorInspectOpen} className="atlas-side-panel atlas-inspection-panel atlas-monitor-inspection" aria-label="Monitoring item details">{props.monitorHasSelection?props.monitorInspector:<><div className="atlas-panel-heading"><h2>Item details</h2><button aria-label="Close item details" onClick={()=>setMonitorInspectOpen(false)}>×</button></div><p className="atlas-panel-empty">Select a location, event or vessel on the map or in a list.</p></>}</aside>
        <aside id="atlas-recovery-inspector" hidden={props.mode!=='recovery'||!recoveryInspectOpen} className="atlas-side-panel atlas-inspection-panel atlas-recovery-inspection" aria-label="Recovery details"><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">SELECTED ITEM</p><h2>{props.recoveryLocationDetails?'Location details':'Recovery details'}</h2></div><button aria-label="Close recovery details" onClick={()=>setRecoveryInspectOpen(false)}>×</button></div><div className="atlas-panel-scroll">{props.recoveryLocationDetails}<div ref={props.recoveryInspectorTargetRef} hidden={Boolean(props.recoveryLocationDetails)}/></div></aside>

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
