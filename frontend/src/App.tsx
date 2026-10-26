import { RecoveryInspector, RecoveryOptionsTabs, type RecoveryView } from "./recovery/RecoveryInspector";
import { SimpleRecovery, type SimpleRecoveryContext } from "./recovery/SimpleRecovery";
import { sameRecoveryEvent } from './exposure/event-context';
import type { EventInput } from "./domain/types";
import type { EvaluationRecord } from "./domain/packets";
import { StoragePanel, EvaluationHistory } from "./components/LocalHistory";
import { usd } from "./format";
import { EventEvidencePanel } from "./components/EventEvidencePanel";
import { AreaExplanation } from "./components/AreaExplanation";
import { useCallback, useEffect, useState } from "react";
import { scenarios } from "./data/scenarios";
import { RevisionControls } from "./components/RevisionControls";
import { DeliveryPanel } from "./components/DeliveryPanel";
import { DeliveryHistory } from "./components/DeliveryHistory";
import { useEvaluationLifecycle } from "./hooks/useEvaluationLifecycle";
import { ReplacementReview } from "./components/ReplacementReview";
import { PacketHistory } from "./components/PacketReview";
import "./app.css";
import "./workbench-theme.css";
import "./recovery-theme.css";
export type RecoveryContext = { evaluation?: EvaluationRecord; selectedArea: string; selectArea: (id: string) => void; kind?: "simple" | "parametric"; simple?: SimpleRecoveryContext | null };
function ParametricRecoveryWorkbench({ sharedEvent, onEventChange, onContextChange, inspectorTarget, view = "assessment", onViewChange }: {
  sharedEvent: EventInput | null;
  onEventChange: (event: EventInput | null) => void;
  onContextChange: (context: RecoveryContext) => void;
  inspectorTarget?: HTMLElement | null;
  view?: RecoveryView;
  onViewChange?: (view: RecoveryView) => void;
}) {
  const [scenarioId, setScenarioId] = useState(""),
    [selectedArea, setSelectedArea] = useState("mojave");
  const {
    lifecycle, evaluateInputs, clearSelection, reviewEvaluation, resumeEvaluation,
    resetDemo, storageStatus, storageError, actionError, repository,
  } = useEvaluationLifecycle();
  const chooseScenario = useCallback(async (id: string) => {
    const next = scenarios.find(scenario => scenario.id === id);
    if (next) {
      const saved = await evaluateInputs(next.event, next.contract);
      if (saved) { setScenarioId(id); onEventChange(next.event); }
    } else {
      clearSelection();
      setScenarioId("");
      onEventChange(null);
    }
  }, [evaluateInputs, clearSelection, onEventChange]);
  const scenario = scenarios.find(scenario => scenario.id === scenarioId) ?? scenarios[0];
  const evaluation = lifecycle.evaluations.find(evaluation => evaluation.id === lifecycle.currentEvaluationId);
  const event = evaluation?.event ?? scenario.event;
  const contract = evaluation?.contract ?? scenario.contract;
  const matches = Boolean(evaluation && sameRecoveryEvent(evaluation.event,sharedEvent));
  const hasSelection = Boolean(evaluation && matches);
  const busy = storageStatus !== "ready";
  const resume = (id: string) => {
    resumeEvaluation(id);
    onEventChange(lifecycle.evaluations.find(item=>item.id===id)?.event ?? null);
    setScenarioId("__retained__");
    onViewChange?.("assessment");
  };
  const reset = () => {
    void resetDemo().then(saved => {
      if (!saved) return;
      setScenarioId("");
      onEventChange(null);
      setSelectedArea("mojave");
    });
  };
  const selectArea = useCallback((id: string) => setSelectedArea(id), []);
  const assessment = evaluation?.assessment;
  const packet = lifecycle.packets.find(
    (p) => p.evaluation.id === evaluation?.id,
  );
  const review = (notes: string) => {
    if (evaluation) reviewEvaluation(evaluation.id, notes);
  };
  const area = assessment?.areas.find((a) => a.areaId === selectedArea);
  useEffect(()=>{onContextChange({evaluation,selectedArea,selectArea});},[evaluation,selectedArea,selectArea,onContextChange]);
  return (
    <div className="catlas recovery-controls">
      <p hidden={view!=="assessment"} className="recovery-panel-intro">Evaluate imported terms against the selected earthquake. Shaking exposure does not establish a recovery.</p>
      <div hidden={view !== "assessment"} className="recovery-assessment-options">
      {sharedEvent && !matches && <section className="recovery-handoff" aria-label="Selected earthquake recovery handoff"><strong>{sharedEvent.name ?? sharedEvent.id}</strong><p>{evaluation?'A retained recovery belongs to a different observation. Evaluate the selected earthquake to create its assessment.':'Use the selected observation with the packaged fictional contract.'}</p><button disabled={busy} onClick={()=>void evaluateInputs(sharedEvent,contract).then(saved=>{if(saved)setScenarioId('__retained__');})}>Evaluate selected earthquake</button></section>}
      <p className="storage-summary" role="status">{storageStatus==="ready"?"Local history saved in this browser":storageStatus==="saving"?"Saving local history…":storageStatus==="loading"?"Loading local history…":"Local history requires attention below"}</p>
        <section
          className="scenario-picker"
          aria-label="Demonstration scenario"
        >
          <label htmlFor="scenario">Demonstration scenario</label>
          <select
            disabled={busy}
            id="scenario"
            value={scenarioId}
            onChange={(e) => chooseScenario(e.target.value)}
          >
            <option value="">Choose an event or walkthrough</option>
            {scenarioId==="__retained__"&&<option value="__retained__">Retained evaluation snapshot</option>}
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <p>
            {hasSelection
              ? scenarioId==="__retained__" ? "Exact retained evaluation snapshot; no recalculation under current fixtures." : scenario.description
              : "Choose a packaged walkthrough, or evaluate the selected earthquake above."}
          </p>
        </section>
        <div className="recovery-quick-events"><button disabled={busy} onClick={()=>void chooseScenario('ridgecrest')}>Ridgecrest historical replay · M7.1</button><button disabled={busy} onClick={()=>void chooseScenario('outer')}>Synthetic outer event · M7.1</button>{sharedEvent&&<button disabled={busy} onClick={()=>void chooseScenario('')}>Clear event selection</button>}</div>
        {hasSelection && <EventEvidencePanel event={event} />}
          <RecoveryInspector target={inspectorTarget}>{hasSelection && assessment && evaluation ? (
            <aside className="inspector">
              <p className="eyebrow">IMPORTED CONTRACT · V{contract.version}</p>
              <h2>{contract.name}</h2>
              <p className="muted">
                {contract.id}
                <br />
                {contract.source} · fictional contract import
              </p>
              <div className="result">
                <span className="status">● {assessment.status}</span>
                <strong data-testid="treaty-total">
                  {assessment.amount === null
                    ? "Indeterminate"
                    : usd(assessment.amount)}
                </strong>
                <span>
                  {assessment.amount === null
                    ? "No recovery amount asserted"
                    : "Provisional recovery · USD"}
                </span>
              </div>
              <p className="caution">
                Calculated contractual amount. Subject to analyst review; not a
                physical loss estimate, approved receivable or payment.
              </p>
              {assessment.exceptions.length > 0 && (
                <section
                  className="assessment-reasons"
                  aria-label="Missing or unsupported inputs"
                >
                  <h3>Missing or unsupported inputs</h3>
                  <ul>
                    {assessment.exceptions.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <p>
                    Needs review: complete required inputs before asserting a
                    recovery. An exception packet may describe these gaps.
                  </p>
                </section>
              )}
              {assessment.knownFailures.length > 0 && (
                <section
                  className="assessment-reasons"
                  aria-label="Known failed conditions"
                >
                  <h3>Known failed conditions</h3>
                  <ul>
                    {assessment.knownFailures.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {assessment.amount === null && (
                    <p>
                      These known failures do not establish zero while required
                      inputs are missing.
                    </p>
                  )}
                </section>
              )}
              <div className="area-tabs" aria-label="Inspect scheduled area">
                {assessment.areas.map((a) => (
                  <button
                    key={a.areaId}
                    onClick={() => selectArea(a.areaId)}
                    aria-pressed={a.areaId === selectedArea}
                  >
                    {a.name}
                    <strong>{usd(a.contribution)}</strong>
                  </button>
                ))}
              </div>
              {area && (
                <AreaExplanation
                  area={area}
                  assessment={assessment}
                  contract={contract}
                />
              )}
              <dl className="aggregation">
                <div>
                  <dt>Area contributions</dt>
                  <dd>
                    {assessment.uncappedSum === null
                      ? "Not determined"
                      : usd(assessment.uncappedSum)}
                  </dd>
                </div>
                <div>
                  <dt>Treaty event cap</dt>
                  <dd>{contract.eventCap===undefined?"Missing cap":usd(contract.eventCap)}</dd>
                </div>
                <div>
                  <dt>Capped treaty total</dt>
                  <dd>
                    {assessment.amount === null
                      ? "Indeterminate"
                      : usd(assessment.amount)}
                  </dd>
                </div>
              </dl>
              <p className="muted">
                UTC coverage [{contract.inception ?? "missing inception"},{" "}
                {contract.expiry ?? "missing expiry"})<br />
                RAS authors contracts; Catlas imports versioned terms.
              </p>
              <ReplacementReview
                key={evaluation.id}
                evaluation={evaluation}
                packet={packet}
                packets={lifecycle.packets}
                repository={repository}
                actionError={actionError}
                onFreshEvaluation={()=>{void evaluateInputs(event,contract,{forceNewVersion:true}).then(saved=>{if(saved)setScenarioId("__retained__");});}}
                disabled={busy}
                onReview={review}
              />
              <DeliveryPanel packet={packet} disabled={busy} repository={repository}/>
            </aside>
          ) : (
            <aside className="inspector">
              <p className="eyebrow">READY TO INVESTIGATE</p>
              <h2>{sharedEvent?'Ready to evaluate':'Select an earthquake'}</h2>
              <p>
                Choose Ridgecrest or the labelled synthetic outer event to
                inspect the two scheduled area contributions and treaty total.
              </p>
              <p>
                Map locations are synthetic context. They do not create recovery
                conditions.
              </p>
            </aside>
          )}</RecoveryInspector>
        <RevisionControls evaluation={evaluation} disabled={busy} onRevise={async (nextEvent,nextContract)=>{
          const saved=await evaluateInputs(nextEvent,nextContract);
          if(saved){setScenarioId("__retained__");onEventChange(nextEvent);}
        }}/>
      </div>
      <div hidden={view !== "history"} className="recovery-history-options">
        <StoragePanel status={storageStatus} error={storageError} onReset={reset} repository={repository} />
        <EvaluationHistory lifecycle={lifecycle} onResume={resume} disabled={busy} />
        <PacketHistory packets={lifecycle.packets} />
        <DeliveryHistory repository={repository}/>
      </div>
    </div>
  );
}


export default function RecoveryWorkbench(props: {
  sharedEvent: EventInput | null;
  onEventChange: (event: EventInput | null) => void;
  onContextChange: (context: RecoveryContext) => void;
  inspectorTarget?: HTMLElement | null;
  view?: RecoveryView;
  onViewChange?: (view: RecoveryView) => void;
}) {
  const [localView,setLocalView] = useState<RecoveryView>("assessment");
  const view = props.view ?? localView;
  const changeView = props.onViewChange ?? setLocalView;
  const [kind,setKind] = useState<'simple'|'parametric'>(()=>new URLSearchParams(location.search).get('recovery')==='parametric'?'parametric':'simple');
  const simpleContext = useCallback((simple:SimpleRecoveryContext|null)=>props.onContextChange({kind:'simple',simple,selectedArea:'',selectArea:()=>{}}),[props.onContextChange]);
  const parametricContext = useCallback((context:RecoveryContext)=>props.onContextChange({...context,kind:'parametric'}),[props.onContextChange]);
  return <>
    {props.view===undefined&&<RecoveryOptionsTabs view={view} onChange={changeView}/>}
    <div className="recovery-kind" hidden={view !== "assessment"}><label>Assessment type<select value={kind} onChange={e=>{
      const next=e.target.value as typeof kind;setKind(next);
      const url=new URL(location.href);if(next==='parametric')url.searchParams.set('recovery',next);else url.searchParams.delete('recovery');window.history.replaceState(null,'',url);
    }}><option value="simple">Event loss · excess-of-loss layer</option><option value="parametric">Parametric demonstration</option></select></label></div>
    {kind==='simple'?<div className="catlas recovery-controls"><SimpleRecovery event={props.sharedEvent} onEventChange={props.onEventChange} onContextChange={simpleContext} inspectorTarget={props.inspectorTarget} view={view} onViewChange={changeView}/></div>:<ParametricRecoveryWorkbench {...props} view={view} onViewChange={changeView} onContextChange={parametricContext}/>}
  </>;
}
