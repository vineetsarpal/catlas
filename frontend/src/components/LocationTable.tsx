import './location-table.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { useLocationTableLayout } from './LocationTableLayout';

/** Shared browser layout implementation; callers retain panel and table-content ownership. */
type Layout = ReturnType<typeof useLocationTableLayout>;
export function LocationTable({ layout, workspace, active = true, children }: { layout: Layout; workspace: 'portfolio' | 'exposure'; active?: boolean; children: (layoutActions: ReactNode) => ReactNode }) {
  const { open, expanded, setExpanded, height: layoutHeight, setHeight: onHeightChange, mobile } = layout;
  const onHide = () => layout.setOpen(false);
  const portfolio = workspace === 'portfolio';
  const id = portfolio ? 'portfolio-location-table' : 'atlas-location-table';
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; y: number; height: number } | null>(null);
  const [available, setAvailable] = useState(400);
  useEffect(() => {
    const handle = divider.current, stage = handle?.closest<HTMLElement>('.atlas-map-stage');
    if (!stage || !handle) return;
    const measure = () => {
      const fixedHeight = [...stage.children].reduce((sum, child) => child.matches('.atlas-map-surface,.portfolio-results-drawer,.atlas-results-drawer') ? sum : sum + child.getBoundingClientRect().height, 0);
      setAvailable(Math.max(0, stage.clientHeight - fixedHeight));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    [...stage.children].filter(child => !child.matches('.atlas-map-surface,.portfolio-results-drawer,.atlas-results-drawer')).forEach(child => observer.observe(child));
    measure();
    return () => observer.disconnect();
  }, [open, expanded, active]);
  const minimum = Math.min(160, available / 2);
  const maximum = Math.max(minimum, available - 160);
  const height = Math.max(minimum, Math.min(maximum, layoutHeight));
  function resize(next: number) {
    if (available > 0) {
      const value = Math.max(minimum, Math.min(maximum, next));
      onHeightChange(value);
    }
  }
  useEffect(() => {
    const stage = divider.current?.closest('.atlas-map-stage');
    if (!portfolio || !stage) return;
    stage.classList.toggle('portfolio-layout-list', open && (expanded || mobile));
    return () => stage.classList.remove('portfolio-layout-list');
  }, [portfolio, open, expanded, mobile]);
  return <>
    <div ref={divider} hidden={!open || expanded || mobile || !active} className={`atlas-table-resize location-table-divider${portfolio ? ' portfolio-table-divider' : ''}`} role="separator" tabIndex={0}
      aria-label="Resize map and locations table" aria-orientation="horizontal" aria-controls={id}
      aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(height)}
      aria-valuetext={`${Math.round(height)} pixels of table height`} title="Drag to resize · Arrow keys to adjust · Double-click to reset"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, y: event.clientY, height };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (start?.pointer === event.pointerId) resize(start.height + start.y - event.clientY);
      }}
      onPointerUp={event => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => resize(250)}
      onKeyDown={event => {
        const next = event.key === 'ArrowUp' ? height + 32 : event.key === 'ArrowDown' ? height - 32 : event.key === 'Home' ? minimum : event.key === 'End' ? maximum : null;
        if (next !== null) { event.preventDefault(); resize(next); }
      }}><span /></div>
    <div id={id} className={portfolio ? "portfolio-results-drawer" : "atlas-results-drawer"} hidden={!open || !active} style={{ height }}>
      {children(<>
        <button className="exposure-expand-locations" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Restore map' : 'Expand locations'}</button>
        <button aria-controls={id} onClick={() => { setExpanded(false); onHide(); }}>Hide locations</button>
      </>)}
    </div>
  </>;
}
