import { manifest } from "../data/fixtures";
import type { EventEvidence } from "../domain/types";
export function EventEvidencePanel({ event }: { event: EventEvidence }) {
  return (
    <>
      <div className="event-facts">
        <div>
          <span>Raw magnitude</span>
          <strong>
            {event.magnitude} {event.magnitudeType}
          </strong>
        </div>
        <div>
          <span>Occurrence (UTC)</span>
          <strong>{event.occurredAt}</strong>
        </div>
        <div>
          <span>Epicentre</span>
          <strong>
            {event.latitude}, {event.longitude}
          </strong>
        </div>
      </div>
      {event.provenance.kind === "historical" ? (
        <details className="evidence">
          <summary>Inspect captured USGS evidence and provenance</summary>
          <p>
            Historical event; capture at preparation time. This is not a
            reconstruction of what was known at occurrence.
          </p>
          <p>
            Selected summary fields: literal raw <code>mw</code>, magnitude 7.1,
            occurrence and epicentre. Highest preferredWeight CI origin product
            matches these summary values. QuakeML is retained verbatim: its
            magnitude spelling is <code>Mw</code> and its magnitude origin
            linkage differs from the preferred hypocentre. No normalization of
            XML spelling determines eligibility.
          </p>
          <dl>
            <dt>Capture recorded (UTC)</dt>
            <dd>{manifest.capturedAt}</dd>
            <dt>Product</dt>
            <dd>{manifest.selectedProductId}</dd>
            <dt>Selected origin</dt>
            <dd>{manifest.selectedOriginId}</dd>
            <dt>Selected magnitude</dt>
            <dd>{manifest.selectedMagnitudeId}</dd>
          </dl>
          {manifest.files.map((f) => (
            <p key={f.file}>
              <a
                href={`${import.meta.env.BASE_URL}evidence/${f.file}`}
                download
              >
                {f.file}
              </a>
              <br />
              <code>SHA-256 {f.sha256}</code>
            </p>
          ))}
          <p>{manifest.selection}</p>
        </details>
      ) : (
        <details className="evidence">
          <summary>Inspect simulation provenance</summary>
          <p>
            This event and occurrence time are synthetic. No historical USGS
            observation or capture is asserted.
          </p>
          <pre>{JSON.stringify(event.provenance, null, 2)}</pre>
        </details>
      )}
    </>
  );
}
