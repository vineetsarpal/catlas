// Throwaway interaction study. All records and receiver responses live in memory.
// The source reference metadata is not a packaged USGS evidence archive.
events[0].date='2019-07-06T03:19:53.040Z';
events[1].date='2014-08-24T10:20:44.070Z';
events[2].date='2019-07-07T12:00:00.000Z';
events.forEach(e=>e.magType='mw');
treaties.forEach((t,i)=>{t.id=`DEMO-T0${i+1}`;t.version='1';t.start=i===2?null:'2019-01-01T00:00:00.000Z';t.end=i===2?null:'2020-01-01T00:00:00.000Z';});

// Pure rule evaluation; the page only supplies evidence and imported treaty terms.
function assess(e,t){
 const missing=[];
 if(!Number.isFinite(e.mag)||e.magType!=='mw')missing.push('Missing or unsupported magnitude; this demo requires mw');
 if(!Array.isArray(e.point)||e.point.length!==2||!e.point.every(Number.isFinite)||Math.abs(e.point[0])>180||Math.abs(e.point[1])>90)missing.push('Missing or invalid epicentre');
 if(!Array.isArray(t.point)||!t.point.every(Number.isFinite))missing.push('Missing contractual reference point');
 if(!Number.isFinite(Date.parse(e.date)))missing.push('Missing occurrence time');
 if(!t.start||!t.end||!Number.isFinite(Date.parse(t.start))||!Number.isFinite(Date.parse(t.end))||Date.parse(t.start)>=Date.parse(t.end))missing.push('Coverage dates unavailable or invalid');
 if(!Number.isFinite(t.limit)||t.limit<=0)missing.push('Missing or invalid contract limit');
 const distance=missing.some(x=>/point|epicentre/.test(x))?null:d3.geoDistance(e.point,t.point)*6371;
 const band=distance===null?null:distance<=25?0:distance<=100?1:2;
 const row=Number.isFinite(e.mag)?rows.findIndex(r=>e.mag>=r.min&&e.mag<r.max):-1;
 const pct=row<0||band===null?null:t.minimum&&e.mag<t.minimum?0:rows[row].pcts[band];
 const inCoverage=t.start&&t.end&&Number.isFinite(Date.parse(e.date))?Date.parse(e.date)>=Date.parse(t.start)&&Date.parse(e.date)<Date.parse(t.end):null;
 return {distance,band,row,pct,inCoverage,exceptions:missing,amount:missing.length?null:!inCoverage?0:t.limit*pct,status:missing.length?'Needs review':!inCoverage?'Outside coverage':pct>0?'Trigger met':'Not triggered'};
}
const baseEvidence=evidence;
evidence=function(){const e=baseEvidence();return {...e,magType:'mw',label:state.snapshot===0?'S01 · simulated M6.9':e.id==='outer'?'SIM-OUTER-01 · simulated event':'S02 · historical reference',synthetic:state.snapshot===0||e.id==='outer'};};
evaluate=i=>assess(evidence(),treaties[i]);

