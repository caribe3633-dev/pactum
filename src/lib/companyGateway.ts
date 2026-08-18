/**
 * Company write gateway.
 * Destination: src/lib/companyGateway.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS  (Phase 3H, closing the Phase 3E audit failure)
 *
 *   The Company Management modal hands its parent a WHOLE NEW ARRAY and
 *   `EnterprisePortfolioPage.handleChange` writes it straight to storage:
 *
 *       const handleChange = (next: Company[]) => {
 *         setCompanies(next);
 *         localStorage.setItem('pactum-enterprise-companies', JSON.stringify(next));
 *       };
 *
 *   No validation runs. The Phase 3E audit proved the consequence by
 *   pushing a bad payload through that exact path:
 *
 *       wrote: empty name + duplicate id + duplicate name
 *       -> registry returned 2 companies; the empty-name row VANISHED
 *       -> duplicate id and duplicate name both persisted
 *
 *   Meanwhile `createCompany` / `updateCompany` / `deleteCompany` sit in
 *   `masterData.ts`, fully tested (26 assertions), refusing exactly those
 *   three things — and nothing called them.
 *
 * ── What this module does ─────────────────────────────────────────────
 *
 *   It turns "here is the new array" into a sequence of VALIDATED
 *   operations. It diffs the submitted array against the registry and
 *   routes each difference through the proper mutator:
 *
 *       present only in `next`     -> createCompany
 *       present in both, changed   -> updateCompany
 *       present only in registry   -> deleteCompany  (dependency-checked)
 *
 *   A rejected operation does NOT abort the batch. Every company is
 *   attempted, and the refusals come back as a list, because a modal
 *   editing five rows should not lose four good edits over one bad name.
 *
 * ── Why a diff and not a rewrite ──────────────────────────────────────
 *
 *   Rewriting the array wholesale is what caused the defect. Diffing means
 *   the same guarantees apply whether a company arrives from this modal,
 *   from an import, or from a future screen — the rules live in one place
 *   and cannot be routed around.
 *
 * ── What it does NOT do ───────────────────────────────────────────────
 *
 *   No UI, no rendering, no financial logic. It validates and delegates.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  type Company,
  type MdReason,
  type ProjectLink,
  readCompanies,
  readSectors,
  createCompany,
  updateCompany,
  deleteCompany,
} from './masterData';

// ── Result ─────────────────────────────────────────────────────────────

export type GatewayOp = 'create' | 'update' | 'delete';

export interface GatewayRejection {
  op: GatewayOp;
  /** Empty for a create that never got an id. */
  id: string;
  /** The name as submitted, so the UI can name the row it refused. */
  name: string;
  reason: MdReason;
  /** Dependents that blocked a delete. */
  blockers?: string[];
}

export interface GatewayResult {
  /** True when every submitted change was accepted. */
  ok: boolean;
  created: string[];
  updated: string[];
  deleted: string[];
  rejected: GatewayRejection[];
  /**
   * The registry AFTER the batch — what the caller should render.
   *
   * Deliberately re-read rather than assembled from the inputs: if an
   * operation was refused, the caller must see the state that actually
   * exists, not the one it asked for. Returning the requested array would
   * show the user a company that was never saved.
   */
  companies: Company[];
}

// ── Change detection ───────────────────────────────────────────────────

/**
 * Fields the modal is allowed to change.
 *
 * `sectors` and `projects` are excluded on purpose — they are derived
 * counters owned by `reconcile()`. Letting a modal write them would let a
 * stale UI overwrite a computed truth.
 */
const EDITABLE_KEYS = [
  'name', 'nameAr', 'logoUrl', 'status', 'portfolioValue',
  'riskRating', 'compliance', 'country', 'city', 'headquarters',
  // Phase 3I — the modal's branding fields. Omitting them from this list
  // meant an edit to any of them was detected as "no change" and never
  // written, so the value silently reverted on the next read.
  'description', 'primaryColor', 'secondaryColor',
  // Task 4 — company profile. Without these an edit to the reporting
  // currency, time zone or calendar reads as "no change" and is skipped.
  'reportingCurrency', 'timeZone', 'calendar',
] as const;

function differs(a: Company, b: Company): boolean {
  return EDITABLE_KEYS.some(k => {
    const av = a[k] ?? '';
    const bv = b[k] ?? '';
    return av !== bv;
  });
}

function patchOf(next: Company): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  EDITABLE_KEYS.forEach(k => {
    if (next[k] !== undefined) out[k] = next[k];
  });
  return out;
}

// ── The gateway ────────────────────────────────────────────────────────

