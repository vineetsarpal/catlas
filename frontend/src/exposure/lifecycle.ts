import type { EventInput } from '../events/model';
import { ridgecrest } from '../events/fixtures';
import type { EarthquakeCapture } from './capture';
import { archiveEvidenceFailure, captureArchivedEarthquake, checkArchivedEarthquake } from './catalogue';
import { loadReplay } from './evidence';
import { earthquakeFromRecovery, recoveryEventFromExposure, sameObservation } from './event-context';
import { decodeBundle, encodeBundle } from './exports';
import { eventFromEvidence, investigate } from './investigation';
import type { CapturedEvidence, Earthquake, Investigation, Portfolio, PortfolioReference } from './model';
import { exposureRepository } from './repository';

type PortfolioInput = { portfolio: Portfolio; portfolioReference?: PortfolioReference; loading?: boolean };
type Check = { attemptedAt: string; successfulAt?: string; failedAt?: string };
type RetainedCapture = { capture: EarthquakeCapture; successfulAt: string };
export type InvestigationState = {
  observation: EventInput | null;
  opened: { record: Investigation; evidence: CapturedEvidence | null } | null;
  openRevision: number;
  openKind: 'assessment' | 'resume' | 'import' | null;
  history: Investigation[];
  inspectionActive: boolean;
  inspection: EarthquakeCapture | null;
  inspectionTarget: Earthquake | string | null;
  inspectionCheck: (Check & { id: string }) | null;
  inspectionReason: string;
  sourceCheck: (Check & { recordId: string; reason: string }) | null;
  pendingUpdate: EarthquakeCapture | null;
  captures: RetainedCapture[];
  busy: string;
  error: string;
  notice: string;
};
const defaults = {
  repository: exposureRepository,
  capture: captureArchivedEarthquake,
  check: checkArchivedEarthquake,
  replay: loadReplay,
  assess: investigate,
  decode: decodeBundle,
  encode: encodeBundle,
};
type Dependencies = Omit<typeof defaults, 'repository'> & {
  repository: Pick<typeof exposureRepository, 'list' | 'save' | 'evidenceFor' | 'removeCase'>;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)) || 'The investigation operation could not be completed.';

