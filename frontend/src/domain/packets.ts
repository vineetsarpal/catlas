import { z } from "zod";
import { assess, EARTH_RADIUS_KM, RULE_VERSION } from "./assessment";
import {
  eventInputSchema,
  contractInputSchema,
  type EventInput,
  type ContractInput,
} from "./types";

const areaAssessmentSchema = z.object({
  areaId: z.string(),
  name: z.string(),
  distanceKm: z.number().nonnegative(),
  band: z.enum(["inner", "outer", "outside"]),
  magnitudeRow: z.string(),
  rate: z.number().min(0).max(1),
  allocation: z.number().nonnegative(),
  contribution: z.number().nonnegative(),
});
export const assessmentSchema = z.object({
  ruleVersion: z.string(),
  status: z.enum([
    "Trigger met",
    "Not triggered",
    "Outside coverage",
    "Needs review",
  ]),
  amount: z.number().nonnegative().nullable(),
  uncappedSum: z.number().nonnegative().nullable(),
  eventCap: z.number().nonnegative().nullable(),
  areas: z.array(areaAssessmentSchema),
  exceptions: z.array(z.string()),
  knownFailures: z.array(z.string()),
});
export const evaluationSchema = z.object({
  id: z.string().min(1),
  lineageId: z.string().min(1),
  version: z.number().int().positive(),
  evaluatedAt: z.iso.datetime(),
  previousEvaluationId: z.string().optional(),
  event: eventInputSchema,
  contract: contractInputSchema,
  assessment: assessmentSchema,
});
export type EvaluationRecord = z.infer<typeof evaluationSchema>;
export const DEMO_ANALYST = {
  id: "DEMO-ANALYST-01",
  name: "Alex Morgan",
  role: "Named demo analyst — unauthenticated persona",
} as const;
export const replacementSchema = z.object({
  purpose: z.literal("Full replacement assessment"),
  previousPacketId: z.string().min(1),
  previousEvaluationId: z.string().min(1),
  previousEvaluationVersion: z.number().int().positive(),
  priorRASReference: z.string().min(1),
});
export type Replacement = z.infer<typeof replacementSchema>;
const packetShapeSchema = z
  .object({
    schemaVersion: z.literal(1),
    packetId: z.string().min(1),
    kind: z.enum(["reviewed-recovery", "exception"]),
    purpose: z.literal("Provisional contractual recovery assessment"),
    evaluation: evaluationSchema,
    cedent: z.object({ id: z.string(), name: z.string() }).nullable(),
    rule: z.object({
      id: z.literal("DEMO-TWO-AREA-MATRIX"),
      version: z.literal(RULE_VERSION),
      earthRadiusKm: z.literal(6371),
      magnitudeType: z.literal("mw"),
      coverage: z.literal("Occurrence UTC [inception, expiry)"),
      distanceBands: z.tuple([
        z.literal("inner ≤25 km"),
        z.literal("outer >25–100 km"),
        z.literal("outside >100 km"),
      ]),
      matrix: z.tuple([
        z.object({
          magnitude: z.literal("<6.5"),
          inner: z.literal(0),
          outer: z.literal(0),
          outside: z.literal(0),
        }),
        z.object({
          magnitude: z.literal("≥6.5 and <7.0"),
          inner: z.literal(0.5),
          outer: z.literal(0.25),
          outside: z.literal(0),
        }),
        z.object({
          magnitude: z.literal("≥7.0 and <7.5"),
          inner: z.literal(0.75),
          outer: z.literal(0.375),
          outside: z.literal(0),
        }),
        z.object({
          magnitude: z.literal("≥7.5"),
          inner: z.literal(1),
          outer: z.literal(0.5),
          outside: z.literal(0),
        }),
      ]),
      aggregation: z.literal(
        "Apply imported minimumMagnitude if present. Each area contributes once; sum then apply treaty event cap. One independent event; full event limit available.",
      ),
    }),
    aggregation: z.object({
      uncappedSum: z.number().nullable(),
      eventCap: z.number().nullable(),
      totalRecovery: z.number().nullable(),
      currency: z.literal("USD"),
    }),
    review: z
      .object({
        reviewer: z.object({
          id: z.string(),
          name: z.string(),
          role: z.string(),
        }),
        reviewedAt: z.iso.datetime(),
        evaluationId: z.string(),
        evaluationVersion: z.number().int(),
        notes: z.string().max(4000),
      })
      .nullable(),
    declarations: z.array(z.string()).min(1),
    replacement: replacementSchema.optional(),
  });
