import type { MonitorItem } from './model';
import { fireEvidenceLabel, fireEvidenceTime, fireSourceLabel, fireTimeLabel } from './fire-display';

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
      <p>{fireSourceLabel(item.perimeter)} · {fireEvidenceLabel(item.perimeter).toLowerCase()}</p>
      <p>{fireTimeLabel(item.perimeter)} {fireEvidenceTime(item.perimeter)?new Date(fireEvidenceTime(item.perimeter)!).toLocaleString():'at an unknown time'}</p>
      {item.perimeter.evidence==='reported-incident'&&<p>Agency: {item.perimeter.cwfis?.agency||'unknown'} · Control status (provider): {item.perimeter.cwfis?.status||'unknown'}. Proximity uses the reported point; a fire boundary is not supplied.</p>}
      {item.perimeter.evidence==='estimated-perimeter'?<p>Rough burned-area estimate derived from satellite hotspots, with activity detected in the past seven days. This is not an agency-mapped incident boundary or evidence of current burning throughout the area.</p>:<p>Reported containment: {item.perimeter.containment===null?'unknown':`${item.perimeter.containment}%`}. Containment does not establish that nearby locations are safe.</p>}
      <a href={item.perimeter.sourceUrl} target="_blank" rel="noreferrer">Official fire source ↗</a>
    </>}
    {item.alert&&<>
      <p>{item.alert.provider==='ECCC'?'ECCC · Canada':'NWS · United States'}</p>
      {item.alert.provider==='ECCC'&&<p>Data source: Environment and Climate Change Canada · <a href="https://eccc-msc.github.io/open-data/licence/readme_en/" target="_blank" rel="noreferrer">Data licence ↗</a></p>}
      {item.alert.eccc?<>
        <p>{item.alert.eccc.area} · {item.alert.eccc.province} · {item.alert.eccc.alertType}</p>
        <p>Risk colour: {item.alert.eccc.riskColour||'unknown'} · Impact: {item.alert.eccc.impact||'unknown'} · Confidence: {item.alert.eccc.confidence||'unknown'}</p>
        <p>Status: {item.alert.eccc.status}</p>
        <p>Published {new Date(item.alert.updatedAt).toLocaleString()}</p>
        {item.alert.eccc.validAt&&<p>Valid from {new Date(item.alert.eccc.validAt).toLocaleString()}</p>}
        {item.alert.eccc.eventEndAt&&<p>Event ends {new Date(item.alert.eccc.eventEndAt).toLocaleString()}</p>}
      </>:<>
        <p>{item.alert.event} · {item.alert.severity} · {item.alert.certainty} · {item.alert.urgency}</p>
        <p>Issued {new Date(item.alert.issuedAt).toLocaleString()} · updated {new Date(item.alert.updatedAt).toLocaleString()}</p>
      </>}
      <p>Expires {new Date(item.alert.expiresAt).toLocaleString()}</p>
      <p className="monitor-alert-description">{item.alert.description}</p>
      {item.alert.eccc?.descriptionFr&&<details><summary>Français</summary><p lang="fr" className="monitor-alert-description">{item.alert.eccc.nameFr}<br/>{item.alert.eccc.descriptionFr}</p></details>}
      <a href={item.alert.sourceUrl} target="_blank" rel="noreferrer">Official weather alert ↗</a>
    </>}
    {item.kind==='fire'&&item.fire&&<p>{item.fireDetections?.length??1} detections · newest {new Date(item.fire.detectedAt).toLocaleString()} · {item.fire.source}</p>}
    {item.kind==='fire'&&item.mapOnly&&item.fire?.confidence!==null&&item.fire?.confidence!==undefined&&<p>Provider confidence: {item.fire.confidence}</p>}
    {item.kind==='fire'&&<p>NASA FIRMS / NRCan CWFIS · satellite fire detections in the past 24 hours. Multiple observations can describe the same fire; detection counts are not incident counts or burned area. Sources may observe the same activity.</p>}
    <HazardRelevanceDetails item={item}/>
    {item.relevance&&<p>Flagged insured value is exposure context. This screening does not establish physical damage, insured loss or contractual recovery.</p>}
  </>;
}