/**
 * Applies a submitted company array through the validated mutators.
 *
 * @param next      the array the modal produced
 * @param projects  live projects, so a delete can be dependency-checked
 * @param actor     username recorded on anything created
 */
export function applyCompanyChanges(
  next: Company[],
  projects: ProjectLink[] = [],
  actor = 'unknown',
): GatewayResult {
  const before = readCompanies();
  const beforeById = new Map(before.map(c => [c.id, c]));

  const submitted = Array.isArray(next) ? next : [];
  const submittedIds = new Set(
    submitted.map(c => String(c?.id ?? '').trim()).filter(Boolean));

  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const rejected: GatewayRejection[] = [];

  // ── 1 · Creates and updates ──
  //
  // Ordered before deletes so that a batch which renames one company and
  // removes another cannot leave a window where neither exists.
  submitted.forEach(row => {
    const id = String(row?.id ?? '').trim();
    const name = String(row?.name ?? '');
    const existing = id ? beforeById.get(id) : undefined;

    if (!existing) {
      // A row with no matching id is new. An id supplied by the caller is
      // honoured so an import can preserve keys; `createCompany` refuses
      // it if already taken.
      const r = createCompany({
        id: id || undefined,
        name,
        nameAr: row?.nameAr,
        logoUrl: row?.logoUrl,
        status: row?.status,
        portfolioValue: row?.portfolioValue,
        riskRating: row?.riskRating,
        compliance: row?.compliance,
        country: row?.country,
        city: row?.city,
        headquarters: row?.headquarters,
        description: row?.description,
        primaryColor: row?.primaryColor,
        secondaryColor: row?.secondaryColor,
        // Task 4 fields. Omitting reportingCurrency here made every
        // create through this gateway fail `missing-currency` even when
        // the caller HAD supplied one — the field was dropped in transit.
        reportingCurrency: row?.reportingCurrency,
        timeZone: row?.timeZone,
        calendar: row?.calendar,
        createdBy: actor,
      });
      if (r.ok && r.record) created.push(r.record.id);
      else rejected.push({ op: 'create', id, name, reason: r.reason! });
      return;
    }

    if (!differs(existing, row)) return;   // untouched — no write at all

    const r = updateCompany(id, patchOf(row) as any);
    if (r.ok) updated.push(id);
    else rejected.push({ op: 'update', id, name, reason: r.reason! });
  });

  // ── 2 · Deletes ──
  //
  // Anything the registry holds that the submission omits. Each is
  // dependency-checked: a company with sectors or projects is REFUSED and
  // survives, rather than being removed and orphaning them.
  before.forEach(existing => {
    if (submittedIds.has(existing.id)) return;
    const r = deleteCompany(existing.id, projects);
    if (r.ok) deleted.push(existing.id);
    else {
      rejected.push({
        op: 'delete',
        id: existing.id,
        name: existing.name,
        reason: r.reason!,
        blockers: r.blockers,
      });
    }
  });

  return {
    ok: rejected.length === 0,
    created,
    updated,
    deleted,
    rejected,
    companies: readCompanies(),
  };
}

// ── Pre-flight dependency check ────────────────────────────────────────

export interface CompanyDependencies {
  /** True when `deleteCompany` would succeed right now. */
  deletable: boolean;
  sectorCount: number;
  projectCount: number;
  /** Sector names, so a dialog can list what must be cleared first. */
  sectorNames: string[];
  /** Ready-made blocker lines, same shape `deleteCompany` returns. */
  blockers: string[];
}

/**
 * Answers "could this company be deleted?" WITHOUT attempting it.
 *
 * PURELY READ-ONLY. It writes nothing, deletes nothing and calls
 * `deleteCompany` not at all — that function is deliberately untouched by
 * this patch.
 *
 * WHY IT EXISTS
 *
 *   The delete dialog has to choose its wording BEFORE the user commits:
 *   a company with no dependents gets an ordinary confirmation, one with
 *   dependents gets the refusal. Discovering that by calling the mutator
 *   and reading the rejection would mean asking the question by trying to
 *   do the thing, which is the wrong shape for a dialog that opens on a
 *   button press.
 *
 *   The dependency RULE is not duplicated here — it mirrors exactly what
 *   `deleteCompany` enforces (sectors, plus projects reached directly or
 *   through a sector, de-duplicated). The mutator remains the authority;
 *   this only previews its answer.
 */
