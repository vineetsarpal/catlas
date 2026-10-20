import { useCallback, useEffect, useRef, useState } from 'react';
import { reviewWithDeliveryContext } from '../delivery/service';
import { ReviewBlockedError } from '../delivery/model';
import { emptyLifecycle, evaluate, type LifecycleState } from '../domain/packets';
import type { EventInput, ContractInput } from '../domain/types';
import { CompatibilityError, demoRepository } from '../persistence/repository';

export type StorageStatus = 'loading' | 'ready' | 'saving' | 'error' | 'incompatible';

// Publish durable state only after its transaction commits. Serial actions also
// prevent an earlier asynchronous action from overwriting a later selection.
export function useEvaluationLifecycle() {
  const [lifecycle, setLifecycle] = useState(emptyLifecycle);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>('loading');
  const [storageError, setStorageError] = useState('');
  const [actionError, setActionError] = useState('');
  const current = useRef(lifecycle);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(false);
  const operationVersion = useRef(0);

  const publish = useCallback((state: LifecycleState) => {
    current.current = state;
    if (mounted.current) setLifecycle(state);
  }, []);
  const failure = useCallback((error: unknown) => {
    if (!mounted.current) return;
    setStorageStatus(error instanceof CompatibilityError ? 'incompatible' : 'error');
    setStorageError(error instanceof Error ? error.message : String(error));
  }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const initial = demoRepository.load().then(state => {
      if (cancelled) return;
      publish(state);
      if (operationVersion.current === 0) setStorageStatus('ready');
    }).catch(error => {
      if (!cancelled) failure(error);
    });
    queue.current = initial;
    return () => { cancelled = true; mounted.current = false; };
  }, [publish, failure]);

  const mutate = useCallback((update: (state: LifecycleState) => LifecycleState | Promise<LifecycleState>) => {
    const operation = ++operationVersion.current;
    setStorageStatus('saving');
    setStorageError('');
    setActionError('');
    const next = queue.current.then(async () => {
      const state = await demoRepository.mutateLifecycle(update, current.current.currentEvaluationId);
      publish(state);
      if (mounted.current && operation === operationVersion.current) setStorageStatus('ready');
      return state;
    }).catch(error => {
      if (operation === operationVersion.current) {
        if (error instanceof ReviewBlockedError) {
          setActionError(error.message);
          setStorageStatus('ready');
        } else failure(error);
      }
      return undefined;
    });
    queue.current = next;
    return next;
  }, [publish, failure]);
  const evaluateInputs = useCallback(
    (event: EventInput, contract: ContractInput, options?: { forceNewVersion?: boolean }) => mutate(state => evaluate(state, event, contract, undefined, options)),
    [mutate],
  );
  const reviewEvaluation = useCallback(
    (id: string, notes: string) => mutate(state => reviewWithDeliveryContext(demoRepository, state, id, notes)),
    [mutate],
  );
  const clearSelection = useCallback(() => {
    // Queue presentation changes so a pending save cannot restore selection later.
    queue.current = queue.current.then(() => publish({ ...current.current, currentEvaluationId: null }));
  }, [publish]);
  const resumeEvaluation = useCallback((id: string) => {
    queue.current = queue.current.then(() => {
      if (current.current.evaluations.some(evaluation => evaluation.id === id)) {
        publish({ ...current.current, currentEvaluationId: id });
      }
    });
  }, [publish]);
  const resetDemo = useCallback(() => {
    const operation = ++operationVersion.current;
    setStorageStatus('saving');
    setStorageError('');
    setActionError('');
    const next = queue.current.then(async () => {
      publish(await demoRepository.reset());
      if (mounted.current && operation === operationVersion.current) setStorageStatus('ready');
      return true;
    }).catch(error => {
      if (operation === operationVersion.current) failure(error);
      return false;
    });
    queue.current = next;
    return next;
  }, [publish, failure]);

  return {
    lifecycle, evaluateInputs, clearSelection, reviewEvaluation, resumeEvaluation,
    resetDemo, storageStatus, storageError, actionError, repository: demoRepository,
  };
}
