# Catlas

Catlas supports a ceded reinsurance analyst's investigation of catastrophe events and explanation of provisional contractual recoveries.

## Language

**Reinsurance contract**:
An agreement authored and maintained in RAS whose relevant terms are imported into Catlas for event evaluation. A treaty is a reinsurance contract.

**Evaluation version**:
A provisional assessment tied to the particular event evidence and contract version used. Revised evidence or contract terms produce a new assessment version.

**Provisional recovery**:
A contractual recovery amount calculated from event evidence and applicable contract terms, subject to review. It is distinct from a physical loss estimate, an approved receivable and a payment.

**Reviewed recovery packet**:
The event evidence, contract reference and evaluation explanation reviewed by an analyst for a specific evaluation version and prepared for download or delivery to RAS. The destination RAS may call this a claim packet; its receiving terminology remains to be established.

**Exception packet**:
A record of an incomplete assessment and the missing information preventing a recovery determination. It does not assert a recovery amount.

**Delivery acknowledgement**:
Confirmation that the destination RAS received a packet, with a receiving reference. It is distinct from approval of the recovery or execution of payment.

**Contractual reference point**:
A fixed geographic location specified by a reinsurance contract, from which distance to an earthquake's epicentre is measured for a distance-based trigger. It is distinct from the epicentre and contextual insured locations.

**Distance band**:
An exclusive contractual range of distances used with event magnitude to select a payout rate. A distance band is not a ground-shaking contour.

**Evidence snapshot**:
A frozen set of source observations and identifiers used in an evaluation. It preserves the selected magnitude, magnitude type and epicentre rather than relying on subsequently changing source data.

**Cedent**:
The insurer purchasing reinsurance protection and receiving a recovery under that agreement. The cedent is distinct from the policyholders insured by it.

**Scheduled portfolio area**:
A named portfolio grouping specified by the parametric reinsurance contract, with a fixed reference point and contractual payout allocation. Each area contributes once to the treaty assessment under the agreed aggregation rule.

**Area allocation**:
The pre-agreed maximum payout contribution for a scheduled portfolio area before applying its trigger rate. It is distinct from insured value, actual losses and individual policyholder claims.

**Treaty event cap**:
The contractual maximum recovery for one evaluated event, applied to the sum of scheduled area contributions.
