import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { portfolioRepository } from './repository';
import { type ManagedPortfolio } from './inventory';
import type { Portfolio } from '../exposure/model';

export function usePortfolios() {
  const [readAttempt, setReadAttempt] = useState(0);
  const [lastSnapshot, setLastSnapshot] = useState<{ portfolios: ManagedPortfolio[]; activeId: string | null }>({ portfolios: [], activeId: null });
  const result = useLiveQuery(async () => {
    try { return { snapshot: await portfolioRepository.load(), error: '' }; }
    catch (error) { return { error: `Portfolio storage unavailable: ${error instanceof Error ? error.message : String(error)}` }; }
  }, [readAttempt]);
  // Retain the last verified inventory if a later read fails, without hiding the error.
  useEffect(() => { if (result?.snapshot) setLastSnapshot(result.snapshot); }, [result]);
  const state = result?.snapshot ?? lastSnapshot;
  async function create(name: string, data: Portfolio) {
    return portfolioRepository.create(name, data);
  }
  async function save(value: ManagedPortfolio) { await portfolioRepository.save(value); }
  async function select(id: string) { await portfolioRepository.select(id); }
  async function remove(id: string) { await portfolioRepository.remove(id); }
  return { ...state, loading: result === undefined, error: result?.error ?? '', active: state.portfolios.find(p => p.id === state.activeId) ?? null, create, save, select, remove, retry: () => setReadAttempt(value => value + 1) };
}
export type PortfoliosState = ReturnType<typeof usePortfolios>;
