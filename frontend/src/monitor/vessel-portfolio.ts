import { inVesselPortfolio, type Vessel, type VesselIdentity } from '@catlas/shared/vessels';

export function toggleVesselPortfolio(portfolio: VesselIdentity[], vessel: Vessel): VesselIdentity[] {
  if(inVesselPortfolio(vessel,portfolio))return portfolio.filter(identity=>!inVesselPortfolio(vessel,[identity]));
  if(portfolio.length>=200)return portfolio;
  return [...portfolio,{name:vessel.name||`Vessel ${vessel.mmsi}`,mmsi:vessel.mmsi,...(/^\d{7}$/.test(vessel.imo)?{imo:vessel.imo}:{})}];
}

// Keep known portfolio reports when a wider viewport response is capped or omits them.
// Use the relay's 30 minute observation window; retained reports never become fresh again.
export function retainPortfolioReports(previous: Vessel[], incoming: Vessel[], portfolio: VesselIdentity[], now: number): Vessel[] {
  const retained=new Map<string,Vessel>();
  for(const vessel of [...previous,...incoming]){
    if(!inVesselPortfolio(vessel,portfolio)||now-Date.parse(vessel.receivedAt)>30*60000)continue;
    const old=retained.get(vessel.mmsi);
    if(!old||Date.parse(vessel.reportedAt)>=Date.parse(old.reportedAt))retained.set(vessel.mmsi,vessel);
  }
  return [...retained.values()];
}
