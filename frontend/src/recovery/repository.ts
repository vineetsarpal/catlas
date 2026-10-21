import Dexie, { type Table } from 'dexie';
import type { EventInput } from '../domain/types';
import { assessLoss, recoveryCaseKey, verifySnapshot, type LossPosition, type RecoverySnapshot } from './model';

class RecoveryDatabase extends Dexie {
  snapshots!: Table<RecoverySnapshot, string>;
  constructor() { super('catlas-event-recovery-1'); this.version(1).stores({snapshots:'id,caseKey,reviewedAt,[caseKey+version]'}); }
}
const db = new RecoveryDatabase();
export const recoveryRepository = {
  async list() { return (await db.snapshots.orderBy('reviewedAt').reverse().toArray()).map(verifySnapshot); },
  async save(event: EventInput, position: LossPosition, reviewNotes: string): Promise<RecoverySnapshot> {
    const caseKey = recoveryCaseKey(event, position);
    return db.transaction('rw', db.snapshots, async () => {
      const previous = await db.snapshots.where('caseKey').equals(caseKey).toArray();
      const snapshot = verifySnapshot({format:'catlas-event-recovery',schemaVersion:1,id:crypto.randomUUID(),caseKey,
        version:Math.max(0,...previous.map(row=>verifySnapshot(row).version))+1,reviewedAt:new Date().toISOString(),
        event:structuredClone(event),position:structuredClone(position),result:assessLoss(position,event),reviewNotes});
      await db.snapshots.add(snapshot);
      return snapshot;
    });
  },
};
