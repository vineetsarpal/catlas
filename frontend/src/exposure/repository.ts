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
export async function restoreEvidence(manifest: EvidenceManifest, rawXml: string, rawEventJson: string | null): Promise<CapturedEvidence> {
  const { rawSha256, measure: _measure, units: _units, productVersion, processedAt, eventDetailUrl, eventDetailSha256, ...metadata } = manifest;
  if ((rawEventJson === null) !== (eventDetailSha256 === null) || (rawEventJson !== null && await sha256(rawEventJson) !== eventDetailSha256))
    throw new Error('Captured event detail integrity check failed.');
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
    return restoreEvidence(record.evidence, row.rawText, detail?.rawText ?? null);
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
