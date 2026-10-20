import { describe, expect, it } from 'vitest';
import { vesselPortfolio, inVesselPortfolio } from '@catlas/shared/vessels';
import { demoFleet } from './vessel-demo';
import { retainPortfolioReports, toggleVesselPortfolio } from './vessel-portfolio';

const vessel={...demoFleet('2026-10-20T12:00:00Z')[0],imo:'9159713'};
describe('vessel portfolio selection',()=>{
  it('adds a feed identity that validates and matches subsequent position reports',()=>{
    const portfolio=vesselPortfolio.parse(toggleVesselPortfolio([],vessel));
    const updatedReport={...vessel,name:'Updated name',latitude:0};
    expect(inVesselPortfolio(updatedReport,portfolio)).toBe(true);
    expect(toggleVesselPortfolio(portfolio,vessel)).toEqual([]);
  });
  it('removes an imported IMO identity even when the MMSI changes, preserving other entries',()=>{
    const other={name:'Other ship',mmsi:'999000002'};
    const portfolio=[{name:'Imported ship',imo:vessel.imo},other];
    expect(toggleVesselPortfolio(portfolio,vessel)).toEqual([other]);
    expect(portfolio).toHaveLength(2);
  });
  it('enforces the 200 vessel limit while still allowing removal',()=>{
    const portfolio=Array.from({length:200},(_,i)=>({name:`Ship ${i}`,mmsi:String(800000000+i)}));
    expect(toggleVesselPortfolio(portfolio,vessel)).toBe(portfolio);
    expect(toggleVesselPortfolio(portfolio,{...vessel,mmsi:portfolio[0].mmsi})).toHaveLength(199);
  });
});

describe('portfolio report retention',()=>{
  const now=Date.parse('2026-10-20T12:00:00Z');
  const report={...vessel,reportedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString()};
  const portfolio=[{name:report.name,mmsi:report.mmsi}];
  it('keeps a known portfolio ship when a zoomed-out snapshot contains 1000 other ships',()=>{
    const retained=retainPortfolioReports([], [report], portfolio, now);
    const incoming=Array.from({length:1000},(_,i)=>({...report,mmsi:String(800000000+i)}));
    expect(retainPortfolioReports(retained,incoming,portfolio,now+60000)).toEqual([report]);
  });
  it('keeps newer positions and drops removed portfolio members',()=>{
    const newer={...report,latitude:50,reportedAt:new Date(now+60000).toISOString(),receivedAt:new Date(now+60000).toISOString()};
    expect(retainPortfolioReports([newer],[report],portfolio,now+60000)).toEqual([newer]);
    expect(retainPortfolioReports([report],[],[],now)).toEqual([]);
  });
  it('expires retained observations without changing their original timestamps',()=>{
    expect(retainPortfolioReports([report],[],portfolio,now+31*60000)).toEqual([]);
  });
});
