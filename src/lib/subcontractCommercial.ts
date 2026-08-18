/**
 * Subcontract Commercial Management — PROJECT-OWNED.
 * Destination: src/lib/subcontractCommercial.ts
 *
 * ARCHITECTURE
 *   Project Subcontract Contract = the single source of truth.
 *   Company Registry             = identity only (never commercial).
 *   Subcontractor Dashboard      = aggregation / reporting only.
 *
 * Each record below belongs to ONE subcontract inside ONE project.
 * Nothing here is ever written to the registry.
 *
 * STORAGE
 *   pactum-sub-commercial-${projectId}
 *     -> Record<subId, SubCommercial>
 *
 * Deliberately NOT stored here (already owned elsewhere, never duplicated):
 *   Original Contract Value -> pactum-subs-${projectId}      sub.contractValue
 *   Retention (contract)    -> pactum-subs-${projectId}      sub.retention
 *   Certificates            -> pactum-sub-certs-${projectId}
 *   Payments                -> DERIVED from certificate paidAmount
 */

// ── Records ────────────────────────────────────────────────────────────

export type CommercialStatus = 'pending' | 'approved' | 'rejected';

/** Variation / change order against this subcontract. Amount may be negative (omission). */
export interface SubChangeOrder {
  id: string;
  ref: string;
  description: string;
  amount: number;
  status: CommercialStatus;
  date: string;
  /** Approved time impact in days. Counts toward Approved EOT when approved. */
  timeImpactDays?: number;
  /**
   * Link to the signed document. A URL only — PACTUM never stores the file
   * itself, so a SharePoint / Drive / network path all work unchanged.
   */
  documentUrl?: string;
}

/** Contractual claim raised by or against the subcontractor. */
export interface SubClaim {
  id: string;
  ref: string;
  description: string;
  amount: number;
  status: CommercialStatus;
  date: string;
  /** Approved time impact in days. Counts toward Approved EOT when approved. */
  timeImpactDays?: number;
  /** Link to the supporting document. URL only — no file is stored. */
  documentUrl?: string;
}

/** Extension of Time. Measured in days. */
export interface SubEOT {
  id: string;
  ref: string;
  description: string;
  days: number;
  status: CommercialStatus;
  date: string;
}

/**
 * Delay event on THIS subcontract. Independent of the project register.
 * `projectDelayRef` stores a reference only — project data is never copied
 * and the project's own register is never modified.
 */
export type DelayOrigin = 'manual' | 'project-delay' | 'approved-co' | 'approved-claim' | 'imported';

export interface SubDelayRow {
  id: string;
  delayId: string;
  description: string;
  startDate: string;
  endDate: string;
  delayDays: number;
  responsibleParty: string;
  category: string;
  status: CommercialStatus;
  costImpact: number;
  /** Optional reference to a project Delay Register row id. Reference only. */
  projectDelayRef?: string;
  /** Provenance. Rows not marked 'manual' are generated and not hand-editable. */
  createdFrom?: DelayOrigin;
  /** Source ref (CO / Claim no) for generated rows. */
  sourceRef?: string;
  /** Approved days carried by a generated row. */
  approvedDays?: number;
  /**
   * Link to the source document. Copied from the originating CO / Claim on a
   * generated row so the evidence is one click away from the register.
   */
  documentUrl?: string;
}

