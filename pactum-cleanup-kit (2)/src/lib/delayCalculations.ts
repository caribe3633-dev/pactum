/**
 * Delay / EOT / Liquidated Damages — single source of truth.
 * Destination: src/lib/delayCalculations.ts
 *
 * WHY THIS FILE EXISTS
 * The culpable-delay formula was previously computed only inside
 * OverviewModule.computeFromStorage. DelayModule needs the identical number
 * for LD exposure. Copy-pasting the formula would let the two drift apart,
 * so it is extracted here and imported by both.
 *
 * EOT SOURCING RULE (locked)
 *   totalApprovedEOT = coEOT + claimEOT
 *
 *   coEOT     = Σ CORow.time      where status === 'approved'
 *   claimEOT  = Σ ClaimRow.timeDays where status === 'approved'
 *
 *   DelayRow.eotDays is DELIBERATELY EXCLUDED. It is a documentation /
 *   evidence field describing the delay event, not a second grant of time.
 *   Including it double-counts: DLY-001 (eotDays 36) is linked to CLM-001
 *   (timeDays 45) — the same physical event would be granted twice.
 *
 * Nothing here writes. Pure reads + pure arithmetic.
 */

// The contract currency, for stamping a unit onto the LD figures. This is
// the module's only import; `projectCurrency.ts` imports nothing itself,
// so no cycle is introduced.
import { contractCurrencyOf } from './projectCurrency';

// ── Row shapes (structural mirrors — the modules own the real interfaces) ──

interface CORowLike {
  no?: string;
  desc?: string;
  value?: number;
  /** Time impact in days. Field is named `time` in ChangesModule. */
  time?: number;
  status?: string;
  /**
   * STEP 12 — the date the TIME grant became effective. Entered where the
   * decision is actually taken. Distinct from `date` (a transaction date
   * for FX lookup) and from `costApprovedAt` (the COST axis, which Step 7
   * separated from time and which may never imply it).
   */
  eotApprovedAt?: string;
}

interface ClaimRowLike {
  no?: string;
  type?: string;
  claimed?: number;
  settled?: number;
  /** EOT in days. Field is named `timeDays` in ClaimsModule. */
  timeDays?: number;
  status?: string;
  /** STEP 12 — see CORowLike.eotApprovedAt. */
  eotApprovedAt?: string;
}

/** Minimal Project surface this module needs. Avoids a circular import. */
export interface LdProjectLike {
  id: string;
  delayDays?: number;
  contractValue?: number;
  ldRatePerDay?: number;
  ldCapAmount?: number;
  /**
   * Currency of `ldRatePerDay` / `ldCapAmount`. Absent on every row
   * filed before the stamp existed, in which case the contract currency
   * governs — see `LdResult.ldCurrency`.
   */
  ldCurrency?: string;
}

// ── Storage reads ──────────────────────────────────────────────────────

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

const APPROVED = 'approved';

// ── EOT ────────────────────────────────────────────────────────────────

export interface EotBreakdown {
  /** Σ approved CORow.time */
  coEOT: number;
  /** Σ approved ClaimRow.timeDays */
  claimEOT: number;
  /** coEOT + claimEOT. Sourced from the Delay Register, deduplicated. */
  totalApprovedEOT: number;
}

