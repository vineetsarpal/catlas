import { useEffect, useState } from 'react';
import { WorkspaceIcon, WorkspaceRail } from '../components/WorkspaceRail';
import type { WorkspacePresentation } from '../components/WorkspacePresentation';
import { sameRecoveryEvent, type EventInput } from '../events/model';
import type { InsuredLocation } from '../exposure/model';
import { mainContract } from './data/fixtures';
import RecoveryWorkbench, { type RecoveryContext } from './RecoveryWorkbench';
import type { RecoveryView } from './RecoveryInspector';

type RecoveryWorkspaceInput = {
  active: boolean;
  observation: EventInput | null;
  onObservationChange: (event: EventInput | null) => void;
  context: RecoveryContext;
  onContextChange: (context: RecoveryContext) => void;
  selectedId: string;
  location?: InsuredLocation;
  onClearLocation: () => void;
  selectionRequest: number;
  layersTargetRef: (node: HTMLDivElement | null) => void;
};
const money = (amount: number, currency: string) => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString('en-US')}`; }
};

/** Keeps the retained Recovery workbench mounted while owning its surrounding presentation. */
export function useRecoveryWorkspace({ active, observation, onObservationChange, context, onContextChange, selectedId, location, onClearLocation, selectionRequest, layersTargetRef }: RecoveryWorkspaceInput): WorkspacePresentation {
  const [view, setView] = useState<RecoveryView>('assessment');
  const [layers, setLayers] = useState(false);
  const [open, setOpen] = useState(() => window.innerWidth > 760);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectorTarget, setInspectorTarget] = useState<HTMLDivElement | null>(null);
  const focus = selectedId || context.evaluation || context.simple ? `${selectionRequest}:${selectedId}:${context.evaluation?.id ?? ''}:${context.selectedArea}:${context.simple?.result.recovery ?? ''}:${context.simple?.version ?? ''}` : '';
  useEffect(() => {
    if (focus) {
      setInspectOpen(true);
      if (window.innerWidth <= 760) setOpen(false);
    }
  }, [focus]);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width:760px)');
    const change = (event: MediaQueryListEvent) => { if (event.matches) setOpen(false); };
    mobile.addEventListener('change', change);
    return () => mobile.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); setOpen(false); setInspectOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [active]);
  function choose(next: RecoveryView | 'layers') {
    const close = open && (next === 'layers' ? layers : !layers && view === next);
    setLayers(next === 'layers');
    if (next !== 'layers') setView(next);
    setOpen(!close);
    if (window.innerWidth <= 760) setInspectOpen(false);
  }
  const matches = Boolean(context.evaluation && sameRecoveryEvent(context.evaluation.event, observation));
  const simple = context.simple && sameRecoveryEvent(context.simple.event, observation) ? context.simple : null;
  const locationDetails = location ? <aside className="exposure-inspector" aria-label="Selected insured location"><h2>{location.name}</h2><p>{location.id}</p><dl><dt>Coordinates</dt><dd>{location.latitude}, {location.longitude}</dd><dt>Insured value</dt><dd>{location.value === null ? 'Unknown' : money(location.value, location.currency)}</dd><dt>Region</dt><dd>{location.region || 'Not supplied'}</dd><dt>Business line</dt><dd>{location.businessLine || 'Not supplied'}</dd></dl><p>Portfolio location context. Insured value is not an event loss estimate or contractual recovery.</p><button onClick={onClearLocation}>Show recovery explanation</button></aside> : null;
  return {
    eyebrow: <span className="exposure-eyebrow">EVENT RECOVERY</span>,
    headerActions: <button aria-expanded={open} aria-controls="atlas-recovery-panel" onClick={() => { setOpen(value => !value); if (window.innerWidth <= 760) setInspectOpen(false); }}>{open ? 'Hide options' : 'Recovery options'}</button>,
    historyAction: <button onClick={() => { setLayers(false); setView('history'); setOpen(true); if (window.innerWidth <= 760) setInspectOpen(false); requestAnimationFrame(() => document.querySelector('#atlas-recovery-panel [aria-label="Retained recovery assessments"], #atlas-recovery-panel [aria-label="Retained evaluation history"]')?.scrollIntoView({ block: 'start' })); }}>Recovery history</button>,
    summary: context.kind !== 'parametric' ? <section className="recovery-summary" aria-label="Event recovery summary"><div><span>Provisional recovery</span><strong>{simple ? money(simple.result.recovery, simple.position.currency) : 'Not assessed'}</strong></div><div><span>Estimated retained loss</span><b>{simple ? money(simple.result.retainedLoss, simple.position.currency) : 'Not assessed'}</b></div><div><span>Assessment</span><b>{simple?.version ? `Reviewed v${simple.version}` : simple ? 'Draft · requires review' : 'Enter loss and layer terms'}</b></div></section> : <section className="recovery-summary" aria-label="Contractual recovery summary"><div><span>Provisional recovery</span><strong>{matches ? (context.evaluation?.assessment.amount === null ? 'Indeterminate' : money(context.evaluation!.assessment.amount!, 'USD')) : 'Not evaluated'}</strong></div><div><span>Imported contract</span><b>{context.evaluation?.contract.name ?? mainContract.name}</b></div><div><span>Assessment</span><b>{matches ? context.evaluation?.assessment.status : 'Evaluate selected observation'}</b></div></section>,
    rail: active && <WorkspaceRail label="Recovery tools" active={open ? (layers ? 'layers' : view) : null} onSelect={id => choose(id as RecoveryView | 'layers')} items={[{ id: 'layers', label: 'Layers', icon: 'layers' }, { id: 'assessment', label: 'Assessment', icon: 'assessment' }, { id: 'history', label: 'History', icon: 'history' }]}><div className="atlas-rail-spacer"/><button aria-label="Recovery details" aria-expanded={inspectOpen} onClick={() => { setInspectOpen(value => !value); if (window.innerWidth <= 760) setOpen(false); }}><WorkspaceIcon name="inspection"/><span>Details</span></button></WorkspaceRail>,
    options: <aside id="atlas-recovery-panel" hidden={!active || !open} className="atlas-side-panel atlas-recovery-panel" aria-label="Recovery investigation"><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">RECOVERY</p><h2>{layers ? 'Map layers' : view === 'history' ? 'Recovery history' : 'Recovery assessment'}</h2></div><button aria-label="Close recovery options" onClick={() => setOpen(false)}>×</button></div><div className="atlas-panel-scroll"><div hidden={layers}><RecoveryWorkbench inspectorTarget={inspectorTarget} view={view} onViewChange={setView} sharedEvent={observation} onEventChange={onObservationChange} onContextChange={onContextChange}/></div><div hidden={!layers} ref={active ? layersTargetRef : undefined}/></div></aside>,
    inspector: <aside id="atlas-recovery-inspector" hidden={!active || !inspectOpen} className="atlas-side-panel atlas-inspection-panel atlas-recovery-inspection" aria-label="Recovery details"><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">SELECTED ITEM</p><h2>{locationDetails ? 'Location details' : 'Recovery details'}</h2></div><button aria-label="Close recovery details" onClick={() => setInspectOpen(false)}>×</button></div><div className="atlas-panel-scroll">{locationDetails}<div ref={setInspectorTarget} hidden={Boolean(locationDetails)}/></div></aside>,
  };
}
