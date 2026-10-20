import { describe,it,expect } from 'vitest';
import { parseVesselCSV, inVesselPortfolio } from './vessels';
describe('vessel membership imports',()=>{
  it('preserves identifiers and quoted names without inventing positions',()=>{
    const list=parseVesselCSV('name,mmsi,imo\r\n"A, vessel",123456789,1234567\r\n"Second ""ship""",223456789,');
    expect(list[0]).toEqual({name:'A, vessel',mmsi:'123456789',imo:'1234567'});
    expect(list[1].name).toBe('Second "ship"');
    expect(inVesselPortfolio({mmsi:'999999999',imo:'1234567'},list)).toBe(true);
    expect(inVesselPortfolio({mmsi:'999999999',imo:''},list)).toBe(false);
  });
  it('rejects missing identities, duplicate rows and invalid CSV',()=>{
    for(const csv of ['name,mmsi\nShip,123','name,mmsi\nShip,','name,mmsi\nA,123456789\nA,123456789','name,mmsi\n"unclosed,123456789','name,mmsi\n"a"bad,123456789'])expect(()=>parseVesselCSV(csv)).toThrow();
  });
});
