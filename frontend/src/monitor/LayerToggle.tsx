export function LayerToggle({label,checked,onChange,disabled=false}:{label:string;checked:boolean;disabled?:boolean;onChange:(checked:boolean)=>void}) {
  return <label className="monitor-layer-toggle"><span>{label}</span><input type="checkbox" role="switch" disabled={disabled} checked={checked} onChange={e=>onChange(e.target.checked)}/></label>;
}
