/**
 * ══════════════════════════════════════════════════════════════════════
 * PACTUM · SOURCE VERSIONING — THE FIVE SOURCES A BASELINE IS MADE OF
 * ══════════════════════════════════════════════════════════════════════
 *
 *     Budget · Cash Flow · EVM Planned · Claims · Change Orders
 *
 * Each one gets its OWN version line, with its OWN numbering. Budget V3,
 * Cash Flow V2, EVM Planned V4, Claims V2, Change Orders V7 is a
 * perfectly valid state, and a Baseline built from exactly those five is
 * Baseline V3. The numbers are NOT forced into step: a source that has
 * not changed has no reason to gain a version, and minting one so the
 * columns line up would be recording an event that never happened.
 *
 * LIFECYCLE
 *
 *     draft ──submit──> submitted ──approve──> approved ──> superseded
 *
 * There is no path backwards. An approved version is a historical
 * statement about what the project committed to, and a statement you can
 * edit afterwards is not a commitment.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT MAKES "IMMUTABLE" REAL HERE
 *
 * It is not a flag that callers are asked to respect. There is NO
 * function in this module that can change an approved version's
 * `snapshot`, `approvedAt`, `approvedBy` or `version`. `updateDraft`
 * refuses anything that is not a draft, `submitVersion` refuses anything
 * that is not a draft, and `approveVersion` refuses anything that is not
 * submitted. The only field that ever moves on an approved record is its
 * lifecycle tail — `status`, `supersededAt`, `supersededById` — which is
 * what makes it findable as HISTORY rather than mistakable for the
 * current plan. Its figures are passed through by reference and never
 * reconstructed.
 *
 * Editing an approved source therefore does not edit anything: it
 * creates the NEXT version as a draft, pointing back at the one it was
 * built to replace. Rule 3 and rule 4 hold by construction.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ══════════════════════════════════════════════════════════════════════
 * MIGRATION — NOTHING IS INVENTED
 *
 * Projects that already hold budget lines, cash rows, change orders,
 * claims and an EVM calendar do NOT get versions retro-fitted. No
 * approval that nobody gave, no date that nobody set, no user who was
 * never asked. Their live registers simply carry `kind: unversioned`
 * until a person presses "Create Version", and THAT capture becomes V1
 * Draft with today's date and the signed-in user — a fact, not a guess.
 *
 * Baselines approved before this module existed carry no `sourceRefs`.
 * They are reported as "pre-versioning baseline", never as "built from
 * V1", because they were not.
 * ══════════════════════════════════════════════════════════════════════
 *
 * STORAGE
 *
 *     pactum-srcver-{projectId}   ->   SourceVersionStore
 *
 * Registered in `PROJECT_STORAGE_KEYS` so disposal cannot orphan it, and
 * in `ARCHIVE_KEYS` so deleting a project does NOT destroy the signed
 * record of what was approved — decision ⑵=B. It goes only with
 * `purgeArchives: true`, an explicit act.
 *
 * WRITES ARE WHOLE-STORE AND SINGLE. Every mutation builds the entire
 * next store in memory and commits it with ONE `localStorage.setItem`,
 * the same shape that makes baseline activation atomic. There is no
 * window in which two versions of one source are approved.
 */

import { record as auditRecord } from './audit';
import type { ModuleKey, Role } from './authz';

// ── Shapes ─────────────────────────────────────────────────────────────

/** The six sources a Baseline Package is assembled from. Closed set. */
export type SourceKind =
  | 'contract' | 'budget' | 'cashflow' | 'evm-planned' | 'claims' | 'change-orders';

export const SOURCE_KINDS: SourceKind[] =
  ['contract', 'budget', 'cashflow', 'evm-planned', 'claims', 'change-orders'];

/**
 * ══════════════════════════════════════════════════════════════════════
 * WHICH SOURCES MAY BE VERSIONED WHILE EMPTY.
 *
 * "NO DATA is not ZERO" is the rule, and it still holds — but it cuts
 * BOTH ways, and the first implementation only applied one half of it.
 *
 * An empty BUDGET means nobody has entered the cost plan yet. Filing
 * that as an approved version would state the project committed to
 * spending nothing, which nobody said. Same for Cash Flow and the EVM
 * calendar. Those stay blocked.
 *
 * An empty CHANGE ORDER register means something entirely different:
 * there are no change orders. That is not missing data — it is a
 * complete and accurate statement of the commercial position, and on a
 * project at day one it is the ONLY true statement available. Refusing
 * to version it forced a false choice: either invent a dummy change
 * order, or never baseline the project at all.
 *
 * So an empty register is versionable for exactly the two sources where
 * emptiness is a FACT rather than an ABSENCE, and the version records
 * `rowCount: 0` with an explicit `emptyByDeclaration` marker so no later
 * reader can mistake "we declared none" for "nobody filled this in".
 * ══════════════════════════════════════════════════════════════════════
 */
export const EMPTY_IS_A_STATEMENT: Record<SourceKind, boolean> = {
  'contract':      false,  // empty = no contract data entered yet
  'budget':        false,  // empty = the cost plan is missing
  'cashflow':      false,  // empty = the funding plan is missing
  'evm-planned':   false,  // empty = no planned-value calendar exists
  'claims':        true,   // empty = there are no claims. A real answer.
  'change-orders': true,   // empty = there are no change orders. Ditto.
};

export const SOURCE_LABELS: Record<SourceKind, { en: string; ar: string }> = {
  'budget':        { en: 'Budget',         ar: 'الموازنة' },
  'contract':      { en: 'Contract',       ar: 'العقد' },
  'cashflow':      { en: 'Cash Flow',      ar: 'التدفق النقدي' },
  'evm-planned':   { en: 'EVM Planned',    ar: 'القيمة المكتسبة المخططة' },
  'claims':        { en: 'Claims',         ar: 'المطالبات' },
  'change-orders': { en: 'Change Orders',  ar: 'أوامر التغيير' },
};

/**
 * Exactly the four states the brief named. No fifth was added.
 *
 * A `rejected` state was DELIBERATELY not introduced: the specification
 * enumerated draft / submitted / approved / superseded, and inventing a
 * status changes the vocabulary every downstream reader has to learn.
 * An unwanted draft is replaced by the next capture, and the audit trail
 * still records that it existed.
 */
