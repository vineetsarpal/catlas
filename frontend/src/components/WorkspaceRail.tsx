import type { ReactNode } from 'react';
export type WorkspaceIconName='filters'|'regions'|'inspection'|'table'|'layers'|'events'|'history'|'portfolio'|'search'|'settings';
export function WorkspaceIcon({name}:{name:WorkspaceIconName}) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name==='filters'||name==='settings'?<><path d="M4 6h16M7 12h10M10 18h4"/></>:name==='regions'||name==='layers'?<><path d="m3 6 9-4 9 4-9 4Z"/><path d="m3 12 9 4 9-4M3 18l9 4 9-4"/></>:name==='table'?<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 10v10"/></>:name==='search'?<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>:name==='portfolio'?<><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M8 6V3h8v3M3 12h18"/></>:name==='history'?<><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2"/></>:name==='events'?<><path d="m3 12 4-1 3-7 4 16 3-8h4"/></>:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>}
  </svg>;
}
export function WorkspaceRail({label,items,active,onSelect,children}:{label:string;items:Array<{id:string;label:string;icon:WorkspaceIconName}>;active:string|null;onSelect:(id:string)=>void;children?:ReactNode}) {
  return <nav className="atlas-tool-rail" aria-label={label}>{items.map(item=><button key={item.id} type="button" aria-label={item.label} aria-expanded={active===item.id} onClick={()=>onSelect(item.id)}><WorkspaceIcon name={item.icon}/><span>{item.label}</span></button>)}{children}</nav>;
}
