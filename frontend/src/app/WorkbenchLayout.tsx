import { LocationTable } from '../components/LocationTable';
import { useEffect, useState, type ReactNode } from 'react';
import { WorkspaceIcon } from '../components/WorkspaceRail';
import type { WorkspacePresentation } from '../components/WorkspacePresentation';
import { WorkbenchHeader } from './WorkbenchHeader';
import type { WorkspaceMode } from './navigation';
import { WorkbenchDialog } from '../components/WorkbenchDialog';
import { LocationViewSwitch, useLocationTableLayout } from '../components/LocationTableLayout';

export type WorkspacePanel = 'filters' | 'regions' | 'inspection' | 'events' | 'history' | 'layers' | 'analysis' | null;
type WorkbenchLayoutProps = {
  layersTargetRef:(node:HTMLDivElement|null)=>void;
  mode: WorkspaceMode; onModeChange: (mode:WorkspaceMode)=>void;
  portfolios: ReactNode; portfolioSelector: ReactNode; snapshotNotice: ReactNode;
  monitor: WorkspacePresentation; recovery: WorkspacePresentation;
  hasSelectedEvent: boolean; onInvestigateSelected: ()=>void;
  panel: WorkspacePanel; onPanel: (value: WorkspacePanel) => void;
  evidenceSummary: ReactNode; assessmentActions: ReactNode; locationsRequest: number;
  catalog?: ReactNode; evidenceInspector?: ReactNode; map: ReactNode; analysis: ReactNode; exposureFilterCount:number; filters: ReactNode; inspector: ReactNode; regions: ReactNode; locations: (layoutActions:ReactNode)=>ReactNode;
  discovery: ReactNode; inputs: ReactNode; actions: ReactNode; identity: ReactNode; metrics: ReactNode; chips: ReactNode; printProvenance: ReactNode;
  eventName: string; magnitude?: number | null; portfolioName: string; version: string;
  hasLocationSelection?: boolean; hasRecord: boolean; inspectionActive?: boolean; busy: boolean; onReplay: () => void;
  message: string; isError: boolean;
};
const panelNames = { analysis:'Analysis settings', filters:'Filter locations', regions:'Explore regions', inspection:'Location details', events:'Choose an earthquake', history:'Investigation history', layers:'Map layers' };
export function WorkbenchLayout(props: WorkbenchLayoutProps) {
  const {panel,onPanel} = props;
  useEffect(()=>{document.querySelector('#atlas-side-panel .atlas-panel-scroll')?.scrollTo({top:0});},[panel]);
  const layout = useLocationTableLayout('exposure');
  const { open: tableOpen, setOpen: setTableOpen, mobile } = layout;
  const [evidenceOpen,setEvidenceOpen] = useState(false);
  const toggleTable = () => {layout.setExpanded(false);setTableOpen(value=>!value);setEvidenceOpen(false);if(mobile)onPanel(null);};
  useEffect(()=>{if(props.locationsRequest>0){setTableOpen(true);setEvidenceOpen(false);}},[props.locationsRequest]);
  useEffect(()=>{if(panel)setEvidenceOpen(false);},[panel]);
  const modal = (props.mode==='monitor'||props.mode==='recovery')&&(panel==='events'||panel==='history');
  useEffect(()=>{
    const close = (event: KeyboardEvent) => {
      if(props.mode!=='exposure')return;
      if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('[aria-modal="true"]')) { event.preventDefault(); if(panel)onPanel(null);else if(evidenceOpen)setEvidenceOpen(false);else layout.dismiss(); }
    };
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[panel,onPanel,props.mode,evidenceOpen,mobile,layout.expanded,layout.dismiss]);
  return <div className={`exposure-page atlas-map-workspace is-${props.mode}${props.mode==='exposure'&&mobile&&tableOpen?' location-view-locations':''}`}>
    <WorkbenchHeader active={props.mode} onModeChange={props.onModeChange} portfolioSelector={props.portfolioSelector}/>
    {props.mode==='portfolios'&&props.message&&<div className="atlas-message" role="alert">{props.message}</div>}
    {props.portfolios}
    <main hidden={props.mode==='portfolios'}>
      {props.mode==='exposure'&&props.snapshotNotice}
      <header className="atlas-case-header">
        <div className="atlas-case-title"><div className="atlas-title-eyebrow">{props.mode==='monitor'?props.monitor.eyebrow:<>{props.mode==='recovery'?props.recovery.eyebrow:<span className="exposure-eyebrow">EXPOSURE INVESTIGATION</span>}<span className="atlas-case-version">{props.version}</span></>}</div><h1>{props.eventName}{props.magnitude!=null&&<span> M{props.magnitude}</span>}</h1></div>
        <div className="atlas-case-context"><span title={props.portfolioName}>{props.portfolioName}</span></div>
        <div className="atlas-case-actions">{props.mode==='exposure'&&props.assessmentActions}{props.mode==='monitor'&&props.monitor.headerActions}{props.mode==='recovery'&&props.recovery.headerActions}{props.mode==='exposure'&&props.hasRecord&&<button className="atlas-recovery-action" onClick={()=>props.onModeChange('recovery')}>Evaluate recovery →</button>}{props.mode!=='monitor'&&<button onClick={()=>onPanel('events')}>Change event</button>}{props.mode==='exposure'?<button onClick={()=>onPanel('history')}>History</button>:props.mode==='recovery'&&props.recovery.historyAction}</div>
      </header>
      {props.mode==='exposure'&&<div className="atlas-evidence-bar"><div>{props.evidenceSummary}</div><button aria-expanded={evidenceOpen} aria-controls="atlas-evidence-drawer" onClick={()=>{setEvidenceOpen(value=>!value);if(panel&&(mobile||panel==='inspection'))onPanel(null);}}>Evidence {evidenceOpen?'−':'+'}</button></div>}
      <div className="atlas-summary"><span className="atlas-summary-scope">{props.mode==='monitor'?'MONITOR':props.mode==='exposure'?'FULL PORTFOLIO':'CONTRACTUAL'}</span>{props.mode==='monitor'?props.monitor.summary:props.mode==='exposure'?props.metrics:props.recovery.summary}</div>
      {!modal&&props.message&&<div className="atlas-message" role={props.isError?'alert':'status'}>{props.message}</div>}
      {props.mode==='exposure'&&mobile&&<LocationViewSwitch view={layout.view} onChange={view=>{layout.setView(view);onPanel(null);setEvidenceOpen(false);}}/>}
      <div className={`atlas-work-area${props.mode==='exposure'&&props.catalog?` has-event-catalog${panel&&panel!=='inspection'?' has-exposure-sidebar':''}`:''}`}>
        {props.mode==='exposure'&&<nav className="atlas-tool-rail" aria-label="Investigation tools">{(['events','history','layers','filters','analysis','regions'] as const).map(value=><button key={value} aria-label={value==='events'?'Events':value==='history'?'Saved':value==='layers'?'Layers':panelNames[value]} aria-expanded={panel===value} aria-controls="atlas-side-panel" onClick={()=>{setEvidenceOpen(false);onPanel(panel===value?null:value);}}><WorkspaceIcon name={value==='analysis'?'settings':value}/><span>{value==='events'?'Events':value==='history'?'Saved':value==='filters'?'Filters':value==='analysis'?'Analysis':value==='layers'?'Layers':'Regions'}</span>{value==='filters'&&props.exposureFilterCount>0&&<b className="workspace-rail-badge" aria-hidden="true">{props.exposureFilterCount}</b>}</button>)}{!mobile&&<button aria-label="Locations" aria-expanded={tableOpen} aria-controls="atlas-location-table" onClick={toggleTable}><WorkspaceIcon name="table"/><span>Locations</span></button>}<div className="atlas-rail-spacer"/><button aria-label="Location details" aria-expanded={panel==='inspection'} aria-controls="atlas-exposure-inspector" onClick={()=>{setEvidenceOpen(false);onPanel(panel==='inspection'?null:'inspection');}}><WorkspaceIcon name="inspection"/><span>Details</span></button></nav>}
        {props.mode==='exposure'&&<aside hidden={!panel||panel==='inspection'} className="atlas-side-panel atlas-exposure-panel atlas-catalog-panel" id="atlas-side-panel" aria-label={panel==='history'?'Saved investigations':panel==='events'?'Earthquake catalog':panel?panelNames[panel]:'Exposure tools'}><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">EXPOSURE</p><h2>{panel==='history'?'Saved investigations':panel==='events'?'Events':panel==='regions'?'Regional exposure':panel?panelNames[panel]:'Exposure tools'}</h2></div>{mobile&&<button aria-label={`Back to ${layout.view==='locations'?'Locations':'Map'}`} onClick={()=>onPanel(null)}>← Back</button>}<button aria-label="Close side panel" onClick={()=>onPanel(null)}>×</button></div><div className="atlas-panel-scroll"><div hidden={panel!=='events'&&panel!=='history'}>{panel==='events'&&<button className="atlas-catalog-replay" disabled={props.busy} onClick={props.onReplay}>Investigate Ridgecrest replay</button>}{props.catalog}</div><div hidden={panel!=='layers'} ref={props.layersTargetRef}/><div hidden={panel!=='filters'}>{props.filters}</div><div hidden={panel!=='analysis'}>{props.analysis}</div><div hidden={panel!=='regions'}>{props.regions||<p className="atlas-panel-empty">Assess an earthquake to see regional exposure.</p>}</div></div></aside>}
        {props.monitor.rail}
        {props.recovery.rail}
        {props.monitor.options}
        {props.recovery.options}
        <div className={`atlas-map-stage${props.mode==='exposure'?` exposure-layout-${tableOpen?(mobile||layout.expanded?'list':'split'):'map'}`:''}`}>
          <div className="atlas-map-surface">{props.map}{props.mode==='exposure'&&panel!=='events'&&panel!=='inspection'&&!props.hasLocationSelection&&!props.hasRecord&&!props.inspectionActive&&<div className="atlas-start-card"><p className="exposure-eyebrow">START YOUR INVESTIGATION</p><h2>{props.hasSelectedEvent?'Investigate this earthquake.':'Put your portfolio in context.'}</h2><p>Choose an earthquake to explore shaking evidence and the locations that need attention.</p><button className="exposure-primary" disabled={props.busy} onClick={props.hasSelectedEvent?props.onInvestigateSelected:props.onReplay}>{props.hasSelectedEvent?'Investigate selected earthquake':'Investigate Ridgecrest replay'}</button><button onClick={()=>onPanel('events')}>Choose another earthquake →</button><small>Historical earthquake · Uses the selected portfolio</small></div>}</div>
          {props.mode==='exposure'&&props.chips&&<div className="atlas-map-status"><div className="atlas-active-filters" aria-label="Active map filters">{props.chips}</div></div>}
          <LocationTable layout={layout} workspace="exposure" active={props.mode==='exposure'}>{props.locations}</LocationTable>
        </div>
        {props.mode==='exposure'&&panel==='inspection'&&<aside id="atlas-exposure-inspector" className="atlas-side-panel atlas-inspection-panel atlas-exposure-inspection" aria-label="Location details"><div className="atlas-panel-heading"><h2>Location details</h2>{mobile&&<button aria-label={`Back to ${layout.view==='locations'?'Locations':'Map'}`} onClick={()=>onPanel(null)}>← Back</button>}<button aria-label="Close location details" onClick={()=>onPanel(null)}>×</button></div><div className="atlas-panel-scroll">{props.inspector}</div></aside>}
        {props.mode==='exposure'&&props.evidenceInspector&&<aside id="atlas-evidence-drawer" hidden={!evidenceOpen} className="atlas-evidence-panel" aria-label="Earthquake evidence inspector"><div className="atlas-panel-heading"><strong>Evidence</strong><button aria-label="Close evidence" onClick={()=>setEvidenceOpen(false)}>×</button></div>{props.evidenceInspector}</aside>}
        {props.monitor.inspector}
        {props.recovery.inspector}

      </div>
      {props.printProvenance}
    </main>
    {modal&&<WorkbenchDialog title={panelNames[panel]} eyebrow="INVESTIGATION WORKSPACE" className={`atlas-modal-${panel}`} focusContent onClose={()=>onPanel(null)}>
      {props.message&&<div className="atlas-message" role={props.isError?'alert':'status'}>{props.message}</div>}{panel==='events'?<><button className="exposure-primary" disabled={props.busy} onClick={props.onReplay}>Investigate Ridgecrest replay</button>{props.discovery}</>:<>{props.identity}{panel==='history'&&props.actions}<div className="atlas-management-content">{props.inputs}</div></>}
    </WorkbenchDialog>}
  </div>;
}