export type SourceStatus =
  'draft' | 'submitted' | 'approved' | 'superseded' | 'rejected';

export const SOURCE_STATUSES: SourceStatus[] =
  ['draft', 'submitted', 'approved', 'superseded', 'rejected'];

export const STATUS_LABELS: Record<SourceStatus, { en: string; ar: string }> = {
  'draft':      { en: 'Draft',      ar: 'مسودة' },
  'submitted':  { en: 'Submitted',  ar: 'مُقدَّمة' },
  'approved':   { en: 'Approved',   ar: 'معتمدة' },
  'superseded': { en: 'Superseded', ar: 'مُستبدَلة' },
  'rejected':   { en: 'Rejected',   ar: 'مرفوضة' },
};

/**
 * One version of one source.
 *
 * `snapshot` is the register AS IT STOOD, stored verbatim. It is never
 * re-derived on read: the entire purpose of a version is to answer "what
 * did this look like when it was approved", and a value recomputed at
 * display time cannot answer that question.
 */
export interface SourceVersion {
  id: string;
  projectId: string;
  kind: SourceKind;
  /** 1-based, per KIND. Budget V3 and Claims V2 coexist by design. */
  version: number;
  /**
   * The attempt number under this version.
   *
   *     V2 submitted -> REJECTED
   *     next attempt -> V2 Rev 1     (not V3)
   *     approved     -> V2 settled, next plan is V3
   *
   * A version names a PLAN; a revision names an ATTEMPT to get it
   * approved. 0 on a first attempt.
   */
  revision: number;
  status: SourceStatus;

  /** The captured register. Array for the four row registers, object for EVM. */
  snapshot: unknown;
  /**
   * Stable fingerprint of `snapshot`. Lets the UI say "the live register
   * has moved since V2 was approved" without diffing the whole payload,
   * and lets a test prove an approved snapshot never changed.
   */
  digest: string;
  /** Rows in the snapshot. 0 for a non-array snapshot. */
  rowCount: number;
  /**
   * TRUE when this version was captured from a legitimately EMPTY
   * register — "there are no change orders", declared as a fact.
   *
   * It exists so that a zero can never be read as a gap. A version with
   * `rowCount: 0` and this flag says somebody looked and there was
   * nothing; a zero without it would be indistinguishable from data
   * that was never entered. Only ever set for the kinds in
   * `EMPTY_IS_A_STATEMENT`.
   */
  emptyByDeclaration: boolean;

  createdAt: string;
  createdBy: string;
  submittedAt: string;
  submittedBy: string;
  /**
   * How many times this version has been submitted. 2 means it was sent
   * for review, RETURNED for revision, and sent again — a round trip
   * that a single `submittedAt` cannot express. Distinct from
   * `revision`, which counts REFUSALS.
   */
  submissionCount: number;
  approvedAt: string;
  approvedBy: string;

  /** Version number this one was built to replace. null on V1. */
  supersedesVersion: number | null;
  /** Set when a later version takes over. */
  supersededAt: string;
  supersededById: string;

  /** Free text the author wrote. Never generated. */
  note: string;
  schema: number;
}

export interface SourceVersionStore {
  versions: SourceVersion[];
}

/**
 * Which approved source version each of the five slots was bound to when
 * a Baseline Package was built. Stored INSIDE the package, so opening a
 * baseline five years from now shows the exact inputs it was made of.
 *
 * `null` means "no approved version existed for this source when the
 * package was built" — a pre-versioning baseline. It is not zero and it
 * is not V0; it is the absence of a record, and it renders as such.
 */
export interface SourceRefs {
  contract: SourceRef | null;
  budget: SourceRef | null;
  cashflow: SourceRef | null;
  evmPlanned: SourceRef | null;
  claims: SourceRef | null;
  changeOrders: SourceRef | null;
}

export interface SourceRef {
  id: string;
  version: number;
  approvedAt: string;
  approvedBy: string;
  digest: string;
}

export const SOURCE_SCHEMA = 1;

export const EMPTY_SOURCE_VERSIONS: SourceVersionStore = { versions: [] };

export const SRCVER_KEY = (projectId: string) => `pactum-srcver-${projectId}`;

/** Which live register each source is captured from. */
export const LIVE_KEY: Record<SourceKind, (p: string) => string> = {
  // The contract's live register is the PROJECT RECORD inside the shared
  // projects store — readLiveSource special-cases it to extract one project.
  'contract':      () => 'pactum-projects',
  'budget':        p => `pactum-budget-${p}`,
  'cashflow':      p => `pactum-cashflow-${p}`,
  'evm-planned':   p => `pactum-evm-${p}`,
  'claims':        p => `pactum-claims-${p}`,
  'change-orders': p => `pactum-co-${p}`,
};

/** Audit module each source reports under. Reuses the existing keys. */
const AUDIT_MODULE: Record<SourceKind, ModuleKey> = {
  'contract': 'baseline',
  'budget': 'budget',
  'cashflow': 'cashflow',
  'evm-planned': 'evm',
  'claims': 'claims',
  'change-orders': 'changes',
};

// ── Primitives ─────────────────────────────────────────────────────────

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * FNV-1a over the canonical JSON of the snapshot.
 *
 * NOT a security hash and not presented as one. It exists to answer one
 * question cheaply and deterministically: "is this byte-for-byte what it
 * was?" Object key ORDER is normalised first, because `ClaimsModule`
 * reloads rows through `map(r => ({ timeDays: 0, ...r }))` and that
 * changes key order without changing a single value — a digest that
 * moved on a re-read would report a change nobody made.
 */
export function digestOf(snapshot: unknown): string {
  const canon = canonical(snapshot);
  const s = JSON.stringify(canon);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `f${h.toString(16).padStart(8, '0')}-${s.length.toString(36)}`;
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    Object.keys(src).sort().forEach(k => { out[k] = canonical(src[k]); });
    return out;
  }
  return v;
}

function rowsOf(snapshot: unknown): number {
  return Array.isArray(snapshot) ? snapshot.length : 0;
}

// ── Storage ────────────────────────────────────────────────────────────

