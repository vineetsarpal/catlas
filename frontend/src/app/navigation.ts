export type WorkspaceMode = 'portfolios' | 'monitor' | 'exposure' | 'recovery';

/** Both entry pages and browser history interpret workspace URLs identically. */
export function workspaceModeFromUrl(url: URL, fallback: WorkspaceMode = url.pathname.endsWith('exposure.html') ? 'exposure' : 'portfolios'): WorkspaceMode {
  const mode = url.searchParams.get('mode');
  return mode === 'portfolios' || mode === 'monitor' || mode === 'exposure' || mode === 'recovery' ? mode : fallback;
}
