import type { EventInput } from '../domain/types';

export function EventEvidencePanel({ event }: { event: EventInput }) {
  const provenance = event.provenance;
  const files = Array.isArray(provenance?.files)
    ? provenance.files.filter(
        (file): file is { file: string; sha256: string } =>
          Boolean(file && typeof file === 'object' && typeof file.file === 'string' && typeof file.sha256 === 'string'),
      )
    : [];
  const historical = provenance?.kind === 'historical';
  const text = (key: string) =>
    typeof provenance?.[key] === 'string' ? provenance[key] as string : 'Not supplied';

  return (
    <>
      <div className="event-facts">
        <div><span>Raw magnitude</span><strong>{event.magnitude ?? 'Missing'} {event.magnitudeType ?? 'Missing type'}</strong></div>
        <div><span>Occurrence (UTC)</span><strong>{event.occurredAt ?? 'Missing'}</strong></div>
        <div><span>Epicentre</span><strong>{event.latitude ?? 'Missing latitude'}, {event.longitude ?? 'Missing longitude'}</strong></div>
      </div>
      <details className="evidence">
        <summary>{historical ? 'Inspect captured USGS evidence and provenance' : 'Inspect simulation provenance'}</summary>
        <p>
          {historical
            ? 'Historical event evaluated from captured evidence. Capture was at preparation time; this is not a reconstruction of what was known at occurrence.'
            : 'Explicit simulation or unsupported evidence. No historical USGS observation or capture is asserted.'}
        </p>
        {historical && (
          <>
            <p>
              Selected summary fields preserve literal raw magnitude and type, occurrence and epicentre.
              Highest preferredWeight CI origin product matches the captured summary. QuakeML is retained
              verbatim: its magnitude spelling is Mw and its magnitude origin linkage differs from the
              preferred hypocentre. No normalization determines eligibility.
            </p>
            <dl>
              <dt>Capture recorded (UTC)</dt><dd>{text('capturedAt')}</dd>
              <dt>Product</dt><dd>{text('selectedProductId')}</dd>
              <dt>Selected origin</dt><dd>{text('selectedOriginId')}</dd>
              <dt>Selected magnitude</dt><dd>{text('selectedMagnitudeId')}</dd>
            </dl>
            {files.map(file => (
              <p key={file.file}>
                <a href={`${import.meta.env.BASE_URL}evidence/${encodeURIComponent(file.file)}`} download>{file.file}</a>
                <br /><code>SHA-256 {file.sha256}</code>
              </p>
            ))}
            <p>{text('selection')}</p>
          </>
        )}
        <pre>{JSON.stringify(provenance ?? { reason: 'Provenance missing' }, null, 2)}</pre>
      </details>
    </>
  );
}
