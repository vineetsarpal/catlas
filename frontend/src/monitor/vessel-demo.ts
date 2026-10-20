import type { Vessel, VesselIdentity } from '@catlas/shared/vessels';

export function demoFleet(at: string): Vessel[] {
  return [
    {name:'Demo North Star',mmsi:'999000001',longitude:1.35,latitude:51.05,speed:12.4,course:45},
    {name:'Demo Meridian',mmsi:'999000002',longitude:1.8,latitude:51.55,speed:9.2,course:220},
    {name:'Demo Coast Runner',mmsi:'999000003',longitude:2.65,latitude:51.9,speed:14.1,course:65},
    {name:'Demo Harbour Light',mmsi:'999000004',longitude:3.7,latitude:51.75,speed:0,course:0},
    {name:'Demo Atlas Trader',mmsi:'999000005',longitude:.5,latitude:50.55,speed:11.6,course:105},
  ].map(v=>({...v,imo:'',reportedAt:at,receivedAt:at,trail:[...Array.from({length:5},(_,i):[number,number,string]=>{
    const distance=(5-i)*.025,angle=v.course*Math.PI/180;
    return [v.longitude-(v.speed?distance*Math.sin(angle):0),v.latitude-(v.speed?distance*Math.cos(angle):0),new Date(Date.parse(at)-(5-i)*60000).toISOString()];
  }),[v.longitude,v.latitude,at]]}));
}
export function demoPortfolio(rows: Vessel[]): VesselIdentity[] {
  return rows.map(({name,mmsi})=>({name,mmsi}));
}
