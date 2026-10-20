import type { Earthquake, Portfolio } from '../exposure/model';
import type { MonitorState } from './useMonitor';
import { inVesselPortfolio, type Vessel } from '@catlas/shared/vessels';
import type { Cyclone } from './feeds';
export type MonitorItem={key:string;name:string;kind:'earthquake'|'cyclone'|'location'|'vessel';longitude:number;latitude:number;nearby:number;earthquake?:Earthquake;cyclone?:Cyclone;vessel?:Vessel;inPortfolio?:boolean};
export function distanceKm(a:{longitude:number;latitude:number},b:{longitude:number;latitude:number}) {
  const rad=Math.PI/180,lat=(b.latitude-a.latitude)*rad,lon=(b.longitude-a.longitude)*rad;
  const h=Math.sin(lat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(lon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function monitorItems(state:MonitorState,portfolio:Portfolio):MonitorItem[] {
  const count=(event:{longitude:number;latitude:number})=>portfolio.locations.filter(site=>distanceKm(event,site)<=250).length;
  return [
    ...state.vessels.rows.map(v=>({key:`vessel:${v.mmsi}`,name:v.name,kind:'vessel' as const,longitude:v.longitude,latitude:v.latitude,nearby:0,vessel:v,inPortfolio:inVesselPortfolio(v,state.vessels.portfolio)})),
    ...(state.prefs.earthquakes?state.earthquakes.data?.events??[]:[]).map(e=>({key:`earthquake:${e.id}`,name:e.name??e.id,kind:'earthquake' as const,longitude:e.longitude,latitude:e.latitude,nearby:count(e),earthquake:e})),
    ...(state.prefs.cyclones?state.cyclones.data?.storms??[]:[]).map(c=>({key:`cyclone:${c.id}`,name:c.name,kind:'cyclone' as const,longitude:c.longitude,latitude:c.latitude,nearby:count(c),cyclone:c})),
    ...(state.prefs.locations?portfolio.locations:[]).map(site=>({key:`location:${site.id}`,name:site.name,kind:'location' as const,longitude:site.longitude,latitude:site.latitude,nearby:0})),
  ];
}
export function visibleMonitorItems(items:MonitorItem[],state:MonitorState) {
  return items.filter(item=>(!state.prefs.nearPortfolio||item.kind==='location'||item.kind==='vessel'||item.nearby>0)&&(!state.prefs.watchedOnly||state.prefs.watchlist.some(w=>w.key===item.key)));
}