/** Contract programme dates for this subcontract. Manual. */
export interface SubSchedule {
  /**
   * Site commencement date for THIS subcontract, ISO yyyy-mm-dd.
   * Day zero of the subcontract programme. When set together with a baseline
   * duration, Baseline Finish is derived from it rather than typed by hand.
   */
  commencementDate?: string;
  /** Baseline duration in days. */
  baselineDuration?: number;
  /** Baseline completion date, ISO yyyy-mm-dd. Ignored once derived. */
  baselineFinish?: string;
  /** Contractor's actual total delay on site. Manual — never derived. */
  totalDelay?: number;
  /**
   * LD rate per day, this subcontract only, AS ENTERED in `ldCurrency`.
   *
   * ══════════════════════════════════════════════════════════════════
   * LD IS A TERM OF THE SUBCONTRACT, SO IT IS IN THE SUBCONTRACT'S
   * CURRENCY.
   *
   * A subcontract signed in USD carries a USD daily rate and a USD cap:
   * that is what the clause says and what a dispute is argued on. These
   * two were stored as bare numbers with no unit and displayed against
   * the PROJECT currency, so a USD 5,000/day rate was rendered
   * "AED 5,000" — the number the user typed, relabelled with a currency
   * they never chose.
   *
   * Stored AS ENTERED, converted for display through the frozen rate in
   * `ldExchangeRate`, exactly as every other subcontract transaction
   * behaves.
   * ══════════════════════════════════════════════════════════════════
   */
  ldRatePerDay?: number;
  /** Absolute LD cap, this subcontract only. 0 = no cap entered. */
  ldCapAmount?: number;
  /**
   * Currency of `ldRatePerDay` / `ldCapAmount`.
   * Absent on rows filed before the stamp existed — those were captured
   * in the project currency, which is what the screen showed them in.
   */
  ldCurrency?: string;
  /** Rate frozen when the LD figures were entered. 1 when no conversion. */
  ldExchangeRate?: number;
  /** Effective date of the FX row used, for the audit reference. */
  ldRateEffectiveDate?: string;
  /** FX register row ids, so the conversion can be re-audited. */
  ldRateLegIds?: string[];
}

export interface SubCommercial {
  changeOrders: SubChangeOrder[];
  claims: SubClaim[];
  eots: SubEOT[];
  delays?: SubDelayRow[];
  schedule?: SubSchedule;
}

export const EMPTY_COMMERCIAL: SubCommercial = { changeOrders: [], claims: [], eots: [], delays: [], schedule: {} };

// ── Storage ────────────────────────────────────────────────────────────

const KEY = (projectId: string) => `pactum-sub-commercial-${projectId}`;

type CommercialMap = Record<string, SubCommercial>;

export function readCommercialMap(projectId: string): CommercialMap {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(projectId)) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function writeCommercialMap(projectId: string, map: CommercialMap): void {
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify(map));
  } catch {
    /* quota — ignore */
  }
}

/** Always returns a complete object, even for subs with no commercial data yet. */
export function readCommercial(projectId: string, subId: string): SubCommercial {
  const c = readCommercialMap(projectId)[subId];
  return {
    changeOrders: Array.isArray(c?.changeOrders) ? c.changeOrders : [],
    claims: Array.isArray(c?.claims) ? c.claims : [],
    eots: Array.isArray(c?.eots) ? c.eots : [],
    delays: Array.isArray(c?.delays) ? c.delays : [],
    schedule: (c?.schedule && typeof c.schedule === 'object') ? c.schedule : {},
  };
}

export function writeCommercial(projectId: string, subId: string, data: SubCommercial): void {
  const map = readCommercialMap(projectId);
  map[subId] = data;
  writeCommercialMap(projectId, map);
}

/** Called when a subcontract is removed from a project. */
export function deleteCommercial(projectId: string, subId: string): void {
  const map = readCommercialMap(projectId);
  if (!(subId in map)) return;
  delete map[subId];
  writeCommercialMap(projectId, map);
}

/**
 * Accepts what a user actually pastes and returns something a browser can
 * open. A bare `docs.company.com/x` becomes `https://docs.company.com/x`;
 * an explicit scheme (https, file, \\server\share) is left alone.
 * Returns '' when there is nothing usable.
 */
export function normaliseDocUrl(raw?: string): string {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) return v;   // https: mailto: file:
  if (v.startsWith('\\\\')) return 'file:' + v.replace(/\\/g, '/'); // UNC path
  if (v.startsWith('/')) return v;                      // site-relative
  return 'https://' + v;
}

export function newCommercialId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Rollup ─────────────────────────────────────────────────────────────

/** Most recent record of a kind. `date` is ISO yyyy-mm-dd; blank dates sort last. */
export interface LatestRecord {
  ref: string;
  description: string;
  /** Amount for CO/Claims, days for EOT. */
  value: number;
  status: CommercialStatus;
  date: string;
}

export interface CommercialRollup {
  /** Σ approved change orders. Signed. */
  approvedChangeOrders: number;
  /** Σ change orders awaiting a decision. */
  pendingChangeOrders: number;
  changeOrdersCount: number;

  /** Σ approved claims. */
  approvedClaims: number;
  /** Σ claims raised, any status except rejected. */
  submittedClaims: number;
  claimsCount: number;