function cleanVersion(r: any, i: number): SourceVersion | null {
  const kind = r?.kind as SourceKind;
  if (!SOURCE_KINDS.includes(kind)) return null;
  const version = num(r?.version) || i + 1;
  // Absent before rejection-revisions existed. 0 = it was a first attempt.
  const revision = num(r?.revision);
  const status: SourceStatus =
    SOURCE_STATUSES.includes(r?.status) ? r.status : 'draft';
  const snapshot = r?.snapshot === undefined ? null : r.snapshot;
  return {
    id: str(r?.id) || `sv-${kind}-v${version}-${i}`,
    projectId: str(r?.projectId),
    kind,
    version,
    revision,
    status,
    snapshot,
    // Recomputed from the snapshot it is carrying, so a stored digest
    // can never claim a payload it does not describe.
    digest: digestOf(snapshot),
    rowCount: rowsOf(snapshot),
    // Recomputed rather than trusted: a stored flag claiming an empty
    // declaration on a snapshot that has rows would be a contradiction.
    emptyByDeclaration: Array.isArray(snapshot) && snapshot.length === 0
      && !!EMPTY_IS_A_STATEMENT[kind],
    createdAt: str(r?.createdAt),
    createdBy: str(r?.createdBy),
    submittedAt: str(r?.submittedAt),
    submittedBy: str(r?.submittedBy),
    // Absent before returns existed. A version carrying a submittedAt
    // was submitted at least once; one without was never submitted.
    submissionCount: num(r?.submissionCount) || (str(r?.submittedAt) ? 1 : 0),
    approvedAt: str(r?.approvedAt),
    approvedBy: str(r?.approvedBy),
    supersedesVersion:
      r?.supersedesVersion === null || r?.supersedesVersion === undefined
        ? null : num(r.supersedesVersion),
    supersededAt: str(r?.supersededAt),
    supersededById: str(r?.supersededById),
    note: str(r?.note),
    schema: num(r?.schema) || SOURCE_SCHEMA,
  };
}

export function readSourceVersions(projectId: string): SourceVersionStore {
  if (!projectId) return { versions: [] };
  try {
    const raw = localStorage.getItem(SRCVER_KEY(projectId));
    if (!raw) return { versions: [] };
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.versions) ? parsed.versions : [];
    return {
      versions: list
        .map((r: any, i: number) => cleanVersion(r, i))
        .filter((v: SourceVersion | null): v is SourceVersion => v !== null),
    };
  } catch {
    // A corrupted store must not take the screen down, and must not be
    // silently rewritten either — this returns empty for THIS read only.
    return { versions: [] };
  }
}

/** ONE setitem. Every mutation below routes through here. */
export function writeSourceVersions(
  projectId: string, store: SourceVersionStore,
): void {
  if (!projectId) return;
  try {
    localStorage.setItem(SRCVER_KEY(projectId), JSON.stringify(store));
  } catch { /* quota — the caller's in-memory result still reports truth */ }
}

// ── Queries (pure) ─────────────────────────────────────────────────────

/** Every version of one source, oldest first. */
export function versionsOf(
  store: SourceVersionStore, kind: SourceKind,
): SourceVersion[] {
  return (store.versions || [])
    .filter(v => v.kind === kind)
    .slice()
    .sort((a, b) => a.version - b.version);
}

/** The highest-numbered version of a source, whatever its status. */
export function latestOf(
  store: SourceVersionStore, kind: SourceKind,
): SourceVersion | null {
  const list = versionsOf(store, kind);
  return list.length ? list[list.length - 1] : null;
}

/** The approved version in force. Null when none has been approved. */
export function approvedOf(
  store: SourceVersionStore, kind: SourceKind,
): SourceVersion | null {
  const approved = versionsOf(store, kind).filter(v => v.status === 'approved');
  if (!approved.length) return null;
  return approved.reduce((a, b) => (b.version > a.version ? b : a));
}

/** The open draft for a source, if one exists. At most one is allowed. */
export function draftOf(
  store: SourceVersionStore, kind: SourceKind,
): SourceVersion | null {
  return versionsOf(store, kind).find(v => v.status === 'draft') || null;
}

/** The submitted version awaiting a decision, if any. */
export function submittedOf(
  store: SourceVersionStore, kind: SourceKind,
): SourceVersion | null {
  return versionsOf(store, kind).find(v => v.status === 'submitted') || null;
}

/**
 * A draft or a submitted version — the one thing blocking a new capture.
 * Only one line of work per source may be open at a time; two competing
 * drafts would make "the next version" ambiguous.
 */
export function openOf(
  store: SourceVersionStore, kind: SourceKind,
): SourceVersion | null {
  // A REJECTED version is not open work. It is a closed attempt, and it
  // must not block the next one — that is the whole point of retrying
  // as V2 Rev 1.
  return draftOf(store, kind) || submittedOf(store, kind);
}

export function versionById(
  store: SourceVersionStore, id: string,
): SourceVersion | null {
  return (store.versions || []).find(v => v.id === id) || null;
}

/**
 * The version number the next capture of this source should carry.
 *
 * A number is CONSUMED only when a version under it was APPROVED (or
 * superseded, which means it was approved once). A rejected V2 is
 * retried as V2 Rev 1 — the history must not read V1, V3, V6 with holes
 * nobody can account for.
 */
export function nextVersionNumber(
  store: SourceVersionStore, kind: SourceKind,
): number {
  const list = versionsOf(store, kind);
  if (list.length === 0) return 1;
  const highest = list.reduce((m, v) => Math.max(m, num(v.version)), 0);
  const settled = list.some(v =>
    num(v.version) === highest
    && (v.status === 'approved' || v.status === 'superseded'));
  return settled ? highest + 1 : highest;
}

/** The attempt number for the next capture under this version. */
export function nextRevisionNumber(
  store: SourceVersionStore, kind: SourceKind, version: number,
): number {
  const attempts = versionsOf(store, kind).filter(v => num(v.version) === version);
  if (attempts.length === 0) return 0;
  return attempts.reduce((m, v) => Math.max(m, num(v.revision)), 0) + 1;
}

