import { portfolioSchema, type InsuredLocation, type Portfolio } from './model';

const rows: [string, string, number, number, number | null, string, string, string][] = [
 ['RC-01','Ridgecrest medical centre',-117.67,35.62,18000000,'USD','Kern','Commercial'],
 ['RC-02','Ridgecrest distribution',-117.66,35.63,32000000,'USD','Kern','Commercial'],
 ['TR-01','Trona retail',-117.37,35.76,4500000,'USD','San Bernardino','Commercial'],
 ['TR-02','Trona residential',-117.37,35.76,1800000,'USD','San Bernardino','Residential'],
 ['IW-01','Inyokern workshop',-117.82,35.65,7200000,'USD','Kern','Commercial'],
 ['LA-01','Lancaster logistics',-118.14,34.7,22000000,'USD','Los Angeles','Commercial'],
 ['LA-02','Los Angeles offices',-118.24,34.05,40000000,'USD','Los Angeles','Commercial'],
 ['LA-03','Los Angeles housing',-118.26,34.07,6500000,'USD','Los Angeles','Residential'],
 ['BA-01','Bakersfield warehouse',-119.02,35.37,15000000,'USD','Kern','Commercial'],
 ['TE-01','Tehachapi housing',-118.45,35.13,9000000,'USD','Kern','Residential'],
 ['LV-01','Las Vegas shops',-115.14,36.17,11000000,'USD','Clark','Commercial'],
 ['FR-01','Fresno offices',-119.78,36.74,13000000,'USD','Fresno','Commercial'],
 ['SB-01','San Bernardino plant',-117.29,34.11,21000000,'USD','San Bernardino','Commercial'],
 ['RC-03','Ridgecrest value pending',-117.69,35.64,null,'USD','Kern','Commercial'],
 ['RC-CA','Ridgecrest commercial schedule',-117.71,35.61,12000000,'USD','Kern','Commercial'],
 ['SD-01','San Diego hotel',-117.16,32.72,25000000,'USD','San Diego','Commercial'],
 ['SF-01','San Francisco offices',-122.42,37.77,35000000,'USD','San Francisco','Commercial'],
 ['PH-01','Phoenix warehouse',-112.07,33.45,16000000,'USD','Maricopa','Commercial'],
];
const locations: InsuredLocation[] = rows.map(([id,name,longitude,latitude,value,currency,region,businessLine]) => ({ id,name,longitude,latitude,value,currency,region,businessLine }));
export const demoPortfolio: Portfolio = portfolioSchema.parse({ source: 'Synthetic PAS export · demonstration only', asOf: '2019-07-05', synthetic: true, locations, excludedRows: 0,
  warnings: ['TR-01 and TR-02 share coordinates and are fictional separate insured locations. All locations and values are synthetic.'] });
export function stressPortfolio(count = 1_000): Portfolio {
  return { ...demoPortfolio, source: `${count.toLocaleString()} synthetic locations · performance fixture`, locations: Array.from({ length: count }, (_, i) => {
    const site = locations[i % locations.length];
    return { ...site, id: `STRESS-${i}`, name: `${site.name} ${i}`, longitude: site.longitude + (i % 9) * .003, latitude: site.latitude + (i % 7) * .003 };
  }) };
}
