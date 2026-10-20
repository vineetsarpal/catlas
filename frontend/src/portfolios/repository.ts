import Dexie, { type Table } from 'dexie';
import { managedPortfolioSchema, type ManagedPortfolio } from './inventory';
import type { Portfolio } from '../exposure/model';
import { demoPortfolio } from '../exposure/fixtures';

export class PortfolioDatabase extends Dexie {
  portfolios!: Table<ManagedPortfolio, string>;
  preferences!: Table<{ key: string; value: string | null }, string>;
  constructor(name = 'catlas-portfolios-1') {
    super(name);
    this.version(1).stores({ portfolios: 'id,updatedAt', preferences: 'key' });
    this.version(2).stores({ portfolios: 'id,updatedAt', preferences: 'key' }).upgrade(transaction =>
      transaction.table<ManagedPortfolio>('portfolios').toCollection().modify(portfolio => {
        if (!portfolio.data.synthetic || portfolio.data.source !== demoPortfolio.source) return;
        const current = demoPortfolio.locations.find(row => row.id === 'RC-CA')!;
        const legacy = { ...current, name: 'Ridgecrest CAD schedule', currency: 'CAD' };
        const row = portfolio.data.locations.find(row => row.id === legacy.id);
        if (!row || !Object.entries(legacy).every(([key, value]) => row[key as keyof typeof row] === value)) return;
        Object.assign(row, current);
        portfolio.revision += 1;
        portfolio.updatedAt = new Date().toISOString();
      }));
  }
}
export class PortfolioRepository {
  constructor(readonly db = new PortfolioDatabase()) {}
  async load() {
    return this.db.transaction('r', this.db.portfolios, this.db.preferences, async () => {
      const portfolios = (await this.db.portfolios.orderBy('updatedAt').reverse().toArray()).map(value => managedPortfolioSchema.parse(value));
      const preference = await this.db.preferences.get('active');
      return { portfolios, activeId: portfolios.some(p => p.id === preference?.value) ? preference!.value : portfolios[0]?.id ?? null };
    });
  }
  async create(name: string, data: Portfolio) {
    const value = managedPortfolioSchema.parse({ id: crypto.randomUUID(), name, data, revision: 1, updatedAt: new Date().toISOString() });
    await this.db.transaction('rw', this.db.portfolios, this.db.preferences, async () => {
      await this.db.portfolios.add(value);
      await this.db.preferences.put({ key: 'active', value: value.id });
    });
    return value;
  }
  async save(portfolio: ManagedPortfolio) {
    const value = managedPortfolioSchema.parse({ ...portfolio, revision: portfolio.revision + 1, updatedAt: new Date().toISOString() });
    await this.db.transaction('rw', this.db.portfolios, async () => {
      const existing = await this.db.portfolios.get(value.id);
      if (!existing || existing.revision !== portfolio.revision) throw new Error('This portfolio changed in another tab. Reload before editing; your form has been preserved.');
      await this.db.portfolios.put(value);
    });
    return value;
  }
  async select(id: string) {
    await this.db.transaction('rw', this.db.portfolios, this.db.preferences, async () => {
      if (!await this.db.portfolios.get(id)) throw new Error('This portfolio is no longer available. Reload to update the list.');
      await this.db.preferences.put({ key: 'active', value: id });
    });
  }
  async remove(id: string) {
    await this.db.transaction('rw', this.db.portfolios, this.db.preferences, async () => {
      await this.db.portfolios.delete(id);
      if ((await this.db.preferences.get('active'))?.value === id) {
        const next = await this.db.portfolios.orderBy('updatedAt').reverse().first();
        await this.db.preferences.put({ key: 'active', value: next?.id ?? null });
      }
    });
  }
}
export const portfolioRepository = new PortfolioRepository();
