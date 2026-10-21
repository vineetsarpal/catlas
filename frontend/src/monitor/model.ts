import type { FireDetection, FirePerimeter, WeatherAlert } from '@catlas/shared/hazards';
import type { Earthquake, Portfolio } from '../exposure/model';
import type { MonitorState } from './useMonitor';
import { inVesselPortfolio, type Vessel } from '@catlas/shared/vessels';
import type { Cyclone } from './feeds';
import { distanceKm, geometryPosition, locationRelevance, screenGeometry, type HazardRelevance } from './hazard-screening';
export { distanceKm } from './hazard-screening';
export type { HazardRelevance } from './hazard-screening';
export type MonitorItem={key:string;name:string;kind:'earthquake'|'cyclone'|'location'|'vessel'|'fire'|'perimeter'|'alert';longitude:number;latitude:number;hasPosition?:boolean;mapOnly?:boolean;nearby:number;earthquake?:Earthquake;cyclone?:Cyclone;vessel?:Vessel;inPortfolio?:boolean;fire?:FireDetection;fireDetections?:FireDetection[];perimeter?:FirePerimeter;alert?:WeatherAlert;relevance?:HazardRelevance};
export type MonitorWatch={key:string;name:string;references?:string[]};
export function isMonitorItemWatched(item:MonitorItem,watchlist:MonitorWatch[]) {
  if(!item.alert)return watchlist.some(w=>w.key===item.key);
  const identities=new Set([item.alert.id,...item.alert.references].map(id=>id.replace(/^alert:/,'')));
  return watchlist.some(w=>w.key===item.key||(w.key.startsWith('alert:')&&[w.key,...w.references??[]].some(id=>identities.has(id.replace(/^alert:/,'')))));
}
export function compareMonitorItems(a:MonitorItem,b:MonitorItem) {
  const rank=(item:MonitorItem)=>item.relevance?.inside?0:item.nearby>0?1:item.relevance?.screeningUnavailable?2:3;
  return rank(a)-rank(b)||b.nearby-a.nearby||a.name.localeCompare(b.name)||a.key.localeCompare(b.key);
}
/** One-degree cells only reject impossible matches; haversine decides proximity. */
function indexDetections(fires:FireDetection[]) {
  const cells=new Map<string,FireDetection[]>();
  const longitudeCell=(lon:number)=>Math.floor(((lon+180)%360+360)%360)-180;
  for(const fire of fires) {
    const key=`${Math.floor(fire.latitude)}:${longitudeCell(fire.longitude)}`;
    const cell=cells.get(key);if(cell)cell.push(fire);else cells.set(key,[fire]);
  }
  return (site:{latitude:number;longitude:number},distance:number)=>{
    const angular=distance/6371,latitudePadding=angular*180/Math.PI+1e-9;
    const longitudePadding=Math.abs(site.latitude)+latitudePadding>=90?180:Math.asin(Math.min(1,Math.sin(angular)/Math.cos(site.latitude*Math.PI/180)))*180/Math.PI+1e-9;
    const candidates:FireDetection[]=[];
    const west=longitudeCell(site.longitude-longitudePadding),east=Math.floor(site.longitude+longitudePadding)-Math.floor(site.longitude-longitudePadding)+west;
    for(let lat=Math.max(-90,Math.floor(site.latitude-latitudePadding));lat<=Math.min(90,Math.floor(site.latitude+latitudePadding));lat++) {
      // At most 360 unique longitude cells even when the radius reaches a pole.
      for(let lon=west;lon<=Math.min(east,west+359);lon++)for(const fire of cells.get(`${lat}:${longitudeCell(lon)}`)??[])candidates.push(fire);
    }
    return candidates.filter(fire=>distanceKm(fire,site)<=distance);
  };
}
export function monitorItems(state:MonitorState,portfolio:Portfolio):MonitorItem[] {
  const count=(event:{longitude:number;latitude:number})=>portfolio.locations.filter(site=>distanceKm(event,site)<=250).length;
  const fireDistance=state.prefs.fireDistanceKm;
  const fires=(state.prefs.fires?state.fires.data?.rows??[]:[]).filter(f=>Date.parse(f.detectedAt)>state.now-24*3600000&&Date.parse(f.detectedAt)<=state.now);
  const candidates=indexDetections(fires),detectionCounts=new Map<FireDetection,number>();
  const fireGroups:MonitorItem[]=portfolio.locations.flatMap(site=>{
    const detections=candidates(site,fireDistance).sort((a,b)=>Date.parse(b.detectedAt)-Date.parse(a.detectedAt));
    if(!detections.length)return [];
    for(const detection of detections)detectionCounts.set(detection,(detectionCounts.get(detection)??0)+1);
    const relevance=locationRelevance([],[site],['Near detected fire activity']);
    return [{key:`fire:location:${site.id}`,name:`Nearby fire detections — ${site.name}`,kind:'fire',longitude:site.longitude,latitude:site.latitude,nearby:1,fire:detections[0],fireDetections:detections,relevance}];
  });
  const perimeters:MonitorItem[]=(state.prefs.perimeters?state.perimeters.data?.rows??[]:[]).map(perimeter=>{
    const position=geometryPosition(perimeter.geometry),relevance=screenGeometry(portfolio.locations,perimeter.geometry,fireDistance,'Inside published fire perimeter');
    return {key:`perimeter:${perimeter.id}`,name:perimeter.name,kind:'perimeter',longitude:position?.longitude??0,latitude:position?.latitude??0,hasPosition:position!==null,nearby:relevance.locationIds.length,perimeter,relevance};
  });
  const alerts:MonitorItem[]=(state.prefs.alerts?state.alerts.data?.rows??[]:[]).filter(alert=>alert.active&&Date.parse(alert.expiresAt)>state.now).map(alert=>{
    const position=geometryPosition(alert.geometry),relevance=screenGeometry(portfolio.locations,alert.geometry,0,'Inside warning area');
    return {key:`alert:${alert.id}`,name:alert.name,kind:'alert',longitude:position?.longitude??0,latitude:position?.latitude??0,hasPosition:position!==null,nearby:relevance.locationIds.length,alert,relevance};
  });
  return [
    ...state.vessels.rows.map(v=>({key:`vessel:${v.mmsi}`,name:v.name,kind:'vessel' as const,longitude:v.longitude,latitude:v.latitude,nearby:0,vessel:v,inPortfolio:inVesselPortfolio(v,state.vessels.portfolio)})),
    ...(state.prefs.earthquakes?state.earthquakes.data?.events??[]:[]).map(e=>({key:`earthquake:${e.id}`,name:e.name??e.id,kind:'earthquake' as const,longitude:e.longitude,latitude:e.latitude,nearby:count(e),earthquake:e})),
    ...(state.prefs.cyclones?state.cyclones.data?.storms??[]:[]).map(c=>({key:`cyclone:${c.id}`,name:c.name,kind:'cyclone' as const,longitude:c.longitude,latitude:c.latitude,nearby:count(c),cyclone:c})),
    ...(state.prefs.locations?portfolio.locations:[]).map(site=>({key:`location:${site.id}`,name:site.name,kind:'location' as const,longitude:site.longitude,latitude:site.latitude,nearby:0})),
    ...fireGroups,...fires.map(fire=>({key:`fire:detection:${fire.id}`,name:`Fire detection — ${fire.source}`,kind:'fire' as const,longitude:fire.longitude,latitude:fire.latitude,nearby:detectionCounts.get(fire)??0,fire,fireDetections:[fire],mapOnly:true})),...perimeters,...alerts,
  ];
}
export function attentionMonitorItems(items:MonitorItem[],state:MonitorState) {
  return items.filter(item=>!item.mapOnly&&(!state.prefs.nearPortfolio||item.kind==='location'||item.kind==='vessel'||item.nearby>0||item.relevance?.screeningUnavailable)&&(!state.prefs.watchedOnly||isMonitorItemWatched(item,state.prefs.watchlist))).sort(compareMonitorItems);
}
export function visibleMonitorItems(items:MonitorItem[],state:MonitorState) {
  const watchedDetectionIds=new Set<string>();
  if(state.prefs.watchedOnly)for(const group of items)if(!group.mapOnly&&isMonitorItemWatched(group,state.prefs.watchlist))for(const detection of group.fireDetections??[])watchedDetectionIds.add(detection.id);
  return items.filter(item=>(item.kind!=='fire'||item.mapOnly)&&(!state.prefs.nearPortfolio||item.kind==='location'||item.kind==='vessel'||item.nearby>0)&&(!state.prefs.watchedOnly||isMonitorItemWatched(item,state.prefs.watchlist)||(item.fire!==undefined&&watchedDetectionIds.has(item.fire.id)))&&item.hasPosition!==false&&(item.kind!=='fire'||state.prefs.showFires)&&(item.kind!=='perimeter'||state.prefs.showPerimeters)&&(item.kind!=='alert'||state.prefs.showAlerts));
}
