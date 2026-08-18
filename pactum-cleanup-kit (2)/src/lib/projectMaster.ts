/**
 * Project master data — creation, validation, archive, cascade delete.
 * Destination: src/lib/projectMaster.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS  (Phase 3F, repairing Phase 3E)
 *
 *   CRIT-3E-01  A project created through the UI could never be attached
 *               to a sector or a company. `Project` had no upward link and
 *               `sector.projectIds` had no writer, so every new project was
 *               born an orphan — invisible to six pages and silently bound
 *               to the wrong currency book.
 *
 *   CRIT-3E-03  `disposeProjectStorage` removed 2 of the 19 keys a project
 *               owns, orphaning 17 per deletion including the append-only
 *               timeline and baseline archives.
 *
 *   MED-3E-01   Contract currency was not mandatory.
 *   MED-3E-03   There was no Archive — only hard delete.
 *
 * ── The linkage decision ──────────────────────────────────────────────
 *
 *   The Phase 3F brief states: "Project creation requires Company, Sector".
 *   A requirement of creation is a property of the record, so the project
 *   CARRIES its parents:
 *
 *       Project.companyId   ← authoritative
 *       Project.sectorId    ← authoritative
 *
 *   `Sector.projectIds` survives as a derived cache (see `masterData.ts`)
 *   so the 13 existing reverse-lookup call sites keep working untouched.
 *
 *   Phase 3E noted this contradicts the reasoning in `projectCurrency.ts`,
 *   which deliberately avoided adding a field to `Project`. That reasoning
 *   was about a SIDE CONCERN (currency) that a project can sensibly not
 *   have. Parentage is not a side concern — it is identity, and the brief
 *   makes it mandatory. Both fields are OPTIONAL in the TypeScript
 *   interface so existing stored projects still parse; `createProject`
 *   requires them, and `validateProject` reports any legacy row missing
 *   them rather than guessing a parent.
 *
 * ── What this file does NOT do ────────────────────────────────────────
 *
 *   No money maths, no EVM, no FX. It creates, validates, archives and
 *   disposes. Contract currency is RECORDED here and delegated to
 *   `projectCurrency.ts`, which remains the owner of that fact.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  findCompanyById, findSectorById, type ProjectLink,
} from './masterData';
import { setContractCurrency, contractCurrencyOf } from './projectCurrency';
// SPRINT 2 — the three-tier currency architecture.
import { setProjectCurrencies, clearProjectCurrencies } from './currencyArchitecture';

// ── The 19 storage keys a project owns ─────────────────────────────────
//
// Enumerated once, here, so a future module cannot add a store and forget
// the disposal path. Phase 3E counted these by executing a deletion and
// listing what survived; this constant is that list.
//
// ORDER IS DELIBERATE: archives last, so a partial failure mid-loop leaves
// the audit trail rather than the working data.

export const PROJECT_STORAGE_KEYS = [
  'pactum-budget',
  'pactum-co',
  'pactum-claims',
  'pactum-delays',
  'pactum-certs',
  'pactum-cashflow',
  'pactum-cashflow-sync',
  'pactum-certs-sync',
  'pactum-subs',
  'pactum-sub-certs',
  'pactum-sub-commercial',
  'pactum-sub-windows',
  'pactum-delay-windows',
  'pactum-ld-log',
  'pactum-risk',
  'pactum-evm',
  'pactum-sub-perf',
  // ── Append-only archives. Treated separately on disposal. ──
  'pactum-timeline',
  'pactum-baselines',
  /**
   * SOURCE VERSIONING. Registered here so disposal cannot orphan it —
   * the failure CRIT-3E-03 was raised for in the first place. Listed
   * among the archives because it holds SIGNED approvals: who approved
   * Budget V3, when, and exactly what they approved.
   */
  'pactum-srcver',
] as const;