/** Owns investigation transitions; storage and capture adapters retain their integrity checks. */
export class InvestigationLifecycle {
  private state: InvestigationState = {
    observation: null, opened: null, openRevision: 0, openKind: null, history: [], inspectionActive: false,
    inspection: null, inspectionTarget: null, inspectionCheck: null, inspectionReason: '',
    sourceCheck: null, pendingUpdate: null, captures: [], busy: '', error: '', notice: '',
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private generation = 0;
  private connected = false;
  private operation: { controller: AbortController; generation: number } | null = null;
  private historyRevision = 0;
  private replayEvidence: CapturedEvidence | null = null;
  private dependencies: Dependencies;
  constructor(dependencies: Partial<Dependencies> = {}) { this.dependencies = { ...defaults, ...dependencies }; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<InvestigationState>) {
    if (!this.connected) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  /** Reconnectable for React's development effect replay. Late reads cannot publish after cleanup. */
  connect() {
    this.connected = true;
    const generation = ++this.generation;
    const historyRevision = this.historyRevision;
    void this.dependencies.repository.list().then(history => {
      if (this.connected && generation === this.generation && historyRevision === this.historyRevision) this.update({ history });
    }).catch(error => {
      if (this.connected && generation === this.generation) this.update({ error: `Local history: ${message(error)}` });
    });
    return () => {
      this.connected = false;
      this.generation++;
      this.epoch++;
      this.operation?.controller.abort();
    };
  }
  selectObservation = (observation: EventInput | null) => {
    this.epoch++;
    this.operation?.controller.abort();
    this.update({ observation, inspectionActive: false, inspection: null, inspectionTarget: null,
      inspectionCheck: null, inspectionReason: '', pendingUpdate: null, sourceCheck: null, notice: '', error: '' });
  };
  currentRecord() {
    const { opened, observation, inspectionActive } = this.state;
    return !inspectionActive && opened && sameObservation(observation, opened.record.event) ? opened.record : null;
  }
  matchingInspection() {
    const { observation, inspection } = this.state;
    return inspection && sameObservation(observation, inspection.event) ? inspection : null;
  }
  private async command<T>(label: string, work: (current: () => boolean, signal: AbortSignal) => Promise<T>, write = false): Promise<T | undefined> {
    if (!this.connected || this.operation) return;
    const operation = { controller: new AbortController(), generation: this.generation };
    this.operation = operation; // synchronous exclusion, before publishing or awaiting
    const epoch = this.epoch;
    const current = () => this.connected && epoch === this.epoch && operation.generation === this.generation;
    this.update({ busy: label, error: '', notice: '' });
    try { return await work(current, operation.controller.signal); }
    catch (error) { if (current() || (write && this.connected && operation.generation === this.generation)) this.update({ error: message(error) }); }
    finally {
      if (this.operation === operation) {
        this.operation = null;
        if (this.connected) this.update({ busy: '' });
      }
    }
  }
  private async refreshHistory() {
    const generation = this.operation?.generation;
    const revision = ++this.historyRevision;
    const history = await this.dependencies.repository.list();
    if (this.connected && generation === this.generation && revision === this.historyRevision) this.update({ history });
  }
  private remember(capture: EarthquakeCapture, successfulAt: string) {
    if (!capture.evidence) return;
    const identity = (item: EarthquakeCapture) => {
      const m = item.evidence!.manifest;
      return JSON.stringify([item.event.id, m.productId, m.productVersion, m.productUpdatedAt, m.rawSha256,
        m.eventDetailSha256, m.occurredAt, m.magnitude, m.longitude, m.latitude]);
    };
    this.update({ captures: [...this.state.captures.filter(item => identity(item.capture) !== identity(capture)), { capture, successfulAt }].slice(-2) });
  }
  private open(kind: NonNullable<InvestigationState['openKind']>, record: Investigation, evidence: CapturedEvidence | null, reason: string, notice: string, observation?: EventInput) {
    this.update({ opened: { record, evidence }, openKind: kind, openRevision: this.state.openRevision + 1,
      observation: observation ?? recoveryEventFromExposure(record.event, evidence), inspectionActive: false,
      inspection: { event: record.event, evidence, reason: record.unavailableReason }, inspectionTarget: null,
      inspectionCheck: null, inspectionReason: reason, pendingUpdate: null, sourceCheck: null, notice });
  }
  private async assess(event: Earthquake, evidence: CapturedEvidence | null, input: PortfolioInput, threshold: number,
    current: () => boolean, unavailableReason?: string, observation?: EventInput) {
    if (input.loading) throw new Error('Portfolios are still loading.');
    if (!input.portfolio.locations.length) throw new Error('Choose a portfolio with locations in Portfolio before investigating exposure.');
    const record = this.state.opened?.record;
    const previous = record ? [record, ...this.state.history.filter(item => item.caseId === record.caseId)].sort((a, b) => b.version - a.version)[0] : null;
    const next = await this.dependencies.assess({ event, evidence, ...input, threshold, unavailableReason, previous });
    if (current()) this.open('assessment', next, evidence, 'Captured evidence retained for this investigation.',
      'New investigation version is ready. Save it locally to retain it after refresh.', observation);
  }
  inspect(event: Earthquake | string) {
    // Selection is part of this command; a rejected overlapping command changes nothing.
    return this.command('Inspecting captured public evidence…', async (current, signal) => {
      const id = typeof event === 'string' ? event : event.id, attemptedAt = new Date().toISOString();
      const inspected = this.state.inspection;
      const cached = [...this.state.captures].reverse();
      const retained = inspected?.evidence && (inspected.event.id === id || inspected.evidence.manifest.aliases.includes(id))
        ? { capture: inspected, successfulAt: cached.find(item => item.capture.evidence?.manifest.rawSha256 === inspected.evidence?.manifest.rawSha256 && item.capture.evidence?.manifest.eventDetailSha256 === inspected.evidence?.manifest.eventDetailSha256)?.successfulAt }
        : cached.find(item => item.capture.event.id === id || item.capture.evidence?.manifest.aliases.includes(id));
      this.update({ inspectionActive: true, inspectionTarget: event, inspectionCheck: { id, attemptedAt, successfulAt: retained?.successfulAt },
        inspection: retained?.capture ?? null, pendingUpdate: null, sourceCheck: null,
        observation: retained ? recoveryEventFromExposure(retained.capture.event, retained.capture.evidence) : typeof event === 'string' ? null : recoveryEventFromExposure(event, null),
        inspectionReason: retained ? 'Checking public evidence; retained verified evidence remains inspectable.' : 'Retrieving available public evidence…' });
      try {
        const result = await this.dependencies.capture(id, signal), successfulAt = new Date().toISOString();
        if (!current()) return;
        this.remember(result, successfulAt);
        this.update({ inspection: result, observation: recoveryEventFromExposure(result.event, result.evidence),
          inspectionReason: result.reason ?? 'Original evidence verified. Assess explicitly to calculate portfolio exposure.', inspectionCheck: { id, attemptedAt, successfulAt } });
      } catch (error) {
        if (current()) this.update({ inspectionReason: `${archiveEvidenceFailure(error).message}${retained ? ' Retained verified evidence remains available with its original provenance; this failed check did not replace it.' : ''}`,
          inspectionCheck: { id, attemptedAt, successfulAt: retained?.successfulAt, failedAt: new Date().toISOString() } });
      }
    });
  }
  assessSelected(input: PortfolioInput, threshold: number, requireVerifiedCapture = false) {
    return this.command('Investigating selected earthquake…', async (current, signal) => {
      const observation = this.state.observation, event = earthquakeFromRecovery(observation), inspection = this.matchingInspection();
      if (!event || this.currentRecord() || !Number.isFinite(threshold) || threshold < 1 || threshold > 10) return;
      if ((requireVerifiedCapture || this.state.inspectionActive) && !inspection?.evidence) return;
      const packaged = observation?.id === ridgecrest.id && observation.magnitude === ridgecrest.magnitude && observation.provenance?.kind === 'historical';
      const evidence = inspection?.evidence ?? (packaged ? await this.replay(current, signal) : null);
      if (current()) await this.assess(inspection?.event ?? event, evidence, input, threshold, current,
        'No shaking evidence is attached to this selected observation. Capture supported USGS evidence to screen exposure.', observation ?? undefined);
    });
  }
  private async replay(current: () => boolean, signal: AbortSignal) {
    if (this.replayEvidence) return this.replayEvidence;
    const evidence = await this.dependencies.replay(signal);
    if (current()) this.replayEvidence = evidence;
    return evidence;
  }
  replayAssessment(input: () => Promise<PortfolioInput>, threshold: number) {
    return this.command('Loading frozen earthquake evidence…', async (current, signal) => {
      const portfolio = await input();
      if (!current()) return;
      const evidence = await this.replay(current, signal);
      if (current()) await this.assess(eventFromEvidence(evidence), evidence, portfolio, threshold, current);
    });
  }
  revise(options: { threshold?: number; portfolio?: PortfolioInput; applyEvidence?: boolean }) {
    return this.command(options.applyEvidence ? 'Applying captured evidence update…' : 'Creating revised investigation…', async current => {
      const record = this.currentRecord();
      if (!record) return;
      const capture = options.applyEvidence ? this.state.pendingUpdate : null;
      if (options.applyEvidence && !capture) return;
      await this.assess(capture?.event ?? record.event, capture?.evidence ?? this.state.opened!.evidence,
        options.portfolio ?? { portfolio: record.portfolio, portfolioReference: record.portfolioReference },
        options.threshold ?? record.settings.threshold, current, capture?.reason ?? record.unavailableReason ?? undefined);
    });
  }
  save() {
    return this.command('Saving this investigation locally…', async current => {
      const opened = this.state.opened;
      if (!opened || !this.currentRecord()) return;
      await this.dependencies.repository.save(opened.record, opened.evidence);
      await this.refreshHistory();
      if (current()) this.update({ notice: 'Investigation saved in this browser.' });
    }, true);
  }
  resume(record: Investigation) {
    return this.command('Opening the saved snapshot…', async current => {
      const evidence = await this.dependencies.repository.evidenceFor(record);
      if (current()) this.open('resume', record, evidence, 'Exact saved evidence reopened.', 'Exact saved assessment reopened. It has not been recalculated.');
    });
  }
  importBundle(file: Blob) {
    return this.command('Validating and opening the case bundle…', async current => {
      const imported = await this.dependencies.decode(file);
      // An explicit import completes its write even if selection changes during validation.
      await this.dependencies.repository.save(imported.record, imported.evidence);
      await this.refreshHistory();
      if (current()) this.open('import', imported.record, imported.evidence, 'Imported frozen evidence verified.', 'Case verified, saved locally and reopened from its frozen evidence.');
    }, true);
  }
  deleteCase() {
    return this.command('Deleting local case…', async current => {
      const record = this.currentRecord();
      if (!record) return;
      await this.dependencies.repository.removeCase(record.caseId);
      await this.refreshHistory();
      if (current()) this.update({ notice: 'The saved case versions were deleted locally. The current unsaved view remains open.' });
    }, true);
  }
  exportBundle() {
    return this.command('Preparing the self-contained case bundle…', async current => {
      const opened = this.state.opened;
      if (!opened || !this.currentRecord()) return;
      const blob = await this.dependencies.encode(opened.record, opened.evidence);
      return current() ? { record: opened.record, blob } : undefined;
    });
  }
  checkUpdate() {
    return this.command('Checking USGS for newer evidence…', async (current, signal) => {
      const record = this.currentRecord();
      if (!record) return;
      const attemptedAt = new Date().toISOString();
      const successfulAt = this.state.sourceCheck?.recordId === record.id ? this.state.sourceCheck.successfulAt : undefined;
      this.update({ sourceCheck: { recordId: record.id, attemptedAt, successfulAt, reason: 'Checking the public source. Retained verified evidence remains inspectable.' } });
      try {
        const result = await this.dependencies.check(record.event.id, signal);
        if (!current()) return;
        if (!result.evidence) {
          const reason = result.reason ?? 'No supported newer evidence is available. Saved evidence is unchanged.';
          this.update({ sourceCheck: { recordId: record.id, attemptedAt, successfulAt, failedAt: new Date().toISOString(), reason }, notice: reason });
          return;
        }
        this.remember(result, new Date().toISOString());
        const prior = record.evidence, next = result.evidence.manifest;
        const unchanged = prior && prior.rawSha256 === next.rawSha256 && prior.eventDetailSha256 === next.eventDetailSha256 && prior.productId === next.productId && prior.productVersion === next.productVersion && prior.productUpdatedAt === next.productUpdatedAt && prior.provider === next.provider && prior.sourceUrl === next.sourceUrl && prior.occurredAt === next.occurredAt && prior.magnitude === next.magnitude && prior.longitude === next.longitude && prior.latitude === next.latitude;
        const reason = unchanged ? 'No newer evidence found. This version is unchanged.' : 'Newer source evidence is available. Apply it explicitly to create a new investigation version.';
        this.update({ sourceCheck: { recordId: record.id, attemptedAt, successfulAt: new Date().toISOString(), reason }, notice: reason, pendingUpdate: unchanged ? null : result });
      } catch (error) {
        if (current()) this.update({ sourceCheck: { recordId: record.id, attemptedAt, successfulAt, failedAt: new Date().toISOString(), reason: `${archiveEvidenceFailure(error).message} Retained verified evidence remains inspectable; saved investigation unchanged.` } });
      }
    });
  }
}
