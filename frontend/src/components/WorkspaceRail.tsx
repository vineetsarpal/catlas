import type { ReactNode } from 'react';
export type WorkspaceIconName='filters'|'regions'|'inspection'|'table'|'layers'|'events'|'history'|'portfolio'|'search'|'settings'|'locations'|'add-location'|'import'|'watchlist'|'feeds'|'assessment'|'attention';

const icons:Record<WorkspaceIconName,ReactNode>={
  filters:<path d="M3 4h18l-7 8v7l-4 2v-9Z"/>,
  regions:<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></>,
  inspection:<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M14 3v18M6 8h5M6 12h5M6 16h3"/></>,
  table:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 10v10"/></>,
  layers:<><path d="m3 6 9-4 9 4-9 4Z"/><path d="m3 12 9 4 9-4M3 18l9 4 9-4"/></>,
  events:<path d="m3 12 4-1 3-7 4 16 3-8h4"/>,
  attention:<><path d="m12 3 10 18H2Z"/><path d="M12 9v5M12 17h.01"/></>,
  history:<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2"/>,
  portfolio:<><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M8 6V3h8v3M3 12h18"/></>,
  search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
  settings:<><path d="M10 2h4l.6 3 2 .9 2.6-1 2 3.5-2 2.1v2.2l2 2.1-2 3.5-2.6-1-2 .9-.6 3h-4l-.6-3-2-.9-2.6 1-2-3.5 2-2.1v-2.2l-2-2.1 2-3.5 2.6 1 2-.9Z"/><circle cx="12" cy="12" r="3"/></>,
  locations:<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  'add-location':<><path d="M17 15c-2 4-5 7-5 7S4 16 4 10a8 8 0 0 1 12-7"/><circle cx="12" cy="10" r="2.5"/><path d="M20 3v6M17 6h6"/></>,
  import:<><path d="M12 3v11m-4-4 4 4 4-4M3 15v6h18v-6"/></>,
  watchlist:<path d="M6 3h12v18l-6-4-6 4Z"/>,
  feeds:<><circle cx="5" cy="19" r="1"/><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/></>,
  assessment:<><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h2M14 18h2"/></>,
};
export function WorkspaceIcon({name}:{name:WorkspaceIconName}) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}
export function WorkspaceRail({label,items,active,onSelect,children}:{label:string;items:Array<{id:string;label:string;icon:WorkspaceIconName;badge?:number}>;active:string|null;onSelect:(id:string)=>void;children?:ReactNode}) {
  return <nav className="atlas-tool-rail" aria-label={label}>{items.map(item=><button key={item.id} type="button" aria-label={item.label} aria-expanded={active===item.id} onClick={()=>onSelect(item.id)}><WorkspaceIcon name={item.icon}/><span>{item.label}</span>{Boolean(item.badge)&&<b className="workspace-rail-badge" aria-hidden="true">{item.badge}</b>}</button>)}{children}</nav>;
}
