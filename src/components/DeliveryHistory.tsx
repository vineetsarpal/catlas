import { demoRepository, type DemoRepository } from "../persistence/repository";
import { useDeliveryHistory } from "../delivery/useDeliveryHistory";
import "./delivery.css";
export function DeliveryHistory({
  repository = demoRepository,
}: {
  repository?: DemoRepository;
}) {
  const { history, error, loading } = useDeliveryHistory(repository);
  return (
    <section
      className="delivery-history"
      aria-label="Simulated RAS delivery history"
    >
      <h2>Simulated RAS delivery history</h2>
      {error ? (
        <p aria-live="assertive">{error}</p>
      ) : loading ? (
        <p>Loading delivery records…</p>
      ) : (
        <>
          <p data-testid="receiver-count">
            {history.receiverRecords.length} simulated receiving record
            {history.receiverRecords.length === 1 ? "" : "s"}
          </p>
          <p>
            {history.attempts.length} delivery attempts · records retained
            separately from immutable packets.
          </p>
          {history.attempts.map((attempt) => (
            <article key={attempt.id} data-testid="delivery-attempt">
              <strong>
                {attempt.state === "received" ? "Received" : "Rejected"} ·{" "}
                {attempt.reference ?? attempt.reason}
              </strong>
              <p>
                {attempt.attemptedAt} · packet {attempt.packetId}
              </p>
              <p>Submission {attempt.submissionId}</p>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
