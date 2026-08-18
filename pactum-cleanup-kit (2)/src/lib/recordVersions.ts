/**
 * ══════════════════════════════════════════════════════════════════════
 * PACTUM · RECORD VERSION HISTORY
 * ══════════════════════════════════════════════════════════════════════
 *
 * Versions of RECORDS, not of files. PACTUM never stores a file — a
 * document is a URL to something living in Drive or SharePoint, and
 * versioning a link you do not own would be a fiction.
 *
 * What it versions is what it actually holds:
 *
 *     BL-024   Concrete   12,500,000  ->  13,200,000
 *
 * a budget line, a change order, a claim. Every edit captures the whole
 * record as it now stands, so any earlier state can be read back exactly
 * and two states can be compared field by field.
 *
 * RESTORE IS A NEW VERSION, NEVER A DELETION (rule 10).
 *
 *     v17, v18 exist.  Restore v17.  Result: v19, a copy of v17.
 *     v18 IS STILL THERE.
 *
 * Rolling back by deleting the thing you rolled back from destroys the
 * evidence of the mistake — and the mistake is usually the part worth
 * keeping. So a restore moves forward, and the history reads
 * v17 -> v18 -> v19(restored from v17), which is the truth.
 *
 * There is no update and no delete for a version. `snapshot()` appends
 * and that is the only writer.
 * ══════════════════════════════════════════════════════════════════════
 */

import type { ModuleKey } from './authz';

export interface RecordVersion {
  id: string;
  /** Which register this belongs to. */
  module: ModuleKey;
  /** The project the record lives under. '' for company-level records. */
  projectId: string;
  /** Stable identity of the record across versions, e.g. 'BL-024'. */
  recordId: string;
  /** 1-based, contiguous, per record. */
  version: number;
  /** The record as it stood, flattened to primitives. */
  data: Record<string, string | number | boolean | null>;
  modifiedBy: string;
  /** ISO timestamp. */
  modifiedAt: string;
  /** One line describing what moved. Written, not inferred. */
  changeSummary: string;
  /** Set when this version was produced by restoring an earlier one. */
  restoredFrom?: number;
}

const KEY = 'pactum-record-versions';

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function cleanData(v: any): RecordVersion['data'] {
  const out: RecordVersion['data'] = {};
  if (!v || typeof v !== 'object') return out;
  for (const k of Object.keys(v)) {
    const val = (v as any)[k];
    if (val === null) { out[k] = null; continue; }
    const t = typeof val;
    if (t === 'string' || t === 'number' || t === 'boolean') out[k] = val;
    // Anything structural is deliberately dropped: a version must be
    // comparable, and nested objects make a diff ambiguous.
  }
  return out;
}

function clean(v: any): RecordVersion | null {
  const id = str(v?.id).trim();
  const recordId = str(v?.recordId).trim();
  if (!id || !recordId) return null;
  return {
    id,
    module: str(v?.module) as ModuleKey,
    projectId: str(v?.projectId),
    recordId,
    version: Number(v?.version) || 1,
    data: cleanData(v?.data),
    modifiedBy: str(v?.modifiedBy) || 'unknown',
    modifiedAt: str(v?.modifiedAt),
    changeSummary: str(v?.changeSummary),
    restoredFrom: v?.restoredFrom === undefined ? undefined : Number(v.restoredFrom),
  };
}

export function readVersions(): RecordVersion[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(clean).filter((x): x is RecordVersion => x !== null);
  } catch {
    return [];
  }
}

function writeVersions(list: RecordVersion[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* quota */ }
}

/** Every version of one record, oldest first. */
export function historyOf(module: ModuleKey, projectId: string, recordId: string): RecordVersion[] {
  return readVersions()
    .filter(v => v.module === module && v.projectId === projectId && v.recordId === recordId)
    .sort((a, b) => a.version - b.version);
}

/** The newest version, or null when the record has never been captured. */
export function currentVersion(
  module: ModuleKey, projectId: string, recordId: string,
): RecordVersion | null {
  const h = historyOf(module, projectId, recordId);
  return h.length ? h[h.length - 1] : null;
}

