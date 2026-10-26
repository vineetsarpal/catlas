import { regionExposure } from './view';
import { type ExposureRow } from './model';

export function RegionExposure({ rows, threshold, region, onRegion }: {
  rows: ExposureRow[]; threshold: number; region: string | null; onRegion: (region: string | null) => void;
}) {
  const groups = regionExposure(rows, threshold);
  return <section className="exposure-regions" aria-label="Regional exposure breakdown">
    <div className="exposure-regions-heading">{region !== null && <button onClick={() => onRegion(null)}>All regions</button>}</div>
    <p>Full assessed portfolio · MMI ≥ {threshold}. Select a region to filter the map and locations.</p>
    <div className="exposure-region-list">{groups.map(group => <button className="exposure-region" key={group.region} aria-label={`Filter region ${group.region || 'Not supplied'}`} aria-pressed={region === group.region} onClick={() => onRegion(region === group.region ? null : group.region)}>
      <span className="exposure-region-title"><strong>{group.region || 'Not supplied'}</strong><span>{group.unknown===group.total?`${group.total} ${group.total===1?'location':'locations'} · intensity unknown`:`${group.meeting} of ${group.total} meet threshold`}</span></span>
      <span className="exposure-region-bar" aria-hidden="true"><span style={{width:`${group.meeting / group.total * 100}%`}} /></span>
      <span className="exposure-region-values">{[...group.values].sort(([a],[b]) => a.localeCompare(b)).map(([code, value]) => <span key={code}>{code} {new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(value)}</span>)}{group.meeting === 0 && <span>No confirmed threshold matches</span>}</span>
      {(group.unknown > 0 || group.unknownValue > 0) && <small>{group.unknown > 0 && `${group.unknown} unknown intensity`}{group.unknown > 0 && group.unknownValue > 0 && ' · '}{group.unknownValue > 0 && `${group.unknownValue} screened with unknown value`}</small>}
    </button>)}</div>
    <p className="exposure-region-note">Values are screened insured value, grouped by currency. They are not loss estimates.</p>
  </section>;
}