  /** Σ approved time impact from change orders. */
  approvedCoEotDays: number;
  /** Σ approved time impact from claims. */
  approvedClaimEotDays: number;
  /**
   * TOTAL approved extension = approved CO time + approved Claim time.
   * There is no manual EOT register: time is granted through a change order
   * or a claim, never on its own.
   */
  approvedEotDays: number;
  pendingEotDays: number;
  /** Number of approved EOT events (change orders + claims granting time). */
  eotCount?: number;

  /** Σ costImpact across every subcontract delay row. */
  grossDelayCost: number;
  delayCount: number;

  /** Latest by date, falling back to insertion order. null when none exist. */
  latestChangeOrder: LatestRecord | null;
  latestClaim: LatestRecord | null;
  latestEot: LatestRecord | null;
}

/**
 * Latest = highest ISO date; ties and blank dates fall back to the last
 * inserted row. Mirrors the certificate rule (no fragile date parsing).
 */
function pickLatest<T extends { ref: string; description: string; status: CommercialStatus; date: string }>(
  rows: T[], value: (r: T) => number,
): LatestRecord | null {
  if (rows.length === 0) return null;
  let best = rows[0];
  for (const r of rows) {
    const a = (r.date || '').trim();
    const b = (best.date || '').trim();
    if (a && !b) { best = r; continue; }
    if (!a && b) continue;
    if (a >= b) best = r;          // >= keeps the later insertion on a tie
  }
  return {
    ref: best.ref,
    description: best.description,
    value: Number(value(best)) || 0,
    status: best.status,
    date: best.date || '',
  };
}

export function rollupCommercial(c: SubCommercial): CommercialRollup {
  const sum = <T>(rows: T[], pick: (r: T) => number, keep: (r: T) => boolean) =>
    rows.filter(keep).reduce((a, r) => a + (Number(pick(r)) || 0), 0);

  const delays = Array.isArray(c.delays) ? c.delays : [];

  // Approved extension comes from approved commercial records only.
  const coEot = sum(c.changeOrders, r => Number(r.timeImpactDays) || 0, r => r.status === 'approved');
  const claimEot = sum(c.claims, r => Number(r.timeImpactDays) || 0, r => r.status === 'approved');

  return {
    approvedChangeOrders: sum(c.changeOrders, r => r.amount, r => r.status === 'approved'),
    pendingChangeOrders: sum(c.changeOrders, r => r.amount, r => r.status === 'pending'),
    changeOrdersCount: c.changeOrders.length,

    approvedClaims: sum(c.claims, r => r.amount, r => r.status === 'approved'),
    submittedClaims: sum(c.claims, r => r.amount, r => r.status !== 'rejected'),
    claimsCount: c.claims.length,

    approvedCoEotDays: coEot,
    approvedClaimEotDays: claimEot,
    // Summed automatically from the two commercial sources.
    approvedEotDays: coEot + claimEot,
    pendingEotDays:
      sum(c.changeOrders, r => Number(r.timeImpactDays) || 0, r => r.status === 'pending') +
      sum(c.claims, r => Number(r.timeImpactDays) || 0, r => r.status === 'pending'),

    grossDelayCost: delays.reduce((a, r) => a + (Number(r.costImpact) || 0), 0),
    delayCount: delays.length,

    latestChangeOrder: pickLatest(c.changeOrders, r => r.amount),
    latestClaim: pickLatest(c.claims, r => r.amount),
    latestEot: null,
  };
}

/**
 * Current Contract = Original Contract + approved change orders.
 * Claims are NOT added — a claim only affects the contract once it is
 * converted into an approved change order. Counting both would double-count.
 */
export function currentContractValue(originalValue: number, r: CommercialRollup): number {
  return (Number(originalValue) || 0) + r.approvedChangeOrders;
}

// ── Liquidated damages — subcontract scope ─────────────────────────────
//
// Mirrors the project LD engine in lib/delayCalculations.ts, but every figure
// belongs to ONE subcontract. Nothing here reads or writes project data.

export interface SubLdResult {
  /** Manual: the subcontractor's actual delay on site. */
  totalDelay: number;
  /** approved CO time + approved Claim time + approved manual EOT */
  approvedExtension: number;
  /** max(0, totalDelay − approvedExtension). Never negative. */
  culpableDelay: number;

