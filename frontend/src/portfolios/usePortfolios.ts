import { useEffect, useState } from 'react';
import { portfolioRepository } from './repository';
import { type ManagedPortfolio } from './inventory';
import type { Portfolio } from '../exposure/model';

export function usePortfolios() {
  const [state, setState] = useState<{ portfolios: ManagedPortfolio[]; activeId: string | null }>({ portfolios: [], activeId: null });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    portfolioRepository.load().then(value => { if (!cancelled) { setState(value); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(`Portfolio storage unavailable: ${e instanceof Error ? e.message : String(e)}`); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);
  async function refresh() { setState(await portfolioRepository.load()); }
  async function create(name: string, data: Portfolio) {
    const value = await portfolioRepository.create(name, data); await refresh(); return value;
  }
  async function save(value: ManagedPortfolio) { await portfolioRepository.save(value); await refresh(); }
  async function select(id: string) { await portfolioRepository.select(id); await refresh(); }
  async function remove(id: string) { await portfolioRepository.remove(id); await refresh(); }
  return { ...state, loading, error, active: state.portfolios.find(p => p.id === state.activeId) ?? null, create, save, select, remove };
}
export type PortfoliosState = ReturnType<typeof usePortfolios>;