/**
 * The human label for one source version. THE ONLY PLACE IT IS BUILT.
 *
 *     V2         a first attempt
 *     V2 Rev 1   the attempt after V2 was rejected once
 */
export function versionLabel(v: { version: number; revision?: number }): string {
  const rev = num(v?.revision);
  return rev > 0 ? `V${num(v?.version)} Rev ${rev}` : `V${num(v?.version)}`;
}

// ── Live capture ───────────────────────────────────────────────────────

/**
 * Reads a live register exactly as its owning module stores it.
 *
 * Nothing is normalised, filtered or totalled. A version is a copy of
 * what was there; interpreting it here would mean the snapshot and the
 * screen could disagree about what "the budget" was.
 */
/**
 * CONTRACT live read — the contract's "register" is the project record
 * itself, inside the shared projects store. Extracts only the commercial
 * identity fields a contract baseline freezes. Returns null when the
 * project has no contract data at all (blocked as an empty snapshot).
 */
function readContractLive(projectId: string): unknown {
  try {
    const raw = localStorage.getItem('pactum-projects');
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    const p = arr.find((x: any) => x && x.id === projectId);
    if (!p) return null;
    const snap = {
      code: typeof p.code === 'string' ? p.code : '',
      nameEn: typeof p.nameEn === 'string' ? p.nameEn : '',
      contractValue: typeof p.contractValue === 'number' ? p.contractValue : null,
      commencementDate: typeof p.commencementDate === 'string' && p.commencementDate ? p.commencementDate : null,
      contractualCompletion: typeof p.contractualCompletion === 'string' && p.contractualCompletion ? p.contractualCompletion : null,
      approvedCompletion: typeof p.approvedCompletion === 'string' && p.approvedCompletion ? p.approvedCompletion : null,
    };
    const hasAnything =
      snap.contractValue !== null ||
      snap.commencementDate !== null ||
      snap.contractualCompletion !== null;
    return hasAnything ? snap : null;
  } catch {
    return null;
  }
}

/**
 * BRIDGE — EVM period sign-off files an approved EVM Planned version.
 *
 * Approving a period in the EVM screen is an approval ACT; this files it
 * as the source version the Baseline system reads, so cards, package lag
 * and gates move the moment a period is signed. If an open draft/submitted
 * version exists it is carried through; otherwise a fresh version is
 * captured from the live EVM store first. Returns false silently when the
 * live store is empty (nothing to version).
 */
export function syncEvmPlannedApproval(projectId: string, actor: Actor): boolean {
  if (!projectId) return false;
  const store = readSourceVersions(projectId);
  const open = openOf(store, 'evm-planned');
  let versionId: string | null;

  if (open) {
    versionId = open.id;
    if (open.status === 'draft') {
      const sub = submitVersion({ projectId, versionId, actor });
      if (!sub.ok) return false;
    }
  } else {
    const created = createVersion({ projectId, kind: 'evm-planned', actor });
    if (!created.ok) return false;
    const drafts = created.store.versions.filter(v => v.kind === 'evm-planned' && v.status === 'draft');
    versionId = drafts.length ? drafts[drafts.length - 1].id : null;
    if (!versionId) return false;
    const sub = submitVersion({ projectId, versionId, actor });
    if (!sub.ok) return false;
  }

  const app = approveVersion({ projectId, versionId, actor });
  return app.ok;
}

export function readLiveSource(projectId: string, kind: SourceKind): unknown {
  // The contract lives in the shared projects store, not a per-project key.
  if (kind === 'contract') return readContractLive(projectId);
  try {
    const raw = localStorage.getItem(LIVE_KEY[kind](projectId));
    if (raw === null) return kind === 'evm-planned' ? null : [];
    return JSON.parse(raw);
  } catch {
    return kind === 'evm-planned' ? null : [];
  }
}

export interface DivergenceReport {
  kind: SourceKind;
  /** Has this source ever been versioned? */
  versioned: boolean;
  approvedVersion: number | null;
  approvedDigest: string;
  liveDigest: string;
  /** True when the live register no longer matches the approved version. */
  diverged: boolean;
  /** There is an open draft or submitted version for this source. */
  openVersion: number | null;
  openStatus: SourceStatus | null;
}

/**
 * Does the live register still match what was approved?
 *
 * This is the signal that tells a user a NEW version is needed. It never
 * acts on its own: nothing is auto-captured, auto-submitted or
 * auto-approved. Rule 5 — no silent mutation — includes the mutation a
 * helpful system performs on your behalf.
 */
export function divergenceOf(
  projectId: string, kind: SourceKind, store?: SourceVersionStore,
): DivergenceReport {
  const s = store ?? readSourceVersions(projectId);
  const approved = approvedOf(s, kind);
  const open = openOf(s, kind);
  const liveDigest = digestOf(readLiveSource(projectId, kind));
  return {
    kind,
    versioned: versionsOf(s, kind).length > 0,
    approvedVersion: approved ? approved.version : null,
    approvedDigest: approved ? approved.digest : '',
    liveDigest,
    diverged: !!approved && approved.digest !== liveDigest,
    openVersion: open ? open.version : null,
    openStatus: open ? open.status : null,
  };
}

export function divergenceReport(projectId: string): DivergenceReport[] {
  const store = readSourceVersions(projectId);
  return SOURCE_KINDS.map(k => divergenceOf(projectId, k, store));
}

// ── Mutations ──────────────────────────────────────────────────────────

export type SourceRefusal =
  | 'no-project'
  | 'unknown-kind'
  | 'not-found'
  | 'open-version-exists'
  | 'not-a-draft'
  | 'not-submitted'
  | 'approved-immutable'
  | 'already-rejected'
  | 'nothing-to-reject'
  | 'not-submitted-cannot-return'
  | 'empty-snapshot';

export interface SourceResult {
  store: SourceVersionStore;
  ok: boolean;
  reason?: SourceRefusal;
  version?: SourceVersion;
}

interface Actor {
  userId: string;
  role?: Role | '';
}

function auditSource(
  actor: Actor, action: 'create' | 'edit' | 'submit' | 'approve' | 'review',
  v: SourceVersion, before: string, after: string, reason: string,
): void {
  auditRecord({
    actorUserId: actor.userId || 'unknown',
    actorRole: actor.role ?? '',
    action,
    module: AUDIT_MODULE[v.kind],
    scopeType: 'project',
    scopeId: v.projectId,
    targetId: `${v.kind}:${v.id}`,
    before,
    after,
    reason,
    version: v.version,
  });
}

