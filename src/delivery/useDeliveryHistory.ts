import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { demoRepository, type DemoRepository } from "../persistence/repository";
import { emptyDeliveryHistory } from "./model";
import { loadDeliveryHistory } from "./service";
export function useDeliveryHistory(
  repository: DemoRepository = demoRepository,
) {
  const [history, setHistory] = useState(emptyDeliveryHistory),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const subscription = liveQuery(async () => {
      try {
        return { value: await loadDeliveryHistory(repository), error: "" };
      } catch (error) {
        return {
          value: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }).subscribe({
      next: (next) => {
        setHistory(next.value ?? emptyDeliveryHistory());
        setError(next.error);
        setLoading(false);
      },
      error: (failure) => {
        setError(failure instanceof Error ? failure.message : String(failure));
        setLoading(false);
      },
    });
    return () => subscription.unsubscribe();
  }, [repository]);
  return { history, error, loading };
}
