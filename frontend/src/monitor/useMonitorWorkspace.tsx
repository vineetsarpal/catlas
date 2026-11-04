import { useEffect, useState } from 'react';
import { WorkspaceIcon, WorkspaceRail } from '../components/WorkspaceRail';
import type { WorkspacePresentation } from '../components/WorkspacePresentation';
import type { Earthquake, Portfolio } from '../exposure/model';
import { attentionMonitorItems, type MonitorItem } from './model';
import { MonitorInspector } from './MonitorInspector';
import { MonitorLayerControls } from './MonitorLayerControls';
import { MonitorPanel, type MonitorPanelView } from './MonitorPanel';
import type { MonitorState } from './useMonitor';

type MonitorWorkspaceInput = {
  active: boolean;
  state: MonitorState;
  items: MonitorItem[];
  portfolio: Portfolio;
  busy: boolean;
  onCapture: (event: Earthquake) => void;
  onPortfolio: () => void;
  onFitPortfolio: () => void;
};

/** Keeps Monitor navigation, selection and responsive presentation in one module. */
export function useMonitorWorkspace({ active, state, items, portfolio, busy, onCapture, onPortfolio, onFitPortfolio }: MonitorWorkspaceInput): WorkspacePresentation {
  const [view, setView] = useState<MonitorPanelView>('attention');
  const [open, setOpen] = useState(() => window.innerWidth > 760);
  const [inspectOpen, setInspectOpen] = useState(false);
  const hasSelection = items.some(item => item.key === state.selected);
  const live = state.online && [state.prefs.earthquakes, state.prefs.cyclones, state.prefs.fires, state.prefs.perimeters, state.prefs.alerts, state.prefs.wind, state.prefs.vessels].some(Boolean);
  useEffect(() => { document.querySelector('#atlas-monitor-panel .atlas-panel-scroll')?.scrollTo({ top: 0 }); }, [view]);
  useEffect(() => {
    if (state.focus > 0) {
      setInspectOpen(true);
      if (window.innerWidth <= 760) setOpen(false);
    }
  }, [state.focus]);
  useEffect(() => { if (!hasSelection) setInspectOpen(false); }, [hasSelection]);
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
  function choose(next: MonitorPanelView) {
    const close = open && view === next;
    setView(next); setOpen(!close);
    if (window.innerWidth <= 760) setInspectOpen(false);
  }
  const filterCount = Number(state.prefs.nearPortfolio) + Number(state.prefs.watchedOnly);
  const loading = state.earthquakes.loading || state.cyclones.loading || state.fires.loading || state.perimeters.loading || state.alerts.loading;
  const unavailable = (state.prefs.earthquakes && state.earthquakes.error) || (state.prefs.cyclones && state.cyclones.error) || (state.prefs.fires && (state.fires.error || state.fires.data?.stale || state.fires.data?.warning)) || (state.prefs.perimeters && (state.perimeters.error || state.perimeters.data?.stale || state.perimeters.data?.warning)) || (state.prefs.alerts && (state.alerts.error || state.alerts.data?.stale || state.alerts.data?.warning));
  return {
    eyebrow: <><span className={`monitor-live-badge${live ? ' is-live' : ''}`} title={live ? 'Automatic feed checks are enabled. Source publication may lag; see Feeds for availability.' : 'Monitoring paused while offline or all feeds are off.'}><span className="monitor-live-dot" aria-hidden="true"/>{live ? 'Live' : 'Paused'}</span><span className="exposure-eyebrow">MONITORING</span></>,
    headerActions: <button aria-expanded={open} aria-controls="atlas-monitor-panel" onClick={() => { setOpen(value => !value); if (window.innerWidth <= 760) setInspectOpen(false); }}>{open ? 'Hide options' : 'Monitor options'}</button>,
    summary: <section className="monitor-summary" aria-label="Monitoring summary"><span><b>{state.prefs.earthquakes ? (state.earthquakes.data?.events.length ?? '—') : 'Off'}</b> earthquakes · past 24h</span><span><b>{state.prefs.cyclones ? (state.cyclones.data?.storms.length ?? '—') : 'Off'}</b> cyclone advisories</span><span><b>{state.prefs.perimeters ? (state.perimeters.data ? items.filter(item => item.kind === 'perimeter').length : '—') : 'Off'}</b> fire reports / areas</span><span><b>{state.prefs.alerts ? (state.alerts.data?.rows.length ?? '—') : 'Off'}</b> weather alerts</span><span><b>{portfolio.locations.length}</b> portfolio locations</span><span>{!state.online ? 'Offline · paused' : loading ? 'Checking feeds…' : unavailable ? 'Some feeds unavailable' : 'Latest available public data'} · {state.prefs.watchlist.length} watched</span></section>,
    rail: active && <WorkspaceRail label="Monitor tools" active={open ? view : null} onSelect={id => choose(id as MonitorPanelView)} items={[{ id: 'controls', label: 'Layers', icon: 'layers' }, { id: 'filters', label: 'Map filters', icon: 'filters', badge: filterCount }, { id: 'attention', label: 'Attention', icon: 'attention' }, { id: 'portfolio', label: 'Locations', icon: 'locations' }, { id: 'watchlist', label: 'Watchlist', icon: 'watchlist' }, { id: 'layers', label: 'Feeds', icon: 'feeds' }]}><div className="atlas-rail-spacer"/><button aria-label="Item details" aria-expanded={inspectOpen} onClick={() => { setInspectOpen(value => !value); if (window.innerWidth <= 760) setOpen(false); }}><WorkspaceIcon name="inspection"/><span>Details</span></button></WorkspaceRail>,
    options: <aside id="atlas-monitor-panel" hidden={!active || !open} className="atlas-side-panel atlas-monitor-panel" aria-label="Monitor details"><div className="atlas-panel-heading"><div><p className="exposure-eyebrow">MONITOR</p><h2>{{ attention: 'Portfolio attention', portfolio: 'Portfolio locations', watchlist: 'Watchlist', layers: 'Feed status', controls: 'Map layers', filters: 'Map filters' }[view]}</h2></div><button aria-label="Close monitor details" onClick={() => setOpen(false)}>×</button></div><div className="atlas-panel-scroll">{active && <MonitorPanel view={view} controls={<MonitorLayerControls state={state} canFitPortfolio={Boolean(portfolio.locations.length)} onFitPortfolio={onFitPortfolio}/>} state={state} items={attentionMonitorItems(items, state)} allItems={items} portfolio={portfolio} onPortfolio={onPortfolio}/>}</div></aside>,
    inspector: <aside hidden={!active || !inspectOpen} className="atlas-side-panel atlas-inspection-panel atlas-monitor-inspection" aria-label="Monitoring item details">{hasSelection ? <MonitorInspector state={state} items={items} portfolio={portfolio} busy={busy} onCapture={onCapture}/> : <><div className="atlas-panel-heading"><h2>Item details</h2><button aria-label="Close item details" onClick={() => setInspectOpen(false)}>×</button></div><p className="atlas-panel-empty">Select a location, event or vessel on the map or in a list.</p></>}</aside>,
  };
}