/**
 * Captures the live register as the NEXT version, in DRAFT.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS IS THE ONLY WAY A VERSION IS BORN, AND IT IS ALWAYS A DRAFT.
 *
 * Not approved, not submitted. The person who captures the numbers and
 * the person who commits the project to them are different decisions
 * even when they are the same human, and collapsing them is how a
 * plan gets approved by accident.
 *
 * The previous approved version is NOT touched. It is read for exactly
 * one thing — its number, so `supersedesVersion` can record what this
 * draft was built to replace. That lineage is a fact about the attempt
 * and survives even if the draft is never approved.
 * ══════════════════════════════════════════════════════════════════════
 */
export function createVersion(input: {
  projectId: string;
  kind: SourceKind;
  actor: Actor;
  note?: string;
  /** Omit to capture the live register. Supplied only by tests and imports. */
  snapshot?: unknown;
}): SourceResult {
  const { projectId, kind } = input;
  if (!projectId) return { store: { versions: [] }, ok: false, reason: 'no-project' };
  const store = readSourceVersions(projectId);
  if (!SOURCE_KINDS.includes(kind)) {
    return { store, ok: false, reason: 'unknown-kind' };
  }
  // One open line of work per source. A second draft would make "the
  // next version" ambiguous and let two people approve different things.
  if (openOf(store, kind)) {
    return { store, ok: false, reason: 'open-version-exists' };
  }

  const snapshot = input.snapshot === undefined
    ? readLiveSource(projectId, kind)
    : input.snapshot;

  /**
   * NO DATA is not ZERO — applied in BOTH directions.
   *
   * For Budget, Cash Flow and the EVM calendar an empty register is a
   * MISSING PLAN, and versioning it would claim a commitment nobody
   * made. Blocked.
   *
   * For Change Orders and Claims an empty register is a COMPLETE
   * ANSWER — there are none — and on a new project it is the only true
   * one available. Allowed, and marked so the zero can never be misread
   * as a gap.
   */
  const isEmpty = snapshot === null || snapshot === undefined
    || (Array.isArray(snapshot) && snapshot.length === 0);
  const declarable = !!EMPTY_IS_A_STATEMENT[kind] && Array.isArray(snapshot);
  if (isEmpty && !declarable) {
    return { store, ok: false, reason: 'empty-snapshot' };
  }

  const prior = approvedOf(store, kind);
  const version = nextVersionNumber(store, kind);
  // Reusing a version that was never approved makes this its next
  // REVISION, not a new plan.
  const revision = nextRevisionNumber(store, kind, version);
  const now = new Date().toISOString();

  const v: SourceVersion = {
    id: `sv-${kind}-v${version}r${revision}-${Date.now()}`,
    projectId,
    kind,
    version,
    revision,
    status: 'draft',
    snapshot,
    digest: digestOf(snapshot),
    rowCount: rowsOf(snapshot),
    emptyByDeclaration: isEmpty && declarable,
    createdAt: now,
    createdBy: input.actor.userId || 'unknown',
    submittedAt: '',
    submittedBy: '',
    submissionCount: 0,
    approvedAt: '',
    approvedBy: '',
    supersedesVersion: prior ? prior.version : null,
    supersededAt: '',
    supersededById: '',
    note: (input.note ?? '').trim(),
    schema: SOURCE_SCHEMA,
  };

  const next: SourceVersionStore = { versions: [...store.versions, v] };
  writeSourceVersions(projectId, next);
  auditSource(input.actor, 'create', v,
    prior ? `${SOURCE_LABELS[kind].en} ${versionLabel(prior)} approved` : '',
    `${SOURCE_LABELS[kind].en} ${versionLabel(v)} draft`, v.note);
  return { store: next, ok: true, version: v };
}

/**
 * Re-captures the live register INTO AN EXISTING DRAFT.
 *
 * Acceptance test A: editing a draft leaves it V1 Draft. It does not
 * mint V2, because a draft that has never been approved has nothing to
 * supersede — the version number counts COMMITMENTS, not keystrokes.
 *
 * Refused for submitted, approved and superseded. There is no argument
 * that switches that off.
 */
export function updateDraft(input: {
  projectId: string;
  versionId: string;
  actor: Actor;
  note?: string;
  snapshot?: unknown;
}): SourceResult {
  const { projectId, versionId } = input;
  const store = readSourceVersions(projectId);
  const i = store.versions.findIndex(v => v.id === versionId);
  if (i < 0) return { store, ok: false, reason: 'not-found' };

  const cur = store.versions[i];
  if (cur.status === 'approved' || cur.status === 'superseded') {
    // Named separately from `not-a-draft` so the UI can say WHY, and so
    // a test can prove the approved path is refused for the right reason.
    return { store, ok: false, reason: 'approved-immutable' };
  }
  // A rejected attempt is closed. It is not edited back to life — the
  // next attempt is a NEW record at the next revision, so the refusal
  // and the record of it both survive.
  if (cur.status === 'rejected') return { store, ok: false, reason: 'already-rejected' };
  if (cur.status !== 'draft') return { store, ok: false, reason: 'not-a-draft' };

  const snapshot = input.snapshot === undefined
    ? readLiveSource(projectId, cur.kind)
    : input.snapshot;
  // Same rule as capture: emptiness is a statement for CO/Claims and an
  // absence everywhere else.
  const isEmpty = snapshot === null || snapshot === undefined
    || (Array.isArray(snapshot) && snapshot.length === 0);
  const declarable = !!EMPTY_IS_A_STATEMENT[cur.kind] && Array.isArray(snapshot);
  if (isEmpty && !declarable) {
    return { store, ok: false, reason: 'empty-snapshot' };
  }

  const updated: SourceVersion = {
    ...cur,
    snapshot,
    digest: digestOf(snapshot),
    rowCount: rowsOf(snapshot),
    emptyByDeclaration: isEmpty && declarable,
    note: input.note === undefined ? cur.note : input.note.trim(),
  };
  const versions = store.versions.slice();
  versions[i] = updated;
  const next: SourceVersionStore = { versions };
  writeSourceVersions(projectId, next);
  auditSource(input.actor, 'edit', updated,
    `${cur.digest} · ${cur.rowCount} rows`,
    `${updated.digest} · ${updated.rowCount} rows`,
    updated.note);
  return { store: next, ok: true, version: updated };
}

