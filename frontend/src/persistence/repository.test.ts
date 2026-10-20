import { describe, expect, it, vi } from 'vitest';
import * as assessment from '../domain/assessment';
import { createPacket, emptyLifecycle, evaluate, serializePacket } from '../domain/packets';
import { mainContract, ridgecrest } from '../data/fixtures';
import { CompatibilityError, restoreLifecycle, STORAGE_SCHEMA_VERSION, type Archive } from './repository';
function fixture() {
    let id = 0;
    const runtime = { id: () => `stored-${++id}`, now: () => '2026-10-16T12:00:00.000Z' };
    let state = evaluate(emptyLifecycle(), ridgecrest, mainContract, runtime);
    state = createPacket(state, state.currentEvaluationId!, 'Preserve these notes', runtime);
    const archive: Archive = { metadata: [{ key: 'format', schemaVersion: STORAGE_SCHEMA_VERSION, ruleVersion: assessment.RULE_VERSION }], evaluations: state.evaluations.map(e => ({ id: e.id, value: structuredClone(e) })), packets: state.packets.map(p => ({ id: p.packetId, value: structuredClone(p) })), deliveryAttempts: [], submissions: [], receiverRecords: [] };
    return { state, archive, runtime };
}
describe('retained history compatibility boundary', () => {
    it('restores frozen content without recalculating; defaults to world discovery', () => {
        const { state, archive } = fixture();
        const calculate = vi.spyOn(assessment, 'assess');
        const restored = restoreLifecycle(archive);
        expect(calculate).not.toHaveBeenCalled();
        expect(restored.currentEvaluationId).toBeNull();
        expect(restored.evaluations).toEqual(state.evaluations);
        expect(serializePacket(restored.packets[0])).toBe(serializePacket(state.packets[0]));
        expect(calculate).not.toHaveBeenCalled();
        expect(() => { restored.packets[0].review!.notes = 'Overwrite'; }).toThrow();
        calculate.mockRestore();
    });
    it.each(['schema', 'rule', 'missing format'])('refuses incompatible %s while leaving raw rows untouched', kind => {
        const { archive } = fixture();
        if (kind === 'missing format')
            archive.metadata = [];
        else
            (archive.metadata[0] as Record<string, unknown>)[kind === 'schema' ? 'schemaVersion' : 'ruleVersion'] = kind === 'schema' ? 99 : 'future-rule';
        const bytes = JSON.stringify(archive);
        expect(() => restoreLifecycle(archive)).toThrow(CompatibilityError);
        expect(JSON.stringify(archive)).toBe(bytes);
    });
    it('rejects tampered lineage, duplicate versions and dangling previous references', () => {
        for (const mutate of [
            (archive: Archive) => { (archive.evaluations[0] as any).value.lineageId = 'other'; },
            (archive: Archive) => { const row = structuredClone(archive.evaluations[0]) as any; row.id = 'duplicate'; row.value.id = 'duplicate'; archive.evaluations.push(row); },
            (archive: Archive) => { const row = archive.evaluations[0] as any; row.value.version = 2; row.value.previousEvaluationId = 'missing'; },
        ]) {
            const { archive } = fixture();
            mutate(archive);
            expect(() => restoreLifecycle(archive)).toThrow(CompatibilityError);
        }
    });
    it('rejects detached packets, altered review references and duplicate packets', () => {
        for (const mutate of [
            (archive: Archive) => { (archive.packets[0] as any).value.evaluation.event.name = 'Not the retained snapshot'; },
            (archive: Archive) => { (archive.packets[0] as any).value.review.evaluationVersion = 7; },
            (archive: Archive) => { const row = structuredClone(archive.packets[0]) as any; row.id = 'duplicate'; row.value.packetId = 'duplicate'; archive.packets.push(row); },
        ]) {
            const { archive } = fixture();
            mutate(archive);
            expect(() => restoreLifecycle(archive)).toThrow(CompatibilityError);
        }
    });
    it('chooses highest lineage version despite clock adjustment and loaded display order', () => {
        const { state, runtime } = fixture();
        const changed = { ...ridgecrest, magnitude: 6.9, evidenceVersion: 'explicit-test-simulation' };
        const revised = evaluate(state, changed, mainContract, { ...runtime, now: () => '2026-10-15T12:00:00.000Z' });
        const archive = fixture().archive;
        archive.evaluations = revised.evaluations.map(e => ({ id: e.id, value: structuredClone(e) }));
        const loaded = restoreLifecycle(archive);
        expect(loaded.evaluations.at(-1)?.version).toBe(1); // timestamps order presentation only
        const resumed = evaluate(loaded, changed, mainContract, runtime);
        expect(resumed.evaluations).toHaveLength(2);
        expect(resumed.evaluations.find(e => e.id === resumed.currentEvaluationId)?.version).toBe(2);
    });
});
