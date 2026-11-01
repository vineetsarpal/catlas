import { useEffect, useRef, useState, type ReactNode } from 'react';

export function ResizableLocationTable({ open, children, onHide, layoutHeight, onHeightChange }: { open: boolean; children: (layoutActions: ReactNode) => ReactNode; onHide?: () => void; layoutHeight?: number; onHeightChange?: (height: number) => void }) {
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; y: number; height: number } | null>(null);
  const [available, setAvailable] = useState(400);
  const [localHeight, setLocalHeight] = useState(250);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!open) setExpanded(false); }, [open]);
  useEffect(() => {
    const handle = divider.current, stage = handle?.parentElement;
    if (!stage || !handle) return;
    const measure = () => {
      const fixedHeight = [...stage.children].reduce((sum, child) => child.matches('.atlas-map-surface,.portfolio-results-drawer') ? sum : sum + child.getBoundingClientRect().height, 0);
      setAvailable(Math.max(0, stage.clientHeight - fixedHeight));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    [...stage.children].filter(child => !child.matches('.atlas-map-surface,.portfolio-results-drawer')).forEach(child => observer.observe(child));
    measure();
    return () => observer.disconnect();
  }, [open, expanded]);
  const minimum = Math.min(160, available / 2);
  const maximum = Math.max(minimum, available - 160);
  const height = Math.max(minimum, Math.min(maximum, layoutHeight ?? localHeight));
  function resize(next: number) {
    if (available > 0) {
      const value = Math.max(minimum, Math.min(maximum, next));
      setLocalHeight(value);
      onHeightChange?.(value);
    }
  }
  useEffect(() => {
    const stage = divider.current?.parentElement;
    if (!stage) return;
    stage.classList.toggle('portfolio-layout-list', open && (expanded || window.innerWidth <= 760));
    return () => stage.classList.remove('portfolio-layout-list');
  }, [open, expanded]);
  useEffect(() => {
    const query = window.matchMedia('(max-width:760px)');
    const update = () => divider.current?.parentElement?.classList.toggle('portfolio-layout-list', open && (expanded || query.matches));
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [open, expanded]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (divider.current?.closest('main')?.hidden) return;
      if (event.key === 'Escape' && expanded && !event.defaultPrevented && !document.querySelector('[aria-modal="true"]')) {
        event.preventDefault(); setExpanded(false);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded]);
  return <>
    <div ref={divider} hidden={!open || expanded} className="atlas-table-resize portfolio-table-divider" role="separator" tabIndex={0}
      aria-label="Resize map and locations table" aria-orientation="horizontal" aria-controls="portfolio-location-table"
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
    <div id="portfolio-location-table" className="portfolio-results-drawer" hidden={!open} style={{ height }}>
      {children(<>
        <button className="exposure-expand-locations" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Restore map' : 'Expand locations'}</button>
        {onHide && <button aria-controls="portfolio-location-table" onClick={() => { setExpanded(false); onHide(); }}>Hide locations</button>}
      </>)}
    </div>
  </>;
}
