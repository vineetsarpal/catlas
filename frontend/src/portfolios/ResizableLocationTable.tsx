import { useEffect, useRef, useState, type ReactNode } from 'react';

export function ResizableLocationTable({ open, children }: { open: boolean; children: ReactNode }) {
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; y: number; height: number } | null>(null);
  const [available, setAvailable] = useState(400);
  const [fraction, setFraction] = useState(.4);
  useEffect(() => {
    const handle = divider.current, stage = handle?.parentElement;
    if (!stage || !handle) return;
    const measure = () => {
      const status = stage.querySelector('.atlas-map-status');
      setAvailable(Math.max(0, stage.clientHeight - (status?.getBoundingClientRect().height ?? 0) - handle.getBoundingClientRect().height));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => observer.disconnect();
  }, [open]);
  const minimum = Math.min(140, available / 2);
  const maximum = Math.max(minimum, available - 100);
  const height = Math.max(minimum, Math.min(maximum, available * fraction));
  function resize(next: number) {
    if (available > 0) setFraction(Math.max(minimum, Math.min(maximum, next)) / available);
  }
  return <>
    <div ref={divider} hidden={!open} className="portfolio-table-divider" role="separator" tabIndex={0}
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
      onDoubleClick={() => setFraction(.4)}
      onKeyDown={event => {
        const next = event.key === 'ArrowUp' ? height + 32 : event.key === 'ArrowDown' ? height - 32 : event.key === 'Home' ? minimum : event.key === 'End' ? maximum : null;
        if (next !== null) { event.preventDefault(); resize(next); }
      }}><span /></div>
    <div id="portfolio-location-table" className="portfolio-results-drawer" hidden={!open} style={{ height }}>{children}</div>
  </>;
}