export function computeApprovedEOT(projectId: string): EotBreakdown {
  // The Delay Register is the system of record. Every schedule-impacting
  // Claim / Change Order has already been synced into it by
  // syncDelayRegister(), including deduplication of events that exist as
  // both. Summing the register therefore counts each event exactly once.
  const rows = readDelayRegister(projectId);
  const approved = rows.filter(r => (r.status || '') === APPROVED);

  // Each row is ONE event and is counted exactly once, attributed to the
  // source that created it. Rows made by hand carry no marker and fall into
  // the claim bucket — they are still real approved time.
  const sum = (rows: DelayRegisterRow[]) =>
    rows.reduce((s, r) => s + (Number(r.eotDays) || 0), 0);

  const coEOT = sum(approved.filter(r => r.sourceType === 'co'));
  const claimEOT = sum(approved.filter(r => r.sourceType !== 'co'));

  return { coEOT, claimEOT, totalApprovedEOT: coEOT + claimEOT };
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * STEP 12 · THE EFFECTIVE APPROVED SCHEDULE, AS AT A GIVEN DATE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Indirect EV is time-based, so it needs to know how long the approved
 * schedule was ON THE DAY each period ended — not how long it is today.
 * Approving 150 days in August must not retroactively change what March
 * was measured against.
 *
 * THE RULE (Q1=A):
 *   an approved EOT row counts only when `eotApprovedAt <= asOf`.
 *
 * THE BLOCK (Q2=C):
 *   an approved row with NO `eotApprovedAt` is neither guessed at nor
 *   quietly dropped. It is already-approved time, so ignoring it would
 *   understate the approved schedule; dating it would be invention.
 *   Instead the whole calculation is refused — `blocked: true` — and the
 *   caller must show a warning naming the undated rows.
 *
 * Undated rows block REGARDLESS of `asOf`, because their effective date
 * is unknowable, not merely future.
 */
export interface EffectiveSchedule {
  /** Approved duration in force at `asOf`, including effective EOT. */
  effectiveDurationDays: number;
  /** Original approved duration before any extension. */
  baseDurationDays: number;
  /** EOT days that had become effective on or before `asOf`. */
  effectiveEotDays: number;
  /** Approved EOT that exists but is NOT yet effective at `asOf`. */
  pendingEotDays: number;
  /**
   * TRUE when at least one approved EOT row carries no effective date.
   * The time basis is UNKNOWABLE and must not be used. Q2=C.
   */
  blocked: boolean;
  /** Human-readable identifiers of the undated approved rows. */
  undatedRefs: string[];
  /** The effective completion date, '' when blocked or undeterminable. */
  effectiveCompletion: string;
}

export function effectiveScheduleDuration(
  projectId: string,
  commencementDate: string,
  baseDurationDays: number,
  asOf: string,
): EffectiveSchedule {
  const base = Math.max(0, Number(baseDurationDays) || 0);
  const out: EffectiveSchedule = {
    effectiveDurationDays: base,
    baseDurationDays: base,
    effectiveEotDays: 0,
    pendingEotDays: 0,
    blocked: false,
    undatedRefs: [],
    effectiveCompletion: '',
  };

  const rows = readDelayRegister(projectId).filter(r => (r.status || '') === APPROVED);

  for (const r of rows) {
    const days = Number(r.eotDays) || 0;
    if (days === 0) continue;              // no time impact, no date needed
    const at = String(r.eotApprovedAt || '').trim();
    if (!at) {
      out.blocked = true;
      out.undatedRefs.push(r.sourceRef || r.description || r.id);
      continue;
    }
    // toDate handles ISO and DD/MM/YYYY; an unparseable date is undated.
    if (!toDate(at)) {
      out.blocked = true;
      out.undatedRefs.push(r.sourceRef || r.description || r.id);
      continue;
    }
    if (daysBetween(at, asOf) >= 0) out.effectiveEotDays += days;
    else out.pendingEotDays += days;
  }

  if (out.blocked) return out;

  out.effectiveDurationDays = base + out.effectiveEotDays;
  out.effectiveCompletion = commencementDate
    ? addDays(commencementDate, out.effectiveDurationDays)
    : '';
  return out;
}

/**
 * Time-based planned percent complete at `asOf`, 0..1.
 *
 * The basis Step 12 requires for Indirect EV:
 *   elapsed days since commencement ÷ effective approved duration
 *
 * Returns null when it cannot be known — no commencement date, no
 * duration, or an undated approved EOT blocking the basis. NULL IS NOT
 * ZERO: a null must be reported as "cannot be determined", never
 * rendered as 0% complete.
 */
export function timePlannedPercent(
  commencementDate: string,
  effective: EffectiveSchedule,
  asOf: string,
): number | null {
  if (effective.blocked) return null;
  if (!commencementDate) return null;
  if (effective.effectiveDurationDays <= 0) return null;
  const elapsed = daysBetween(commencementDate, asOf);
  if (elapsed <= 0) return 0;
  return Math.max(0, Math.min(1, elapsed / effective.effectiveDurationDays));
}

// ── Culpable delay ─────────────────────────────────────────────────────

/**
 * Culpable (compensable) delay.
 * project.delayDays is the authoritative manually-entered total delay —
 * NOT the sum of DelayRow.delayDays.
 */
export function computeCulpableDelay(totalDelayDays: number, totalApprovedEOT: number): number {
  return Math.max(0, (Number(totalDelayDays) || 0) - (Number(totalApprovedEOT) || 0));
}

// ── Liquidated damages ─────────────────────────────────────────────────

export interface LdResult {
  /** project.delayDays — manual, authoritative. */
  totalDelay: number;
  coEOT: number;
  claimEOT: number;
  totalApprovedEOT: number;
  /** max(0, totalDelay − totalApprovedEOT) */
  culpableDelay: number;

  ldRatePerDay: number;
  /** 0 means "no cap entered". Treated as Infinity when capping. */
  ldCapAmount: number;
  /** Uncapped: culpableDelay × rate. */
  grossExposure: number;
  /** min(grossExposure, cap). The reportable figure. */
  ldExposure: number;

  /**
   * The currency `ldRatePerDay`, `ldCapAmount` and `ldExposure` are
   * expressed in.
   *
   * ══════════════════════════════════════════════════════════════════
   * WHY THIS FIELD WAS ADDED
   *
   * `ldRatePerDay` and `ldCapAmount` are stored on the project record as
   * BARE NUMBERS with no currency stamp, unlike every other money field
   * on the platform, which carries its provenance via
   * `transactionFields()`. The screens then printed them against
   * whatever unit was in scope, which was the company reporting
   * currency — so an LD rate typed on a SAR project displayed as AED.
   *
   * The agreed reading of the existing data: a liquidated-damages rate
   * is a term of the CONTRACT, so a figure already on record was
   * entered in the contract's currency. That is what
   * `project.ldCurrency` records, defaulting to the contract currency
   * when absent.
   *
   * No stored number changes. Only the unit is now stated instead of
   * being assumed.
   * ══════════════════════════════════════════════════════════════════
   */
  ldCurrency: string;

  /** True once the cap actually binds. Requires a cap > 0 to be meaningful. */
  capReached: boolean;
  /** Amount the cap absorbed. 0 when not capped. */
  cappedAmount: number;
  /** Rate entered but no cap — exposure is unbounded. */
  uncapped: boolean;
}

/**
 * A cap of 0 / undefined means the user has not entered one, so no cap is
 * applied (Infinity). It must never be read as "capped at zero".
 */
export function computeLd(project: LdProjectLike, eot?: EotBreakdown): LdResult {
  const e = eot ?? computeApprovedEOT(project.id);

  const totalDelay = Number(project.delayDays) || 0;
  const culpableDelay = computeCulpableDelay(totalDelay, e.totalApprovedEOT);

  const ldRatePerDay = Number(project.ldRatePerDay) || 0;
  const ldCapAmount = Number(project.ldCapAmount) || 0;

  const grossExposure = culpableDelay * ldRatePerDay;
  const effectiveCap = ldCapAmount > 0 ? ldCapAmount : Infinity;
  const ldExposure = Math.min(grossExposure, effectiveCap);

  return {
    totalDelay,
    coEOT: e.coEOT,
    claimEOT: e.claimEOT,
    totalApprovedEOT: e.totalApprovedEOT,
    culpableDelay,
    ldRatePerDay,
    ldCapAmount,
    grossExposure,
    ldExposure,
    // A stamped row states its own unit. An unstamped one is read as the
    // contract currency — the documented assumption, applied in one
    // place rather than guessed at each call site.
    ldCurrency: (project.ldCurrency || contractCurrencyOf(project.id, '')).toUpperCase(),
    // Literal form of the agreed spec:
    //   ldExposure >= (cap ?? Infinity) && (cap ?? 0) > 0
    capReached: ldExposure >= effectiveCap && ldCapAmount > 0,
    cappedAmount: grossExposure > ldExposure ? grossExposure - ldExposure : 0,
    uncapped: ldRatePerDay > 0 && ldCapAmount <= 0,
  };
}

// ── Delay Register sync ────────────────────────────────────────────────
//
// The Delay Register is the SYSTEM OF RECORD for delay analysis.
// Its rows are built and kept up to date from the two authoritative
// schedule-impacting sources:
//
//   • Time Claims        — ClaimRow with timeDays > 0
//   • Change Orders      — CORow with time > 0  (schedule impact)
//
// Purely financial change orders (time === 0) are NEVER imported.
//
// DEDUPLICATION
//   One physical event can appear as both a Claim and a Change Order.
//   A DelayRow already linked to a claim via `linkedClaimNos` is treated as
//   the same event: it is UPDATED, never duplicated.
//
// PRESERVED ON UPDATE
//   User-owned fields survive every sync: description, responsibleParty,
//   startDate, endDate, delayDays, costImpact, category, notes.
//   Only eotDays / status / linkedClaimNos are refreshed from the source.

/** Structural mirror of DelayModule.DelayRow. DelayModule owns the real type. */
export interface DelayRegisterRow {
  id: string;
  description: string;
  responsibleParty: string;
  startDate: string;
  endDate: string;
  delayDays: number;
  eotDays: number;
  costImpact: number;
  category: string;
  status: string;
  notes: string;
  linkedClaimNos?: string[];
  /** Change Orders representing the SAME physical event as this row. */
  linkedCoNos?: string[];
  /** Origin marker written by the sync. Absent on hand-created rows. */
  sourceRef?: string;
  sourceType?: 'claim' | 'co';

  /**
   * ════════════════════════════════════════════════════════════════════
   * STEP 12 · Q1=A — WHEN THE APPROVED EOT BECAME EFFECTIVE.
   *
   * ISO yyyy-mm-dd, entered by Finance. This is the ONLY field that says
   * from which point an approved extension is part of the approved
   * schedule.
   *
   * WHY IT HAD TO EXIST. `computeApprovedEOT` returns a number and
   * nothing else. Without a date, approving 150 days would silently
   * lengthen the schedule for EVERY period ever recorded, rewriting
   * Indirect EV backwards through history. That is the one thing the
   * system must never do.
   *
   * OPTIONAL, AND NEVER INVENTED. Rows approved before Step 12 have no
   * date and must not be given one. Per Q2=C they do not get a guessed
   * effective date and they are not quietly dropped either — they BLOCK
   * the time-based calculation and raise a warning. See
   * `effectiveScheduleDuration()` below.
   *
   * NOT the same as `costApprovedAt`, which is the COST approval on a
   * change order or claim. Step 7 separated the cost axis from the time
   * axis deliberately; one may never stand in for the other.
   * ════════════════════════════════════════════════════════════════════
   */
  eotApprovedAt?: string;
}

const DELAYS_KEY = (projectId: string) => `pactum-delays-${projectId}`;

export function readDelayRegister(projectId: string): DelayRegisterRow[] {
  const rows = readJson<DelayRegisterRow[]>(DELAYS_KEY(projectId), []);
  return Array.isArray(rows) ? rows : [];
}

function writeDelayRegister(projectId: string, rows: DelayRegisterRow[]): void {
  try {
    localStorage.setItem(DELAYS_KEY(projectId), JSON.stringify(rows));
  } catch {
    /* quota — ignore */
  }
}

export interface DelaySyncResult {
  rows: DelayRegisterRow[];
  created: number;
  updated: number;
  /** true when storage was actually written. */
  changed: boolean;
}

/**
 * Rebuilds the Delay Register from Claims + time-bearing Change Orders.
 *
 * Idempotent: running it twice in a row produces no second write.
 * Rows created by hand (no sourceRef) are left untouched.
 */
export function syncDelayRegister(projectId: string): DelaySyncResult {
  const existing = readDelayRegister(projectId);
  const claims = readJson<ClaimRowLike[]>(`pactum-claims-${projectId}`, []);
  const cos = readJson<CORowLike[]>(`pactum-co-${projectId}`, []);

  const next = existing.map(r => ({ ...r }));
  let created = 0;
  let updated = 0;

  /** Finds the row representing this event, by source marker or explicit link. */
  const findRow = (ref: string, type: 'claim' | 'co') => {
    let i = next.findIndex(r => r.sourceRef === ref && r.sourceType === type);
    if (i !== -1) return i;
    // Dedup: a row already linked to this reference IS this event, so the
    // row is updated instead of a second one being created.
    const linkField = type === 'claim' ? 'linkedClaimNos' : 'linkedCoNos';
    i = next.findIndex(r => ((r[linkField] as string[] | undefined) || []).includes(ref));
    return i;
  };

  const apply = (
    i: number,
    patch: Pick<DelayRegisterRow, 'eotDays' | 'status'>
      & { link?: string; type: 'claim' | 'co'; eotApprovedAt?: string },
  ) => {
    const row = next[i];
    const field = patch.type === 'claim' ? 'linkedClaimNos' : 'linkedCoNos';
    const links = new Set((row[field] as string[] | undefined) || []);
    if (patch.link) links.add(patch.link);
    const nextLinks = Array.from(links);

    // A row that already represents this event via the OTHER source keeps its
    // own eotDays — the same grant of time is never added twice.
    const isSameEventFromOtherSource = row.sourceType !== undefined && row.sourceType !== patch.type;
    const nextEot = isSameEventFromOtherSource ? row.eotDays : patch.eotDays;

    /**
     * ════════════════════════════════════════════════════════════════════
     * STEP 12 — THE EFFECTIVE DATE IS CARRIED, NEVER CLOBBERED.
     *
     * Your rule: "Never silently overwrite an existing approved source
     * date." So this only FILLS a blank. Once a row carries a date it is
     * the row's own fact and the sync leaves it alone — an edit made in
     * the register survives every later sync.
     *
     * The same one-event rule that protects eotDays protects the date: a
     * row already owned by the other source keeps its own.
     * ════════════════════════════════════════════════════════════════════
     */
    const incomingAt = String(patch.eotApprovedAt || '').trim();
    const existingAt = String(row.eotApprovedAt || '').trim();
    const nextAt = (existingAt || isSameEventFromOtherSource) ? existingAt : incomingAt;

    const same =
      row.eotDays === nextEot &&
      row.status === patch.status &&
      existingAt === nextAt &&
      JSON.stringify((row[field] as string[] | undefined) || []) === JSON.stringify(nextLinks);

    if (same) return;
    // Only source-owned fields are refreshed. Everything else is the user's.
    next[i] = { ...row, eotDays: nextEot, status: patch.status, [field]: nextLinks };
    if (nextAt) next[i].eotApprovedAt = nextAt;
    updated++;
  };

  // ── Time Claims ──
  (Array.isArray(claims) ? claims : []).forEach(c => {
    const ref = (c.no || '').trim();
    const days = Number(c.timeDays) || 0;
    if (!ref || days <= 0) return;            // no time impact -> not a delay event

    const status = (c.status || 'submitted').trim();
    const i = findRow(ref, 'claim');

    if (i === -1) {
      next.push({
        id: `DLY-${ref}`,
        description: c.type || `Time claim ${ref}`,
        responsibleParty: 'owner',
        startDate: '', endDate: '',
        delayDays: days,                       // seed only; user may override
        eotDays: days,
        costImpact: Number(c.claimed) || 0,    // seed only; user may override
        category: 'scope_change',
        status,
        notes: `Auto-generated from Claim ${ref}.`,
        linkedClaimNos: [ref],
        sourceRef: ref,
        sourceType: 'claim',
        // STEP 12 — carried from the claim. Absent stays absent: an
        // undated approved EOT must BLOCK the time basis (Q2=C), never
        // be given a manufactured date here.
        ...(String(c.eotApprovedAt || '').trim()
          ? { eotApprovedAt: String(c.eotApprovedAt).trim() } : {}),
      });
      created++;
    } else {
      apply(i, { eotDays: days, status, link: ref, type: 'claim', eotApprovedAt: c.eotApprovedAt });
      if (!next[i].sourceRef) {
        next[i] = { ...next[i], sourceRef: ref, sourceType: 'claim' };
      }
    }
  });

  // ── Change Orders WITH schedule impact ──
  (Array.isArray(cos) ? cos : []).forEach(co => {
    const ref = (co.no || '').trim();
    const days = Number(co.time) || 0;
    if (!ref || days <= 0) return;            // purely financial CO -> skipped

    const status = (co.status || 'submitted').trim();
    const i = findRow(ref, 'co');

    if (i === -1) {
      next.push({
        id: `DLY-${ref}`,
        description: co.desc || `Change order ${ref}`,
        responsibleParty: 'owner',
        startDate: '', endDate: '',
        delayDays: days,
        eotDays: days,
        costImpact: Number(co.value) || 0,
        category: 'scope_change',
        status,
        notes: `Auto-generated from Change Order ${ref}.`,
        linkedClaimNos: [],
        linkedCoNos: [ref],
        sourceRef: ref,
        sourceType: 'co',
        // STEP 12 — carried from the change order. Absent stays absent.
        ...(String(co.eotApprovedAt || '').trim()
          ? { eotApprovedAt: String(co.eotApprovedAt).trim() } : {}),
      });
      created++;
    } else {
      apply(i, { eotDays: days, status, link: ref, type: 'co', eotApprovedAt: co.eotApprovedAt });
    }
  });

  const changed = created > 0 || updated > 0;
  if (changed) writeDelayRegister(projectId, next);

  return { rows: changed ? next : existing, created, updated, changed };
}

/** Count of delay events on record. Drives the "Delay Events" counter. */
export function countDelayEvents(rows: { length: number } | null | undefined): number {
  return Array.isArray(rows) ? rows.length : 0;
}

// ── Cost impact ────────────────────────────────────────────────────────

/**
 * Structural mirror of DelayModule.DelayRow — only the fields needed here.
 * DelayModule owns the real interface.
 */
export interface DelayRowLike {
  costImpact?: number;
}

/**
 * Gross delay-related cost impact = Σ costImpact across EVERY row in the
 * delay register, regardless of status.
 *
 * This is the single implementation behind BOTH the top "Cost Impact" tile and
 * the "Net Cost Impact" tile, so the two can never disagree. The caller passes
 * the same rows array the register renders — not a separate storage read.
 */
export function sumCostImpact(rows: DelayRowLike[]): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, r) => sum + (Number(r?.costImpact) || 0), 0);
}

