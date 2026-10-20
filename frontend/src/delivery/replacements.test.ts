import { describe, it, expect } from 'vitest';
import { createPacket, evaluate, emptyLifecycle, serializePacket, packetSchema, type LifecycleState, type Runtime } from '../domain/packets';
import { mainContract, ridgecrest } from '../data/fixtures';
import { simulatedObservation, revisedTerms, missingCoverageRevisedTerms } from '../data/revisions';
import { receive, checkStatus, emptyDeliveryHistory, replacementForReview, deliveryGate, initialSendGate, validateHistory, type DeliveryHistoryState } from './model';
function setup() { let id = 0; const runtime: Runtime = { id: () => `replacement-${++id}`, now: () => new Date(Date.UTC(2026, 9, 16, 12, 0, id)).toISOString() }; return { runtime, state: emptyLifecycle(), history: emptyDeliveryHistory() }; }
function review(state: LifecycleState, history: DeliveryHistoryState, runtime: Runtime) { const evaluation = state.evaluations.find(e => e.id === state.currentEvaluationId)!; return createPacket(state, evaluation.id, 'Fresh review', runtime, replacementForReview(evaluation, history)); }
function send(state: LifecycleState, history: DeliveryHistoryState, runtime: Runtime, outcome: 'accept' | 'unconfirmed' = 'accept') { const packet = state.packets.find(p => p.evaluation.id === state.currentEvaluationId)!; return receive(history, `submission:${packet.packetId}`, serializePacket(packet), outcome, runtime); }
describe('linked full replacement assessments', () => {
    it('replaces $4m with full $6m then zero in one receiving record; old retries never roll it back', () => {
        let { state, history, runtime } = setup();
        state = review(evaluate(state, simulatedObservation, mainContract, runtime), history, runtime);
        const initial = state.packets[0], initialBytes = serializePacket(initial);
        history = send(state, history, runtime).history;
        const reference = history.receiverRecords[0].reference;
        state = review(evaluate(state, ridgecrest, mainContract, runtime), history, runtime);
        const replacement = state.packets[1];
        expect(replacement.replacement).toEqual({ purpose: 'Full replacement assessment', previousPacketId: initial.packetId, previousEvaluationId: initial.evaluation.id, previousEvaluationVersion: 1, priorRASReference: reference });
        expect(replacement.aggregation.totalRecovery).toBe(6000000);
        history = send(state, history, runtime).history;
        expect(history.receiverRecords).toHaveLength(1);
        expect(history.receiverRecords[0].currentAmount).toBe(6000000);
        state = review(evaluate(state, ridgecrest, revisedTerms, runtime), history, runtime);
        const zero = state.packets[2];
        expect(initialSendGate(zero)).not.toBeNull();
        expect(deliveryGate(history, zero)).toBeNull();
        history = send(state, history, runtime).history;
        expect(history.receiverRecords[0].currentAmount).toBe(0);
        expect(history.receiverRecords[0].reference).toBe(reference);
        expect(history.receiverRecords[0].acceptedPacketIds).toEqual(state.packets.map(p => p.packetId));
        const oldRetry = receive(history, `submission:${initial.packetId}`, initialBytes, 'accept', runtime);
        expect(oldRetry.submission.reference).toBe(reference);
        expect(oldRetry.history.receiverRecords[0].currentAmount).toBe(0);
        expect(serializePacket(initial)).toBe(initialBytes);
    });
    it('requires prior uncertainty reconciliation before freezing linked review', () => {
        let { state, history, runtime } = setup();
        state = review(evaluate(state, simulatedObservation, mainContract, runtime), history, runtime);
        history = send(state, history, runtime, 'unconfirmed').history;
        state = evaluate(state, ridgecrest, mainContract, runtime);
        expect(() => review(state, history, runtime)).toThrow('Reconcile prior');
        const initial = state.packets[0];
        history = checkStatus(history, `submission:${initial.packetId}`, serializePacket(initial), runtime).history;
        state = review(state, history, runtime);
        expect(state.packets[1].replacement?.priorRASReference).toBe(history.receiverRecords[0].reference);
    });
    it('blocks incomplete revisions but permits their null exception export', () => {
        let { state, history, runtime } = setup();
        state = review(evaluate(state, ridgecrest, mainContract, runtime), history, runtime);
        history = send(state, history, runtime).history;
        state = review(evaluate(state, ridgecrest, missingCoverageRevisedTerms, runtime), history, runtime);
        const exception = state.packets[1];
        expect(exception.kind).toBe('exception');
        expect(exception.replacement).toBeUndefined();
        expect(exception.aggregation.totalRecovery).toBeNull();
        expect(deliveryGate(history, exception)).toContain('Incomplete');
    });
    it('rejects wrong links, stale replacement bases and changed bytes under an accepted identity', () => {
        let { state, history, runtime } = setup();
        state = review(evaluate(state, simulatedObservation, mainContract, runtime), history, runtime);
        history = send(state, history, runtime).history;
        state = review(evaluate(state, ridgecrest, mainContract, runtime), history, runtime);
        const next = state.packets[1], wrong = { ...next, replacement: { ...next.replacement!, priorRASReference: 'WRONG-REFERENCE' } };
        expect(receive(history, `submission:${wrong.packetId}`, serializePacket(wrong), 'accept', runtime).submission.state).toBe('rejected');
        history = send(state, history, runtime).history;
        expect(() => receive(history, `submission:${next.packetId}`, serializePacket(wrong), 'accept', runtime)).toThrow('changed payload');
        const stale = packetSchema.parse({ ...next, packetId: 'stale-new-identity', evaluation: { ...next.evaluation, id: 'stale-eval', version: 3 }, review: { ...next.review!, evaluationId: 'stale-eval', evaluationVersion: 3 } });
        expect(receive(history, `submission:${stale.packetId}`, serializePacket(stale), 'accept', runtime).submission.reason).toContain('stale');
        expect(history.receiverRecords[0].currentAmount).toBe(6000000);
    });
    it('does not retag already-frozen initial packets after the earlier packet gets delivered', () => {
        let { state, history, runtime } = setup();
        state = review(evaluate(state, simulatedObservation, mainContract, runtime), history, runtime);
        const initial = state.packets[0];
        state = review(evaluate(state, ridgecrest, mainContract, runtime), history, runtime);
        const frozen = state.packets[1], bytes = serializePacket(frozen);
        history = receive(history, `submission:${initial.packetId}`, serializePacket(initial), 'accept', runtime).history;
        expect(deliveryGate(history, frozen)).toContain('fresh evaluation');
        expect(serializePacket(frozen)).toBe(bytes);
        state = evaluate(state, ridgecrest, mainContract, runtime, { forceNewVersion: true });
        state = review(state, history, runtime);
        expect(state.evaluations.at(-1)?.version).toBe(3);
        expect(state.packets[2].replacement?.previousPacketId).toBe(initial.packetId);
    });
    it('allows a new positive initial assessment after rejection with no receiving case', () => {
        let { state, history, runtime } = setup();
        state = review(evaluate(state, simulatedObservation, mainContract, runtime), history, runtime);
        const packet = state.packets[0];
        history = receive(history, `submission:${packet.packetId}`, serializePacket(packet), 'reject', runtime).history;
        state = review(evaluate(state, ridgecrest, mainContract, runtime), history, runtime);
        expect(state.packets[1].replacement).toBeUndefined();
        history = send(state, history, runtime).history;
        expect(history.receiverRecords).toHaveLength(1);
    });
});
it('preserves incompatible receiver rows with fabricated current content or unmatched accepted packet IDs', () => { let { state, history, runtime } = setup(); state = review(evaluate(state, simulatedObservation, mainContract, runtime), history, runtime); history = send(state, history, runtime).history; const extra = structuredClone(history); extra.receiverRecords[0].acceptedPacketIds.push('fabricated-packet'); expect(() => validateHistory(extra)).toThrow('incompatible'); const fabricated = structuredClone(history); const packet = state.packets[0]; const changed = { ...packet, review: { ...packet.review!, notes: 'Never submitted' } }; fabricated.receiverRecords[0].currentPayload = serializePacket(changed); expect(() => validateHistory(fabricated)).toThrow('incompatible'); });
it('retrying an older rejected replacement cannot roll back a newer accepted assessment', () => {
    let { state, history, runtime } = setup();
    state = review(evaluate(state, simulatedObservation, mainContract, runtime), history, runtime);
    history = send(state, history, runtime).history;
    state = review(evaluate(state, ridgecrest, mainContract, runtime), history, runtime);
    const older = state.packets[1];
    history = receive(history, `submission:${older.packetId}`, serializePacket(older), 'reject', runtime).history;
    state = review(evaluate(state, ridgecrest, revisedTerms, runtime), history, runtime);
    history = send(state, history, runtime).history;
    const retry = receive(history, `submission:${older.packetId}`, serializePacket(older), 'accept', runtime);
    expect(retry.submission.state).toBe('rejected');
    expect(retry.submission.reason).toContain('stale');
    expect(retry.history.receiverRecords[0].currentAmount).toBe(0);
    expect(retry.history.receiverRecords[0].currentPacketId).toBe(state.packets[2].packetId);
});
