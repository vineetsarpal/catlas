import { useState } from 'react';
import { PacketReview } from './PacketReview';
import type { EvaluationRecord, RecoveryPacket } from '../domain/packets';
import type { DemoRepository } from '../persistence/repository';
import { useDeliveryHistory } from '../delivery/useDeliveryHistory';
import { deliveryGate, lineageDelivery, replacementForReview } from '../delivery/model';
import { checkPacketStatus, submitPacket } from '../delivery/service';

type ReplacementReviewProps = {
  evaluation: EvaluationRecord;
  packet?: RecoveryPacket;
  packets: RecoveryPacket[];
  repository: DemoRepository;
  disabled: boolean;
  onReview: (notes: string) => void;
  onFreshEvaluation: () => void;
  actionError: string;
};
export function ReplacementReview({
  evaluation, packet, packets, repository, disabled, onReview, onFreshEvaluation, actionError,
}: ReplacementReviewProps) {
  const { history, error, loading } = useDeliveryHistory(repository);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState('');
  const context = lineageDelivery(history, evaluation.lineageId);
  let reviewGate = '';
  let replacement: ReturnType<typeof replacementForReview>;
  if (!packet) {
    try { replacement = replacementForReview(evaluation, history); }
    catch (error) { reviewGate = error instanceof Error ? error.message : String(error); }
  }
  const requiresFresh = Boolean(
    packet && context.receiver && !context.receiver.acceptedPacketIds.includes(packet.packetId) &&
    evaluation.assessment.amount !== null && deliveryGate(history, packet),
  );
  const staleUnreviewed = !packet && reviewGate && !context.unconfirmed.length;
  const reconcile = async (prior: RecoveryPacket, retry = false) => {
    setWorking(true);
    setFailure('');
    try {
      if (retry) await submitPacket(repository, prior, 'accept');
      else await checkPacketStatus(repository, prior);
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    finally { setWorking(false); }
  };
  const locked = disabled || working || loading || Boolean(error);
  return (
    <>
      {(context.unconfirmed.length > 0 || replacement || requiresFresh || reviewGate || actionError) && (
        <section className="packet-review" aria-label="Replacement review context">
          <h3>Linked replacement assessment</h3>
          <p>Replace the full receiving assessment for this event and treaty. Amounts are never added to the earlier recovery.</p>
          {replacement && <p>Review will freeze previous packet {replacement.previousPacketId} and receiving reference {replacement.priorRASReference}.</p>}
          {reviewGate && <p role="status">{reviewGate}</p>}
          {context.unconfirmed.filter(submission => submission.packetId !== packet?.packetId).map(submission => {
            const prior = packets.find(packet => packet.packetId === submission.packetId);
            return (
              <div key={submission.id}>
                <p>Prior delivery unconfirmed · original submission {submission.id}</p>
                {prior ? (
                  <>
                    <button disabled={locked} onClick={() => void reconcile(prior)}>Reconcile prior delivery status</button>
                    <button disabled={locked} onClick={() => void reconcile(prior, true)}>Retry prior immutable packet</button>
                  </>
                ) : <p>Original packet is unavailable; export history for inspection or reset this demonstration.</p>}
              </div>
            );
          })}
          {requiresFresh && <p>This immutable packet was frozen before the current receiving assessment. Its links cannot be changed or refreshed. Create a fresh evaluation and review against current delivery context.</p>}
          {(requiresFresh || staleUnreviewed) && (
            <button disabled={locked || context.unconfirmed.length > 0} onClick={onFreshEvaluation}>Create fresh evaluation for replacement review</button>
          )}
          {(error || failure || actionError) && <p role="alert">{error || failure || actionError}</p>}
        </section>
      )}
      <PacketReview evaluation={evaluation} packet={packet} onReview={onReview} disabled={locked || Boolean(reviewGate)} />
    </>
  );
}