/** draft -> submitted. The capture is finished; the decision is not. */
export function submitVersion(input: {
  projectId: string; versionId: string; actor: Actor; note?: string;
}): SourceResult {
  const { projectId, versionId } = input;
  const store = readSourceVersions(projectId);
  const i = store.versions.findIndex(v => v.id === versionId);
  if (i < 0) return { store, ok: false, reason: 'not-found' };
  const cur = store.versions[i];
  if (cur.status === 'approved' || cur.status === 'superseded') {
    return { store, ok: false, reason: 'approved-immutable' };
  }
  if (cur.status === 'rejected') return { store, ok: false, reason: 'already-rejected' };
  if (cur.status !== 'draft') return { store, ok: false, reason: 'not-a-draft' };

  /**
   * A RESUBMISSION after a return is still a submission of the SAME
   * version. It does not advance the number and does not create a
   * revision — the plan was handed back, not refused. The audit trail
   * is what distinguishes the two events, and it holds both.
   */
  const resubmission = (store.versions[i].submissionCount || 0) > 0;

  const updated: SourceVersion = {
    ...cur,
    status: 'submitted',
    submittedAt: new Date().toISOString(),
    submittedBy: input.actor.userId || 'unknown',
    submissionCount: (cur.submissionCount || 0) + 1,
    note: input.note === undefined ? cur.note : input.note.trim(),
  };
  const versions = store.versions.slice();
  versions[i] = updated;
  const next: SourceVersionStore = { versions };
  writeSourceVersions(projectId, next);
  auditSource(input.actor, 'submit', updated, 'draft',
    resubmission
      ? `submitted (attempt ${updated.submissionCount})`
      : 'submitted',
    updated.note);
  return { store: next, ok: true, version: updated };
}

/**
 * RETURNS a submitted version to its author for another attempt.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE THIRD ANSWER A REVIEWER NEEDS.
 *
 * Once submitted, there were only two ways out: approve it, or reject
 * it outright. That forced a false choice. Most review comments are not
 * "this plan is wrong, abandon it" — they are "fix the cash-out line
 * and send it back". Rejecting for that buries a live piece of work
 * under a permanent refusal, and approving it commits the project to
 * figures the reviewer just said were wrong.
 *
 *     submitted --approve--> approved       committed
 *     submitted --reject---> rejected       closed, V2 Rev 1 next
 *     submitted --return---> draft          SAME version, same revision
 *
 * RETURNING IS NOT REJECTING, so it does NOT create a revision. The
 * version goes back to being the draft it was a moment ago and the
 * author edits it in place. A revision number counts REFUSED ATTEMPTS;
 * a returned submission was never refused, it was handed back.
 *
 * THE SUBMISSION STAMPS ARE CLEARED, and that is deliberate. Leaving
 * `submittedBy` and `submittedAt` on a draft would claim it is sitting
 * in somebody's queue when it is not. When it is submitted again, the
 * new stamps are the real ones. The audit trail keeps BOTH events —
 * the first submission, the return, and the resubmission — so nothing
 * about the round trip is lost by clearing a field that would otherwise
 * be a lie.
 * ══════════════════════════════════════════════════════════════════════
 */
export function returnVersion(input: {
  projectId: string; versionId: string; actor: Actor; reason?: string;
}): SourceResult {
  const { projectId, versionId } = input;
  const store = readSourceVersions(projectId);
  const i = store.versions.findIndex(v => v.id === versionId);
  if (i < 0) return { store, ok: false, reason: 'not-found' };

  const cur = store.versions[i];
  if (cur.status === 'approved' || cur.status === 'superseded') {
    // An approved plan cannot be pulled back into drafting. The way to
    // change it is to approve the next version.
    return { store, ok: false, reason: 'approved-immutable' };
  }
  if (cur.status === 'rejected') return { store, ok: false, reason: 'already-rejected' };
  if (cur.status !== 'submitted') {
    return { store, ok: false, reason: 'not-submitted-cannot-return' };
  }

  const reason = (input.reason || '').trim();
  const returned: SourceVersion = {
    ...cur,
    status: 'draft',
    // Cleared so the record does not claim a pending submission that no
    // longer exists. The audit trail holds what happened.
    submittedAt: '',
    submittedBy: '',
    note: [cur.note, reason && `Returned by ${input.actor.userId || 'unknown'}: ${reason}`]
      .filter(Boolean).join(' · '),
  };

  const versions = store.versions.slice();
  versions[i] = returned;
  const next: SourceVersionStore = { versions };
  writeSourceVersions(projectId, next);
  auditSource(input.actor, 'review', returned,
    `${versionLabel(cur)} submitted`,
    `${versionLabel(cur)} returned for revision`, reason);
  return { store: next, ok: true, version: returned };
}

/**
 * Discards a DRAFT entirely.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A DRAFT IS NOT HISTORY YET, SO DELETING ONE DESTROYS NOTHING.
 *
 * This is the one deletion in the whole module, and it is safe for a
 * precise reason: a draft has never been submitted and never been
 * approved, so nobody has committed to it and no baseline can be bound
 * to it. It is a working copy. Refusing to remove it would leave the
 * user with a permanent piece of clutter blocking the next capture, and
 * would teach them that "approve it to get rid of it" is a workaround —
 * which is how an unwanted plan gets approved.
 *
 * WHAT IT REFUSES, ABSOLUTELY:
 *   submitted   the version is in somebody's queue for a decision
 *   approved    a commitment; there is no path back
 *   superseded  a historical statement that a later version replaced
 *
 * THE DELETION IS ITSELF AUDITED. The row leaves `pactum-srcver-{p}`,
 * but `pactum-audit` keeps a permanent entry saying who discarded which
 * version and when. The evidence that the attempt existed survives the
 * attempt — the same principle `rejectPackage` follows for baselines.
 *
 * THE NUMBER IS NOT REUSED. `nextVersionNumber` counts from the highest
 * version ever recorded... but a deleted draft is gone, so V2 discarded
 * means the next capture is V2 again. That is correct: V2 never existed
 * as a commitment, and leaving a permanent hole would imply a version
 * that somebody approved and then hid.
 * ══════════════════════════════════════════════════════════════════════
 */
