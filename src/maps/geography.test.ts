import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

const root = new URL('../../public/map/', import.meta.url);
const data = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
it('ships the exact geographic data and label font declared in the offline manifest', () => {
  const manifest = data('geography-manifest.json');
  for (const [name, digest] of Object.entries(manifest.files)) {
    expect(createHash('sha256').update(readFileSync(new URL(name, root))).digest('hex'), name).toBe(digest);
  }
  expect(manifest.sources.every((source: {source:string}) => source.source.includes(manifest.naturalEarthCommit))).toBe(true);
});
it('includes country and principal state labels across regions rather than only the demonstration area', () => {
  const names = (file: string) => data(file).features.map((feature: {properties:{name:string}}) => feature.properties.name);
  expect(names('country-labels.geojson')).toEqual(expect.arrayContaining(['Canada', 'India', 'Brazil']));
  const states = names('state-labels.geojson');
  expect(states).toEqual(expect.arrayContaining(['California', 'Ontario', 'Maharashtra']));
  expect(states.filter((name: string) => name === 'California')).toHaveLength(1);
});