/**
 * Net exposure after liquidated damages.
 *
 *   netCostImpact = grossCostImpact − ldExposure
 *
 * A NEGATIVE result is meaningful, not an error: liquidated damages exceed the
 * delay-related cost recorded in the register. Callers should flag it.
 */
export function computeNetCostImpact(grossCostImpact: number, ldExposure: number): number {
  return (Number(grossCostImpact) || 0) - (Number(ldExposure) || 0);
}

// ── Append-only LD log ─────────────────────────────────────────────────

export interface LdLogEntry {
  date: string;
  totalDelay: number;
  approvedExtension: number;
  culpableDelay: number;
  ldExposure: number;
  note?: string;
  updatedBy?: string;
}

const LD_LOG_KEY = (projectId: string) => `pactum-ld-log-${projectId}`;

export function readLdLog(projectId: string): LdLogEntry[] {
  const rows = readJson<LdLogEntry[]>(LD_LOG_KEY(projectId), []);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Append-only. Past entries are never edited or removed.
 * Returns the new log.
 */
export function appendLdLog(projectId: string, entry: LdLogEntry): LdLogEntry[] {
  const next = [...readLdLog(projectId), entry];
  try {
    localStorage.setItem(LD_LOG_KEY(projectId), JSON.stringify(next));
  } catch {
    /* quota — ignore */
  }
  return next;
}

/**
 * Snapshot signature. Used to skip appending when nothing material changed,
 * so the log records real events rather than every re-render.
 */
export function ldSignature(r: Pick<LdResult, 'totalDelay' | 'totalApprovedEOT' | 'culpableDelay' | 'ldRatePerDay' | 'ldCapAmount' | 'ldExposure'>): string {
  return [
    r.totalDelay, r.totalApprovedEOT, r.culpableDelay,
    r.ldRatePerDay, r.ldCapAmount, r.ldExposure,
  ].join('|');
}

export function buildLogEntry(r: LdResult, note?: string, updatedBy?: string): LdLogEntry {
  return {
    date: new Date().toISOString(),
    totalDelay: r.totalDelay,
    approvedExtension: r.totalApprovedEOT,
    culpableDelay: r.culpableDelay,
    ldExposure: r.ldExposure,
    ...(note ? { note } : {}),
    ...(updatedBy ? { updatedBy } : {}),
  };
}

// ── Project programme — commencement-driven ────────────────────────────
//
// Commencement Date is day zero of the contract programme.
//
//   Baseline Finish = Commencement + Planned Duration
//   Approved Finish = Baseline Finish + Approved EOT
//   Forecast Finish = Baseline Finish + Total Delay
//
// A project with no commencement date on record keeps working exactly as
// before: the stored contractualCompletion / approvedCompletion are used
// verbatim. Nothing is migrated and no stored field is overwritten.

export interface ProgrammeProjectLike {
  commencementDate?: string;
  plannedDurationDays?: number;
  contractualCompletion?: string;
  approvedCompletion?: string;
}

export interface ProgrammeResult {
  commencementDate: string;
  plannedDurationDays: number;
  /** Commencement + duration, or the stored date when no commencement set. */
  baselineFinish: string;
  /** Baseline + approved EOT. The contractual date after extensions. */
  approvedFinish: string;
  /**
   * Approved Finish + Total Delay. The date the works are actually expected
   * to complete once the delay on site is carried past the approved date.
   */
  estimatedFinish: string;
  /** Baseline + total delay. */
  forecastFinish: string;
  /** True when the dates above were derived from the commencement date. */
  derived: boolean;
}

/** Parses ISO or DD/MM/YYYY into a Date. Returns null on anything else. */
function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const v = String(value).trim();
  let y = 0, m = 0, d = 0;
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (match) { y = +match[1]; m = +match[2]; d = +match[3]; }
  else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (!match) return null;
    d = +match[1]; m = +match[2]; y = +match[3];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return isNaN(dt.getTime()) ? null : dt;
}