export function deleteDraft(input: {
  projectId: string; versionId: string; actor: Actor; reason?: string;
}): SourceResult {
  const { projectId, versionId } = input;
  const store = readSourceVersions(projectId);
  const i = store.versions.findIndex(v => v.id === versionId);
  if (i < 0) return { store, ok: false, reason: 'not-found' };

  const cur = store.versions[i];
  if (cur.status === 'approved' || cur.status === 'superseded') {
    return { store, ok: false, reason: 'approved-immutable' };
  }
  // A rejected attempt is a RECORD, not a working copy. Discarding it
  // would erase the evidence that the plan was refused.
  if (cur.status === 'rejected') return { store, ok: false, reason: 'already-rejected' };
  if (cur.status !== 'draft') return { store, ok: false, reason: 'not-a-draft' };

  const next: SourceVersionStore = {
    versions: store.versions.filter((_, idx) => idx !== i),
  };
  writeSourceVersions(projectId, next);

  // Recorded BEFORE the caller can forget it happened. The version is
  // gone from the store; this line is why it is not gone from history.
  auditSource(input.actor, 'edit', cur,
    `${SOURCE_LABELS[cur.kind].en} V${cur.version} draft`,
    'discarded',
    (input.reason || '').trim() || 'Draft discarded');
  return { store: next, ok: true, version: cur };
}

/**
 * submitted -> approved, retiring the version it replaces.
 *
 * ══════════════════════════════════════════════════════════════════════
 * V1 IS NOT REWRITTEN WHEN V2 IS APPROVED.
 *
 * The outgoing version keeps its snapshot, its digest, its approver and
 * its dates. Only `status`, `supersededAt` and `supersededById` move,
 * and its `snapshot` is carried by reference — never rebuilt, never
 * re-read from the live register. Acceptance test E depends on exactly
 * this, and the digest recomputed on read proves it byte-for-byte.
 *
 * ONE WRITE. The retired version and the new one land together.
 * ══════════════════════════════════════════════════════════════════════
 */
export function approveVersion(input: {
  projectId: string; versionId: string; actor: Actor; note?: string;
}): SourceResult {
  const { projectId, versionId } = input;
  const store = readSourceVersions(projectId);
  const i = store.versions.findIndex(v => v.id === versionId);
  if (i < 0) return { store, ok: false, reason: 'not-found' };
  const cur = store.versions[i];
  if (cur.status === 'approved' || cur.status === 'superseded') {
    return { store, ok: false, reason: 'approved-immutable' };
  }
  if (cur.status === 'rejected') return { store, ok: false, reason: 'already-rejected' };
  if (cur.status !== 'submitted') return { store, ok: false, reason: 'not-submitted' };

  const now = new Date().toISOString();
  const outgoing = approvedOf(store, cur.kind);
  const approved: SourceVersion = {
    ...cur,
    status: 'approved',
    approvedAt: now,
    approvedBy: input.actor.userId || 'unknown',
    note: input.note === undefined ? cur.note : input.note.trim(),
  };

  const versions = store.versions.map((v, idx) => {
    if (idx === i) return approved;
    if (outgoing && v.id === outgoing.id) {
      return {
        ...v,
        status: 'superseded' as SourceStatus,
        supersededAt: now,
        supersededById: approved.id,
      };
    }
    return v;
  });

  const next: SourceVersionStore = { versions };
  writeSourceVersions(projectId, next);
  auditSource(input.actor, 'approve', approved,
    outgoing ? `V${outgoing.version} approved` : 'submitted',
    `V${approved.version} approved`, approved.note);
  return { store: next, ok: true, version: approved };
}

/**
 * REJECTS a submitted version — the counterpart to approve.
 *
 * ══════════════════════════════════════════════════════════════════════
 * EVERY VERSION CAN GO EITHER WAY. THAT IS THE POINT.
 *
 * Before this, `approveVersion` was the only decision available and a
 * submitted version had no way out but forward. A review with only one
 * possible answer is not a review.
 *
 * THE REJECTED RECORD IS KEPT, NOT DELETED. It holds its snapshot, its
 * author, its submitter, its dates and its label — V2, or V2 Rev 1 —
 * permanently. "We proposed this and it was refused" is a fact about
 * the project, and the reason travels with it.
 *
 * THE VERSION NUMBER IS NOT CONSUMED. The next capture comes back as
 * V2 Rev 1, and V2 only settles when a version under it is approved.
 *
 * The approved version in force is NOT touched. A rejection changes
 * nothing about the plan currently in effect — it only closes an
 * attempt to replace it.
 * ══════════════════════════════════════════════════════════════════════
 */
export function rejectVersion(input: {
  projectId: string; versionId: string; actor: Actor; reason?: string;
}): SourceResult {
  const { projectId, versionId } = input;
  const store = readSourceVersions(projectId);
  const i = store.versions.findIndex(v => v.id === versionId);
  if (i < 0) return { store, ok: false, reason: 'not-found' };

  const cur = store.versions[i];
  if (cur.status === 'approved' || cur.status === 'superseded') {
    // An approved version is a historical statement. It cannot be
    // un-approved by rejecting it after the fact; the way to replace a
    // plan is to approve the next one.
    return { store, ok: false, reason: 'approved-immutable' };
  }
  if (cur.status === 'rejected') {
    return { store, ok: false, reason: 'already-rejected' };
  }
  if (cur.status !== 'submitted' && cur.status !== 'draft') {
    return { store, ok: false, reason: 'nothing-to-reject' };
  }

  const reason = (input.reason || '').trim();
  const rejected: SourceVersion = {
    ...cur,
    status: 'rejected',
    // The refusal is appended to the note rather than replacing it, so
    // the author's own words and the reviewer's both survive.
    note: [cur.note, reason && `Rejected by ${input.actor.userId || 'unknown'}: ${reason}`]
      .filter(Boolean).join(' · '),
  };

  const versions = store.versions.slice();
  versions[i] = rejected;
  const next: SourceVersionStore = { versions };
  writeSourceVersions(projectId, next);
  auditSource(input.actor, 'review', rejected,
    `${versionLabel(cur)} ${cur.status}`,
    `${versionLabel(cur)} rejected`, reason);
  return { store: next, ok: true, version: rejected };
}

