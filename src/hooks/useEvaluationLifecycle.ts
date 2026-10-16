import { useCallback, useState } from "react";
import { createPacket, emptyLifecycle, evaluate } from "../domain/packets";
import type { EventInput, ContractInput } from "../domain/types";

// Central input/lifecycle seam: scenario discovery and future imported revisions
// use the same action. Presentation controls do not call it.
export function useEvaluationLifecycle() {
  const [lifecycle, setLifecycle] = useState(emptyLifecycle);
  const evaluateInputs = useCallback(
    (event: EventInput, contract: ContractInput) => {
      setLifecycle((state) => evaluate(state, event, contract));
    },
    [],
  );
  const clearSelection = useCallback(() => {
    setLifecycle((state) => ({ ...state, currentEvaluationId: null }));
  }, []);
  const reviewEvaluation = useCallback(
    (evaluationId: string, notes: string) => {
      setLifecycle((state) => createPacket(state, evaluationId, notes));
    },
    [],
  );
  return { lifecycle, evaluateInputs, clearSelection, reviewEvaluation };
}
