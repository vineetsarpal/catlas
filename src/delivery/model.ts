import { z } from "zod";
import {
  packetSchema,
  serializePacket,
  type RecoveryPacket,
  type Runtime,
  browserRuntime,
} from "../domain/packets";
import { CompatibilityError } from "../persistence/repository";

const identity = z.string().min(1),
  instant = z.iso.datetime();
export const submissionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identity,
    packetId: identity,
    caseId: identity,
    payload: z.string(),
    state: z.enum(["received", "rejected", "unconfirmed"]),
    createdAt: instant,
    updatedAt: instant,
    reference: identity.nullable(),
    reason: identity.nullable(),
  })
  .strict();
export const attemptSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identity,
    submissionId: identity,
    packetId: identity,
    attemptedAt: instant,
    action: z.enum(["send", "retry", "check"]).optional(),
    state: z.enum(["received", "rejected", "unconfirmed"]),
    reference: identity.nullable(),
    reason: identity.nullable(),
  })
  .strict();
export const receiverSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identity,
    caseId: identity,
    reference: identity,
    receivedAt: instant,
    currentPacketId: identity,
    currentPayload: z.string(),
    currentAmount: z.number().positive(),
    acceptedSubmissionIds: z.array(identity).min(1),
    acceptedPacketIds: z.array(identity).min(1),
  })
  .strict();
export type Submission = z.infer<typeof submissionSchema>;
export type DeliveryAttempt = z.infer<typeof attemptSchema>;
export type ReceiverRecord = z.infer<typeof receiverSchema>;
export type DeliveryHistoryState = {
  submissions: Submission[];
  attempts: DeliveryAttempt[];
  receiverRecords: ReceiverRecord[];
};
export const emptyDeliveryHistory = (): DeliveryHistoryState => ({
  submissions: [],
  attempts: [],
  receiverRecords: [],
});
export const submissionIdentity = (packetId: string) =>
  `submission:${packetId}`;
export function initialSendGate(packet?: RecoveryPacket): string | null {
  if (!packet) return "Review a complete positive evaluation before sending.";
  if (packet.kind === "exception" || packet.aggregation.totalRecovery === null)
    return "Incomplete assessment: exception export only; recovery send blocked.";
  if (!packet.review) return "Review is required before sending.";
  if (packet.aggregation.totalRecovery <= 0)
    return "Initial zero assessment: reviewed download only; recovery send blocked.";
  return null;
}
export function parsePayload(payload: string): RecoveryPacket {
  const packet = packetSchema.parse(JSON.parse(payload));
  if (serializePacket(packet) !== payload)
    throw new Error(
      "Receiver requires the exact canonical reviewed JSON bytes.",
    );
  return packet;
}
// Structural and relationship validation preserves incompatible records for export/reset.
export function validateHistory(raw: {
  submissions: unknown[];
  attempts: unknown[];
  receiverRecords: unknown[];
}): DeliveryHistoryState {
  try {
    const history = {
      submissions: raw.submissions.map((s) => submissionSchema.parse(s)),
      attempts: raw.attempts.map((a) => attemptSchema.parse(a)),
      receiverRecords: raw.receiverRecords.map((r) => receiverSchema.parse(r)),
    };
    const fail = () => {
      throw new Error("Inconsistent delivery references");
    };
    for (const rows of [
      history.submissions,
      history.attempts,
      history.receiverRecords,
    ])
      if (new Set(rows.map((r) => r.id)).size !== rows.length) fail();
    if (
      new Set(history.receiverRecords.map((r) => r.caseId)).size !==
      history.receiverRecords.length
    )
      fail();
    for (const s of history.submissions) {
      const p = parsePayload(s.payload);
      if (
        s.id !== submissionIdentity(s.packetId) ||
        p.packetId !== s.packetId ||
        p.evaluation.lineageId !== s.caseId
      )
        fail();
      if (s.state === "received") {
        const r = history.receiverRecords.find((r) => r.caseId === s.caseId);
        if (
          !r ||
          r.reference !== s.reference ||
          !r.acceptedSubmissionIds.includes(s.id) ||
          s.reason !== null
        )
          fail();
      } else if (!s.reason || s.reference !== null) fail();
    }
    for (const a of history.attempts) {
      const s = history.submissions.find((s) => s.id === a.submissionId);
      if (
        !s ||
        s.packetId !== a.packetId ||
        (a.state === "received"
          ? !a.reference || a.reference !== s.reference || a.reason !== null
          : !a.reason || a.reference !== null)
      )
        fail();
    }
    for (const r of history.receiverRecords) {
      const p = parsePayload(r.currentPayload);
      if (
        p.packetId !== r.currentPacketId ||
        p.evaluation.lineageId !== r.caseId ||
        p.aggregation.totalRecovery !== r.currentAmount
      )
        fail();
      if (
        r.acceptedSubmissionIds.length !==
          new Set(r.acceptedSubmissionIds).size ||
        r.acceptedPacketIds.length !== new Set(r.acceptedPacketIds).size
      )
        fail();
      for (const id of r.acceptedSubmissionIds) {
        const s = history.submissions.find((s) => s.id === id);
        if (
          !s ||
          (s.state !== "received" && s.state !== "unconfirmed") ||
          s.caseId !== r.caseId ||
          (s.state === "received"
            ? s.reference !== r.reference
            : s.reference !== null) ||
          !r.acceptedPacketIds.includes(s.packetId)
        )
          fail();
      }
      if (!r.acceptedPacketIds.includes(r.currentPacketId)) fail();
    }
    return history;
  } catch {
    throw new CompatibilityError(
      "Saved simulated RAS history is incompatible. Raw records are preserved; export local history or explicitly reset demo data.",
    );
  }
}
export type ReceiverOutcome = "accept" | "reject" | "unconfirmed";
export function receive(
  history: DeliveryHistoryState,
  submissionId: string,
  payload: string,
  outcome: ReceiverOutcome,
  runtime: Runtime = browserRuntime,
): {
  history: DeliveryHistoryState;
  submission: Submission;
  attempt: DeliveryAttempt;
} {
  const before = validateHistory(history),
    packet = parsePayload(payload),
    gate = initialSendGate(packet);
  if (gate) throw new Error(gate);
  if (submissionId !== submissionIdentity(packet.packetId))
    throw new Error(
      "Submission identity must belong to this immutable packet.",
    );
  const previous = before.submissions.find((s) => s.id === submissionId);
  if (previous && previous.payload !== payload)
    throw new Error("Same submission identity cannot carry changed payload.");
  const current = before.receiverRecords.find(
    (r) => r.caseId === packet.evaluation.lineageId,
  );
  const at = runtime.now();
  let submission: Submission;
  let records = before.receiverRecords;
  if (previous?.state === "received") submission = previous;
  else {
    const reason =
      current && current.currentPacketId !== packet.packetId
        ? "A receiving case already exists. A different packet requires a linked replacement assessment."
        : outcome === "reject" &&
            !current?.acceptedSubmissionIds.includes(submissionId)
          ? "Simulated RAS rejected this demonstration submission for manual inspection."
          : null;
    let reference: string | null = null;
    if (!reason) {
      reference = current?.reference ?? `MOCK-RAS-${runtime.id()}`;
      if (!current)
        records = [
          ...records,
          {
            schemaVersion: 1,
            id: `case:${packet.evaluation.lineageId}`,
            caseId: packet.evaluation.lineageId,
            reference,
            receivedAt: at,
            currentPacketId: packet.packetId,
            currentPayload: payload,
            currentAmount: packet.aggregation.totalRecovery!,
            acceptedSubmissionIds: [submissionId],
            acceptedPacketIds: [packet.packetId],
          },
        ];
    }
    submission = {
      schemaVersion: 1,
      id: submissionId,
      packetId: packet.packetId,
      caseId: packet.evaluation.lineageId,
      payload,
      state: reason
        ? "rejected"
        : outcome === "unconfirmed"
          ? "unconfirmed"
          : "received",
      createdAt: previous?.createdAt ?? at,
      updatedAt: at,
      reference: !reason && outcome === "unconfirmed" ? null : reference,
      reason:
        !reason && outcome === "unconfirmed"
          ? "Acknowledgement lost; timeout proves neither receipt nor rejection."
          : reason,
    };
  }
  const attempt: DeliveryAttempt = {
    schemaVersion: 1,
    id: runtime.id(),
    submissionId,
    packetId: packet.packetId,
    attemptedAt: at,
    action: previous ? "retry" : "send",
    state: submission.state,
    reference: submission.reference,
    reason: submission.reason,
  };
  const next = {
    submissions: [
      ...before.submissions.filter((s) => s.id !== submissionId),
      submission,
    ],
    attempts: [...before.attempts, attempt],
    receiverRecords: records,
  };
  return { history: validateHistory(next), submission, attempt };
}

