import { describe, it, expect } from "vitest";
import { ridgecrest, mainContract } from "../data/fixtures";
import { incompleteContract, highThresholdContract } from "../data/scenarios";
import {
  evaluate,
  createPacket,
  emptyLifecycle,
  serializePacket,
  packetSchema,
  type Runtime,
} from "./packets";
const runtime = (): Runtime => {
  let id = 0;
  return { id: () => `test-${++id}`, now: () => "2026-10-16T12:00:00.000Z" };
};
describe("evaluation review and immutable packet boundary", () => {
  it("rejects stale review action and contradictory rule/identity metadata", () => {
    const r = runtime();
    let state = evaluate(emptyLifecycle(), ridgecrest, mainContract, r);
    const first = state.currentEvaluationId!;
    state = createPacket(state, first, "", r);
    const raw = JSON.parse(serializePacket(state.packets[0]));
    expect(
      packetSchema.safeParse({
        ...raw,
        rule: { ...raw.rule, version: "other-rule" },
      }).success,
    ).toBe(false);
    expect(
      packetSchema.safeParse({
        ...raw,
        rule: { ...raw.rule, distanceBands: ["all locations"] },
      }).success,
    ).toBe(false);
    expect(
      packetSchema.safeParse({ ...raw, cedent: { id: "other", name: "Other" } })
        .success,
    ).toBe(false);
    expect(
      packetSchema.safeParse({
        ...raw,
        rule: {
          ...raw.rule,
          matrix: raw.rule.matrix.map((row: unknown) => ({
            ...(row as object),
            inner: 1,
          })),
        },
      }).success,
    ).toBe(false);
    state = evaluate(state, ridgecrest, highThresholdContract, r);
    expect(() => createPacket(state, first, "stale action", r)).toThrow(
      "current evaluation",
    );
  });
  it("starts without any evaluated or reviewed recovery", () =>
    expect(emptyLifecycle()).toEqual({
      evaluations: [],
      packets: [],
      currentEvaluationId: null,
    }));
  it("reviews only once per exact evaluation, freezing original notes and raw inputs", () => {
    const r = runtime();
    let state = evaluate(emptyLifecycle(), ridgecrest, mainContract, r);
    state = createPacket(
      state,
      state.currentEvaluationId!,
      "Reviewed areas",
      r,
    );
    const packet = state.packets[0],
      content = serializePacket(packet);
    expect(packet.aggregation.totalRecovery).toBe(6000000);
    expect(
      packet.evaluation.assessment.areas.map((a) => a.contribution),
    ).toEqual([4500000, 1500000]);
    expect(packet.evaluation.event.provenance).toEqual(ridgecrest.provenance);
    expect(() => {
      packet.review!.notes = "changed";
    }).toThrow();
    expect(() => {
      packet.evaluation.contract.areas![0].allocation = 1;
    }).toThrow();
    const again = createPacket(
      state,
      state.currentEvaluationId!,
      "Different notes",
      r,
    );
    expect(again).toBe(state);
    expect(serializePacket(again.packets[0])).toBe(content);
  });
  it("requires fresh review when exact inputs change away and back", () => {
    const r = runtime();
    let state = evaluate(emptyLifecycle(), ridgecrest, mainContract, r);
    state = createPacket(state, state.currentEvaluationId!, "first", r);
    const first = state.evaluations[0];
    state = evaluate(
      state,
      {
        ...ridgecrest,
        magnitude: 6.9,
        evidenceVersion: "labelled-test-simulation",
      },
      mainContract,
      r,
    );
    state = evaluate(state, ridgecrest, mainContract, r);
    expect(state.evaluations.at(-1)?.version).toBe(3);
    expect(state.evaluations.at(-1)?.previousEvaluationId).toBe(
      state.evaluations[1].id,
    );
    expect(
      state.packets.some((p) => p.evaluation.id === state.currentEvaluationId),
    ).toBe(false);
    expect(state.packets[0].evaluation.id).toBe(first.id);
  });
  it("resumes independent case latest unchanged snapshots without duplicating versions", () => {
    const r = runtime();
    let state = evaluate(emptyLifecycle(), ridgecrest, mainContract, r);
    const id = state.currentEvaluationId;
    state = evaluate(state, ridgecrest, highThresholdContract, r);
    state = evaluate(state, ridgecrest, mainContract, r);
    expect(state.currentEvaluationId).toBe(id);
    expect(state.evaluations).toHaveLength(2);
  });
  it.each([
    [highThresholdContract, "reviewed-recovery", 0],
    [incompleteContract, "exception", null],
  ] as const)(
    "exports correct kind and null versus zero %#",
    (contract, kind, amount) => {
      const r = runtime();
      let state = evaluate(emptyLifecycle(), ridgecrest, contract, r);
      state = createPacket(
        state,
        state.currentEvaluationId!,
        "reviewed zero",
        r,
      );
      const p = packetSchema.parse(
        JSON.parse(serializePacket(state.packets[0])),
      );
      expect(p.kind).toBe(kind);
      expect(p.aggregation.totalRecovery).toBe(amount);
      if (amount === null) {
        expect(p.review).toBeNull();
        expect(p.evaluation.contract.inception).toBeNull();
        expect(p.evaluation.assessment.exceptions.length).toBeGreaterThan(0);
      } else expect(p.review?.reviewer.name).toBe("Alex Morgan");
    },
  );
  it("rejects inconsistent, unreviewed and tampered complete packets", () => {
    const r = runtime();
    let state = evaluate(emptyLifecycle(), ridgecrest, mainContract, r);
    state = createPacket(state, state.currentEvaluationId!, "", r);
    const p = JSON.parse(serializePacket(state.packets[0]));
    expect(packetSchema.safeParse({ ...p, review: null }).success).toBe(false);
    p.aggregation.totalRecovery = 1;
    expect(packetSchema.safeParse(p).success).toBe(false);
    p.aggregation.totalRecovery = 6000000;
    p.evaluation.event.magnitude = 4;
    expect(packetSchema.safeParse(p).success).toBe(false);
  });
});

it("retains absent required raw identity and does not turn undefined optional terms into null",()=>{const state=evaluate(emptyLifecycle(),{...ridgecrest,id:undefined},{...mainContract,minimumMagnitude:undefined});expect(state.evaluations[0].event.id).toBeUndefined();expect(state.evaluations[0].assessment.status).toBe("Needs review");expect(state.evaluations[0].assessment.amount).toBeNull();expect(state.evaluations[0].contract.minimumMagnitude).toBeUndefined();const complete=evaluate(emptyLifecycle(),ridgecrest,{...mainContract,minimumMagnitude:undefined});expect(complete.evaluations[0].assessment.amount).toBe(6000000);});
