import { useState } from "react";
import {
  DEMO_ANALYST,
  serializePacket,
  type EvaluationRecord,
  type RecoveryPacket,
} from "../domain/packets";

export function downloadPacket(packet: RecoveryPacket) {
  const url = URL.createObjectURL(
    new Blob([serializePacket(packet)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `catlas-${packet.kind}-${packet.packetId}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PacketReview({
  evaluation,
  packet,
  onReview,
  disabled = false,
}: {
  evaluation: EvaluationRecord;
  packet?: RecoveryPacket;
  onReview: (notes: string) => void;
  disabled?: boolean;
}) {
  const [notes, setNotes] = useState("");
  const incomplete = evaluation.assessment.amount === null;
  return (
    <section
      className="packet-review"
      aria-label="Evaluation review and packet"
    >
      <h3>{incomplete ? "Export an exception" : "Review this evaluation"}</h3>
      <p>
        Evaluation v{evaluation.version} · <code>{evaluation.id}</code>
      </p>
      <p>
        {DEMO_ANALYST.name} · named demo analyst. No sign-in; this review is not
        authenticated financial approval.
      </p>
      {incomplete ? (
        <p>
          Missing required information prevents recovery review. Export lists
          exceptions and asserts no amount.
        </p>
      ) : (
        <>
          <label htmlFor="review-notes">Review notes</label>
          <textarea
            id="review-notes"
            maxLength={4000}
            value={packet?.review?.notes ?? notes}
            disabled={disabled || Boolean(packet)}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button disabled={disabled || Boolean(packet)} onClick={() => onReview(notes)}>
            Review evaluation v{evaluation.version}
          </button>
        </>
      )}
      {!packet && incomplete && (
        <button disabled={disabled} onClick={() => onReview("")}>Prepare exception packet</button>
      )}
      <button
        disabled={!packet}
        onClick={() => packet && downloadPacket(packet)}
      >
        {incomplete ? "Download exception JSON" : "Download reviewed JSON"}
      </button>
      {packet && (
        <>
          <p role="status">
            {incomplete ? "Exception prepared" : "Reviewed and frozen"} ·{" "}
            {packet.packetId}
          </p>
          <p>Download is separate from delivery. No receipt is asserted.</p>
          <details>
            <summary>Inspect immutable packet JSON</summary>
            <pre>{serializePacket(packet)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
export function PacketHistory({ packets }: { packets: RecoveryPacket[] }) {
  if (!packets.length) return null;
  return (
    <section className="packet-history" aria-label="Retained packet history">
      <h3>Saved packets</h3>
      <p>
        Prior packets remain immutable and retained locally across refresh on this origin. Download archived content independently of the selected evaluation.
      </p>
      {packets.map((packet) => (
        <div key={packet.packetId}>
          <span>
            {packet.evaluation.event.name} · {packet.evaluation.contract.id} ·
            evaluation v{packet.evaluation.version}
          </span>
          <button onClick={() => downloadPacket(packet)}>
            Download archived{" "}
            {packet.kind === "exception" ? "exception" : "reviewed"} packet{" "}
            {packet.packetId.slice(0, 8)}
          </button>
        </div>
      ))}
    </section>
  );
}
