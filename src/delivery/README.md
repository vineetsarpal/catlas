# Simulated RAS delivery boundary (CAT-19)

Integration imports:

```tsx
import { DeliveryPanel } from "./components/DeliveryPanel";
import { DeliveryHistory } from "./components/DeliveryHistory";
```

Render `<DeliveryPanel packet={packet} disabled={busy} repository={repository} />` after PacketReview, including when `packet` is undefined so the review gate remains visible. Render `<DeliveryHistory repository={repository} />` beside retained history. Both repository props default to the singleton demoRepository. No shared App/lifecycle/repository changes are included in this slice.

`model.ts` supplies pure `receive`, `validateHistory`, `initialSendGate`, `submissionIdentity` and operational schemas. `service.ts` supplies `submitPacket(repository, packet, outcome, runtime?)` and `loadDeliveryHistory(repository?)`. Outcome is explicitly simulated accept/reject. `useDeliveryHistory` subscribes through Dexie liveQuery and recovers after explicit reset. Error handling preserves incompatible rows for the existing raw archive export; it never silently resets them.

The adapter checks the exact retained immutable packet and serializes with the existing serializePacket function. An enclosing transaction includes immutable packets, metadata and all operational tables; the existing deliveryTransaction runs inside it. This prevents reset or concurrent sends from separating the reviewed-content check and receipt commit. No lifecycle record is modified. The pure receiver independently validates canonical JSON/calculation and requires the same exact bytes. No network, credentials, vendor RAS or financial approval is implied.

Each packet uses submission identity `submission:${packetId}`. Retries preserve payload and deduplicate the receiving reference, while attempts have distinct identities and timestamps. Rejections remain separate attempt records even if a retry is received. A receiver case is keyed by the event×treaty lineage; it stores a mock receiving reference, current full assessment and accepted packet/submission identities. A different packet for an existing case is rejected as requiring a linked replacement, preventing additive receiving records.

CAT-20 can extend operational states with unconfirmed delivery and status reconciliation. CAT-21 can extend the case transition to validate explicit replacement links and permit complete downward-to-zero corrections; current initial-send zero gate intentionally blocks them until that replacement path exists. Neither extension requires changing immutable payload bytes on retry.

Tests: model.test.ts verifies seven receiver cases. tests/e2e/delivery.spec.ts uses real IndexedDB and actual downloaded bytes, offline receipt, rejection, retries, persistence, initial gates, incompatible-record preservation/reset, concurrent sends and altered-content rejection. Browser tests require the shared App integration above; temporary worktree wiring/config used for verification is excluded from the commit.

## Lost acknowledgement and reconciliation (CAT-20)

The simulated `unconfirmed` outcome accepts into receiver truth while withholding the acknowledgement: sender submission and its attempt retain state `unconfirmed`, null receiving reference and an explicit uncertainty reason. A timeout establishes neither receipt nor rejection. Refresh retains these rows; receiver count is explicitly simulator truth rather than a sender acknowledgement.

`checkPacketStatus(repository, packet, runtime?)` uses the existing submission identity and exact retained bytes, then appends an `action: 'check'` attempt. A matching accepted receiver record supplies its existing acknowledgement/reference; unknown/not-found status stays unconfirmed. The check never creates or changes a receiver record. Retrying uses `action: 'retry'`; repeated lost acknowledgements preserve uncertainty, and an acknowledged retry returns the original reference. Existing received/rejected rows without an action field remain compatible and are displayed as legacy sends.

`lineageDelivery(history, lineageId)` returns the receiving case, all submissions and the unconfirmed subset for CAT-21. Receiver truth must not be used as an acknowledged reference before the sender submission is reconciled. Delivery history orders attempts by actual recorded attempt time for presentation; the raw archive retains database primary-key order and must not be mistaken for chronology.

The complete replacement workflow remains a later slice. No immutable packet content, source provenance or financial approval state changes during reconciliation.
