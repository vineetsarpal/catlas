import type { ReactNode } from 'react';
export type WorkspaceMode = 'portfolios' | 'monitor' | 'exposure' | 'recovery';
export function WorkbenchHeader({active,onModeChange,portfolioSelector}:{active:WorkspaceMode;onModeChange:(mode:WorkspaceMode)=>void;portfolioSelector?:ReactNode}) {
  return <header className="workbench-header">
    <a className="workbench-brand" href="./"><span className="workbench-mark" aria-hidden="true">◈</span>catlas<span className="workbench-edition">Workbench</span></a>
    <nav aria-label="Workspace">{(['portfolios','monitor','exposure','recovery'] as const).map(mode=><button key={mode} aria-current={active===mode?'page':undefined} aria-pressed={active===mode} onClick={()=>onModeChange(mode)}>{{portfolios:'Portfolios',monitor:'Monitor',exposure:'Exposure',recovery:'Recovery'}[mode]}</button>)}</nav>
    <span className="workbench-environment"><span aria-hidden="true" />{active === 'recovery' ? 'Provisional · saved locally' : active === 'monitor' ? 'Public feeds · local portfolio' : 'Portfolios saved in this browser'}</span>
    {portfolioSelector}
  </header>;
}
