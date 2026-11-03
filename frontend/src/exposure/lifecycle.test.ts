import { describe, expect, it, vi } from 'vitest';
import { InvestigationLifecycle } from './lifecycle';
import { captureEvidence } from './evidence';
import { eventFromEvidence, investigate } from './investigation';
import { recoveryEventFromExposure } from './event-context';
import { demoPortfolio } from './fixtures';
import { encodeBundle } from './exports';
import type { EarthquakeCapture } from './capture';
import type { CapturedEvidence, Investigation } from './model';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture() {
  const xml = '<shakemap_grid event_id="x" shakemap_version="1" process_timestamp="2026-01-01T00:00:00"><event event_id="x"/><grid_specification nlon="2" nlat="2"/><grid_field name="LON" index="1" units="dd"/><grid_field name="LAT" index="2" units="dd"/><grid_field name="MMI" index="3" units="intensity"/><grid_data>0 1 6\n1 1 8\n0 0 4\n1 0 6</grid_data></shakemap_grid>';
  const evidence = await captureEvidence(xml, { eventId: 'x', aliases: [], eventName: 'Test earthquake', occurredAt: '2026-01-01T00:00:00.000Z', magnitude: 6, longitude: .5, latitude: .5, productId: 'product-x-1', provider: 'us', productUpdatedAt: '2026-01-01T01:00:00.000Z', capturedAt: '2026-01-01T02:00:00.000Z', sourceUrl: 'https://earthquake.usgs.gov/example.xml', retrospective: false });
  const event = eventFromEvidence(evidence);
  const portfolio = { ...demoPortfolio, locations: [{ ...demoPortfolio.locations[0], longitude: .5, latitude: .5 }] };
  const record = await investigate({ event, portfolio, evidence, threshold: 4 });
  return { evidence, event, portfolio, record, capture: { event, evidence, reason: null } satisfies EarthquakeCapture };
}
function setup(overrides: ConstructorParameters<typeof InvestigationLifecycle>[0] = {}) {
  const saved: { record: Investigation; evidence: CapturedEvidence | null }[] = [];
  const repository = {
    list: vi.fn(async () => saved.map(item => item.record)),
    save: vi.fn(async (record: Investigation, evidence: CapturedEvidence | null) => { saved.push({ record, evidence }); }),
    evidenceFor: vi.fn(async (record: Investigation) => saved.find(item => item.record.id === record.id)?.evidence ?? null),
    removeCase: vi.fn(async (id: string) => { saved.splice(0, saved.length, ...saved.filter(item => item.record.caseId !== id)); }),
  };
  const lifecycle = new InvestigationLifecycle({ repository, ...overrides });
  const disconnect = lifecycle.connect();
  return { lifecycle, repository, saved, disconnect };
}
const otherObservation = (event: Awaited<ReturnType<typeof fixture>>['event']) => recoveryEventFromExposure({ ...event, id: 'other' }, null);