/**
 * The append-only audit archives.
 *
 * Phase 3E flagged the governance tension: deleting an approved timeline
 * destroys a signed historical record. Disposal therefore requires an
 * explicit decision rather than defaulting either way.
 *
 * SOURCE VERSIONS JOIN THEM — decision ⑵=B. A source version records a
 * named person approving a specific set of figures on a specific date.
 * Deleting a project should not silently erase the evidence that the
 * approval happened; that is a governance decision, and like the other
 * two it now takes `purgeArchives: true` to make it.
 */
export const ARCHIVE_KEYS =
  ['pactum-timeline', 'pactum-baselines', 'pactum-srcver'] as const;

// ── Shapes ─────────────────────────────────────────────────────────────

export type ProjectStatus = 'Active' | 'On Hold' | 'Completed' | 'Archived';

/**
 * The statuses a create/edit form may offer.
 *
 * 'Archived' is DELIBERATELY EXCLUDED: archiving is an action with its own
 * guards and audit fields (`archivedAt` / `archivedBy`), not a value to be
 * picked from a dropdown. Creating a project directly into the archive
 * would produce an archived record that was never active and carries no
 * archive audit trail.
 */
export const PROJECT_STATUSES: { value: ProjectStatus; en: string; ar: string }[] = [
  { value: 'Active',    en: 'Active',    ar: 'نشط' },
  { value: 'On Hold',   en: 'On Hold',   ar: 'متوقف مؤقتاً' },
  { value: 'Completed', en: 'Completed', ar: 'مكتمل' },
];

/** Everything creation demands. Mirrors the Phase 3F brief exactly. */
export interface CreateProjectInput {
  nameEn: string;
  nameAr?: string;
  code: string;

  /** MANDATORY — brief requirement. */
  companyId: string;
  /** MANDATORY — brief requirement. */
  sectorId: string;
  /**
   * MANDATORY — brief requirement. ISO 4217.
   * The BASE CONTRACT currency: the currency of the signed contract.
   */
  contractCurrency: string;
  /**
   * MANDATORY (SPRINT 2) — ISO 4217.
   * The currency this project's own totals are expressed in. Defaults in
   * the FORM to the company's reporting currency, but is STORED on the
   * project so a later change to the company cannot restate it.
   */
  reportingCurrency: string;
  /**
   * OPTIONAL — ISO 4217. Day-to-day site spend (wages, local suppliers).
   * Defaults to the contract currency when not stated.
   */
  workingCurrency?: string;
  /**
   * MANDATORY (SPRINT 2) — brief requirement.
   * No default is invented: a project's status is a statement about the
   * real world, and guessing 'Active' for a project that has not started
   * is a false statement.
   */
  status: ProjectStatus;
  /** MANDATORY — brief requirement. ISO yyyy-mm-dd. */
  commencementDate: string;
  /** MANDATORY — brief requirement. ISO yyyy-mm-dd. */
  contractualCompletion: string;

  country?: string;
  cityEn?: string;
  cityAr?: string;
  contractValue?: number;
  image?: string;
  createdBy?: string;
  /** Optional explicit id, for import. Rejected if taken. */
  id?: string;
}

export type ProjectReason =
  | 'missing-name'
  | 'missing-code'
  | 'missing-company'
  | 'missing-sector'
  | 'missing-currency'
  | 'invalid-currency'
  | 'missing-reporting-currency'
  | 'invalid-reporting-currency'
  | 'invalid-working-currency'
  | 'missing-status'
  | 'invalid-status'
  | 'missing-start-date'
  | 'missing-finish-date'
  | 'invalid-date'
  | 'finish-before-start'
  | 'company-not-found'
  | 'sector-not-found'
  | 'sector-company-mismatch'
  | 'duplicate-id'
  | 'duplicate-name'
  | 'duplicate-code'
  | 'not-found'
  | 'has-dependents';

export interface ProjectResult<T> {
  ok: boolean;
  reason?: ProjectReason;
  /** Every failed field, so a form can mark them all at once. */
  fields?: string[];
  record?: T;
  blockers?: string[];
}

