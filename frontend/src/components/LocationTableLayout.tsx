import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export type LocationView = 'map' | 'locations';
type LayoutPreference = { open: boolean; height: number };

function readLayout(workspace: 'portfolio' | 'exposure'): LayoutPreference {
  const height = Math.max(160, Math.min(250, window.innerHeight * .3));
  try {
    const value = JSON.parse(localStorage.getItem(`catlas.${workspace}.layout.v1`) ?? 'null');
    return {
      open: typeof value?.open === 'boolean' ? value.open : value?.layout !== 'map',
      height: Number.isFinite(value?.height) ? Math.max(140, Math.min(window.innerHeight * .5, value.height)) : height,
    };
  } catch { return { open: true, height }; }
}

/** Desktop preferences and mobile navigation are independent, so a phone visit never hides the desktop table. */
export function useLocationTableLayout(workspace: 'portfolio' | 'exposure') {
  const [preference] = useState(() => readLayout(workspace));
  const [desktopOpen, setDesktopOpen] = useState(preference.open);
  const [height, setHeight] = useState(preference.height);
  const [mobile, setMobile] = useState(() => window.innerWidth <= 760);
  const [view, setView] = useState<LocationView>('map');
  useEffect(() => {
    const query = window.matchMedia('(max-width:760px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(`catlas.${workspace}.layout.v1`, JSON.stringify({ open: desktopOpen, height })); }
    catch { /* The current view remains usable without browser storage. */ }
  }, [workspace, desktopOpen, height]);
  const open = mobile ? view === 'locations' : desktopOpen;
  const setOpen: Dispatch<SetStateAction<boolean>> = useCallback(next => {
    if (mobile) setView(previous => (typeof next === 'function' ? next(previous === 'locations') : next) ? 'locations' : 'map');
    else setDesktopOpen(next);
  }, [mobile]);
  return { open, setOpen, height, setHeight, mobile, view, setView };
}

export function LocationViewSwitch({ view, onChange }: { view: LocationView; onChange: (view: LocationView) => void }) {
  return <div className="location-view-switch" role="group" aria-label="Location view">
    <button type="button" aria-pressed={view === 'map'} onClick={() => onChange('map')}>Map</button>
    <button type="button" aria-pressed={view === 'locations'} aria-expanded={view === 'locations'} onClick={() => onChange('locations')}>Locations</button>
  </div>;
}