describe('exposure investigation lifecycle through its caller interface', () => {
  it('inspects without assessing, creates unsaved immutable revisions, and saves paired evidence', async () => {
    const f = await fixture();
    const { lifecycle, repository } = setup({ capture: async () => f.capture });
    await lifecycle.inspect(f.event);
    expect(lifecycle.currentRecord()).toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
    await lifecycle.assessSelected({ portfolio: f.portfolio }, 4, true);
    const first = lifecycle.currentRecord()!;
    expect(first.summary.meetingThreshold).toBe(1);
    await lifecycle.revise({ threshold: 7 });
    const second = lifecycle.currentRecord()!;
    expect(second).toMatchObject({ version: 2, previousId: first.id, caseId: first.caseId });
    expect(first.settings.threshold).toBe(4);
    expect(second.summary.meetingThreshold).toBe(0);
    expect(repository.save).not.toHaveBeenCalled();
    await lifecycle.save();
    expect(repository.save).toHaveBeenCalledWith(second, f.evidence);
  });

  it('rejects overlapping commands immediately and discards capture results after selection changes', async () => {
    const f = await fixture(), pending = deferred<EarthquakeCapture>();
    const capture = vi.fn((_id: string, _signal?: AbortSignal) => pending.promise);
    const { lifecycle, repository } = setup({ capture });
    const work = lifecycle.inspect(f.event);
    await lifecycle.inspect('another');
    await lifecycle.save();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(repository.save).not.toHaveBeenCalled();
    lifecycle.selectObservation(otherObservation(f.event));
    expect(capture.mock.calls[0][1]?.aborted).toBe(true);
    pending.resolve(f.capture); await work;
    expect(lifecycle.getSnapshot().observation?.id).toBe('other');
    expect(lifecycle.getSnapshot().inspection).toBeNull();
    expect(lifecycle.getSnapshot().captures).toEqual([]);
    expect(lifecycle.getSnapshot().busy).toBe('');
  });

  it('rejects an assessment completion belonging to a previous selection', async () => {
    const f = await fixture(), pending = deferred<Investigation>();
    const { lifecycle } = setup({ assess: () => pending.promise });
    lifecycle.selectObservation(recoveryEventFromExposure(f.event, null));
    const work = lifecycle.assessSelected({ portfolio: f.portfolio }, 4);
    lifecycle.selectObservation(otherObservation(f.event));
    pending.resolve(f.record); await work;
    expect(lifecycle.getSnapshot().opened).toBeNull();
    expect(lifecycle.getSnapshot().observation?.id).toBe('other');
  });

  it('stages changed origin detail explicitly and preserves the opened version until applied', async () => {
    const f = await fixture();
    const changed = await captureEvidence(f.evidence.rawXml, f.evidence.manifest, undefined, { url: 'https://earthquake.usgs.gov/detail.json', text: JSON.stringify({ id: f.event.id, properties: { mag: f.event.magnitude, time: Date.parse(f.event.occurredAt), magType: 'mw' }, geometry: { coordinates: [f.event.longitude, f.event.latitude] } }) });
    const { lifecycle, saved } = setup({ check: async () => ({ ...f.capture, evidence: changed }) });
    saved.push({ record: f.record, evidence: f.evidence });
    await lifecycle.resume(f.record);
    await lifecycle.checkUpdate();
    expect(lifecycle.getSnapshot().pendingUpdate?.evidence).toBe(changed);
    expect(lifecycle.currentRecord()).toBe(f.record);
    await lifecycle.revise({ applyEvidence: true });
    expect(lifecycle.currentRecord()).toMatchObject({ version: 2, previousId: f.record.id, evidence: { eventDetailSha256: changed.manifest.eventDetailSha256 } });
    expect(f.record.evidence?.eventDetailSha256).toBeNull();
  });

  it('preserves verified captures and successful check time after a failed check', async () => {
    const f = await fixture();
    const check = vi.fn().mockResolvedValueOnce(f.capture).mockRejectedValueOnce(new Error('offline'));
    const { lifecycle, saved } = setup({ check });
    saved.push({ record: f.record, evidence: f.evidence });
    await lifecycle.resume(f.record); await lifecycle.checkUpdate();
    const successfulAt = lifecycle.getSnapshot().sourceCheck!.successfulAt;
    await lifecycle.checkUpdate();
    expect(lifecycle.getSnapshot().sourceCheck).toMatchObject({ successfulAt, failedAt: expect.any(String) });
    expect(lifecycle.getSnapshot().opened).toEqual({ record: f.record, evidence: f.evidence });
  });

  it('suppresses a late source update after event selection changes', async () => {
    const f = await fixture(), pending = deferred<EarthquakeCapture>();
    const { lifecycle, saved } = setup({ check: () => pending.promise });
    saved.push({ record: f.record, evidence: f.evidence });
    await lifecycle.resume(f.record);
    const work = lifecycle.checkUpdate();
    lifecycle.selectObservation(otherObservation(f.event));
    pending.resolve(f.capture); await work;
    expect(lifecycle.getSnapshot().pendingUpdate).toBeNull();
    expect(lifecycle.getSnapshot().sourceCheck).toBeNull();
    lifecycle.selectObservation(recoveryEventFromExposure(f.event, f.evidence));
    expect(lifecycle.currentRecord()).toBe(f.record);
  });

  it('finishes a started save and refreshes history without replacing a newer selection', async () => {
    const f = await fixture(), pending = deferred<void>();
    const { lifecycle, saved, repository } = setup();
    saved.push({ record: f.record, evidence: f.evidence });
    await lifecycle.resume(f.record); saved.length = 0;
    repository.save.mockImplementationOnce(async (record, evidence) => { await pending.promise; saved.push({ record, evidence }); });
    const work = lifecycle.save();
    lifecycle.selectObservation(otherObservation(f.event));
    pending.resolve(); await work;
    expect(repository.save).toHaveBeenCalledWith(f.record, f.evidence);
    expect(lifecycle.getSnapshot().history).toEqual([f.record]);
    expect(lifecycle.getSnapshot().observation?.id).toBe('other');
    expect(lifecycle.getSnapshot().notice).toBe('');
  });

  it('finishes import after selection changes but does not reopen it', async () => {
    const f = await fixture(), pending = deferred<{ record: Investigation; evidence: CapturedEvidence | null }>();
    const { lifecycle, repository } = setup({ decode: () => pending.promise });
    const work = lifecycle.importBundle(new Blob());
    lifecycle.selectObservation(otherObservation(f.event));
    pending.resolve({ record: f.record, evidence: f.evidence }); await work;
    expect(repository.save).toHaveBeenCalledWith(f.record, f.evidence);
    expect(lifecycle.getSnapshot().history).toEqual([f.record]);
    expect(lifecycle.getSnapshot().opened).toBeNull();
    expect(lifecycle.getSnapshot().observation?.id).toBe('other');
  });

  it('leaves the investigation usable after write failure and permits explicit retry', async () => {
    const f = await fixture();
    const { lifecycle, saved, repository } = setup();
    saved.push({ record: f.record, evidence: f.evidence });
    await lifecycle.resume(f.record); saved.length = 0;
    repository.save.mockRejectedValueOnce(new Error('Storage full'));
    await lifecycle.save();
    expect(lifecycle.getSnapshot().error).toBe('Storage full');
    expect(lifecycle.getSnapshot().opened).toEqual({ record: f.record, evidence: f.evidence });
    expect(lifecycle.getSnapshot().history).toEqual([]);
    await lifecycle.save();
    expect(lifecycle.getSnapshot().error).toBe('');
    expect(lifecycle.getSnapshot().history).toEqual([f.record]);
  });

  it('imports a real bundle and reopens frozen results without recalculation', async () => {
    const f = await fixture(), assess = vi.fn(investigate);
    const { lifecycle, repository } = setup({ assess });
    await lifecycle.importBundle(await encodeBundle(f.record, f.evidence));
    const imported = lifecycle.currentRecord()!;
    expect(imported).toEqual(f.record);
    lifecycle.selectObservation(otherObservation(f.event));
    await lifecycle.resume(imported);
    expect(lifecycle.currentRecord()).toEqual(f.record);
    expect(lifecycle.getSnapshot().opened?.evidence?.rawXml).toBe(f.evidence.rawXml);
    expect(repository.evidenceFor).toHaveBeenCalledWith(imported);
    expect(assess).not.toHaveBeenCalled();
  });

  it('does not publish pending reads after disconnection or reconnection', async () => {
    const f = await fixture(), pending = deferred<EarthquakeCapture>();
    const { lifecycle, disconnect } = setup({ capture: () => pending.promise });
    const work = lifecycle.inspect(f.event);
    disconnect();
    lifecycle.connect();
    const afterReconnect = lifecycle.getSnapshot();
    pending.resolve(f.capture); await work;
    expect(lifecycle.getSnapshot().inspection).toBe(afterReconnect.inspection);
    expect(lifecycle.getSnapshot().captures).toEqual([]);
  });

  it('keeps the public capture cache bounded and never stores portfolios there', async () => {
    const f = await fixture();
    const { lifecycle } = setup({ capture: async id => ({ ...f.capture, event: { ...f.event, id } }) });
    for (const id of ['one', 'two', 'three']) await lifecycle.inspect(id);
    expect(lifecycle.getSnapshot().captures.map(item => item.capture.event.id)).toEqual(['two', 'three']);
    expect(lifecycle.getSnapshot().opened).toBeNull();
  });

  it('retains verified evidence and its original check time after capture retrieval fails', async () => {
    const f = await fixture();
    const capture = vi.fn().mockResolvedValueOnce(f.capture).mockRejectedValueOnce(new Error('offline'));
    const { lifecycle } = setup({ capture });
    await lifecycle.inspect(f.event);
    const successfulAt = lifecycle.getSnapshot().inspectionCheck!.successfulAt;
    await lifecycle.inspect(f.event);
    expect(lifecycle.getSnapshot().inspection).toBe(f.capture);
    expect(lifecycle.getSnapshot().inspectionCheck).toMatchObject({ successfulAt, failedAt: expect.any(String) });
    expect(lifecycle.getSnapshot().inspectionReason).toContain('Retained verified evidence remains available');
  });

  it('a delayed resume cannot replace a more recently selected observation', async () => {
    const f = await fixture(), pending = deferred<CapturedEvidence | null>();
    const { lifecycle, repository } = setup();
    repository.evidenceFor.mockImplementationOnce(() => pending.promise);
    const work = lifecycle.resume(f.record);
    lifecycle.selectObservation(otherObservation(f.event));
    pending.resolve(f.evidence); await work;
    expect(lifecycle.getSnapshot().opened).toBeNull();
    expect(lifecycle.getSnapshot().observation?.id).toBe('other');
  });

  it('failed import preserves the opened investigation and creates no saved history entry', async () => {
    const f = await fixture();
    const { lifecycle, repository, saved } = setup();
    saved.push({ record: f.record, evidence: f.evidence });
    await lifecycle.resume(f.record);
    await lifecycle.importBundle(new Blob(['invalid bundle']));
    expect(lifecycle.getSnapshot().error).not.toBe('');
    expect(lifecycle.getSnapshot().opened).toEqual({ record: f.record, evidence: f.evidence });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('revision ancestry follows the latest saved version even when an older version is reopened', async () => {
    const f = await fixture();
    const latest = await investigate({ event: f.event, portfolio: f.portfolio, evidence: f.evidence, threshold: 5, previous: f.record });
    const { lifecycle, saved } = setup();
    saved.push({ record: f.record, evidence: f.evidence }, { record: latest, evidence: f.evidence });
    await lifecycle.resume(latest); await lifecycle.save();
    await lifecycle.resume(f.record); await lifecycle.revise({ threshold: 6 });
    expect(lifecycle.currentRecord()).toMatchObject({ version: 3, previousId: latest.id, caseId: f.record.caseId });
  });

  it('an old startup history read cannot overwrite history refreshed after saving', async () => {
    const f = await fixture(), startup = deferred<Investigation[]>();
    const repository = {
      list: vi.fn().mockImplementationOnce(() => startup.promise).mockResolvedValue([f.record]),
      evidenceFor: vi.fn(async () => f.evidence), save: vi.fn(async () => {}), removeCase: vi.fn(async () => {}),
    };
    const { lifecycle } = setup({ repository });
    await lifecycle.resume(f.record); await lifecycle.save();
    startup.resolve([]); await startup.promise;
    expect(lifecycle.getSnapshot().history).toEqual([f.record]);
  });

});
