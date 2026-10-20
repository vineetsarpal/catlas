import { useState } from 'react';
import type { EvaluationRecord } from '../domain/packets';
import type { ContractInput, EventInput } from '../domain/types';
import { mainContract, ridgecrest } from '../data/fixtures';
import { capturedReference, simulatedObservation, revisedTerms, missingCoverageRevisedTerms } from '../data/revisions';
import './revision-controls.css';

export type RevisionControlsProps = {
 evaluation?: EvaluationRecord;
 disabled?: boolean;
 onRevise: (event: EventInput, contract: ContractInput) => Promise<unknown> | void;
};
export function RevisionControls({evaluation, disabled=false, onRevise}: RevisionControlsProps) {
 const [pending,setPending]=useState(false), [error,setError]=useState('');
 const locked=disabled||pending;
 const mainLineage=evaluation?.event.id===ridgecrest.id&&evaluation?.contract.id===mainContract.id;
 const run=async(event:EventInput,contract:ContractInput)=>{
  setPending(true);setError('');
  try {await onRevise(event,contract);} catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}
  finally {setPending(false);}
 };
 const same=(event:EventInput,contract:ContractInput)=>Boolean(evaluation&&JSON.stringify(evaluation.event)===JSON.stringify(event)&&JSON.stringify(evaluation.contract)===JSON.stringify(contract));
 return <section className="revision-controls" aria-label="Versioned input revisions">
  <h2>Evidence and imported-term revisions</h2>
  <p>Labelled sensitivity exercise: simulated M6.9 → captured M7.1, at unchanged Ridgecrest coordinates and occurrence time. This is not actual USGS bulletin chronology.</p>
  <button disabled={locked||same(simulatedObservation,mainContract)} onClick={()=>void run(simulatedObservation,mainContract)}>Start simulated M6.9 exercise · reset to imported v2</button>
  {evaluation&&<>
   <p>Selected evaluation v{evaluation.version} · evidence <code>{evaluation.event.evidenceVersion??'missing'}</code> · imported contract v{evaluation.contract.version??'missing'}.</p>
   <div className="revision-actions">
    <button disabled={locked||!mainLineage||same(capturedReference,evaluation.contract)} onClick={()=>void run(capturedReference,evaluation.contract)}>Apply captured M7.1 reference · keep current terms</button>
    <button disabled={locked||!mainLineage||same(evaluation.event,revisedTerms)} onClick={()=>void run(evaluation.event,revisedTerms)}>Import fictional RAS terms v3 · minimum M7.5</button>
    <button disabled={locked||!mainLineage||same(evaluation.event,missingCoverageRevisedTerms)} onClick={()=>void run(evaluation.event,missingCoverageRevisedTerms)}>Import incomplete fictional RAS terms v4</button>
    <button disabled={locked||!mainLineage||same(evaluation.event,mainContract)} onClick={()=>void run(evaluation.event,mainContract)}>Restore packaged RAS terms v2 · keep evidence</button>
   </div>
   {!mainLineage&&<p>Reference and term replacements apply to the Ridgecrest × DEMO-CA-PARAMETRIC case. Start the sensitivity exercise to investigate that lineage.</p>}
  </>}
  <p>RAS authors contracts; Catlas imports these packaged fictional versions. Version 3 raises the minimum magnitude to 7.5; version 4 deliberately omits coverage. Changed inputs create a new evaluation requiring fresh review; previous packets remain immutable in local history.</p>
  {error&&<p role="alert">Revision failed: {error}</p>}
 </section>;
}
