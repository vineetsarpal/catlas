# Catlas

Catlas supports an insurer's investigation of catastrophe events and potentially affected portfolio exposure, alongside a ceded reinsurance analyst's explanation of provisional contractual recoveries.

## Language

**Exposure portfolio**:
A collection of insured locations and their associated insurance values and attributes used to investigate an insurer's exposure to catastrophe events.

**Insured location**:
A consolidated insured site identified within an exposure portfolio. Multiple policies covering that site are represented by the supplied consolidated location record rather than counted as separate locations.

**Portfolio snapshot**:
A particular exposure portfolio identified by its source and as-of date. Its as-of date describes the supplied portfolio and does not by itself establish policy coverage at an event's occurrence time.

**Total insured value**:
The insurance value supplied for a consolidated insured location, expressed in its stated currency. It is an exposure measure, distinct from a policy limit, estimated damage or payable loss; an unknown value is not zero.

**Hazard footprint**:
A geographic representation of a specified catastrophe hazard's intensity for an event and evidence version. It is distinct from contractual trigger zones and verified damage.

**Potentially affected exposure**:
Insured locations and associated values identified by comparing a portfolio with event hazard evidence. It does not establish physical damage, insured loss or reinsurance recovery.

**Investigation threshold**:
The selected minimum estimated hazard intensity used to screen insured locations for investigation. It is distinct from a damage threshold or a contractual recovery trigger.

**Impact summary**:
A shareable account of an event's potentially affected portfolio exposure, with the supporting evidence and limitations identified. It does not assert damage or loss solely from hazard-footprint intersection.

**Exposure investigation version**:
A reproducible assessment of a portfolio snapshot against selected event and hazard evidence using identified analysis settings. Applying revised evidence or changing substantive analysis inputs produces a new version rather than rewriting an earlier assessment.

**Case bundle**:
A portable record containing the portfolio snapshot, captured hazard evidence and analysis settings needed to reopen an exposure investigation. It includes the insured-location data contained in that investigation.

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

**Wind forecast**:
A numerical prediction of wind vectors at an identified model run and forecast valid time. It provides weather context, distinct from an observed wind report or a location-level hazard assessment.