/**
 * Structural mirror of `lib/data.ts` Project, plus the two new links.
 * Kept loose deliberately — this module validates and links; it does not
 * own the financial fields.
 */
export interface ProjectRecord {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  companyId?: string;
  sectorId?: string;
  status?: ProjectStatus;
  country?: string;
  cityEn: string;
  cityAr: string;
  contractValue: number;
  progress: number;
  delayDays: number;
  image?: string;
  revisedContractValue: number;
  totalApprovedCOs: number;
  totalApprovedClaims: number;
  totalCashReceived: number;
  totalCashDisbursed: number;
  commencementDate?: string;
  plannedDurationDays?: number;
  contractualCompletion: string;
  approvedCompletion: string;
  ldRatePerDay?: number;
  ldCapAmount?: number;
  archivedAt?: string;
  archivedBy?: string;
  createdAt?: string;
  createdBy?: string;

  /**
   * ══════════════════════════════════════════════════════════════════════
   * ARCHIVE HISTORY — APPEND ONLY, NEVER REWRITTEN.
   *
   * `archivedAt` / `archivedBy` above describe the CURRENT archived state
   * and are cleared on restore, because a restored project is not
   * archived any more. That is correct for state — and useless as a
   * record, which is why this exists alongside them.
   *
   * Every archive and every restore appends one entry here. Nothing is
   * ever removed. A project archived in March, restored in June and
   * archived again in September carries three entries, in order, and the
   * March event is still legible after the June restore.
   *
   * Absent on every project that has never been archived. An empty array
   * and an absent array mean the same thing and both are safe to read.
   * ══════════════════════════════════════════════════════════════════════
   */
  archiveLog?: ArchiveEvent[];
}

