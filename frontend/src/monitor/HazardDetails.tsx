import type { MonitorItem } from './model';

export function HazardRelevanceDetails({item}:{item:MonitorItem}) {
  const relevance=item.relevance;
  if(!relevance)return null;
  return <div className="monitor-hazard-relevance">
    {relevance.screeningUnavailable?<p role="status">Location screening unavailable · boundary evidence missing.</p>:<>
      {relevance.reasons.map(reason=><p key={reason}>{reason}{reason.startsWith('Inside')?` · ${relevance.inside} locations`:reason.startsWith('Near')?` · ${relevance.nearby} locations`:''}</p>)}
      <p>{relevance.locationIds.length} portfolio locations flagged for attention</p>
      {relevance.totals.length>0&&<p>TIV: {relevance.totals.map(total=>`${total.currency} ${total.value.toLocaleString(undefined,{maximumFractionDigits:2})}`).join(' · ')}</p>}
      {relevance.unknownValues>0&&<p>{relevance.unknownValues} flagged locations have unknown insured value.</p>}
    </>}
  </div>;
}

export function HazardEvidenceDetails({item,now}:{item:MonitorItem;now:number}) {
  return <>
    {item.perimeter&&<>
      <p>NIFC WFIGS · published fire perimeter</p>
      <p>Boundary updated {item.perimeter.updatedAt?new Date(item.perimeter.updatedAt).toLocaleString():'at an unknown time'}{item.perimeter.updatedAt?` · ${Math.max(0,Math.floor((now-Date.parse(item.perimeter.updatedAt))/3600000))} hours ago`:''}</p>
      <p>Reported containment: {item.perimeter.containment===null?'unknown':`${item.perimeter.containment}%`}. Containment does not establish that nearby locations are safe.</p>
      <a href={item.perimeter.sourceUrl} target="_blank" rel="noreferrer">Official fire source ↗</a>
    </>}
    {item.alert&&<>
      <p>{item.alert.event} · {item.alert.severity} · {item.alert.certainty} · {item.alert.urgency}</p>
      <p>Issued {new Date(item.alert.issuedAt).toLocaleString()} · updated {new Date(item.alert.updatedAt).toLocaleString()}</p>
      <p>Expires {new Date(item.alert.expiresAt).toLocaleString()}</p>
      <p className="monitor-alert-description">{item.alert.description}</p>
      <a href={item.alert.sourceUrl} target="_blank" rel="noreferrer">Official weather alert ↗</a>
    </>}
    {item.kind==='fire'&&item.fire&&<p>{item.fireDetections?.length??1} detections · newest {new Date(item.fire.detectedAt).toLocaleString()} · {item.fire.source}</p>}
    {item.kind==='fire'&&item.mapOnly&&item.fire?.confidence!==null&&item.fire?.confidence!==undefined&&<p>Provider confidence: {item.fire.confidence}</p>}
    {item.kind==='fire'&&<p>NASA FIRMS · satellite fire detections in the past 24 hours. Multiple observations can describe the same fire; detection counts are not incident counts or burned area.</p>}
    <HazardRelevanceDetails item={item}/>
    {item.relevance&&<p>Flagged insured value is exposure context. This screening does not establish physical damage, insured loss or contractual recovery.</p>}
  </>;
}
