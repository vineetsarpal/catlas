type WorkspaceMode = 'monitor' | 'exposure' | 'recovery';

export function WorkbenchHeader({active,onModeChange,onPortfolio,portfolioName}:{active:WorkspaceMode;onModeChange:(mode:WorkspaceMode)=>void;onPortfolio:()=>void;portfolioName:string}) {
  return <header className="workbench-header">
    <a className="workbench-brand" href="./"><span className="workbench-mark" aria-hidden="true">◈</span>catlas<span className="workbench-edition">Workbench</span></a>
    <nav aria-label="Investigation mode">{(['monitor','exposure','recovery'] as const).map(mode=><button key={mode} aria-current={active===mode?'page':undefined} aria-pressed={active===mode} onClick={()=>onModeChange(mode)}>{{monitor:'Monitor',exposure:'Exposure',recovery:'Recovery'}[mode]}</button>)}</nav>
    <span className="workbench-environment"><span aria-hidden="true" />{active === 'recovery' ? 'Demo · simulated RAS' : active === 'monitor' ? 'Public feeds · local portfolio' : 'Local portfolio workspace'}</span>
    <button className="workbench-portfolio" title={portfolioName} onClick={onPortfolio}>Portfolio</button>
  </header>;
}