// Live creation validates calculations; retained snapshots are validated structurally
// without rerunning the current calculation over historical records.
export const packetSnapshotSchema = packetShapeSchema.superRefine((packet, ctx) => {
    if (packet.replacement && (packet.kind!=="reviewed-recovery" || packet.replacement.previousPacketId===packet.packetId || packet.replacement.previousEvaluationId===packet.evaluation.id || packet.replacement.previousEvaluationVersion>=packet.evaluation.version))
      ctx.addIssue({code:"custom",message:"Replacement must identify an earlier reviewed evaluation"});
    const a = packet.evaluation.assessment;
    if (
      JSON.stringify(packet.cedent) !==
      JSON.stringify(packet.evaluation.contract.cedent ?? null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Cedent must match the imported contract snapshot",
      });
    if (
      packet.evaluation.lineageId !==
      JSON.stringify([
        packet.evaluation.event.id ?? null,
        packet.evaluation.contract.id ?? null,
      ])
    )
      ctx.addIssue({
        code: "custom",
        message: "Evaluation lineage must identify its event and treaty",
      });
    if (
      packet.kind === "exception"
        ? a.amount !== null ||
          packet.review !== null ||
          a.status !== "Needs review" ||
          !a.exceptions.length
        : a.amount === null || !packet.review || a.status === "Needs review"
    )
      ctx.addIssue({
        code: "custom",
        message: "Packet kind, assessment and review are inconsistent",
      });
    if (
      packet.review &&
      (packet.review.evaluationId !== packet.evaluation.id ||
        packet.review.evaluationVersion !== packet.evaluation.version)
    )
      ctx.addIssue({
        code: "custom",
        message: "Review must identify this exact evaluation",
      });
    if (
      packet.aggregation.totalRecovery !== a.amount ||
      packet.aggregation.uncappedSum !== a.uncappedSum ||
      packet.aggregation.eventCap !== a.eventCap
    )
      ctx.addIssue({
        code: "custom",
        message: "Aggregation must equal the evaluated result",
      });
  });
