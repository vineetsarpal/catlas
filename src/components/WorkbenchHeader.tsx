export function WorkbenchHeader({ active }: { active: 'exposure' | 'recovery' }) {
  return <header className="workbench-header">
    <a className="workbench-brand" href="./"><span className="workbench-mark" aria-hidden="true">◈</span>catlas<span className="workbench-edition">Workspace</span></a>
    <span className="workbench-environment"><span aria-hidden="true" />{active === 'recovery' ? 'Demo · simulated RAS' : 'Local portfolio workspace'}</span>
  </header>;
}