  /**
   * LD figures IN THE PROJECT CURRENCY — converted through the rate
   * frozen when they were entered. These are what every rollup consumes,
   * so the project's arithmetic is unchanged.
   */
  ldRatePerDay: number;
  /** 0 means "no cap entered" — treated as Infinity, never as zero. */
  ldCapAmount: number;
  grossExposure: number;
  /** min(grossExposure, cap). The reportable figure. */
  ldExposure: number;
  capReached: boolean;
  cappedAmount: number;
  uncapped: boolean;

  /**
   * The same three figures AS AGREED, in the subcontract's own currency.
   * A screen shows the converted figure and states this one beside it —
   * the LD the subcontract clause actually names.
   */
  ldCurrency: string;
  nativeRatePerDay: number;
  nativeCapAmount: number;
  nativeExposure: number;
  /** Rate applied. 1 when the subcontract is in the project currency. */
  ldExchangeRate: number;
  ldRateEffectiveDate: string;
  ldRateLegIds: string[];
  /** True when the LD figures were entered in another currency. */
  ldForeign: boolean;
  /** True once a currency + rate has been saved onto the schedule. */
  ldRateFrozen: boolean;

  /** Σ costImpact of the subcontract delay register. */
  grossDelayCost: number;
  /** grossDelayCost − ldExposure. Negative is meaningful. */
  netCostImpact: number;
}

/**
 * `defaultCurrency` — the SUBCONTRACT's currency, for a subcontract that
 * has no LD figures on record yet.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WITHOUT IT, AN EMPTY LD BLOCK LIED BY OMISSION.
 *
 * `ldCurrency` is only stamped once a rate or cap is SAVED. Until then
 * the schedule holds nothing, so the block fell back to the project
 * currency and rendered "AED 0" on a subcontract signed in USD — while
 * the contract value and the certificates directly above it correctly
 * read USD. The unit changed halfway down one card.
 *
 * The subcontract's own currency is the honest default: it is what the
 * next entry WILL be denominated in, because `patchSchedule` saves in
 * exactly that currency.
 * ══════════════════════════════════════════════════════════════════════
 */
export function computeSubLd(
  c: SubCommercial, roll?: CommercialRollup, defaultCurrency = '',
): SubLdResult {
  const r = roll ?? rollupCommercial(c);
  const sch = c.schedule || {};

  const totalDelay = Number(sch.totalDelay) || 0;
  const approvedExtension = r.approvedEotDays;
  const culpableDelay = Math.max(0, totalDelay - approvedExtension);

  /**
   * CONVERT ONCE, HERE, THROUGH THE FROZEN RATE.
   *
   * The stored numbers are AS ENTERED in `ldCurrency`. A legacy row has
   * no rate, which means it was captured in the project currency — rate
   * 1, no conversion, byte-identical behaviour to before.
   *
   * The rate is never looked up live: re-reading a rate a year later
   * would silently restate a contractual figure.
   */
  const nativeRatePerDay = Number(sch.ldRatePerDay) || 0;
  const nativeCapAmount = Number(sch.ldCapAmount) || 0;
  const ldCurrency = String(sch.ldCurrency || defaultCurrency || '').toUpperCase();
  const rate = Number(sch.ldExchangeRate) > 0 ? Number(sch.ldExchangeRate) : 1;

  const ldRatePerDay = nativeRatePerDay * rate;
  const ldCapAmount = nativeCapAmount * rate;
  const nativeExposure = Math.min(
    culpableDelay * nativeRatePerDay,
    nativeCapAmount > 0 ? nativeCapAmount : Infinity,
  );

  const grossExposure = culpableDelay * ldRatePerDay;
  const effectiveCap = ldCapAmount > 0 ? ldCapAmount : Infinity;
  const ldExposure = Math.min(grossExposure, effectiveCap);

  return {
    totalDelay,
    approvedExtension,
    culpableDelay,
    ldRatePerDay,
    ldCapAmount,
    grossExposure,
    ldExposure,
    capReached: ldExposure >= effectiveCap && ldCapAmount > 0,
    cappedAmount: grossExposure > ldExposure ? grossExposure - ldExposure : 0,
    uncapped: ldRatePerDay > 0 && ldCapAmount <= 0,
    ldCurrency,
    nativeRatePerDay,
    nativeCapAmount,
    nativeExposure,
    ldExchangeRate: rate,
    ldRateEffectiveDate: String(sch.ldRateEffectiveDate || ''),
    ldRateLegIds: Array.isArray(sch.ldRateLegIds) ? sch.ldRateLegIds.map(String) : [],
    // Whether a rate has actually been frozen onto the record. Distinct
    // from "is this a foreign currency", which only the caller knows —
    // it is the one holding the project currency to compare against.
    ldForeign: rate !== 1,
    ldRateFrozen: Boolean(sch.ldCurrency) && rate > 0,
    grossDelayCost: r.grossDelayCost,
    netCostImpact: r.grossDelayCost - ldExposure,
  };
}