// ── Binding a baseline to its sources ──────────────────────────────────

export const EMPTY_SOURCE_REFS: SourceRefs = {
  contract: null, budget: null, cashflow: null, evmPlanned: null, claims: null, changeOrders: null,
};

function refOf(v: SourceVersion | null): SourceRef | null {
  if (!v) return null;
  return {
    id: v.id, version: v.version,
    approvedAt: v.approvedAt, approvedBy: v.approvedBy,
    digest: v.digest,
  };
}

/**
 * The five approved versions as they stand right now.
 *
 * A slot is `null` when that source has no approved version. It is NOT
 * filled from a draft and NOT filled from the live register — decision
 * ⑴=A says a baseline is built from approved source versions, and a
 * missing one is a blocking fact the gate reports by name.
 */
export function approvedRefs(projectId: string): SourceRefs {
  const s = readSourceVersions(projectId);
  return {
    contract: refOf(approvedOf(s, 'contract')),
    budget: refOf(approvedOf(s, 'budget')),
    cashflow: refOf(approvedOf(s, 'cashflow')),
    evmPlanned: refOf(approvedOf(s, 'evm-planned')),
    claims: refOf(approvedOf(s, 'claims')),
    changeOrders: refOf(approvedOf(s, 'change-orders')),
  };
}

/** Reads `SourceRefs` back off a stored package without trusting its shape. */
export function cleanSourceRefs(r: any): SourceRefs | null {
  if (!r || typeof r !== 'object') return null;
  const one = (x: any): SourceRef | null => {
    if (!x || typeof x !== 'object') return null;
    const version = num(x.version);
    if (!version) return null;
    return {
      id: str(x.id), version,
      approvedAt: str(x.approvedAt), approvedBy: str(x.approvedBy),
      digest: str(x.digest),
    };
  };
  return {
    contract: one(r.contract),
    budget: one(r.budget),
    cashflow: one(r.cashflow),
    evmPlanned: one(r.evmPlanned),
    claims: one(r.claims),
    changeOrders: one(r.changeOrders),
  };
}

/** Has this project versioned anything at all? Drives the legacy path. */
export function hasAnyVersions(projectId: string): boolean {
  return readSourceVersions(projectId).versions.length > 0;
}

export interface RefsReadiness {
  ready: boolean;
  /** Sources with no approved version, named. Never counted silently. */
  missing: SourceKind[];
  /** Sources whose live register has moved past the approved version. */
  stale: SourceKind[];
  refs: SourceRefs;
}

/**
 * Can a baseline be built from approved sources right now?
 *
 * `stale` is reported but is NOT a blocker: a live register moving on
 * after a version was approved is normal work, and the baseline is
 * deliberately built from the APPROVED snapshot rather than from what
 * somebody typed this morning. It is surfaced so the user knows a newer
 * version exists to capture, which is acceptance test I.
 */
export function refsReadiness(projectId: string): RefsReadiness {
  const store = readSourceVersions(projectId);
  const refs = approvedRefs(projectId);
  const missing: SourceKind[] = [];
  const stale: SourceKind[] = [];
  SOURCE_KINDS.forEach(k => {
    const a = approvedOf(store, k);
    if (!a) { missing.push(k); return; }
    if (a.digest !== digestOf(readLiveSource(projectId, k))) stale.push(k);
  });
  return { ready: missing.length === 0, missing, stale, refs };
}

/**
 * The approved snapshot for one source, or null.
 *
 * THE READ THE GATE AND THE REBUILD BOTH USE. Decision ⑴=A: a package is
 * measured against the source versions it was built from, not against
 * whatever the live register happens to say at approval time. Without
 * this, every approval would fail the moment somebody edited a budget
 * line between capture and signature.
 */
export function approvedSnapshot(
  projectId: string, kind: SourceKind, store?: SourceVersionStore,
): unknown | null {
  const s = store ?? readSourceVersions(projectId);
  const a = approvedOf(s, kind);
  return a ? a.snapshot : null;
}

/** Approved snapshot as an array, empty when absent. Convenience for callers. */
export function approvedRows(
  projectId: string, kind: SourceKind, store?: SourceVersionStore,
): unknown[] {
  const snap = approvedSnapshot(projectId, kind, store);
  return Array.isArray(snap) ? snap : [];
}

/**
 * The exact snapshot a FILED package was bound to, fetched by its ref.
 *
 * Acceptance test G and H: opening Baseline V1 must show the source
 * versions it was actually made of, even after V2, V3 and V4 of those
 * sources have been approved. It resolves by id — not by "the approved
 * one", which by then is somebody else.
 */
export function snapshotForRef(
  projectId: string, ref: SourceRef | null,
): unknown | null {
  if (!ref || !ref.id) return null;
  const v = versionById(readSourceVersions(projectId), ref.id);
  return v ? v.snapshot : null;
}

/** Human summary of a package's binding. '' when pre-versioning. */
export function describeRefs(refs: SourceRefs | null | undefined, ar = false): string {
  if (!refs) return ar ? 'خط أساس سابق لنظام النسخ' : 'Pre-versioning baseline';
  const parts: string[] = [];
  const add = (k: SourceKind, r: SourceRef | null) => {
    const label = ar ? SOURCE_LABELS[k].ar : SOURCE_LABELS[k].en;
    parts.push(r ? `${label} V${r.version}` : `${label} —`);
  };
  add('budget', refs.budget);
  add('cashflow', refs.cashflow);
  add('evm-planned', refs.evmPlanned);
  add('claims', refs.claims);
  add('change-orders', refs.changeOrders);
  return parts.join(' · ');
}

/** Every version of every source, newest first. For the audit panel. */
export function allVersions(projectId: string): SourceVersion[] {
  return readSourceVersions(projectId).versions
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}