export function companyDependencies(
  companyId: string, projects: ProjectLink[] = [],
): CompanyDependencies {
  const sectors = readSectors().filter(s => s.companyId === companyId);
  const sectorIds = new Set(sectors.map(s => s.id));

  const direct = projects.filter(p => p.companyId === companyId);
  const viaSector = projects.filter(p => p.sectorId && sectorIds.has(p.sectorId));
  const projectCount = new Set([
    ...direct.map(p => p.id),
    ...viaSector.map(p => p.id),
  ]).size;

  const blockers: string[] = [];
  if (sectors.length) {
    blockers.push(`${sectors.length} sector(s): ${sectors.map(s => s.name).join(', ')}`);
  }
  if (projectCount) blockers.push(`${projectCount} project(s)`);

  return {
    deletable: sectors.length === 0 && projectCount === 0,
    sectorCount: sectors.length,
    projectCount,
    sectorNames: sectors.map(s => s.name),
    blockers,
  };
}

// ── Messaging ──────────────────────────────────────────────────────────

/** One refusal, in plain language. */
export function rejectionText(r: GatewayRejection, lang: 'en' | 'ar' = 'en'): string {
  const label = r.name?.trim() || r.id || '—';

  const en: Record<MdReason, string> = {
    'missing-name': `"${label}" was not saved: a company name is required.`,
    'duplicate-name': `"${label}" was not saved: another company already has that name.`,
    'duplicate-id': `"${label}" was not saved: that id is already in use.`,
    'not-found': `"${label}" no longer exists.`,
    'missing-company': `"${label}" is missing its parent company.`,
    'company-not-found': `"${label}" points at a company that does not exist.`,
    // PHASE 3F-UX Task 3 — states the RULE and the remedy. Deliberately
    // silent about Timeline / FX History / Baselines: none of them is
    // deleted, so mentioning them at all would imply otherwise.
    'has-dependents':
      `This company cannot be deleted while dependent records exist. Archive instead.`
      + (r.blockers?.length ? ` — ${label}: ${r.blockers.join(' · ')}` : ` — ${label}`),
    'invalid-order': `"${label}" has an invalid ordering.`,
    // Task 4 — reporting currency is mandatory on a company.
    'missing-currency': `"${label}" was not saved: a reporting currency is required.`,
    'invalid-currency': `"${label}" was not saved: the reporting currency must be a 3-letter ISO code.`,
    // SPRINT 2 — archive outcomes. The exhaustive Record<MdReason, string>
    // is what forced these to be written rather than silently defaulting
    // to the raw reason code.
    'already-archived': `"${label}" is already archived.`,
    'not-archived': `"${label}" is not archived, so it cannot be restored.`,
    'has-active-children':
      `"${label}" cannot be archived while active children remain.`
      + (r.blockers?.length ? ` — ${r.blockers.join(' · ')}` : ''),
  };

  const ar: Record<MdReason, string> = {
    'missing-name': `لم يُحفَظ «${label}»: اسم الشركة مطلوب.`,
    'duplicate-name': `لم يُحفَظ «${label}»: يوجد شركة أخرى بنفس الاسم.`,
    'duplicate-id': `لم يُحفَظ «${label}»: المعرّف مستخدم بالفعل.`,
    'not-found': `«${label}» لم يعد موجوداً.`,
    'missing-company': `«${label}» بلا شركة أم.`,
    'company-not-found': `«${label}» يشير إلى شركة غير موجودة.`,
    'has-dependents':
      `لا يمكن حذف هذه الشركة ما دامت لديها سجلات تابعة. استخدم الأرشفة بدلاً من ذلك.`
      + (r.blockers?.length ? ` — «${label}»: ${r.blockers.join(' · ')}` : ` — «${label}»`),
    'invalid-order': `ترتيب «${label}» غير صالح.`,
    'missing-currency': `لم يُحفَظ «${label}»: عملة التقارير مطلوبة.`,
    'invalid-currency': `لم يُحفَظ «${label}»: رمز عملة التقارير يجب أن يكون 3 أحرف ISO.`,
    'already-archived': `«${label}» مؤرشفة بالفعل.`,
    'not-archived': `«${label}» غير مؤرشفة، فلا يمكن استعادتها.`,
    'has-active-children':
      `لا يمكن أرشفة «${label}» ما دامت لديها عناصر نشطة.`
      + (r.blockers?.length ? ` — ${r.blockers.join(' · ')}` : ''),
  };

  return (lang === 'ar' ? ar : en)[r.reason] ?? String(r.reason);
}

/** Every refusal in a batch, newest-first, ready for a banner. */
export function summarise(result: GatewayResult, lang: 'en' | 'ar' = 'en'): string {
  if (result.ok) return '';
  return result.rejected.map(r => rejectionText(r, lang)).join('\n');
}
