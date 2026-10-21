import { RecoveryInspector, type RecoveryView } from "./RecoveryInspector";
import { useEffect, useState, type FormEvent } from 'react';
import type { EventInput } from '../domain/types';
import { sameRecoveryEvent } from '../exposure/event-context';
import { downloadFile } from '../exposure/exports';
import { ridgecrest } from '../data/fixtures';
import { assessLoss, lossPositionSchema, type LossPosition, type RecoveryResult, type RecoverySnapshot } from './model';
import { recoveryRepository } from './repository';

export type SimpleRecoveryContext = { result: RecoveryResult; position: LossPosition; event: EventInput; version?: number };
type Draft = Record<keyof Omit<LossPosition, 'confirmed'>, string>;
const empty: Draft = {entity:'',businessLine:'',source:'',valuationDate:'',currency:'USD',eligibleLoss:'',treaty:'',inception:'',expiry:'',retention:'',limit:'',availableLimit:'',share:''};
const amountFields = new Set(['eligibleLoss','retention','limit','availableLimit','share']);
const money = (amount: number, currency: string) => new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:2}).format(amount);
export function SimpleRecovery({event,onEventChange,onContextChange,inspectorTarget,view="assessment",onViewChange}: {
  inspectorTarget?: HTMLElement | null; view?: RecoveryView; onViewChange?: (view:RecoveryView)=>void;
  event: EventInput|null; onEventChange:(event:EventInput|null)=>void; onContextChange:(context:SimpleRecoveryContext|null)=>void;
}) {
  const [draft,setDraft] = useState<Draft>(empty);
  const [confirmed,setConfirmed] = useState(false), [reviewed,setReviewed] = useState(false), [notes,setNotes] = useState('');
  const [assessment,setAssessment] = useState<SimpleRecoveryContext|null>(null), [saved,setSaved] = useState<RecoverySnapshot|null>(null);
  const [history,setHistory] = useState<RecoverySnapshot[]>([]), [status,setStatus] = useState('Loading local history…'), [error,setError] = useState('');
  const [ready,setReady] = useState(false), [saving,setSaving] = useState(false);
  const current = assessment && sameRecoveryEvent(assessment.event,event) ? assessment : null;
  useEffect(()=>{let active=true;void recoveryRepository.list().then(rows=>{if(active){setHistory(rows);setReady(true);setStatus('Reviewed versions are saved in this browser only.');}}).catch(()=>{if(active){setError('Local recovery history could not be loaded. Existing records are preserved. Reload to retry.');setStatus('Local history unavailable.');}});return()=>{active=false;};},[]);
  useEffect(()=>{onContextChange(current);},[current,onContextChange]);
  useEffect(()=>{setAssessment(null);setSaved(null);setReviewed(false);setConfirmed(false);},[event]);
  function invalidate() {setAssessment(null);setSaved(null);setReviewed(false);setError('');}
  function field(key:keyof Draft,label:string,type='text') {
    return <label key={key}>{label}<input required type={type} value={draft[key]} min={type==='number'?0:undefined} max={key==='share'?100:type==='number'?1e12:undefined} step={type==='number'?'0.01':undefined} maxLength={type==='text'?500:undefined} onChange={e=>{setDraft(value=>({...value,[key]:e.target.value}));setConfirmed(false);invalidate();}}/></label>;
  }
  function calculate(e:FormEvent) {
    e.preventDefault();setError('');
    try {
      const values = Object.fromEntries(Object.entries(draft).map(([key,value])=>[key,amountFields.has(key)?value.trim()===''?undefined:Number(value):value]));
      const parsed = lossPositionSchema.safeParse({...values,confirmed});
      if(!parsed.success) throw new Error(parsed.error.issues.map(issue=>issue.message).join(' '));
      if(!event) throw new Error('Select an event first.');
      setAssessment({event:structuredClone(event),position:parsed.data,result:assessLoss(parsed.data,event)});setSaved(null);setReviewed(false);
    } catch(e) {setAssessment(null);setError(e instanceof Error?e.message:'Assessment failed.');}
  }
  async function save() {
    if(!current||!reviewed||!ready||saving)return;
    setSaving(true);setError('');
    try {
      const snapshot=await recoveryRepository.save(current.event,current.position,notes);
      setSaved(snapshot);setAssessment({...current,version:snapshot.version});setHistory(rows=>[snapshot,...rows]);setStatus(`Reviewed version ${snapshot.version} saved locally.`);
    } catch {setError('Could not save this reviewed version. No successful save is being asserted. Retry or reload.');}
    finally {setSaving(false);}
  }
  function open(snapshot:RecoverySnapshot) {
    onEventChange(snapshot.event as EventInput);
    setDraft(Object.fromEntries(Object.entries(snapshot.position).filter(([key])=>key!=='confirmed').map(([key,value])=>[key,String(value)])) as Draft);
    // Restore after the event change invalidates the previous assessment.
    setPending(snapshot);
    onViewChange?.("assessment");
  }
  const [pending,setPending] = useState<RecoverySnapshot|null>(null);
  useEffect(()=>{if(pending&&sameRecoveryEvent(pending.event as EventInput,event)){setAssessment({event:pending.event as EventInput,position:pending.position,result:pending.result,version:pending.version});setSaved(pending);setNotes(pending.reviewNotes);setConfirmed(true);setReviewed(true);setError('');setPending(null);}},[pending,event]);
  const p=current?.position, r=current?.result;
  return <section className="simple-recovery" aria-label="Event recovery assessment">
    <header><p className="eyebrow">EVENT RECOVERY ASSESSMENT</p><h2>Estimate recovery and retained loss</h2><p>Assess one catastrophe excess-of-loss layer using an eligible event loss estimate. Exposure values are not loss estimates.</p></header>
    <div hidden={view !== "assessment"} className="recovery-assessment-options">
    <section className="recovery-event"><strong>{event?.name??'Choose an event to begin'}</strong><p>{event?.occurredAt??'Use Change event above, or load the historical earthquake.'}</p>{!event&&<button onClick={()=>onEventChange(ridgecrest)}>Use Ridgecrest earthquake</button>}</section>
    <p>Manual assessment · one currency · one occurrence layer. Confirm event grouping and covered losses with your reinsurance team.</p>
    <form onSubmit={calculate}>
      <fieldset disabled={saving}><legend>1. Loss position</legend>
        {field('entity','Insurer / legal entity')}{field('businessLine','Business line / covered portfolio')}
        {field('source','Loss estimate source / reference')}{field('valuationDate','Loss valuation date','date')}
        <label>Assessment currency<select value={draft.currency} onChange={e=>{setDraft(value=>({...value,currency:e.target.value}));setConfirmed(false);invalidate();}}>{['USD','CAD','EUR','GBP'].map(code=><option key={code}>{code}</option>)}</select></label>
        {field('eligibleLoss','Estimated eligible event loss','number')}
        <p>Enter the total estimated ultimate loss eligible for this layer, including paid and outstanding amounts. Apply underlying policy terms and any preceding reinsurance before entering this estimate. Do not add overlapping estimates or insured values. Expenses must follow the treaty basis.</p>
      </fieldset>
      <fieldset disabled={saving}><legend>2. Reinsurance layer</legend>
        {field('treaty','Contract reference / version')}{field('inception','First covered date (UTC)','date')}{field('expiry','Last covered date (UTC, inclusive)','date')}
        {field('retention','Retention / attachment','number')}{field('limit','Layer limit at 100%','number')}{field('availableLimit','Remaining available limit at 100%','number')}{field('share','Placed share (%)','number')}
        <p>All amounts use {draft.currency}. Available limit is the remaining capacity for this assessment before applying the placed share. No currency conversion or automatic reinstatement is applied.</p>
        <label className="recovery-check"><input type="checkbox" checked={confirmed} required onChange={e=>{setConfirmed(e.target.checked);invalidate();}}/>I checked covered business, peril, occurrence grouping, expense treatment, preceding reinsurance and available capacity. These terms describe one occurrence layer.</label>
      </fieldset>
      <button type="submit" disabled={!event||saving}>Calculate provisional recovery</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    </div>
    <RecoveryInspector target={inspectorTarget} simple>{p&&r?<section className="inspector" aria-label="Recovery explanation">
      <p className="eyebrow">{saved?`REVIEWED VERSION ${saved.version}`:'DRAFT · REQUIRES REVIEW'}</p>
      <div className="result"><span>Provisional recovery · {p.currency}</span><strong data-testid="simple-recovery-total">{money(r.recovery,p.currency)}</strong><span>{r.outsideCoverage?'Outside entered coverage dates':r.recovery===0?'No recovery under the entered terms':'Estimated ultimate recovery'}</span></div>
      <dl className="aggregation">{[['Eligible event loss',r.eligibleLoss],['Loss above retention',r.aboveRetention],['Loss allocated to available layer',r.layerLoss],['Estimated retained loss',r.retainedLoss]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(value as number,p.currency)}</dd></div>)}</dl>
      <p className="formula">{r.outsideCoverage?'The event falls outside the entered UTC coverage dates.':`min(max(${money(p.eligibleLoss,p.currency)} − ${money(p.retention,p.currency)}, 0), ${money(p.limit,p.currency)}, ${money(p.availableLimit,p.currency)}) × ${p.share}%`}</p>
      <p>Retained loss = entered eligible loss − provisional recovery. This describes this layer only; other recoveries may change the insurer’s final net loss.</p>
      <p className="caution">Provisional estimate, not an approved receivable, amount currently billable or cash collected. Contract interpretation and financial approval remain with reinsurance operations.</p>
      {!saved&&<><label>Review notes<textarea maxLength={4000} value={notes} onChange={e=>{setNotes(e.target.value);setReviewed(false);}}/></label><label className="recovery-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed the inputs and calculation for this assessment.</label><button disabled={!reviewed||!ready||saving} onClick={()=>void save()}>{saving?'Saving…':'Save reviewed version'}</button></>}
      {saved&&<button onClick={()=>downloadFile(`catlas-recovery-${saved.id}.json`,new Blob([JSON.stringify(saved,null,2)],{type:'application/json'}))}>Download reviewed assessment</button>}
    </section>:inspectorTarget?<section className="inspector" aria-label="Recovery explanation"><p className="eyebrow">RECOVERY DETAILS</p><h2>{event?"Enter loss and layer terms":"Select an event"}</h2><p>Calculate an assessment to inspect the provisional recovery, retained loss and calculation here.</p></section>:null}</RecoveryInspector>
    <div hidden={view !== "history"} className="recovery-history-options">
    <p role="status">{status}</p>
    <section aria-label="Retained recovery assessments"><h3>Reviewed recovery history</h3><p>Opening a version restores its event, entered terms and loss estimate. Editing creates a draft; saving preserves a new version.</p>{!history.length?<p>No reviewed assessments yet.</p>:history.map(item=><article className="recovery-history-row" key={item.id}><strong>{item.event.name} · v{item.version}</strong><span>{item.position.entity} · {item.position.businessLine} · {item.position.treaty}</span><span>Loss as of {item.position.valuationDate} · {money(item.result.recovery,item.position.currency)}</span><button disabled={saving} onClick={()=>open(item)}>Open reviewed version {item.version}</button></article>)}</section>
    </div>
  </section>;
}