export function checkStatus(
  history: DeliveryHistoryState,
  submissionId: string,
  payload: string,
  runtime: Runtime = browserRuntime,
) {
  const before = validateHistory(history),
    packet = parsePayload(payload),
    previous = before.submissions.find((s) => s.id === submissionId);
  if (submissionId !== submissionIdentity(packet.packetId))
    throw new Error(
      "Submission identity must belong to this immutable packet.",
    );
  if (previous && previous.payload !== payload)
    throw new Error("Same submission identity cannot carry changed payload.");
  const receiver = before.receiverRecords.find((r) =>
    r.acceptedSubmissionIds.includes(submissionId),
  );
  const at = runtime.now();
  const submission: Submission = {
    schemaVersion: 1,
    id: submissionId,
    packetId: packet.packetId,
    caseId: packet.evaluation.lineageId,
    payload,
    state: receiver
      ? "received"
      : previous?.state === "rejected"
        ? "rejected"
        : "unconfirmed",
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
    reference: receiver?.reference ?? null,
    reason: receiver
      ? null
      : previous?.state === "rejected"
        ? previous.reason
        : "Receiver status not found; delivery remains unconfirmed.",
  };
  const attempt: DeliveryAttempt = {
    schemaVersion: 1,
    id: runtime.id(),
    submissionId,
    packetId: packet.packetId,
    attemptedAt: at,
    action: "check",
    state: submission.state,
    reference: submission.reference,
    reason: submission.reason,
  };
  const next = {
    submissions: [
      ...before.submissions.filter((s) => s.id !== submissionId),
      submission,
    ],
    attempts: [...before.attempts, attempt],
    receiverRecords: before.receiverRecords,
  };
  return { history: validateHistory(next), submission, attempt };
}
export function lineageDelivery(
  history: DeliveryHistoryState,
  lineageId: string,
) {
  const submissions = history.submissions.filter((s) => s.caseId === lineageId);
  return {
    receiver: history.receiverRecords.find((r) => r.caseId === lineageId),
    submissions,
    unconfirmed: submissions.filter((s) => s.state === "unconfirmed"),
  };
}
