import { useState } from 'react';
import type { LifecycleState } from '../domain/packets';
import type { StorageStatus } from '../hooks/useEvaluationLifecycle';
import type { DemoRepository } from '../persistence/repository';
import { usd } from '../format';

type StoragePanelProps = {
  status: StorageStatus;
  error: string;
  onReset: () => void;
  repository: DemoRepository;
};
export function StoragePanel({ status, error, onReset, repository }: StoragePanelProps) {
  const [exportError, setExportError] = useState('');
  const downloadArchive = async () => {
    try {
      const archive = await repository.exportArchive();
      const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'catlas-local-history-raw.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportError('');
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    }
  };
  const pending = status === 'loading' || status === 'saving';
  const message = {
    ready: 'Saved locally in this browser · IndexedDB',
    loading: 'Loading local history…',
    saving: 'Saving local history…',
    incompatible: 'Compatibility problem · saved raw history preserved',
    error: 'Storage unavailable · changes are not confirmed saved',
  }[status];
  return (
    <section className="local-storage" aria-label="Local history storage">
      <div>
        <h3>Browser storage</h3>
        <p role={status === 'error' || status === 'incompatible' ? 'alert' : 'status'}>{message}</p>
        {error && <p>{error}</p>}
        <p>Reload opens world discovery. Resume a retained evaluation below to inspect its exact stored inputs and result. Hosted and offline origins keep separate histories.</p>
      </div>
      <div>
        <button onClick={downloadArchive} disabled={pending}>Export raw local history</button>
        <button onClick={onReset} disabled={pending}>Reset demo data</button>
      </div>
      {exportError && <p role="alert">Could not export local history: {exportError}</p>}
    </section>
  );
}

type EvaluationHistoryProps = {
  lifecycle: LifecycleState;
  onResume: (id: string) => void;
  disabled: boolean;
};
export function EvaluationHistory({ lifecycle, onResume, disabled }: EvaluationHistoryProps) {
  if (!lifecycle.evaluations.length) return null;
  return (
    <section className="evaluation-history" aria-label="Retained evaluation history">
      <h3>Saved evaluations</h3>
      <p>Stored snapshots retain the evaluated rule, evidence and imported terms. Resuming does not recalculate them.</p>
      {lifecycle.evaluations.map(evaluation => (
        <div key={evaluation.id} data-testid="retained-evaluation">
          <span>
            <strong>{evaluation.event.name ?? 'Unnamed event'}</strong> · {evaluation.contract.id ?? 'Unidentified contract'} · evaluation v{evaluation.version}<br />
            {evaluation.assessment.status} · {evaluation.assessment.amount === null ? 'Indeterminate' : usd(evaluation.assessment.amount)} · {' '}
            {lifecycle.packets.some(packet => packet.evaluation.id === evaluation.id) ? 'Packet retained' : 'Unreviewed / no packet'}<br />
            <small>{evaluation.evaluatedAt} · rule {evaluation.assessment.ruleVersion}</small>
          </span>
          <button disabled={disabled} onClick={() => onResume(evaluation.id)}>Resume evaluation {evaluation.id.slice(0, 8)}</button>
        </div>
      ))}
    </section>
  );
}
