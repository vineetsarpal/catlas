import { useState } from "react";
import { demoRepository, type DemoRepository } from "../persistence/repository";
import type { RecoveryPacket } from "../domain/packets";
import { initialSendGate, type ReceiverOutcome } from "../delivery/model";
import { submitPacket, checkPacketStatus } from "../delivery/service";
import { useDeliveryHistory } from "../delivery/useDeliveryHistory";
import "./delivery.css";
export function DeliveryPanel({
  packet,
  disabled = false,
  repository = demoRepository,
}: {
  packet?: RecoveryPacket;
  disabled?: boolean;
  repository?: DemoRepository;
}) {
  const { history, error, loading } = useDeliveryHistory(repository),
    [sending, setSending] = useState(false),
    [checking, setChecking] = useState(false),
    [failure, setFailure] = useState(""),
    [outcome, setOutcome] = useState<ReceiverOutcome>("accept");
  const submission = history.submissions.find(
      (s) => s.packetId === packet?.packetId,
    ),
    gate = initialSendGate(packet);
  async function check() {
    if (!packet) return;
    setChecking(true);
    setFailure("");
    try {
      await checkPacketStatus(repository, packet);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }
  async function send() {
    if (!packet || gate) return;
    setSending(true);
    setFailure("");
    try {
      await submitPacket(repository, packet, outcome);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="delivery-panel" aria-label="Simulated RAS delivery">
      <h3>Send to simulated RAS</h3>
      <p>
        Local vendor-neutral demonstration receiver. No network service or real
        RAS writeback.
      </p>
      {gate && <p>{gate}</p>}
      <label>
        Simulated receiver outcome
        <select
          aria-label="Simulated receiver outcome"
          value={outcome}
          disabled={disabled || sending || checking}
          onChange={(e) => setOutcome(e.target.value as ReceiverOutcome)}
        >
          <option value="accept">Accept and acknowledge</option>
          <option value="reject">Reject with reason</option>
          <option value="unconfirmed">Accept but lose acknowledgement</option>
        </select>
      </label>
      <button
        onClick={send}
        disabled={
          Boolean(gate) ||
          disabled ||
          sending ||
          checking ||
          loading ||
          Boolean(error)
        }
      >
        {sending
          ? "Sending…"
          : submission
            ? "Retry same reviewed packet"
            : "Send reviewed packet"}
      </button>
      {submission?.state === "unconfirmed" && (
        <button
          onClick={check}
          disabled={
            disabled || sending || checking || loading || Boolean(error)
          }
        >
          {checking ? "Checking status…" : "Check delivery status"}
        </button>
      )}
      <p aria-live="polite">
        {sending
          ? "Sending reviewed packet…"
          : checking
            ? "Checking existing submission status…"
            : submission?.state === "unconfirmed"
              ? "Delivery unconfirmed · no acknowledgement establishes receipt or rejection. Check status or retry with the same identity."
              : submission?.state === "received"
                ? `Received by simulated RAS · ${submission.reference}`
                : submission?.state === "rejected"
                  ? `Rejected by simulated RAS · ${submission.reason}`
                  : "Not sent. Download alone does not imply receipt."}
      </p>
      {submission && (
        <p>
          Stable submission identity: <code>{submission.id}</code>
        </p>
      )}
      {(error || failure) && <p aria-live="assertive">{error || failure}</p>}
      <p>
        Receipt confirms simulated delivery only; no financial approval or
        payment.
      </p>
    </section>
  );
}
