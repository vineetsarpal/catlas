import {sampleMMI,type CapturedEvidence,type Earthquake,type Portfolio} from './model';
import {distanceKm} from '../monitor/hazard-screening';
export type PortfolioRelevance={kind:'match'|'unknown'|'below';explanation:string;knownCount:number;unknownCount:number;matchingCount:number;nearbyCount:number;evidence?:CapturedEvidence['manifest']};
/** Uses verified public captures already held by the browser; never acquires evidence or creates an investigation. */
export function screenPortfolioRelevance(event:Earthquake&{aliases?:string[]},portfolio:Portfolio,evidence:readonly CapturedEvidence[],threshold:number):PortfolioRelevance{
 const nearbyCount=portfolio.locations.filter(site=>distanceKm(event,site)<=250).length;
 const proximity=nearbyCount?`${nearbyCount} supplied locations within 250 km of the epicentre suggest proximity attention only.`:'No supplied locations within 250 km of the epicentre; distance alone cannot establish unaffected exposure.';
 const unknown=(explanation:string):PortfolioRelevance=>({kind:'unknown',explanation,knownCount:0,unknownCount:portfolio.locations.length,matchingCount:0,nearbyCount});
 if(!portfolio.locations.length)return unknown('Choose a current portfolio containing insured locations. An empty portfolio cannot establish below-threshold screening.');
 if(!Number.isFinite(threshold)||threshold<1||threshold>10)return unknown(`Choose a finite screening threshold from MMI 1 through 10. Relevance remains unknown. ${proximity}`);
 const identities=new Set([event.id,...event.aliases??[]]),seen=new Set<string>();
 const linked=evidence.filter(capture=>{const m=capture.manifest;if(![m.eventId,...m.aliases].some(id=>identities.has(id)))return false;const identity=JSON.stringify([m.rawSha256,m.eventDetailSha256,m.productId,m.productVersion,m.productUpdatedAt,m.occurredAt,m.magnitude,m.latitude,m.longitude]);if(seen.has(identity))return false;seen.add(identity);return true;});
 const sameObservation=(capture:CapturedEvidence)=>{const m=capture.manifest;return Date.parse(m.occurredAt)===Date.parse(event.occurredAt)&&m.magnitude===event.magnitude&&m.latitude===event.latitude&&m.longitude===event.longitude;};
 const incompatible=linked.filter(capture=>!sameObservation(capture));
 const captures=linked.filter(capture=>{
  const m=capture.manifest;
  if(!sameObservation(capture)||m.measure!=='MMI'||m.units!=='intensity')return false;
  return true;
 });
 const observationGap=incompatible.length?`${incompatible.length} source-linked inspected captures have different earthquake observations (occurrence, magnitude or epicentre); their grids were not sampled for this catalog observation. `:'';
 if(!captures.length)return {...unknown(`${observationGap}No compatible inspected shaking evidence is available for this source identity and observation. Location intensity remains unknown. ${proximity}`),...(incompatible.length?{evidence:incompatible[0].manifest}:{})};
 let matchingCount=0,unknownCount=0;let matchingEvidence:CapturedEvidence['manifest']|undefined,unknownEvidence:CapturedEvidence['manifest']|undefined;
 for(const site of portfolio.locations){
  let matched=false,unresolved=false;
  for(const capture of captures){
   const sample=sampleMMI(capture.grid,site.longitude,site.latitude);
   if(sample.mmi===null||!Number.isFinite(sample.mmi)){unresolved=true;unknownEvidence??=capture.manifest;}
   else if(sample.mmi>=threshold){matched=true;matchingEvidence??=capture.manifest;}
  }
  if(matched)matchingCount++;if(unresolved)unknownCount++;
 }
 // A location is fully known only when every compatible capture supplies a usable sample.
 const counts={knownCount:portfolio.locations.length-unknownCount,unknownCount,matchingCount,nearbyCount};
 const versions=captures.length>1?`${captures.length} compatible inspected evidence versions considered; retained versions are not a claim about the latest source product. `:'';
 const excluded=portfolio.excludedRows>0?`${portfolio.excludedRows} excluded import rows remain unresolved. `:'';
 if(matchingCount)return {kind:'match',...counts,evidence:matchingEvidence,explanation:`${matchingCount} supplied locations have an unrounded MMI estimate ≥ ${threshold} in compatible inspected evidence. ${unknownCount?`${unknownCount} supplied locations have unknown intensity in at least one considered version. `:''}${excluded}${observationGap}${versions}${proximity}`};
 if(incompatible.length)return {kind:'unknown',...counts,knownCount:0,unknownCount:portfolio.locations.length,evidence:incompatible[0].manifest,explanation:`${observationGap}Source revision uncertainty prevents a definitive below-threshold conclusion. ${excluded}${versions}${proximity}`};
 if(unknownCount||portfolio.excludedRows>0)return {kind:'unknown',...counts,evidence:unknownEvidence??captures[0].manifest,explanation:`${unknownCount?`${unknownCount} supplied locations have unknown intensity because required samples are missing or outside an inspected grid. `:''}${excluded}Partial evidence cannot establish below-threshold screening for every supplied location. ${versions}${proximity}`};
 return {kind:'below',...counts,evidence:captures[0].manifest,explanation:`Every supplied location has a known unrounded MMI estimate below ${threshold} in all compatible inspected evidence. ${versions}This does not establish no damage or loss. ${proximity}`};
}
