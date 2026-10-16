import { usd } from "./format";
import { EventEvidencePanel } from "./components/EventEvidencePanel";
import { AreaExplanation } from "./components/AreaExplanation";
import { useCallback, useState } from "react";
import { scenarios } from "./data/scenarios";
import { mainContract } from "./data/fixtures";
import { WorkbenchMap } from "./components/WorkbenchMap";
import { useEvaluationLifecycle } from "./hooks/useEvaluationLifecycle";
import { PacketReview, PacketHistory } from "./components/PacketReview";
import "./app.css";
export default function App() {
  const [scenarioId, setScenarioId] = useState(""),
    [selectedArea, setSelectedArea] = useState("mojave");
  const { lifecycle, evaluateInputs, clearSelection, reviewEvaluation } =
    useEvaluationLifecycle();
  const chooseScenario = useCallback(
    (id: string) => {
      setScenarioId(id);
      const next = scenarios.find((s) => s.id === id);
      if (next) evaluateInputs(next.event, next.contract);
      else clearSelection();
    },
    [evaluateInputs, clearSelection],
  );
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];
  const { event, contract } = scenario;
  const hasSelection = Boolean(scenarioId);
  const selectEvent = useCallback(
    (next: typeof event) =>
      chooseScenario(next.id === "SIM-OUTER-01" ? "outer" : "ridgecrest"),
    [chooseScenario],
  );
  const clearEvent = useCallback(() => chooseScenario(""), [chooseScenario]);
  const selectArea = useCallback((id: string) => setSelectedArea(id), []);
  const evaluation = lifecycle.evaluations.find(
    (e) => e.id === lifecycle.currentEvaluationId,
  );
  const assessment = evaluation?.assessment;
  const packet = lifecycle.packets.find(
    (p) => p.evaluation.id === evaluation?.id,
  );
  const review = (notes: string) => {
    if (evaluation) reviewEvaluation(evaluation.id, notes);
  };
  const area = assessment?.areas.find((a) => a.areaId === selectedArea);
  return (
    <div className="catlas">
      <header className="topbar">
        <a className="brand" href="./">
          ◈ <strong>catlas</strong>
          <span>EARTHQUAKE WORKBENCH</span>
        </a>
        <span className="demo-tag">Demonstration · simulated RAS</span>
      </header>
      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">CEDENT INVESTIGATION / HISTORICAL REPLAY</p>
            <h1>One earthquake. Two area contributions.</h1>
            <p>
              Explain a provisional contractual recovery from frozen evidence
              and imported terms.
            </p>
          </div>
          <div className="cedent">
            <span>Fictional cedent</span>
            <strong>{contract.cedent.name}</strong>
            <small>{contract.cedent.id}</small>
          </div>
        </section>
        <section
          className="scenario-picker"
          aria-label="Demonstration scenario"
        >
          <label htmlFor="scenario">Demonstration scenario</label>
          <select
            id="scenario"
            value={scenarioId}
            onChange={(e) => chooseScenario(e.target.value)}
          >
            <option value="">Choose an event or walkthrough</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <p>
            {hasSelection
              ? scenario.description
              : "Discover an earthquake on the world map or choose a known walkthrough. No recovery is selected yet."}
          </p>
        </section>
        <div className="workspace">
          <section className="map-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">SELECTED EVENT</p>
                <h2>{hasSelection ? event.name : "World event discovery"}</h2>
              </div>
              {hasSelection && (
                <span className="event-button">
                  M{event.magnitude} {event.magnitudeType} ·{" "}
                  {event.provenance.kind === "historical"
                    ? "historical evidence"
                    : "labelled simulation"}
                </span>
              )}
            </div>
            <WorkbenchMap
              event={hasSelection ? event : null}
              contract={mainContract}
              selectedArea={selectedArea}
              onSelectArea={selectArea}
              onSelectEvent={selectEvent}
              onClearEvent={clearEvent}
            />
            {hasSelection && <EventEvidencePanel event={event} />}
          </section>
          {hasSelection && assessment && evaluation ? (
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
                  <dd>{usd(contract.eventCap)}</dd>
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
              <PacketReview
                key={evaluation.id}
                evaluation={evaluation}
                packet={packet}
                onReview={review}
              />
            </aside>
          ) : (
            <aside className="inspector">
              <p className="eyebrow">READY TO INVESTIGATE</p>
              <h2>Select an earthquake</h2>
              <p>
                Choose Ridgecrest or the labelled synthetic outer event to
                inspect the two scheduled area contributions and treaty total.
              </p>
              <p>
                Map locations are synthetic context. They do not create recovery
                conditions.
              </p>
            </aside>
          )}
        </div>
        <PacketHistory packets={lifecycle.packets} />
      </main>
      <footer>
        Offline analytical map · Natural Earth public-domain land data ·
        MapLibre GL JS (BSD-3-Clause) · Public USGS earthquake evidence ·
        Customer validation deferred
      </footer>
    </div>
  );
}