export interface SnapshotInput {
  module: ModuleKey;
  projectId: string;
  recordId: string;
  data: Record<string, unknown>;
  modifiedBy: string;
  changeSummary?: string;
  restoredFrom?: number;
}

/**
 * Captures the record as it now stands. APPEND ONLY.
 *
 * When no summary is supplied, one is derived by diffing against the
 * previous version — so the history reads
 * `value 12,500,000 -> 13,200,000` rather than a bare "edited".
 */
export function snapshot(input: SnapshotInput): RecordVersion {
  const list = readVersions();
  const prior = list
    .filter(v => v.module === input.module && v.projectId === input.projectId
              && v.recordId === input.recordId)
    .sort((a, b) => a.version - b.version);
  const last = prior.length ? prior[prior.length - 1] : null;
  const data = cleanData(input.data);

  const summary = input.changeSummary
    || (last ? describeDiff(diff(last.data, data)) : 'created');

  const v: RecordVersion = {
    id: `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    module: input.module,
    projectId: input.projectId,
    recordId: input.recordId,
    version: last ? last.version + 1 : 1,
    data,
    modifiedBy: input.modifiedBy || 'unknown',
    modifiedAt: new Date().toISOString(),
    changeSummary: summary,
    restoredFrom: input.restoredFrom,
  };
  writeVersions([...list, v]);
  return v;
}

// ── Compare (rule 9) ───────────────────────────────────────────────────

export interface FieldDiff {
  field: string;
  status: 'added' | 'removed' | 'changed';
  before: string;
  after: string;
}

/** Field-by-field difference between two captured states. */
export function diff(
  a: RecordVersion['data'], b: RecordVersion['data'],
): FieldDiff[] {
  const keys = Array.from(new Set([...Object.keys(a || {}), ...Object.keys(b || {})])).sort();
  const out: FieldDiff[] = [];
  for (const k of keys) {
    const inA = a && Object.prototype.hasOwnProperty.call(a, k);
    const inB = b && Object.prototype.hasOwnProperty.call(b, k);
    const av = inA ? str(a[k]) : '';
    const bv = inB ? str(b[k]) : '';
    if (inA && !inB) out.push({ field: k, status: 'removed', before: av, after: '' });
    else if (!inA && inB) out.push({ field: k, status: 'added', before: '', after: bv });
    else if (av !== bv) out.push({ field: k, status: 'changed', before: av, after: bv });
  }
  return out;
}

/** Compares two version numbers of the same record. */
export function compare(
  module: ModuleKey, projectId: string, recordId: string, from: number, to: number,
): { from: RecordVersion | null; to: RecordVersion | null; changes: FieldDiff[] } {
  const h = historyOf(module, projectId, recordId);
  const a = h.find(v => v.version === from) || null;
  const b = h.find(v => v.version === to) || null;
  return { from: a, to: b, changes: a && b ? diff(a.data, b.data) : [] };
}

function fmt(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' ? n.toLocaleString('en-US') : v;
}

/** A one-line human summary of a diff. */
export function describeDiff(changes: FieldDiff[]): string {
  if (changes.length === 0) return 'no change';
  const first = changes[0];
  const head = first.status === 'changed'
    ? `${first.field} ${fmt(first.before)} → ${fmt(first.after)}`
    : `${first.field} ${first.status}`;
  return changes.length === 1 ? head : `${head} (+${changes.length - 1} more)`;
}

/**
 * Restores an earlier version by writing a NEW one that copies it.
 *
 * Nothing between is removed. `restoredFrom` marks the lineage so the
 * history can say "v19 — restored from v17" rather than presenting a
 * rollback as an ordinary edit.
 */
export function restoreVersion(
  module: ModuleKey, projectId: string, recordId: string,
  version: number, by: string, reason = '',
): { ok: boolean; version?: RecordVersion; reason?: string } {
  const h = historyOf(module, projectId, recordId);
  const src = h.find(v => v.version === version);
  if (!src) return { ok: false, reason: 'version-not-found' };
  const v = snapshot({
    module, projectId, recordId,
    data: src.data,
    modifiedBy: by,
    changeSummary: reason
      ? `restored from v${version} — ${reason}`
      : `restored from v${version}`,
    restoredFrom: version,
  });
  return { ok: true, version: v };
}
