import { RULE_VERSION } from "../domain/assessment";
import {
  type RecoveryPacket,
  serializePacket,
  browserRuntime,
  type Runtime,
} from "../domain/packets";
import {
  demoRepository,
  CompatibilityError,
  STORAGE_SCHEMA_VERSION,
  type DemoRepository,
  type OperationalRecord,
} from "../persistence/repository";
import {
  initialSendGate,
  receive,
  checkStatus,
  submissionIdentity,
  validateHistory,
  type ReceiverOutcome,
  type DeliveryHistoryState,
} from "./model";

export async function loadDeliveryHistory(
  repository: DemoRepository = demoRepository,
): Promise<DeliveryHistoryState> {
  return repository.db.transaction(
    "r",
    [
      repository.db.metadata,
      repository.db.submissions,
      repository.db.deliveryAttempts,
      repository.db.receiverRecords,
    ],
    async () => {
      const metadata = await repository.db.metadata.get("format");
      const rows = {
        submissions: await repository.db.submissions.toArray(),
        attempts: await repository.db.deliveryAttempts.toArray(),
        receiverRecords: await repository.db.receiverRecords.toArray(),
      };
      if (
        !metadata &&
        !rows.submissions.length &&
        !rows.attempts.length &&
        !rows.receiverRecords.length
      )
        return validateHistory(rows);
      if (
        metadata?.schemaVersion !== STORAGE_SCHEMA_VERSION ||
        metadata.ruleVersion !== RULE_VERSION
      )
        throw new CompatibilityError(
          "Simulated RAS history uses an incompatible storage format. Raw history is preserved; export or explicitly reset demo data.",
        );
      const history = validateHistory(rows);
      history.attempts.sort(
        (a, b) =>
          a.attemptedAt.localeCompare(b.attemptedAt) ||
          a.id.localeCompare(b.id),
      );
      return history;
    },
  );
}
async function packetAction(
  repository: DemoRepository,
  packet: RecoveryPacket,
  outcome: ReceiverOutcome = "accept",
  runtime: Runtime = browserRuntime,
  action: "submit" | "check" = "submit",
) {
  const gate = initialSendGate(packet);
  if (gate) throw new Error(gate);
  const payload = serializePacket(packet);
  // Include immutable packet table in the enclosing transaction: reset cannot race
  // between verifying saved review and committing an operational receipt.
  return repository.db.transaction(
    "rw",
    [
      repository.db.packets,
      repository.db.metadata,
      repository.db.submissions,
      repository.db.deliveryAttempts,
      repository.db.receiverRecords,
    ],
    async () => {
      const saved = await repository.db.packets.get(packet.packetId);
      if (!saved || serializePacket(saved.value as RecoveryPacket) !== payload)
        throw new Error("Send requires the exact retained reviewed packet.");
      return repository.deliveryTransaction(async (tables) => {
        const before = validateHistory({
          submissions: await tables.submissions.toArray(),
          attempts: await tables.deliveryAttempts.toArray(),
          receiverRecords: await tables.receiverRecords.toArray(),
        });
        const result =
          action === "check"
            ? checkStatus(
                before,
                submissionIdentity(packet.packetId),
                payload,
                runtime,
              )
            : receive(
                before,
                submissionIdentity(packet.packetId),
                payload,
                outcome,
                runtime,
              );
        await tables.submissions.put(result.submission as OperationalRecord);
        await tables.deliveryAttempts.add(result.attempt as OperationalRecord);
        for (const receiver of result.history.receiverRecords)
          await tables.receiverRecords.put(receiver as OperationalRecord);
        return result.submission;
      });
    },
  );
}

export async function submitPacket(
  repository: DemoRepository,
  packet: RecoveryPacket,
  outcome: ReceiverOutcome = "accept",
  runtime: Runtime = browserRuntime,
) {
  return packetAction(repository, packet, outcome, runtime, "submit");
}
export async function checkPacketStatus(
  repository: DemoRepository,
  packet: RecoveryPacket,
  runtime: Runtime = browserRuntime,
) {
  return packetAction(repository, packet, "accept", runtime, "check");
}