const cases=new Map(),records=[],receiver=new Map(),receivingCases=new Map();let packetSequence=0;
function activeRecord(){
 if(state.event===null||state.treaty===null)return null;
 const key=`${state.event}:${state.treaty}`,fingerprint=`${state.snapshot}:contract-${treaties[state.treaty].version}`;
 let r=cases.get(key);
 if(!r||r.fingerprint!==fingerprint){const prior=r;r={key,fingerprint,version:(prior?.version||0)+1,event:state.event,treaty:state.treaty,snapshot:state.snapshot,assessment:evaluate(state.treaty),prior,packet:null,notes:'',delivery:'Not sent',attempts:[],rasReference:null};cases.set(key,r);records.push(r);}
 return r;
}
function precedingPacket(r){let p=r.prior;while(p&&!p.packet)p=p.prior;return p;}
function uncertainPrior(r){let p=r.prior;while(p){if(p.delivery==='Delivery unconfirmed'||p.delivery==='Sending')return p;p=p.prior;}return null;}
function knownReference(r){let p=r;while(p){if(p.rasReference)return p.rasReference;p=p.prior;}return null;}
function makePacket(r){
 const e=evidence(),t=treaties[r.treaty],c=r.assessment,previous=precedingPacket(r);
 return {schemaVersion:'catlas-demo/1',packetId:`DEMO-PKT-${String(++packetSequence).padStart(4,'0')}`,purpose:previous?'replacement_assessment':'initial_assessment',evaluation:{id:`DEMO-EVAL-${e.id}-${t.id}`,version:r.version,previousPacketId:previous?.packet.packetId||null,previousEvaluationVersion:r.prior?.version||null},contract:{sourceSystem:'Simulated RAS import',id:t.id,version:t.version,currency:'USD',limit:t.limit,coverage:{startInclusive:t.start,endExclusive:t.end}},event:{id:e.id==='outer'?e.source:e.source,name:e.name,occurrenceTime:e.date,magnitude:e.mag,magnitudeType:e.magType,epicentre:{longitude:e.point[0],latitude:e.point[1]},simulated:e.synthetic,observationLabel:e.label},evidence:{snapshotId:`DEMO-${e.source}-S0${r.snapshot+1}`,source:e.synthetic?'SIMULATION':'USGS research reference',sourceEventId:e.id==='outer'?null:e.source,sourceUrl:e.id==='outer'?null:`https://earthquake.usgs.gov/earthquakes/eventpage/${e.source}/executive`,provenanceStatus:'Illustrative embedded reference metadata; source-byte archive not packaged in this UI study',captureTime:null,contentDigest:null},calculation:{ruleId:'DEMO-MATRIX',ruleVersion:'3',referencePoint:{longitude:t.point[0],latitude:t.point[1]},distanceKm:c.distance,distanceMethod:'Spherical great-circle; Earth radius 6371 km',band:bandLabel(c.band),magnitudeRow:rows[c.row]?.label||null,matrixRate:c.pct,coverageMatches:c.inCoverage,status:c.status,provisionalRecovery:c.amount,currency:'USD'},review:{reviewerId:'DEMO-ANALYST',reviewerName:'Demo ceded reinsurance analyst',reviewedAt:new Date().toISOString(),evaluationVersion:r.version,notes:r.notes},priorRasReference:knownReference(r.prior),exceptions:c.exceptions,prototype:true,notice:'Fictional contract and portfolio. Simulation labels apply. Provisional assessment only; no financial approval, payment or live RAS submission.'};
}
function exceptionPacket(r){const e=evidence(),t=treaties[r.treaty];return{schemaVersion:'catlas-demo/1',purpose:'exception_assessment',evaluationId:`DEMO-EVAL-${e.source}-${t.id}`,evaluationVersion:r.version,contractId:t.id,contractVersion:t.version,eventId:e.source,observation:e.label,simulated:e.synthetic,status:'Needs review',provisionalRecovery:null,currency:'USD',exceptions:r.assessment.exceptions,knownConditions:{distanceKm:r.assessment.distance,matrixRate:r.assessment.pct},notes:r.notes,prototype:true,notice:'Incomplete assessment. No recovery amount asserted; not eligible for recovery submission.'};}
function downloadJSON(payload){const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`catlas-${payload.packetId||'exception-v'+payload.evaluationVersion}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function sendable(r){return !!r.packet&&r.assessment.amount!==null&&(r.assessment.amount>0||!!knownReference(r.prior))&&!uncertainPrior(r);}

// Retain the geographic workspace while making review state specific to a version.
const baseRender=render;
render=function(){const r=activeRecord();state.reviewed=!!r?.packet;baseRender();
 document.querySelectorAll('[data-event="2"] small').forEach(el=>el.textContent='Simulated event · fictional 2019 timestamp');
 if(r){const h=$('inspector').querySelector('.pad');h.insertAdjacentHTML('beforeend',`<div class="version-note">Evaluation v${r.version} · RAS contract v1 · ${r.packet?'Explanation reviewed':'Fresh review required'}${r.prior?' · earlier version retained':''}</div>`);const metric=$('inspector').querySelector('.metric .small');if(metric&&r.assessment.amount===0&&r.assessment.status==='Outside coverage')metric.textContent='Occurrence time is outside the imported coverage interval.';
 const coverage=[...$('inspector').querySelectorAll('.row')].find(el=>el.firstElementChild?.textContent==='Coverage period');if(coverage)coverage.lastElementChild.textContent=treaties[r.treaty].missing?'? Dates unavailable':r.assessment.inCoverage?'✓ 2019-01-01 ≤ occurrence < 2020-01-01 UTC':'× Occurrence outside [2019-01-01, 2020-01-01) UTC';
 if(r.assessment.status==='Outside coverage'&&$('inspector').querySelector('.calc'))$('inspector').querySelector('.calc').textContent='Occurrence time is outside coverage → $0. This is distinct from an unmet magnitude/distance trigger.';
 const call=$('handoff');if(call)call.textContent=r.assessment.amount===null?'Inspect exception & missing information ↗':'Review & hand off evaluation ↗';
 if(state.tab==='evidence')$('inspector').insertAdjacentHTML('beforeend','<div class="pad provenance small">Reference metadata from prior research. This UI study does not contain the frozen source-byte archive; production evidence packaging is subsequent work.</div>');
 }
 $('state').textContent+=` · HISTORY: ${records.length} EVALUATIONS${r?' · DELIVERY: '+r.delivery.toUpperCase():''}`;
 $('historycount').textContent=records.length;
};
function summaryRows(data){return data.map(([k,v])=>`<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');}
function deliveryView(r){
 const ref=r.rasReference?` · ${r.rasReference}`:'';
 $('delivery-status').textContent=`${r.delivery}${ref}`;
 $('delivery-status').className=r.delivery==='Received'?'received':'pending';
 $('delivery-log').textContent=r.attempts.map(a=>`${a.at} · ${a.action} · ${a.result}`).join('\n')||'No delivery attempts. Downloading does not submit a packet.';
 $('sendras').disabled=!sendable(r)||r.delivery==='Sending'||r.delivery==='Received';
 $('sendras').textContent=r.attempts.length?'Retry same packet →':'Send to simulated RAS →';
 $('checkras').hidden=r.delivery!=='Delivery unconfirmed';
 $('download').disabled=r.assessment.amount!==null&&!r.packet;
 $('download').textContent=r.assessment.amount===null?'Download exception JSON ↓':r.packet?'Download reviewed packet JSON ↓':'Review required before download';
 $('receiver-mode').disabled=r.delivery==='Sending'||r.delivery==='Received';
 $('delivery-reason').textContent=r.assessment.amount===null?'Missing required information blocks recovery submission.':!r.packet?'Review this evaluation before sending.':uncertainPrior(r)?'Reconcile the earlier delivery before submitting a replacement.':r.assessment.amount===0&&!knownReference(r.prior)?'Completed $0 assessments are download-only for this first demonstration.':r.packet.purpose==='replacement_assessment'?'Replacement assessment: full revised amount, not an additional claim.':'Receipt confirms delivery only; approval and payment remain downstream.';
}
openPacket=function(){const r=activeRecord();if(!r)return;const e=evidence(),t=treaties[r.treaty],c=r.assessment,prior=precedingPacket(r),unconfirmed=uncertainPrior(r);
 $('packetheading').textContent=c.amount===null?'Resolve the missing information.':'Review this evaluation version.';
 $('packet').innerHTML=summaryRows([['Evaluation',`v${r.version} · ${r.packet?.packetId||'Packet created on review'}`],['Event / observation',`${e.name} / ${e.label}`],['Occurrence UTC',e.date],['Magnitude / type',`${e.mag} / mw`],['Imported RAS contract',`${t.id} / v${t.version}`],['Rule / currency','DEMO-MATRIX-v3 / USD'],['Reference latitude, longitude',`${t.point[1]}, ${t.point[0]}`],['Distance / band',`${c.distance?.toFixed(3)} km / ${bandLabel(c.band)}`],['Matrix rate / limit',`${c.pct*100}% / ${money(t.limit)}`],['Coverage',t.missing?'Dates unavailable':'[2019-01-01, 2020-01-01) UTC'],['Assessment / full recovery',`${c.status} / ${money(c.amount)}`],['Previous packet',prior?.packet.packetId||'None'],['Existing RAS reference',knownReference(r.prior)||'None'],['Exceptions',c.exceptions.join('; ')||'None in this fixture']]);
 $('reviewlabel').hidden=c.amount===null;$('reviewed').checked=!!r.packet;$('reviewed').disabled=!!r.packet||!!unconfirmed;
 $('packetnotes').value=r.packet?.review.notes||r.notes;$('packetnotes').disabled=!!r.packet;
 $('reviewhint').textContent=c.amount===null?'This is an exception assessment. No recovery amount is asserted.':r.packet?`Reviewed by demo analyst at ${r.packet.review.reviewedAt}. This packet is frozen; changed inputs require fresh review.`:unconfirmed?'An earlier delivery is unresolved. Reconcile it before freezing a replacement packet.':'Review is scoped to this exact event, contract and evaluation version.';
 $('reconcile-prior').hidden=!unconfirmed;$('reconcile-prior').onclick=()=>{checkDelivery(unconfirmed);openPacket()};
 deliveryView(r);$('packetmodal').style.display='flex';$('closepacket').focus();
};
$('packetnotes').oninput=e=>{const r=activeRecord();if(!r.packet)r.notes=e.target.value;};
$('reviewed').onchange=()=>{const r=activeRecord();if(!r.packet&&$('reviewed').checked&&!uncertainPrior(r)){r.packet=makePacket(r);state.reviewed=true;render();openPacket();}};
$('download').onclick=()=>{const r=activeRecord();if(r.assessment.amount===null)downloadJSON(exceptionPacket(r));else if(r.packet)downloadJSON(r.packet);};
function receiptFor(r){const existing=receiver.get(r.packet.packetId);if(existing)return existing;let reference=knownReference(r.prior)||receivingCases.get(r.key);if(!reference){reference=`MOCK-RAS-${String(receivingCases.size+1).padStart(3,'0')}`;receivingCases.set(r.key,reference);}const receipt={reference,packetId:r.packet.packetId,receivedAt:new Date().toISOString()};receiver.set(r.packet.packetId,receipt);return receipt;}
function logAttempt(r,action,result){r.attempts.push({at:new Date().toISOString(),action,result,submissionId:r.packet.packetId});}
function checkDelivery(r){const receipt=receiver.get(r.packet.packetId);if(receipt){r.delivery='Received';r.rasReference=receipt.reference;logAttempt(r,'Status check',`Received · ${receipt.reference}`);}else{r.delivery='Delivery unconfirmed';logAttempt(r,'Status check','No acknowledgement available; no new claim created');}render();if($('packetmodal').style.display==='flex')openPacket();}
$('sendras').onclick=()=>{const r=activeRecord();if(!sendable(r)||r.delivery==='Sending'||r.delivery==='Received')return;const mode=$('receiver-mode').value;r.delivery='Sending';logAttempt(r,'Send',`Packet ${r.packet.packetId} · awaiting mock response`);deliveryView(r);render();setTimeout(()=>{if(receiver.has(r.packet.packetId)){const receipt=receiver.get(r.packet.packetId);r.delivery='Received';r.rasReference=receipt.reference;logAttempt(r,'Retry acknowledgement',`Same receiving record · ${receipt.reference}`);}else if(mode==='reject'){r.delivery='Rejected';logAttempt(r,'Mock response','Rejected: simulated destination validation rule. Reviewed payload unchanged.');}else{const receipt=receiptFor(r);if(mode==='unconfirmed'){r.delivery='Delivery unconfirmed';logAttempt(r,'Mock response','Acknowledgement lost; receiving outcome not yet confirmed to Catlas');}else{r.delivery='Received';r.rasReference=receipt.reference;logAttempt(r,'Mock response',`Received · ${receipt.reference}`);}}render();if(activeRecord()===r&&$('packetmodal').style.display==='flex')openPacket();},450);};
$('checkras').onclick=()=>checkDelivery(activeRecord());
function showHistory(){const box=$('historylist');box.replaceChildren();if(!records.length)box.textContent='Select an event and treaty to create an evaluation.';records.slice().reverse().forEach(r=>{const card=document.createElement('div');card.className='history-card';const title=document.createElement('strong');title.textContent=`${events[r.event].name} · ${treaties[r.treaty].short} · v${r.version}`;card.append(title);const p=document.createElement('p');p.textContent=`${r.event===2?'Simulated outer-band event':r.snapshot?'Reference observation':'Simulated M6.9'} · ${r.assessment.status} · ${money(r.assessment.amount)} · ${r.packet?'Reviewed '+r.packet.packetId:'Not reviewed'} · ${r.delivery}${r.rasReference?' / '+r.rasReference:''}`;card.append(p);if(r.packet){const btn=document.createElement('button');btn.textContent='Download preserved packet';btn.onclick=()=>downloadJSON(r.packet);card.append(btn);}if(r.attempts.length){const attempts=document.createElement('pre');attempts.textContent=r.attempts.map(a=>`${a.action}: ${a.result}`).join('\n');card.append(attempts);}box.append(card);});$('historymodal').style.display='flex';$('closehistory').focus();}
$('historybutton').onclick=showHistory;$('closehistory').onclick=()=>$('historymodal').style.display='none';$('historymodal').onclick=e=>{if(e.target===$('historymodal'))$('historymodal').style.display='none';};
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('historymodal').style.display='none';});
const baseRenderTour=renderTour;renderTour=function(){baseRenderTour();if(state.step===5)$('tourdesc').textContent='Review this version, then download or send to the simulated receiver. Try receipt, rejection or an unconfirmed response.';if(state.scenario==='missing'&&state.step===5)$('tourdesc').textContent='Download an exception with missing fields. Recovery submission is blocked.';if(state.free){$('tourtitle').textContent='Free exploration';$('tourdesc').textContent='Select events and treaties in any order, or start a guided scenario.';$('next').textContent='Start walkthrough →';$('previous').disabled=true;}};
const baseChooseEvent=chooseEvent,baseChooseTreaty=chooseTreaty,baseApplyStep=applyStep;
chooseEvent=i=>{state.free=true;baseChooseEvent(i);};chooseTreaty=i=>{state.free=true;baseChooseTreaty(i);};applyStep=n=>{state.free=false;baseApplyStep(n);};
$('next').onclick=()=>applyStep(state.free?1:(state.step+1)%6);
// No external map requests on load. Satellite imagery is opt-in and contextual.
render();
