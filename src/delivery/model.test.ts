import { describe, it, expect } from "vitest";
import {
  createPacket,
  emptyLifecycle,
  evaluate,
  serializePacket,
  type Runtime,
} from "../domain/packets";
import { ridgecrest, mainContract } from "../data/fixtures";
import { highThresholdContract, incompleteContract } from "../data/scenarios";
import { CompatibilityError } from "../persistence/repository";
import {
  receive,
  initialSendGate,
  submissionIdentity,
  emptyDeliveryHistory,
  validateHistory,
} from "./model";
function fixtures() {
  let id = 0;
  const runtime: Runtime = {
    id: () => `test-${++id}`,
    now: () => new Date(Date.UTC(2026, 9, 16, 12, 0, id)).toISOString(),
  };
  let state = evaluate(emptyLifecycle(), ridgecrest, mainContract, runtime);
  state = createPacket(
    state,
    state.currentEvaluationId!,
    "Exact reviewed content",
    runtime,
  );
  return { runtime, state, packet: state.packets[0] };
}
describe("simulated RAS receiver boundary", () => {
  it("accepts exact reviewed bytes with reference and separate attempt; never mutates packet", () => {
    const { packet, runtime } = fixtures(),
      payload = serializePacket(packet);
    const result = receive(
      emptyDeliveryHistory(),
      submissionIdentity(packet.packetId),
      payload,
      "accept",
      runtime,
    );
    expect(result.submission.payload).toBe(payload);
    expect(result.submission.state).toBe("received");
    expect(result.submission.reference).toMatch(/^MOCK-RAS-/);
    expect(result.history.receiverRecords[0].currentAmount).toBe(6000000);
    expect(result.history.receiverRecords[0].currentPayload).toBe(payload);
    expect(result.history.attempts).toHaveLength(1);
    expect(serializePacket(packet)).toBe(payload);
  });
  it("deduplicates repeated and concurrent-ordered retries with identical identity and receiving reference", () => {
    const { packet, runtime } = fixtures(),
      payload = serializePacket(packet),
      id = submissionIdentity(packet.packetId);
    const first = receive(
      emptyDeliveryHistory(),
      id,
      payload,
      "accept",
      runtime,
    );
    const retry = receive(first.history, id, payload, "reject", runtime);
    expect(retry.submission.reference).toBe(first.submission.reference);
    expect(retry.history.receiverRecords).toHaveLength(1);
    expect(retry.history.submissions).toHaveLength(1);
    expect(retry.history.attempts).toHaveLength(2);
    expect(retry.history.attempts[0].id).not.toBe(retry.history.attempts[1].id);
  });
  it("records rejection reason and can retry to receipt without losing rejected attempt", () => {
    const { packet, runtime } = fixtures(),
      payload = serializePacket(packet),
      id = submissionIdentity(packet.packetId);
    const rejected = receive(
      emptyDeliveryHistory(),
      id,
      payload,
      "reject",
      runtime,
    );
    expect(rejected.submission.reference).toBeNull();
    expect(rejected.submission.reason).toContain("manual inspection");
    expect(rejected.history.receiverRecords).toHaveLength(0);
    const retry = receive(rejected.history, id, payload, "accept", runtime);
    expect(retry.history.attempts.map((a) => a.state)).toEqual([
      "rejected",
      "received",
    ]);
    expect(retry.history.receiverRecords).toHaveLength(1);
  });
  it("blocks unreviewed, zero and incomplete initial submissions", () => {
    const { runtime } = fixtures();
    expect(initialSendGate()).toContain("Review");
    for (const contract of [highThresholdContract, incompleteContract]) {
      let state = evaluate(emptyLifecycle(), ridgecrest, contract, runtime);
      state = createPacket(state, state.currentEvaluationId!, "", runtime);
      const p = state.packets[0];
      expect(initialSendGate(p)).not.toBeNull();
      expect(() =>
        receive(
          emptyDeliveryHistory(),
          submissionIdentity(p.packetId),
          serializePacket(p),
          "accept",
          runtime,
        ),
      ).toThrow();
    }
  });
  it("rejects changed payload for same identity and invalid calculation", () => {
    const { packet, runtime } = fixtures(),
      payload = serializePacket(packet),
      id = submissionIdentity(packet.packetId);
    const first = receive(
      emptyDeliveryHistory(),
      id,
      payload,
      "accept",
      runtime,
    );
    const changed = {
      ...packet,
      review: { ...packet.review!, notes: "Changed" },
    };
    expect(() =>
      receive(first.history, id, serializePacket(changed), "accept", runtime),
    ).toThrow("changed payload");
    const invalid = JSON.parse(payload);
    invalid.aggregation.totalRecovery = 1;
    expect(() =>
      receive(
        emptyDeliveryHistory(),
        id,
        JSON.stringify(invalid),
        "accept",
        runtime,
      ),
    ).toThrow();
  });
  it("rejects different packets for existing lineage pending linked replacement support", () => {
    const { packet, state, runtime } = fixtures(),
      first = receive(
        emptyDeliveryHistory(),
        submissionIdentity(packet.packetId),
        serializePacket(packet),
        "accept",
        runtime,
      );
    let next = evaluate(
      state,
      {
        ...ridgecrest,
        magnitude: 6.9,
        evidenceVersion: "SIM-TEST",
        provenance: { kind: "simulation" },
      },
      mainContract,
      runtime,
    );
    next = createPacket(
      next,
      next.currentEvaluationId!,
      "Fresh review",
      runtime,
    );
    const p = next.packets[1],
      result = receive(
        first.history,
        submissionIdentity(p.packetId),
        serializePacket(p),
        "accept",
        runtime,
      );
    expect(result.submission.state).toBe("rejected");
    expect(result.submission.reason).toContain("linked replacement");
    expect(result.history.receiverRecords).toHaveLength(1);
    expect(result.history.receiverRecords[0].currentAmount).toBe(6000000);
  });
  it("preserves incompatible rows and rejects dangling operational references", () => {
    const raw = {
        submissions: [{ id: "future" }],
        attempts: [],
        receiverRecords: [],
      },
      before = JSON.stringify(raw);
    expect(() => validateHistory(raw)).toThrow(CompatibilityError);
    expect(JSON.stringify(raw)).toBe(before);
    const { packet, runtime } = fixtures(),
      result = receive(
        emptyDeliveryHistory(),
        submissionIdentity(packet.packetId),
        serializePacket(packet),
        "accept",
        runtime,
      );
    const broken = structuredClone(result.history);
    broken.receiverRecords = [];
    expect(() => validateHistory(broken)).toThrow(CompatibilityError);
  });
});
