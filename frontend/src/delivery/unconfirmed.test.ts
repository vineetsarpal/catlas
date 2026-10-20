import { describe, it, expect } from "vitest";
import {
  createPacket,
  emptyLifecycle,
  evaluate,
  serializePacket,
  type Runtime,
} from "../domain/packets";
import { mainContract, ridgecrest } from "../data/fixtures";
import {
  receive,
  checkStatus,
  emptyDeliveryHistory,
  submissionIdentity,
  validateHistory,
  lineageDelivery,
} from "./model";
function fixture() {
  let id = 0;
  const runtime: Runtime = {
    id: () => `unc-${++id}`,
    now: () => new Date(Date.UTC(2026, 9, 16, 12, 0, id)).toISOString(),
  };
  let state = evaluate(emptyLifecycle(), ridgecrest, mainContract, runtime);
  state = createPacket(
    state,
    state.currentEvaluationId!,
    "Reviewed before lost ack",
    runtime,
  );
  const packet = state.packets[0];
  return {
    packet,
    payload: serializePacket(packet),
    id: submissionIdentity(packet.packetId),
    runtime,
  };
}
describe("lost acknowledgement and reconciliation", () => {
  it("preserves accepted receiver truth without claiming receipt or exposing its reference", () => {
    const f = fixture(),
      result = receive(
        emptyDeliveryHistory(),
        f.id,
        f.payload,
        "unconfirmed",
        f.runtime,
      );
    expect(result.submission.state).toBe("unconfirmed");
    expect(result.submission.reference).toBeNull();
    expect(result.history.receiverRecords).toHaveLength(1);
    expect(result.history.receiverRecords[0].reference).toMatch(/^MOCK-RAS-/);
    expect(result.attempt.action).toBe("send");
    expect(result.attempt.reference).toBeNull();
    expect(result.submission.payload).toBe(f.payload);
    expect(
      lineageDelivery(result.history, f.packet.evaluation.lineageId)
        .unconfirmed,
    ).toHaveLength(1);
  });
  it("status checks reconcile original identity and append check attempts without new receiver records", () => {
    const f = fixture(),
      lost = receive(
        emptyDeliveryHistory(),
        f.id,
        f.payload,
        "unconfirmed",
        f.runtime,
      ),
      reference = lost.history.receiverRecords[0].reference;
    const checked = checkStatus(lost.history, f.id, f.payload, f.runtime),
      again = checkStatus(checked.history, f.id, f.payload, f.runtime);
    expect(checked.submission.state).toBe("received");
    expect(checked.submission.reference).toBe(reference);
    expect(again.history.receiverRecords).toEqual(lost.history.receiverRecords);
    expect(again.history.attempts.map((a) => a.action)).toEqual([
      "send",
      "check",
      "check",
    ]);
    expect(again.history.attempts[0].reference).toBeNull();
    expect(
      lineageDelivery(again.history, f.packet.evaluation.lineageId).unconfirmed,
    ).toHaveLength(0);
  });
  it("repeated lost acknowledgements and acknowledged retry keep one reference and immutable payload", () => {
    const f = fixture(),
      lost = receive(
        emptyDeliveryHistory(),
        f.id,
        f.payload,
        "unconfirmed",
        f.runtime,
      ),
      lostAgain = receive(
        lost.history,
        f.id,
        f.payload,
        "unconfirmed",
        f.runtime,
      );
    expect(lostAgain.submission.reference).toBeNull();
    expect(lostAgain.history.receiverRecords).toHaveLength(1);
    const ack = receive(
      lostAgain.history,
      f.id,
      f.payload,
      "accept",
      f.runtime,
    );
    expect(ack.submission.reference).toBe(
      lost.history.receiverRecords[0].reference,
    );
    expect(ack.history.attempts.map((a) => a.action)).toEqual([
      "send",
      "retry",
      "retry",
    ]);
    expect(ack.submission.payload).toBe(f.payload);
    expect(serializePacket(f.packet)).toBe(f.payload);
  });
  it("unknown receiver status remains unconfirmed instead of inferring a rejection", () => {
    const f = fixture(),
      unknown = checkStatus(emptyDeliveryHistory(), f.id, f.payload, f.runtime);
    expect(unknown.submission.state).toBe("unconfirmed");
    expect(unknown.submission.reference).toBeNull();
    expect(unknown.history.receiverRecords).toHaveLength(0);
    expect(unknown.submission.reason).toContain("not found");
  });
  it("prevents payload replacement on both status-check and retry", () => {
    const f = fixture(),
      lost = receive(
        emptyDeliveryHistory(),
        f.id,
        f.payload,
        "unconfirmed",
        f.runtime,
      ),
      changed = serializePacket({
        ...f.packet,
        review: { ...f.packet.review!, notes: "Changed" },
      });
    expect(() => checkStatus(lost.history, f.id, changed, f.runtime)).toThrow(
      "changed payload",
    );
    expect(() =>
      receive(lost.history, f.id, changed, "accept", f.runtime),
    ).toThrow("changed payload");
  });
  it("continues to validate received/rejected records created before action fields existed", () => {
    const f = fixture(),
      accepted = receive(
        emptyDeliveryHistory(),
        f.id,
        f.payload,
        "accept",
        f.runtime,
      ),
      old = structuredClone(accepted.history);
    for (const attempt of old.attempts) delete attempt.action;
    expect(validateHistory(old)).toEqual(old);
    const invalid = structuredClone(accepted.history);
    invalid.submissions[0].state = "unconfirmed";
    expect(() => validateHistory(invalid)).toThrow();
  });
});