/** One archive or restore, recorded permanently. */
export interface ArchiveEvent {
  action: 'archived' | 'restored';
  /** ISO timestamp. */
  at: string;
  by: string;
  /** Free-text reason. '' when none was given — never invented. */
  note: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function mintProjectId(): string {
  return `pj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Whole days between two ISO dates. */
function daysBetween(a: string, b: string): number {
  const t1 = new Date(`${a}T00:00:00Z`).getTime();
  const t2 = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((t2 - t1) / 86_400_000);
}

// ── VALIDATION ─────────────────────────────────────────────────────────

/**
 * Validates a creation request WITHOUT writing anything.
 *
 * Returns EVERY problem rather than the first, so a form can highlight all
 * bad fields in one pass instead of making the user resubmit six times.
 */
export function validateCreate(
  input: CreateProjectInput, existing: ProjectRecord[] = [],
): ProjectResult<never> {
  const fields: string[] = [];
  let reason: ProjectReason | undefined;

  const fail = (f: string, r: ProjectReason) => {
    fields.push(f);
    if (!reason) reason = r;
  };

  if (!(input.nameEn ?? '').trim()) fail('nameEn', 'missing-name');
  if (!(input.code ?? '').trim()) fail('code', 'missing-code');

  // ── Parentage ──
  const companyId = (input.companyId ?? '').trim();
  const sectorId = (input.sectorId ?? '').trim();

  if (!companyId) fail('companyId', 'missing-company');
  if (!sectorId) fail('sectorId', 'missing-sector');

  if (companyId && !findCompanyById(companyId)) fail('companyId', 'company-not-found');

  if (sectorId) {
    const sec = findSectorById(sectorId);
    if (!sec) {
      fail('sectorId', 'sector-not-found');
    } else if (companyId && sec.companyId !== companyId) {
      // The sector exists but belongs to a different company. Accepting
      // this would create exactly the mismatch `validateMasterData`
      // reports, so it is refused at the door.
      fail('sectorId', 'sector-company-mismatch');
    }
  }

  // ── Base contract currency ──
  const cur = (input.contractCurrency ?? '').trim().toUpperCase();
  if (!cur) fail('contractCurrency', 'missing-currency');
  else if (cur.length !== 3 || !/^[A-Z]{3}$/.test(cur)) {
    fail('contractCurrency', 'invalid-currency');
  }

  // ── Reporting currency (SPRINT 2 — mandatory) ──
  // Stored on the project, not derived from the company at read time, so
  // that changing the company later cannot silently restate this project.
  const rep = (input.reportingCurrency ?? '').trim().toUpperCase();
  if (!rep) fail('reportingCurrency', 'missing-reporting-currency');
  else if (!/^[A-Z]{3}$/.test(rep)) {
    fail('reportingCurrency', 'invalid-reporting-currency');
  }

  // ── Working currency (optional, validated when present) ──
  const wrk = (input.workingCurrency ?? '').trim().toUpperCase();
  if (wrk && !/^[A-Z]{3}$/.test(wrk)) {
    fail('workingCurrency', 'invalid-working-currency');
  }

  // ── Status (SPRINT 2 — mandatory) ──
  const st = (input.status ?? '') as string;
  if (!st) fail('status', 'missing-status');
  else if (!['Active', 'On Hold', 'Completed', 'Archived'].includes(st)) {
    fail('status', 'invalid-status');
  }

  // ── Dates ──
  const start = (input.commencementDate ?? '').trim();
  const finish = (input.contractualCompletion ?? '').trim();

  if (!start) fail('commencementDate', 'missing-start-date');
  else if (!isValidDate(start)) fail('commencementDate', 'invalid-date');

  if (!finish) fail('contractualCompletion', 'missing-finish-date');
  else if (!isValidDate(finish)) fail('contractualCompletion', 'invalid-date');

  if (start && finish && isValidDate(start) && isValidDate(finish) && finish < start) {
    fail('contractualCompletion', 'finish-before-start');
  }

  // ── Uniqueness ──
  const name = (input.nameEn ?? '').trim();
  const code = (input.code ?? '').trim();

  if (input.id && existing.some(p => p.id === input.id)) fail('id', 'duplicate-id');

  // Names are unique WITHIN THE SECTOR. Two companies may each run a
  // "Phase 1" — scoping the check to the parent is the only reading that
  // does not refuse legitimate data.
  if (name && sectorId &&
      existing.some(p => p.sectorId === sectorId && sameName(p.nameEn, name))) {
    fail('nameEn', 'duplicate-name');
  }

  // Codes are unique ENTERPRISE-WIDE — a project code is an external
  // reference and two identical ones cannot be told apart in a report.
  if (code && existing.some(p => sameName(p.code, code))) {
    fail('code', 'duplicate-code');
  }

  return fields.length
    ? { ok: false, reason, fields }
    : { ok: true };
}

// ── CREATE ─────────────────────────────────────────────────────────────

/**
 * Builds a fully-linked project record.
 *
 * Does NOT persist the project itself — `useProjects().addProject` owns the
 * projects array and its lifecycle hooks. This function validates, mints
 * the record, and records the contract currency in its own store. The
 * caller commits.
 *
 * Reporting currency is deliberately NOT copied onto the project. The brief
 * says it is "inherited from Company", and inheritance means reading the
 * parent at the time of use — copying it would freeze a stale value the
 * moment the company changed its reporting currency. `reportingCurrencyOf()`
 * below performs the inheritance.
 */
export function createProject(
  input: CreateProjectInput, existing: ProjectRecord[] = [],
): ProjectResult<ProjectRecord> {
  const check = validateCreate(input, existing);
  if (!check.ok) return check as ProjectResult<ProjectRecord>;

  const id = (input.id ?? '').trim() || mintProjectId();
  if (existing.some(p => p.id === id)) {
    return { ok: false, reason: 'duplicate-id', fields: ['id'] };
  }

  const start = input.commencementDate.trim();
  const finish = input.contractualCompletion.trim();
  const value = Number(input.contractValue) || 0;

  const record: ProjectRecord = {
    id,
    code: input.code.trim(),
    nameEn: input.nameEn.trim(),
    nameAr: (input.nameAr ?? '').trim() || input.nameEn.trim(),

    companyId: input.companyId.trim(),
    sectorId: input.sectorId.trim(),
    // SPRINT 2 — status is now a required INPUT, not a hardcoded 'Active'.
    // A project being created is not necessarily one that has started.
    status: input.status,

    country: input.country?.trim() || undefined,
    cityEn: (input.cityEn ?? '').trim(),
    cityAr: (input.cityAr ?? '').trim(),

    contractValue: value,
    revisedContractValue: value,
    progress: 0,
    delayDays: 0,
    totalApprovedCOs: 0,
    totalApprovedClaims: 0,
    totalCashReceived: 0,
    totalCashDisbursed: 0,

    commencementDate: start,
    plannedDurationDays: daysBetween(start, finish),
    contractualCompletion: finish,
    // Approved finish starts equal to the contractual one. Only an approved
    // EOT moves it, and that is the Delay Register's job, not creation's.
    approvedCompletion: finish,

    ldRatePerDay: 0,
    ldCapAmount: 0,

    image: input.image || undefined,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy || 'unknown',
  };

  // ── Currency architecture (SPRINT 2) ──
  // All THREE currencies are written at creation, from what the form
  // collected. `setProjectCurrencies` also keeps the older
  // `pactum-project-currency` store in step, so Sprint 1's money layer
  // and every module still reading it see the same base currency.
  const base = input.contractCurrency.trim().toUpperCase();
  const reporting = input.reportingCurrency.trim().toUpperCase();
  const working = (input.workingCurrency ?? '').trim().toUpperCase() || base;

  setProjectCurrencies(
    id,
    { baseCurrency: base, reportingCurrency: reporting, workingCurrency: working },
    input.createdBy || 'unknown',
    'Set at project creation',
  );

  return { ok: true, record };
}

// ── CURRENCY INHERITANCE ───────────────────────────────────────────────

/**
 * The company's reporting currency.
 *
 * Read live rather than copied, so a company that changes its reporting
 * currency changes it for every project at once. Falls back to 'SAR' only
 * when the company genuinely has no setting — the same default
 * `readCurrencySettings` already applies.
 *
 * NOTE: this reads the currency settings store directly rather than
 * importing `readCurrencySettings`, to keep this module free of a
 * dependency on the FX engine. The key format is the one that module owns
 * and has not changed.
 */
export function reportingCurrencyOf(companyId: string): string {
  if (!companyId) return 'SAR';
  try {
    const raw = JSON.parse(localStorage.getItem(`pactum-currency-${companyId}`) || 'null');
    const base = String(raw?.baseCurrency ?? '').toUpperCase().slice(0, 3);
    return base || 'SAR';
  } catch {
    return 'SAR';
  }
}

/**
 * The company a project belongs to — Task 5.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 *   Six commercial modules resolved their company like this:
 *
 *       fetchSectors().find(s => s.projectIds.includes(project.id))
 *         ?.companyId ?? ''
 *
 *   `projectIds` is a DERIVED CACHE rebuilt by `reconcile()`. When it is
 *   stale — before the first reconcile of a page load, or for a project
 *   created moments earlier — the lookup yields `''`, and:
 *
 *       readCurrencySettings('')  ->  no such key  ->  DEFAULT  ->  'SAR'
 *
 *   The module then reports in SAR for a company that reports in USD, and
 *   reads an empty FX book, so every conversion silently resolves to
 *   nothing. Measured, not assumed.
 *
 *   `project.companyId` is the AUTHORITATIVE link written at creation. It
 *   needs no cache and cannot go stale. The sector lookup is retained only
 *   as a fallback for a legacy row that predates the field.
 * ══════════════════════════════════════════════════════════════════════
 */
export function companyIdOfProject(
  project: { id: string; companyId?: string; sectorId?: string },
  sectors: { id: string; companyId: string; projectIds: string[] }[] = [],
): string {
  if (project.companyId) return project.companyId;
  if (project.sectorId) {
    const bySectorId = sectors.find(s => s.id === project.sectorId);
    if (bySectorId) return bySectorId.companyId;
  }
  // Legacy only: a project stored before Phase 3F carries neither field.
  return sectors.find(s => s.projectIds.includes(project.id))?.companyId ?? '';
}

/**
 * The pair a project actually operates in.
 * Contract currency is the project's own; reporting is inherited.
 */
export function currencyContextOf(project: ProjectRecord): {
  contractCurrency: string;
  reportingCurrency: string;
  needsRate: boolean;
} {
  const reporting = reportingCurrencyOf(project.companyId ?? '');
  const contract = contractCurrencyOf(project.id, reporting);
  return {
    contractCurrency: contract,
    reportingCurrency: reporting,
    // A project whose contract currency differs from its company's
    // reporting currency cannot be reported on without a published rate.
    needsRate: Boolean(contract && reporting && contract !== reporting),
  };
}

// ── RENAME / EDIT ──────────────────────────────────────────────────────

export type UpdateProjectInput = Partial<
  Pick<ProjectRecord,
    'nameEn' | 'nameAr' | 'code' | 'companyId' | 'sectorId' | 'status' |
    'country' | 'cityEn' | 'cityAr' | 'image'>
>;

/**
 * Validates a rename / re-parent and returns the patched record.
 *
 * Re-parenting is allowed but re-validated: moving a project to a sector
 * owned by a different company would create a mismatch, so the pair is
 * checked together rather than field by field.
 */
export function updateProject(
  current: ProjectRecord, patch: UpdateProjectInput, existing: ProjectRecord[] = [],
): ProjectResult<ProjectRecord> {
  const fields: string[] = [];
  let reason: ProjectReason | undefined;
  const fail = (f: string, r: ProjectReason) => {
    fields.push(f);
    if (!reason) reason = r;
  };

  const nextCompany = (patch.companyId ?? current.companyId ?? '').trim();
  const nextSector = (patch.sectorId ?? current.sectorId ?? '').trim();
  const nextName = (patch.nameEn ?? current.nameEn ?? '').trim();
  const nextCode = (patch.code ?? current.code ?? '').trim();

  if (!nextName) fail('nameEn', 'missing-name');
  if (!nextCode) fail('code', 'missing-code');

  if (patch.companyId !== undefined || patch.sectorId !== undefined) {
    if (!nextCompany) fail('companyId', 'missing-company');
    if (!nextSector) fail('sectorId', 'missing-sector');
    if (nextCompany && !findCompanyById(nextCompany)) fail('companyId', 'company-not-found');
    if (nextSector) {
      const sec = findSectorById(nextSector);
      if (!sec) fail('sectorId', 'sector-not-found');
      else if (nextCompany && sec.companyId !== nextCompany) {
        fail('sectorId', 'sector-company-mismatch');
      }
    }
  }

  const others = existing.filter(p => p.id !== current.id);
  if (nextName && nextSector &&
      others.some(p => p.sectorId === nextSector && sameName(p.nameEn, nextName))) {
    fail('nameEn', 'duplicate-name');
  }
  if (nextCode && others.some(p => sameName(p.code, nextCode))) {
    fail('code', 'duplicate-code');
  }

  if (fields.length) return { ok: false, reason, fields };

  const record: ProjectRecord = {
    ...current,
    ...patch,
    nameEn: nextName,
    nameAr: (patch.nameAr ?? current.nameAr ?? '').trim() || nextName,
    code: nextCode,
    companyId: nextCompany || undefined,
    sectorId: nextSector || undefined,
    id: current.id,
  };

  return { ok: true, record };
}

// ── ARCHIVE ────────────────────────────────────────────────────────────

/**
 * Archives a project — MED-3E-03.
 *
 * Reversible and non-destructive. Nothing is deleted, no storage is
 * touched, the timeline archive is untouched. An archived project is
 * excluded from active listings but stays fully readable, which is what
 * "archive" has to mean for a system whose whole premise is append-only
 * history.
 */
export function archiveProject(
  current: ProjectRecord, by: string, note = '',
): ProjectResult<ProjectRecord> {
  if (current.status === 'Archived') return { ok: true, record: current };
  const at = new Date().toISOString();
  return {
    ok: true,
    record: {
      ...current,
      status: 'Archived',
      archivedAt: at,
      archivedBy: by || 'unknown',
      // Appended, never replaced. See ArchiveEvent.
      archiveLog: [
        ...(current.archiveLog || []),
        { action: 'archived', at, by: by || 'unknown', note: String(note || '') },
      ],
    },
  };
}

/**
 * Restores an archived project to Active.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE RESTORE USED TO DESTROY THE ARCHIVE RECORD.
 *
 * It read:
 *     const { archivedAt, archivedBy, ...rest } = current;
 *     return { ok: true, record: { ...rest, status: 'Active' } };
 *
 * Both audit fields were DELETED. After a restore there was no way to
 * learn that the project had ever been archived, by whom, or when — the
 * evidence was destroyed by the act of reversing it.
 *
 * Now: `archivedAt` / `archivedBy` are still cleared, because they
 * describe a state the project is no longer in and leaving them would
 * make a live project look archived. But the EVENT is appended to
 * `archiveLog` first, and a matching 'restored' entry goes in after it.
 * The history survives the reversal, which is the whole point of an
 * audit trail.
 * ══════════════════════════════════════════════════════════════════════
 */
export function unarchiveProject(
  current: ProjectRecord, by = 'unknown', note = '',
): ProjectResult<ProjectRecord> {
  if (current.status !== 'Archived') return { ok: true, record: current };
  const { archivedAt, archivedBy, ...rest } = current;

  const log = (current.archiveLog || []).slice();
  // Defensive: a project archived before archiveLog existed has the two
  // fields but no entry. Recover it rather than lose it on restore.
  if (log.length === 0 && archivedAt) {
    log.push({ action: 'archived', at: archivedAt, by: archivedBy || 'unknown', note: '' });
  }
  log.push({ action: 'restored', at: new Date().toISOString(), by: by || 'unknown', note: String(note || '') });

  return { ok: true, record: { ...rest, status: 'Active', archiveLog: log } };
}

/** Active listings exclude archived projects. */
export function activeProjects(list: ProjectRecord[]): ProjectRecord[] {
  return list.filter(p => p.status !== 'Archived');
}

// ── DISPOSAL ───────────────────────────────────────────────────────────

export interface DisposeOptions {
  /**
   * Whether to destroy `pactum-timeline-*` and `pactum-baselines-*`.
   *
   * DEFAULT false — the append-only archives are a signed historical
   * record and Phase 3E flagged their removal as a governance decision,
   * not a cleanup detail. The caller must say so explicitly.
   */
  purgeArchives?: boolean;
}

export interface DisposeReport {
  removed: string[];
  retained: string[];
}

/**
 * Removes every store a project owns — CRIT-3E-03.
 *
 * Phase 3E measured the old implementation removing 2 of 19 keys and
 * orphaning 17. This walks the full enumerated list.
 *
 * Archives are retained unless explicitly purged, and what was retained is
 * reported so the caller can surface it rather than leaving silent residue.
 */
export function disposeProjectStorage(
  projectId: string, options: DisposeOptions = {},
): DisposeReport {
  const removed: string[] = [];
  const retained: string[] = [];
  if (!projectId) return { removed, retained };

  const archives = new Set<string>(ARCHIVE_KEYS);

  PROJECT_STORAGE_KEYS.forEach(prefix => {
    const key = `${prefix}-${projectId}`;
    const isArchive = archives.has(prefix);

    if (isArchive && !options.purgeArchives) {
      try {
        if (localStorage.getItem(key) !== null) retained.push(key);
      } catch { /* storage unavailable */ }
      return;
    }

    try {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        removed.push(key);
      }
    } catch { /* storage unavailable — skip silently */ }
  });

  // The project's contract-currency entry lives in a shared map rather than
  // a per-project key, so it needs removing by hand or it becomes a stale
  // entry keyed to a project that no longer exists.
  try {
    const raw = JSON.parse(localStorage.getItem('pactum-project-currency') || 'null');
    if (raw && typeof raw === 'object' && projectId in raw) {
      delete raw[projectId];
      localStorage.setItem('pactum-project-currency', JSON.stringify(raw));
      removed.push(`pactum-project-currency[${projectId}]`);
    }
  } catch { /* malformed — leave it alone rather than rewriting it */ }

  // SPRINT 2 — the three-currency config lives in the same kind of shared
  // map and would otherwise become an orphan keyed to a deleted project.
  try {
    const raw = JSON.parse(localStorage.getItem('pactum-project-currency-config') || 'null');
    if (raw && typeof raw === 'object' && projectId in raw) {
      clearProjectCurrencies(projectId);
      removed.push(`pactum-project-currency-config[${projectId}]`);
    }
  } catch { /* malformed — leave it alone rather than rewriting it */ }

  return { removed, retained };
}

/**
 * Counts what a project still holds. Used to warn before deletion.
 */
export function projectFootprint(projectId: string): { key: string; bytes: number }[] {
  const out: { key: string; bytes: number }[] = [];
  PROJECT_STORAGE_KEYS.forEach(prefix => {
    const key = `${prefix}-${projectId}`;
    try {
      const v = localStorage.getItem(key);
      if (v !== null) out.push({ key, bytes: v.length });
    } catch { /* storage unavailable */ }
  });
  return out;
}

// ── LEGACY MIGRATION ───────────────────────────────────────────────────

/**
 * Back-fills `companyId` / `sectorId` on projects stored before Phase 3F.
 *
 * The old relationship lived in `sector.projectIds`. Where a legacy project
 * appears in exactly one sector, its parents can be recovered with
 * certainty and are written onto the record.
 *
 * A project appearing in TWO sectors is ambiguous. It is left untouched and
 * REPORTED — guessing which parent is correct would silently move money
 * between companies, and Phase 3E specifically identified un-enforced
 * one-sector membership as a defect. Reporting it lets a human resolve it.
 *
 * PURE: returns the patched list, writes nothing.
 */
export function backfillParentage(
  projects: ProjectRecord[],
  sectors: { id: string; companyId: string; projectIds: string[] }[],
): { projects: ProjectRecord[]; linked: string[]; ambiguous: string[]; unlinked: string[] } {
  const linked: string[] = [];
  const ambiguous: string[] = [];
  const unlinked: string[] = [];

  const next = projects.map(p => {
    if (p.companyId && p.sectorId) return p;

    const owners = sectors.filter(s => s.projectIds.includes(p.id));

    if (owners.length === 1) {
      linked.push(p.id);
      return { ...p, companyId: p.companyId || owners[0].companyId, sectorId: p.sectorId || owners[0].id };
    }
    if (owners.length > 1) { ambiguous.push(p.id); return p; }
    unlinked.push(p.id);
    return p;
  });

  return { projects: next, linked, ambiguous, unlinked };
}

/** Projects that still have no parent after migration. */
export function orphanProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return projects.filter(p => !p.companyId || !p.sectorId);
}

/** Adapter for `masterData.reconcile()`. */
export function toLinks(projects: ProjectRecord[]): ProjectLink[] {
  // `status` is carried so the master-data archive guards can tell a live
  // project from an archived one. Dropping it made every project look
  // active and blocked sector archiving permanently.
  return projects.map(p => ({
    id: p.id, companyId: p.companyId, sectorId: p.sectorId, status: p.status,
  }));
}
