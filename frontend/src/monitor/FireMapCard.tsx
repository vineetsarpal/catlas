import { containmentBand, containmentBands, observationAge, fireEvidenceLabel, fireEvidenceTime, fireSourceLabel, fireTimeLabel } from './fire-display';
import { isMonitorItemWatched, type MonitorItem } from './model';
import type { MonitorState } from './useMonitor';

export function FirePerimeterLegend() {
  return <details className="monitor-containment-legend">
    <summary>Fire perimeters · containment</summary>
    <div aria-label="Reported fire containment legend">
    <b>Reported containment</b>
    {containmentBands.map(band => <span key={band.id}><i style={{ background: band.color }}/>{band.label}</span>)}
    <small>Containment does not establish location safety.</small>
    </div>
  </details>;
}

export function FireMapCard({ item, state }: { item: MonitorItem; state: MonitorState }) {
  const perimeter = item.perimeter, relevance = item.relevance;
  const watched = isMonitorItemWatched(item, state.prefs.watchlist);
  const feed = perimeter ? state.perimeters : state.fires;
  const degraded = !state.online || Boolean(feed.error || feed.data?.stale || feed.data?.warning);
  return <section className="monitor-fire-card" aria-label="Selected fire map card" style={{ borderColor: perimeter ? containmentBand(perimeter.containment).color : '#d96a22' }}>
    <header><p>{perimeter ? fireEvidenceLabel(perimeter).toUpperCase() : item.mapOnly ? 'SATELLITE DETECTION' : 'NEAR PORTFOLIO LOCATION'}</p><button aria-label="Dismiss fire map selection" onClick={() => state.select('')}>×</button></header>
    <h3>{perimeter ? item.name : item.mapOnly ? 'Detected fire activity' : item.name.replace('Nearby fire detections — ', '')}</h3>
    {perimeter ? <p><b>{perimeter.evidence==='estimated-perimeter'?'Satellite-derived estimate':perimeter.evidence==='reported-incident'?`Control status: ${perimeter.cwfis?.status||'unknown'}`:perimeter.containment === null ? 'Containment unknown' : `${perimeter.containment}% contained`}</b><br/>{fireTimeLabel(perimeter)}: {observationAge(fireEvidenceTime(perimeter), state.now)} · {fireSourceLabel(perimeter)}</p>
      : item.fire && <p>{item.fireDetections?.length ?? 1} satellite observations<br/>{observationAge(item.fire.detectedAt, state.now)} · {item.fire.source}</p>}
    {degraded && <p className="monitor-fire-stale" role="status">Coverage degraded · see Feeds</p>}
    {relevance?.screeningUnavailable ? <p>Location screening unavailable</p> : <div className="monitor-fire-card-exposure">
      <strong>{relevance?.locationIds.length ?? item.nearby}</strong><span>portfolio locations {relevance ? 'flagged' : 'nearby'}</span>
      {relevance?.totals.map(total => <b key={total.currency}>{total.currency} {total.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} TIV</b>)}
      {!!relevance?.unknownValues && <small>{relevance.unknownValues} with unknown insured value</small>}
    </div>}
    <small>{perimeter ? perimeter.evidence==='reported-incident'?'Reported point proximity; boundary not supplied.':perimeter.evidence==='estimated-perimeter'?'Rough burned-area estimate; no damage or loss assessment.':'Published boundary; no damage or loss assessment.' : 'Observations are not distinct incidents or burned area.'}</small>
    <button className="monitor-fire-watch" disabled={!watched && state.prefs.watchlist.length >= 100} onClick={() => state.toggleWatch(item.key, item.name)}>{watched ? 'Remove fire watch' : 'Watch fire activity'}</button>
  </section>;
}