export const packetSchema = packetSnapshotSchema.superRefine((packet, ctx) => {
    if (JSON.stringify(assess(packet.evaluation.event, packet.evaluation.contract)) !== JSON.stringify(packet.evaluation.assessment))
      ctx.addIssue({code:'custom',message:'Assessment does not match its frozen raw inputs'});
});
export type RecoveryPacket = z.infer<typeof packetSchema>;
export type LifecycleState = {
  evaluations: EvaluationRecord[];
  packets: RecoveryPacket[];
  currentEvaluationId: string | null;
};
export const emptyLifecycle = (): LifecycleState => ({
  evaluations: [],
  packets: [],
  currentEvaluationId: null,
});
export type Runtime = { now: () => string; id: () => string };
export const browserRuntime: Runtime = {
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
};
// Preserve explicitly missing nullable calculation fields as null. Other undefined
// fields are omitted, retaining missing inputs without invalidating raw schemas.
function snapshot<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, entry) =>
      entry === undefined && ["inception","expiry","magnitude","magnitudeType","occurredAt","latitude","longitude"].includes(key) ? null : entry,
    ),
  );
}
export function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
export function evaluate(
  state: LifecycleState,
  event: EventInput,
  contract: ContractInput,
  runtime = browserRuntime,
  options: {forceNewVersion?:boolean} = {},
): LifecycleState {
  const eventSnapshot = snapshot(event),
    contractSnapshot = snapshot(contract);
  const lineageId = JSON.stringify([event.id ?? null, contract.id ?? null]);
  const previous = state.evaluations
    .filter((e) => e.lineageId === lineageId)
    .sort((a,b)=>a.version-b.version)
    .at(-1);
  if (
    previous && !options.forceNewVersion &&
    JSON.stringify(previous.event) === JSON.stringify(eventSnapshot) &&
    JSON.stringify(previous.contract) === JSON.stringify(contractSnapshot)
  )
    return { ...state, currentEvaluationId: previous.id };
  const evaluation = immutable(
    evaluationSchema.parse({
      id: runtime.id(),
      lineageId,
      version: (previous?.version ?? 0) + 1,
      evaluatedAt: runtime.now(),
      ...(previous ? { previousEvaluationId: previous.id } : {}),
      event: eventSnapshot,
      contract: contractSnapshot,
      assessment: assess(eventSnapshot, contractSnapshot),
    }),
  );
  return {
    ...state,
    evaluations: [...state.evaluations, evaluation],
    currentEvaluationId: evaluation.id,
  };
}
export function createPacket(
  state: LifecycleState,
  evaluationId: string,
  notes = "",
  runtime = browserRuntime,
  replacement?: Replacement,
): LifecycleState {
  if (state.currentEvaluationId !== evaluationId)
    throw new Error("Review must target the current evaluation");
  if (state.packets.some((p) => p.evaluation.id === evaluationId)) return state;
  const evaluation = state.evaluations.find((e) => e.id === evaluationId);
  if (!evaluation) throw new Error("Evaluation does not exist");
  const exception = evaluation.assessment.amount === null;
  const packet = immutable(
    packetSchema.parse({
      schemaVersion: 1,
      packetId: runtime.id(),
      kind: exception ? "exception" : "reviewed-recovery",
      purpose: "Provisional contractual recovery assessment",
      evaluation: snapshot(evaluation),
      cedent: evaluation.contract.cedent ?? null,
      rule: {
        id: "DEMO-TWO-AREA-MATRIX",
        version: RULE_VERSION,
        earthRadiusKm: EARTH_RADIUS_KM,
        magnitudeType: "mw",
        coverage: "Occurrence UTC [inception, expiry)",
        distanceBands: ["inner ≤25 km", "outer >25–100 km", "outside >100 km"],
        matrix: [
          { magnitude: "<6.5", inner: 0, outer: 0, outside: 0 },
          { magnitude: "≥6.5 and <7.0", inner: 0.5, outer: 0.25, outside: 0 },
          { magnitude: "≥7.0 and <7.5", inner: 0.75, outer: 0.375, outside: 0 },
          { magnitude: "≥7.5", inner: 1, outer: 0.5, outside: 0 },
        ],
        aggregation:
          "Apply imported minimumMagnitude if present. Each area contributes once; sum then apply treaty event cap. One independent event; full event limit available.",
      },
      aggregation: {
        uncappedSum: evaluation.assessment.uncappedSum,
        eventCap: evaluation.assessment.eventCap,
        totalRecovery: evaluation.assessment.amount,
        currency: "USD",
      },
      review: exception
        ? null
        : {
            reviewer: DEMO_ANALYST,
            reviewedAt: runtime.now(),
            evaluationId,
            evaluationVersion: evaluation.version,
            notes,
          },
      declarations: [
        "Fictional cedent and simulated RAS-authored imported terms.",
        "Provisional calculation; not approved receivable, payment or physical loss estimate.",
        "Review by an unauthenticated demo persona is not production financial approval.",
        "Download does not imply RAS receipt. Delivery records are separate.",
        evaluation.event.provenance?.kind === "historical"
          ? "Historical event evaluated from captured source evidence; not reconstructed historical bulletin chronology."
          : "Explicitly simulated event/evidence; no historical observation is asserted.",
        ...(exception
          ? [
              "Incomplete assessment: no recovery amount asserted; resolve listed exceptions.",
            ]
          : []),
      ],
      ...(replacement ? {replacement} : {}),
    }),
  );
  return { ...state, packets: [...state.packets, packet] };
}
// The same bytes are the handoff boundary for downloads and future simulated delivery.
export function serializePacket(packet: RecoveryPacket): string {
  packetSnapshotSchema.parse(packet);
  return JSON.stringify(packet, null, 2) + "\n";
}
