import { describe, expect, it } from 'vitest';
import { containmentBand, fireDetectionFeatures, observationAge, perimeterBounds, fireEvidenceLabel, fireEvidenceTime, fireSourceLabel } from './fire-display';
import type { FirePerimeter } from '@catlas/shared/hazards';
import type { MonitorItem } from './model';

describe('fire map presentation boundaries', () => {
  it('distinguishes unknown containment from reported zero and preserves band boundaries', () => {
    expect([null, 0, 1, 49.9, 50, 99.9, 100].map(value => containmentBand(value).id))
      .toEqual(['unknown', 'uncontained', 'low', 'low', 'partial', 'partial', 'contained']);
  });
  it('fits all polygon parts in the smallest dateline-crossing longitude arc', () => {
    const bounds = perimeterBounds({ type: 'MultiPolygon', coordinates: [
      [[[179, 50], [-179, 50], [-179, 51], [179, 50]]],
      [[[-178, 52], [-177, 52], [-177, 53], [-178, 52]]],
    ] });
    expect(bounds).toEqual([[179, 50], [183, 53]]);
  });
  it('fits an ordinary western-hemisphere boundary without wrapping it around the globe', () => {
    expect(perimeterBounds({ type: 'Polygon', coordinates: [[[-120, 30], [-110, 30], [-110, 40], [-120, 30]]] }))
      .toEqual([[-120, 30], [-110, 40]]);
  });
  it('aggregates only raw observations and retains their original identities and coordinates', () => {
    const detection: MonitorItem = { key: 'fire:detection:a', name: 'Detection', kind: 'fire', mapOnly: true, nearby: 2, longitude: -118.5, latitude: 35.2 };
    const items = [detection, { ...detection, key: 'fire:location:site', mapOnly: false, longitude: -118 }, { ...detection, key: 'invalid', hasPosition: false }];
    const before = structuredClone(items);
    const features = fireDetectionFeatures(items).features;
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ properties: { key: detection.key }, geometry: { coordinates: [-118.5, 35.2] } });
    expect(items).toEqual(before);
  });
  it('labels satellite estimates and incident points independently from US published perimeters',()=>{
    const fire:FirePerimeter={id:'cwfis:estimate:1',name:'Estimate',geometry:null,updatedAt:null,containment:null,sourceUrl:'https://cwfis.cfs.nrcan.gc.ca/',provider:'CWFIS',evidence:'estimated-perimeter',cwfis:{agency:'',status:'',lastDetectedAt:'2026-10-21T12:00:00Z'}};
    expect(fireEvidenceLabel(fire)).toBe('Estimated fire area');
    expect(fireSourceLabel(fire)).toBe('NRCan CWFIS · Canada');
    expect(fireEvidenceTime(fire)).toBe('2026-10-21T12:00:00Z');
    expect(fireEvidenceLabel({...fire,evidence:'reported-incident'})).toBe('Reported fire location');
  });
  it('labels observation age separately from an unknown publication time', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    expect(observationAge(null, now)).toBe('Time unknown');
    expect(observationAge('2026-10-21T10:30:00Z', now)).toBe('1h ago');
    expect(observationAge('2026-10-19T10:30:00Z', now)).toBe('2d ago');
  });
});
