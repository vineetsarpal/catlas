/** CAT-5 amended fictional contextual portfolio. Coordinates are longitude, latitude. */
export type ContextLocation = { id: string; name: string; longitude: number; latitude: number; group?: 'Mojave' | 'Western' };
const fixtures: [string, number, number, ContextLocation['group']?][] = [
 ['Los Angeles',-118.24,34.05],['San Francisco',-122.42,37.77],['Lancaster',-118.14,34.70,'Western'],
 ['Las Vegas',-115.14,36.17],['Phoenix',-112.07,33.45],['Ridgecrest',-117.67,35.62,'Mojave'],
 ['Trona',-117.37,35.76,'Mojave'],['Tehachapi',-118.45,35.13,'Western'],['Mexico City',-99.13,19.43],
 ['New York',-74,40.7],['London',-0.13,51.5],['Tokyo',139.69,35.68],['Osaka',135.5,34.7],
 ['Sydney',151.2,-33.87],['Istanbul',28.98,41.01],['Singapore',103.82,1.35],['Vancouver',-123.12,49.28],['Santiago',-70.67,-33.45],
];
export const contextLocations: ContextLocation[] = fixtures.map(([name, longitude, latitude, group], i) => ({id:`DEMO-LOC-${String(i+1).padStart(2,'0')}`, name, longitude, latitude, ...(group ? {group} : {})}));