/** Adds whole days to an ISO / DD-MM date and returns ISO. '' on bad input. */
export function addDays(value: string | undefined, days: number): string {
  const dt = toDate(value);
  if (!dt) return '';
  dt.setUTCDate(dt.getUTCDate() + (Number(days) || 0));
  return dt.toISOString().slice(0, 10);
}

/** Whole days between two dates. 0 when either is unparseable. */
export function daysBetween(from?: string, to?: string): number {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function computeProgramme(
  project: ProgrammeProjectLike,
  approvedEot: number,
  totalDelay: number,
): ProgrammeResult {
  const commencementDate = (project.commencementDate || '').trim();
  const storedBaseline = project.contractualCompletion || '';

  // Duration falls back to the gap between commencement and the stored
  // baseline, so entering a commencement date alone still works.
  let plannedDurationDays = Number(project.plannedDurationDays) || 0;
  if (!plannedDurationDays && commencementDate && storedBaseline) {
    plannedDurationDays = Math.max(0, daysBetween(commencementDate, storedBaseline));
  }

  const derived = Boolean(commencementDate && plannedDurationDays > 0);

  const baselineFinish = derived
    ? addDays(commencementDate, plannedDurationDays)
    : storedBaseline;

  const approvedFinish = baselineFinish
    ? addDays(baselineFinish, Number(approvedEot) || 0)
    : (project.approvedCompletion || '');

  return {
    commencementDate,
    plannedDurationDays,
    baselineFinish,
    approvedFinish,
    // Estimated Finish carries the delay on site PAST the approved date.
    estimatedFinish: approvedFinish
      ? addDays(approvedFinish, Number(totalDelay) || 0)
      : '',
    forecastFinish: baselineFinish
      ? addDays(baselineFinish, Number(totalDelay) || 0)
      : (project.approvedCompletion || ''),
    derived,
  };
}
