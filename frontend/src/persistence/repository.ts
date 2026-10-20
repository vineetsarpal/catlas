import Dexie, { type Table, type Transaction } from 'dexie';
import { RULE_VERSION } from '../domain/assessment';
import { emptyLifecycle, evaluationSchema, immutable, packetSnapshotSchema, type LifecycleState } from '../domain/packets';
export const DATABASE_NAME = 'catlas-demo';
export const STORAGE_SCHEMA_VERSION = 1;
type SnapshotRow = {
    id: string;
    value: unknown;
};
type FormatRow = {
    key: string;
    schemaVersion: number;
    ruleVersion: string;
};
// Mutable operational records intentionally live outside immutable packet snapshots.
// Delivery adapters may add their own fields without coupling lifecycle writes to them.
export type OperationalRecord = {
    id: string;
    [key: string]: unknown;
};
export class CatlasDatabase extends Dexie {
    metadata!: Table<FormatRow, string>;
    evaluations!: Table<SnapshotRow, string>;
    packets!: Table<SnapshotRow, string>;
    deliveryAttempts!: Table<OperationalRecord, string>;
    submissions!: Table<OperationalRecord, string>;
    receiverRecords!: Table<OperationalRecord, string>;
    constructor(name = DATABASE_NAME) {
        super(name);
        this.version(1).stores({ metadata: 'key', evaluations: 'id', packets: 'id', deliveryAttempts: 'id', submissions: 'id', receiverRecords: 'id' });
    }
}
export class CompatibilityError extends Error {
    constructor(message: string) { super(message); this.name = 'CompatibilityError'; }
}
const format = (): FormatRow => ({ key: 'format', schemaVersion: STORAGE_SCHEMA_VERSION, ruleVersion: RULE_VERSION });
export type Archive = {
    metadata: unknown[];
    evaluations: unknown[];
    packets: unknown[];
    deliveryAttempts: unknown[];
    submissions: unknown[];
    receiverRecords: unknown[];
};
// Validate metadata/shape/references, never recalculate an archived assessment.
export function restoreLifecycle(archive: Archive): LifecycleState {
    const metadata = archive.metadata.find(row => row && typeof row === 'object' && 'key' in row && row.key === 'format') as FormatRow | undefined;
    if (!metadata || metadata.schemaVersion !== STORAGE_SCHEMA_VERSION || metadata.ruleVersion !== RULE_VERSION)
        throw new CompatibilityError('Saved history uses an unsupported storage schema or calculation rule. Raw history is preserved; export it or explicitly reset demo data.');
    const evaluations = archive.evaluations.map(raw => {
        const row = raw as SnapshotRow;
        const result = evaluationSchema.safeParse(row?.value);
        if (!result.success || result.data.id !== row.id || result.data.assessment.ruleVersion !== metadata.ruleVersion)
            throw new CompatibilityError('A saved evaluation is incompatible. Raw history is preserved; export it or explicitly reset demo data.');
        return immutable(structuredClone(row.value)) as typeof result.data;
    });
    const identities = new Set<string>();
    for (const evaluation of evaluations) {
        const identity = JSON.stringify([evaluation.lineageId, evaluation.version]);
        const expectedLineage = JSON.stringify([evaluation.event.id ?? null, evaluation.contract.id ?? null]);
        const previous = evaluations.find(e => e.id === evaluation.previousEvaluationId);
        if (identities.has(identity) || evaluation.lineageId !== expectedLineage ||
            (evaluation.version === 1 ? evaluation.previousEvaluationId !== undefined : !previous || previous.lineageId !== evaluation.lineageId || previous.version !== evaluation.version - 1))
            throw new CompatibilityError('Saved evaluation lineage or version references are incompatible. Raw history is preserved.');
        identities.add(identity);
    }
    if (new Set(evaluations.map(e => e.id)).size !== evaluations.length)
        throw new CompatibilityError('Saved evaluation identities are duplicated. Raw history is preserved.');
    const packets = archive.packets.map(raw => {
        const row = raw as SnapshotRow;
        const result = packetSnapshotSchema.safeParse(row?.value);
        if (!result.success || result.data.packetId !== row.id || !evaluations.some(e => e.id === result.data.evaluation.id && JSON.stringify(e) === JSON.stringify(result.data.evaluation)))
            throw new CompatibilityError('A saved packet is incompatible with its evaluation snapshot. Raw history is preserved; export it or explicitly reset demo data.');
        return immutable(structuredClone(row.value)) as typeof result.data;
    });
    for (const packet of packets) {
        const link = packet.replacement;
        if (!link)
            continue;
        const base = packets.find(p => p.packetId === link.previousPacketId);
        if (!base || base.evaluation.id !== link.previousEvaluationId || base.evaluation.version !== link.previousEvaluationVersion || base.evaluation.lineageId !== packet.evaluation.lineageId)
            throw new CompatibilityError('Saved replacement references are incompatible. Raw history is preserved.');
    }
    if (new Set(packets.map(p => p.evaluation.id)).size !== packets.length)
        throw new CompatibilityError('Saved history contains multiple packets for one evaluation. Raw history is preserved.');
    evaluations.sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt) || a.version - b.version);
    return { evaluations, packets, currentEvaluationId: null };
}
export class DemoRepository {
    constructor(public readonly db = new CatlasDatabase()) { }
    private async archiveRows(): Promise<Archive> {
        const [metadata, evaluations, packets, deliveryAttempts, submissions, receiverRecords] = await Promise.all([
            this.db.metadata.toArray(), this.db.evaluations.toArray(), this.db.packets.toArray(), this.db.deliveryAttempts.toArray(), this.db.submissions.toArray(), this.db.receiverRecords.toArray(),
        ]);
        return { metadata, evaluations, packets, deliveryAttempts, submissions, receiverRecords };
    }
    async exportArchive(): Promise<Archive> {
        return this.db.transaction('r', this.db.tables, () => this.archiveRows());
    }
    async load(): Promise<LifecycleState> {
        return this.db.transaction('rw', this.db.tables, async () => {
            const archive = await this.archiveRows();
            if (!archive.metadata.length && !archive.evaluations.length && !archive.packets.length && !archive.deliveryAttempts.length && !archive.submissions.length && !archive.receiverRecords.length) {
                await this.db.metadata.add(format());
                return emptyLifecycle();
            }
            return restoreLifecycle(archive);
        });
    }
    async mutateLifecycle(update: (state: LifecycleState) => LifecycleState | Promise<LifecycleState>, currentEvaluationId: string | null): Promise<LifecycleState> {
        return this.db.transaction('rw', this.db.tables, async () => {
            const before = restoreLifecycle(await this.archiveRows());
            const after = await update({ ...before, currentEvaluationId });
            if (before.evaluations.some(e => !after.evaluations.some(next => next.id === e.id)) || before.packets.some(p => !after.packets.some(next => next.packetId === p.packetId)))
                throw new Error('Lifecycle updates cannot remove saved history; use explicit reset.');
            for (const evaluation of after.evaluations) {
                const existing = before.evaluations.find(e => e.id === evaluation.id);
                if (existing && JSON.stringify(existing) !== JSON.stringify(evaluation))
                    throw new Error('Saved evaluations are immutable.');
                if (!existing)
                    await this.db.evaluations.add({ id: evaluation.id, value: structuredClone(evaluation) });
            }
            for (const packet of after.packets) {
                const existing = before.packets.find(p => p.packetId === packet.packetId);
                if (existing && JSON.stringify(existing) !== JSON.stringify(packet))
                    throw new Error('Saved packets are immutable.');
                if (!existing)
                    await this.db.packets.add({ id: packet.packetId, value: structuredClone(packet) });
            }
            // Validate additions and references before committing; abort rolls back every write.
            restoreLifecycle(await this.archiveRows());
            return after;
        });
    }
    // CAT-19 adapters can atomically update receiver/submission/attempt state without
    // replacing any lifecycle object or writing packet content.
    async deliveryTransaction<T>(action: (tables: Pick<CatlasDatabase, 'deliveryAttempts' | 'submissions' | 'receiverRecords'>, transaction: Transaction) => Promise<T>): Promise<T> {
        return this.db.transaction('rw', this.db.metadata, this.db.deliveryAttempts, this.db.submissions, this.db.receiverRecords, async (transaction) => {
            const metadata = await this.db.metadata.get('format');
            if (metadata?.schemaVersion !== STORAGE_SCHEMA_VERSION || metadata.ruleVersion !== RULE_VERSION)
                throw new CompatibilityError('Delivery history is incompatible; export or reset it first.');
            return action(this.db, transaction);
        });
    }
    async reset(): Promise<LifecycleState> {
        return this.db.transaction('rw', this.db.tables, async () => {
            for (const table of this.db.tables)
                await table.clear();
            await this.db.metadata.add(format());
            return emptyLifecycle();
        });
    }
}
export const demoRepository = new DemoRepository();