// ── Schedule impact — subcontract scope ────────────────────────────────

export interface SubScheduleImpact {
  /** Day zero. '' when none entered. */
  commencementDate: string;
  baselineDuration: number;
  /** commencement + duration when both are set, else the stored date. */
  baselineFinish: string;
  /** True when baselineFinish was derived from the commencement date. */
  derived: boolean;
  /** baselineDuration + totalDelay */
  currentForecast: number;
  /** baselineFinish + approvedExtension */
  approvedFinish: string;
  /**
   * approvedFinish + totalDelay. The date the works are actually expected to
   * finish once the delay on site is carried past the approved date.
   */
  estimatedFinish: string;
  /** baselineFinish + totalDelay */
  forecastFinish: string;
  /** forecastFinish − approvedFinish, in days. */
  currentVariance: number;
  /** currentVariance when positive, else 0. */
  recoveryRequired: number;
}

/** Adds days to an ISO yyyy-mm-dd date. Returns '' on bad input. */
function addDaysIso(iso: string, days: number): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates. 0 when either is unusable. */
function daysBetweenIso(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function computeSubSchedule(c: SubCommercial, ld?: SubLdResult): SubScheduleImpact {
  const l = ld ?? computeSubLd(c);
  const sch = c.schedule || {};

  const commencementDate = (sch.commencementDate || '').trim();
  const storedFinish = sch.baselineFinish || '';

  // Duration falls back to the gap to the stored finish, so entering a
  // commencement date alone still produces a working programme.
  let baselineDuration = Number(sch.baselineDuration) || 0;
  if (!baselineDuration && commencementDate && storedFinish) {
    baselineDuration = Math.max(0, daysBetweenIso(commencementDate, storedFinish));
  }

  const derived = Boolean(commencementDate && baselineDuration > 0);
  const baselineFinish = derived
    ? addDaysIso(commencementDate, baselineDuration)
    : storedFinish;

  const currentForecast = baselineDuration + l.totalDelay;
  const approvedFinish = addDaysIso(baselineFinish, l.approvedExtension);
  const forecastFinish = addDaysIso(baselineFinish, l.totalDelay);

  // Estimated Finish carries the delay on site PAST the approved date:
  //   Approved Finish + Total Delay
  // It is the honest expected completion, not a contractual entitlement.
  const estimatedFinish = addDaysIso(approvedFinish, l.totalDelay);

  // forecast − approved reduces to totalDelay − approvedExtension, which is
  // the culpable delay before the max(0) floor. Kept signed here so a project
  // running ahead of its approved date shows a negative variance.
  const currentVariance = l.totalDelay - l.approvedExtension;

  return {
    commencementDate,
    baselineDuration,
    baselineFinish,
    derived,
    currentForecast,
    approvedFinish,
    estimatedFinish,
    forecastFinish,
    currentVariance,
    recoveryRequired: Math.max(0, currentVariance),
  };
}

/** Persists a schedule/LD field without touching the registers. */
export function writeSubSchedule(
  projectId: string, subId: string, patch: Partial<SubSchedule>,
): SubCommercial {
  const cur = readCommercial(projectId, subId);
  const next: SubCommercial = { ...cur, schedule: { ...(cur.schedule || {}), ...patch } };
  writeCommercial(projectId, subId, next);
  return next;
}

// ── Delay Register sync — subcontract scope ────────────────────────────
//
// The register is an EVENT LOG, not a hand-kept table.
//
//   Approved change order with time impact  ->  delay event, category
//                                               'scope_change'
//   Approved claim with time impact         ->  delay event, category 'claim'
//
// Generated rows carry `createdFrom` and `sourceRef`. They are refreshed on
// every sync and withdrawn if the source is un-approved or loses its time
// impact. Manual rows (weather, site access, late drawings …) are never
// touched — those are the only kind a user may add by hand.

/** Rows a user may still create manually. CO/Claim events are generated. */
export const MANUAL_DELAY_CATEGORIES = [
  { value: 'weather',        label: 'Weather' },
  { value: 'owner_delay',    label: 'Owner Delay' },
  { value: 'site_access',    label: 'Site Access' },
  { value: 'late_drawings',  label: 'Late Drawings' },
  { value: 'material_delay', label: 'Material Delay' },
  { value: 'utilities',      label: 'Utilities' },
  { value: 'inspection',     label: 'Inspection Delay' },
  { value: 'authority',      label: 'Authority Delay' },
  { value: 'other',          label: 'Other' },
];

export interface SubDelaySyncResult {
  data: SubCommercial;
  created: number;
  updated: number;
  removed: number;
  changed: boolean;
}

/**
 * Rebuilds the generated portion of the subcontract delay register.
 * Idempotent: a second call with unchanged sources writes nothing.
 */
export function syncSubDelayRegister(c: SubCommercial): SubDelaySyncResult {
  const existing = Array.isArray(c.delays) ? c.delays : [];
  const manual = existing.filter(r => (r.createdFrom ?? 'manual') === 'manual' || r.createdFrom === 'project-delay' || r.createdFrom === 'imported');
  const generated = existing.filter(r => r.createdFrom === 'approved-co' || r.createdFrom === 'approved-claim');

  let created = 0;
  let updated = 0;

  const next: SubDelayRow[] = [];

  const build = (
    origin: 'approved-co' | 'approved-claim',
    ref: string,
    description: string,
    days: number,
    date: string,
    cost: number,
    documentUrl: string,
  ): SubDelayRow => {
    const prior = generated.find(g => g.createdFrom === origin && g.sourceRef === ref);
    const row: SubDelayRow = {
      // Keep the original row id so links and ordering survive a re-sync.
      id: prior?.id ?? newCommercialId('sdly'),
      delayId: `DLY-${ref}`,
      description,
      startDate: prior?.startDate ?? date,
      endDate: prior?.endDate ?? '',
      delayDays: days,
      responsibleParty: prior?.responsibleParty ?? 'owner',
      category: origin === 'approved-co' ? 'scope_change' : 'claim',
      status: 'approved',
      // Cost stays user-owned once set; seeded from the source on creation.
      costImpact: prior ? prior.costImpact : cost,
      projectDelayRef: prior?.projectDelayRef,
      createdFrom: origin,
      sourceRef: ref,
      approvedDays: days,
      // Always mirrors the source: the link is owned by the CO / Claim.
      documentUrl,
    };
    if (!prior) created++;
    else if (
      prior.approvedDays !== days ||
      prior.description !== description ||
      prior.delayDays !== days ||
      (prior.documentUrl || '') !== documentUrl
    ) updated++;
    return row;
  };

  (c.changeOrders || []).forEach(co => {
    const ref = (co.ref || '').trim();
    const days = Number(co.timeImpactDays) || 0;
    if (!ref || days <= 0 || co.status !== 'approved') return;
    next.push(build('approved-co', ref, co.description || `Change order ${ref}`, days, co.date || '', Number(co.amount) || 0, co.documentUrl || ''));
  });

  (c.claims || []).forEach(cl => {
    const ref = (cl.ref || '').trim();
    const days = Number(cl.timeImpactDays) || 0;
    if (!ref || days <= 0 || cl.status !== 'approved') return;
    next.push(build('approved-claim', ref, cl.description || `Claim ${ref}`, days, cl.date || '', Number(cl.amount) || 0, cl.documentUrl || ''));
  });

  // A source that lost approval or its time impact withdraws its event.
  const removed = generated.length - next.filter(r =>
    generated.some(g => g.createdFrom === r.createdFrom && g.sourceRef === r.sourceRef)).length;

  const merged = [...manual, ...next];
  const changed =
    created > 0 || updated > 0 || removed !== 0 || merged.length !== existing.length;

  return {
    data: changed ? { ...c, delays: merged } : c,
    created,
    updated,
    removed: Math.max(0, removed),
    changed,
  };
}

/** Reads, syncs and persists in one step. Safe to call on every mount. */
export function readSyncedCommercial(projectId: string, subId: string): SubCommercial {
  const cur = readCommercial(projectId, subId);
  const res = syncSubDelayRegister(cur);
  if (res.changed) writeCommercial(projectId, subId, res.data);
  return res.data;
}
