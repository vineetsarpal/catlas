import Dexie, { type Table } from 'dexie';
import { sha256, type CapturedEvidence, type EvidenceManifest, type Investigation } from './model';
import { captureEvidence } from './evidence';
import { verifyInvestigation } from './investigation';

type CaseRow = { id: string; caseId: string; version: number; createdAt: string; value: Investigation; hash: string };
type EvidenceRow = { hash: string; rawText: string };
export class ExposureDatabase extends Dexie {
  cases!: Table<CaseRow, string>; evidence!: Table<EvidenceRow, string>;
  constructor(name = 'catlas-exposure-1') {
    super(name); this.version(1).stores({ cases: 'id,caseId,createdAt,[caseId+version]', evidence: 'hash' });
  }
}
export async function restoreEvidence(manifest: EvidenceManifest, rawXml: string, rawEventJson: string | null, investigationEventId = manifest.eventId): Promise<CapturedEvidence> {
  const { rawSha256, measure: _measure, units: _units, productVersion, processedAt, eventDetailUrl, eventDetailSha256, ...metadata } = manifest;
  if ((rawEventJson === null) !== (eventDetailSha256 === null) || (rawEventJson !== null && await sha256(rawEventJson) !== eventDetailSha256))
    throw new Error('Captured event detail integrity check failed.');
  if (rawEventJson !== null) {
    const detail = JSON.parse(rawEventJson.replace(/^\uFEFF/, ''));
    const sourceIds = new Set([detail.id, ...(typeof detail.properties?.ids === 'string' ? detail.properties.ids.split(',').filter(Boolean) : [])]);
    // The original supported packaged replay recorded a rounded observation.
    // Preserve that exact historical tuple only, never a general coordinate tolerance.
    const packagedReplay = rawSha256 === 'f4fbcf36e9098963ddc2ea82656974c268b50df5dfdb49b9bf9ffae72ea8e306' &&
      eventDetailSha256 === 'b50ed4fa2bf4e43b897db38c5881dcdd0628c242207d96e1146022304f45ec77' &&
      manifest.eventId === 'ci38457511' && manifest.magnitude === 7.1 && manifest.longitude === -117.5993 &&
      manifest.latitude === 35.7695 && manifest.occurredAt === '2019-07-06T03:19:53.000Z';
    if (!sourceIds.has(manifest.eventId) || !sourceIds.has(investigationEventId) ||
        (typeof detail.properties?.ids === 'string' && manifest.aliases.some(alias => !sourceIds.has(alias))) ||
        detail.properties?.mag !== manifest.magnitude || (!packagedReplay &&
        (detail.properties?.time !== Date.parse(manifest.occurredAt) || detail.geometry?.coordinates?.[0] !== manifest.longitude || detail.geometry?.coordinates?.[1] !== manifest.latitude)))
      throw new Error('Frozen evidence does not match its original event detail.');
    const products = detail.properties?.products?.shakemap;
    if (products !== undefined) {
      const selected = Array.isArray(products) ? products.find(product => product?.id === manifest.productId) : undefined;
      if (!selected || selected.source !== manifest.provider || manifest.retrospective !== selected.source.toLowerCase().includes('atlas') || selected.updateTime !== Date.parse(manifest.productUpdatedAt) ||
          selected.contents?.['download/grid.xml']?.url !== manifest.sourceUrl)
        throw new Error('Frozen evidence does not match its original product detail.');
    }
  }
  const restored = await captureEvidence(rawXml, metadata, rawSha256, rawEventJson !== null && eventDetailUrl ? { url: eventDetailUrl, text: rawEventJson } : undefined);
  if (restored.manifest.productVersion !== productVersion || restored.manifest.processedAt !== processedAt)
    throw new Error('Evidence version/processing metadata does not match the frozen grid.');
  return restored;
}
export class ExposureRepository {
  constructor(readonly db = new ExposureDatabase()) {}
  async list(): Promise<Investigation[]> {
    const rows = await this.db.cases.orderBy('createdAt').reverse().toArray();
    const result: Investigation[] = [];
    for (const row of rows) {
      if (row.hash !== await sha256(JSON.stringify(row.value))) throw new Error('Saved case integrity check failed. Saved records have been preserved.');
      const value = await verifyInvestigation(row.value);
      if (value.id !== row.id || value.caseId !== row.caseId || value.version !== row.version) throw new Error('Saved case identity is incompatible.');
      result.push(value);
    }
    return result;
  }
  async save(record: Investigation, evidence: CapturedEvidence | null): Promise<void> {
    const value = await verifyInvestigation(record), hash = await sha256(JSON.stringify(value));
    if (record.evidence) {
      if (!evidence || evidence.manifest.rawSha256 !== record.evidence.rawSha256 || await sha256(evidence.rawXml) !== record.evidence.rawSha256)
        throw new Error('The complete frozen evidence is required to save this case.');
      if ((record.evidence.eventDetailSha256 === null) !== (evidence.rawEventJson === null) ||
          (evidence.rawEventJson !== null && await sha256(evidence.rawEventJson) !== record.evidence.eventDetailSha256))
        throw new Error('The complete captured event detail is required to save this case.');
    }
    await this.db.transaction('rw', this.db.cases, this.db.evidence, async () => {
      const existing = await this.db.cases.get(value.id);
      if (existing && existing.hash !== hash) throw new Error('Saved investigation versions cannot be overwritten.');
      const sameVersion = await this.db.cases.where('[caseId+version]').equals([value.caseId, value.version]).first();
      if (sameVersion && sameVersion.id !== value.id) throw new Error('This case version already exists. Resume the latest version before revising.');
      if (record.evidence && evidence) {
        const old = await this.db.evidence.get(record.evidence.rawSha256);
        if (!old) await this.db.evidence.add({ hash: record.evidence.rawSha256, rawText: evidence.rawXml });
        if (record.evidence.eventDetailSha256 && evidence.rawEventJson !== null && !await this.db.evidence.get(record.evidence.eventDetailSha256))
          await this.db.evidence.add({ hash: record.evidence.eventDetailSha256, rawText: evidence.rawEventJson });
      }
      if (!existing) await this.db.cases.add({ id: value.id, caseId: value.caseId, version: value.version, createdAt: value.createdAt, value: structuredClone(value), hash });
    });
  }
  async evidenceFor(record: Investigation): Promise<CapturedEvidence | null> {
    if (!record.evidence) return null;
    const row = await this.db.evidence.get(record.evidence.rawSha256);
    if (!row) throw new Error('Saved case evidence is missing. The assessment is preserved; its map cannot be reconstructed.');
    const detail = record.evidence.eventDetailSha256 ? await this.db.evidence.get(record.evidence.eventDetailSha256) : undefined;
    return restoreEvidence(record.evidence, row.rawText, detail?.rawText ?? null, record.event.id);
  }
  async removeCase(caseId: string): Promise<void> {
    await this.db.transaction('rw', this.db.cases, this.db.evidence, async () => {
      await this.db.cases.where('caseId').equals(caseId).delete();
      const retained = new Set((await this.db.cases.toArray()).flatMap(r => [r.value.evidence?.rawSha256, r.value.evidence?.eventDetailSha256]));
      for (const row of await this.db.evidence.toArray()) if (!retained.has(row.hash)) await this.db.evidence.delete(row.hash);
    });
  }
}
export const exposureRepository = new ExposureRepository();
