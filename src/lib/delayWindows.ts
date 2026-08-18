/**
 * Windows Analysis — monthly delay snapshots.
 * Destination: src/lib/delayWindows.ts
 *
 * WHAT A WINDOW IS
 *   One calendar month, identified by its LAST day: Window-2026-01 covers
 *   January 2026 and is stamped 2026-01-31.
 *
 * WHO CREATES ONE
 *   Nobody. A window materialises on the first change recorded inside that
 *   month and is refreshed on every subsequent change in the SAME month.
 *   Once the month passes, its snapshot is never rewritten — it becomes the
 *   historical record for that period.
 *
 * WHAT IT HOLDS
 *   A snapshot only. Windows never own source data and never write back into
 *   the delay register, claims, change orders or contracts. Deleting every
 *   window would lose history but change no live figure.
 *
 * STORAGE
 *   pactum-delay-windows-${projectId}  ->  DelayWindow[]  (ascending by id)
 */

import { formatMonthYear } from './dateFormat';

// ── Shapes ─────────────────────────────────────────────────────────────

/** Project-level position at the close of a window. */
export interface ProjectSnapshot {
  plannedFinish: string;
  forecastFinish: string;
  approvedFinish: string;
  currentVariance: number;
  totalDelay: number;
  approvedEot: number;
  unmitigatedDelay: number;
  recoveryRequired: number;
  ldExposure: number;
  costImpact: number;
  delayEventCount: number;
}

/** One subcontract's position at the close of a window. */
export interface SubcontractSnapshot {
  subId: string;
  code: string;
  company: string;
  trade: string;
  originalContract: number;
  currentContract: number;
  forecastFinish: string;
  approvedFinish: string;
  currentVariance: number;
  totalDelay: number;
  approvedExtension: number;
  delayDays: number;
  costImpact: number;
  ldExposure: number;
  outstanding: number;
  certified: number;
  paid: number;
}

/**
 * One delay-register event as it stood at the close of a window.
 * A frozen copy — editing the register later never rewrites a closed month.
 */
export interface WindowDelayEvent {
  id: string;
  delayId: string;
  description: string;
  responsibleParty: string;
  category: string;
  status: string;
  startDate: string;
  endDate: string;
  delayDays: number;
  eotDays: number;
  costImpact: number;
}

export interface DelayWindow {
  /** `2026-01` — sortable, one per calendar month. */
  id: string;
  /** Last day of the month, ISO. `2026-01-31`. */
  closesOn: string;
  /** When this snapshot was last written. */
  updatedAt: string;
  /**
   * A window for a month that has passed is frozen: no further writes.
   * Computed on read against today's date, never stored as a stale flag.
   */
  project: ProjectSnapshot;
  /**
   * The delay register as at the close of this month. This is what a project
   * window is ABOUT — subcontract history lives in its own sub-window store.
   */
  events: WindowDelayEvent[];
  /** Legacy field. Project windows no longer carry subcontract rows. */
  subcontractors?: SubcontractSnapshot[];
}

// ── Month helpers ──────────────────────────────────────────────────────

/** `2026-01` for any date. Defaults to today. */
export function windowIdFor(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Last calendar day of the month a window id refers to. */
export function windowClosesOn(id: string): string {
  const [y, m] = id.split('-').map(Number);
  if (!y || !m) return '';
  // Day 0 of the next month is the last day of this one.
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

/** Human label: `August 2026`. Month spelled out — never a number. */
export function windowLabel(id: string, lang: 'en' | 'ar' = 'en'): string {
  const [y, m] = id.split('-').map(Number);
  if (!y || !m) return id;
  return formatMonthYear(y, m, lang);
}

/**
 * Every month id from `start` to `end`, inclusive.
 * A project running since January 2025 shows twenty months of history, not
 * one — the window list is the project's timeline, not a single entry.
 */
export function monthRange(startId: string, endId: string): string[] {
  const [sy, sm] = startId.split('-').map(Number);
  const [ey, em] = endId.split('-').map(Number);
  if (!sy || !sm || !ey || !em) return [];
  const out: string[] = [];
  let y = sy, m = sm;
  // Guard against a bad start date producing an unbounded loop.
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard++ < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * A window is closed once its month is behind us. Closed windows are
 * read-only: they are the historical record and must not be rewritten.
 */
export function isWindowClosed(id: string, now: Date = new Date()): boolean {
  return id < windowIdFor(now);
}

// ── Storage ────────────────────────────────────────────────────────────

const KEY = (projectId: string) => `pactum-delay-windows-${projectId}`;

export function readWindows(projectId: string): DelayWindow[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(projectId)) || '[]');
    if (!Array.isArray(raw)) return [];
    return (raw as DelayWindow[]).slice().sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

function writeWindows(projectId: string, rows: DelayWindow[]): void {
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify(rows));
  } catch {
    /* quota — ignore */
  }
}

// ── Recording ──────────────────────────────────────────────────────────

export interface WindowInput {
  project: ProjectSnapshot;
  events: WindowDelayEvent[];
}

/**
 * Builds the snapshot for one month.
 * `closesOn` is the last day of that month, so a builder can exclude events
 * dated after it and produce a genuine period-end position.
 */
export type WindowBuilder = (closesOn: string, windowId: string) => WindowInput;

export interface RecordResult {
  windows: DelayWindow[];
  /** The window this call touched, or the existing one if nothing changed. */
  current: DelayWindow;
  created: boolean;
  updated: boolean;
}

/** Cheap deep-equality for the snapshot payload. */
function sameSnapshot(a: WindowInput, b: DelayWindow): boolean {
  return (
    JSON.stringify(a.project) === JSON.stringify(b.project) &&
    JSON.stringify(a.events || []) === JSON.stringify(b.events || [])
  );
}

/**
 * Records the current position into the CURRENT month's window.
 *
 * - Creates the window if this month has none yet.
 * - Refreshes it while the month is still open.
 * - Never touches a window whose month has closed.
 * - Skips the write entirely when nothing material changed, so the log
 *   records real movement rather than every render.
 */
export function recordWindow(
  projectId: string,
  input: WindowInput,
  now: Date = new Date(),
): RecordResult {
  const windows = readWindows(projectId);
  const id = windowIdFor(now);
  const idx = windows.findIndex(w => w.id === id);

  if (idx !== -1) {
    const existing = windows[idx];
    if (sameSnapshot(input, existing)) {
      return { windows, current: existing, created: false, updated: false };
    }
    const next: DelayWindow = {
      ...existing,
      updatedAt: now.toISOString(),
      project: input.project,
      events: input.events,
    };
    const out = windows.slice();
    out[idx] = next;
    writeWindows(projectId, out);
    return { windows: out, current: next, created: false, updated: true };
  }

  const created: DelayWindow = {
    id,
    closesOn: windowClosesOn(id),
    updatedAt: now.toISOString(),
    project: input.project,
    events: input.events,
  };
  const out = [...windows, created].sort((a, b) => a.id.localeCompare(b.id));
  writeWindows(projectId, out);
  return { windows: out, current: created, created: true, updated: false };
}

export interface BackfillResult {
  windows: DelayWindow[];
  created: number;
  updated: number;
}

/**
 * Materialises one window per month from `startId` to the current month.
 *
 * A project running for a year has twelve windows, not one. Months already on
 * record and CLOSED are left exactly as they are — that is the whole point of
 * a historical snapshot. Only the current month is refreshed.
 *
 * `build` is called once per missing month with that month's closing date, so
 * each snapshot reflects the position as at its own period end.
 */
export function backfillWindows(
  projectId: string,
  startId: string,
  build: WindowBuilder,
  now: Date = new Date(),
): BackfillResult {
  const existing = readWindows(projectId);
  const byId = new Map(existing.map(w => [w.id, w]));
  const currentId = windowIdFor(now);

  // A start later than today still yields the current month.
  const from = startId && startId <= currentId ? startId : currentId;
  const ids = monthRange(from, currentId);

  let created = 0;
  let updated = 0;
  const out: DelayWindow[] = [];

  ids.forEach(id => {
    const closesOn = windowClosesOn(id);
    const prior = byId.get(id);
    const closed = isWindowClosed(id, now);

    // Closed month already on record: frozen, never rebuilt.
    // A window written before events existed is rebuilt once, then frozen.
    if (prior && closed && Array.isArray(prior.events)) { out.push(prior); return; }

    const input = build(closesOn, id);

    if (prior) {
      if (sameSnapshot(input, prior)) { out.push(prior); return; }
      out.push({ ...prior, updatedAt: now.toISOString(), project: input.project, events: input.events });
      updated++;
      return;
    }

    out.push({
      id,
      closesOn,
      updatedAt: now.toISOString(),
      project: input.project,
      events: input.events,
    });
    created++;
  });

  // Anything outside the range (e.g. an earlier start that later moved) is
  // preserved rather than silently dropped.
  existing.forEach(w => { if (!ids.includes(w.id)) out.push(w); });

  out.sort((a, b) => a.id.localeCompare(b.id));
  if (created > 0 || updated > 0) writeWindows(projectId, out);
  return { windows: out, created, updated };
}

/** Movement between two consecutive windows. Reporting only. */
export interface WindowDelta {
  totalDelay: number;
  approvedEot: number;
  unmitigatedDelay: number;
  ldExposure: number;
  costImpact: number;
  delayEventCount: number;
}

export function windowDelta(prev: DelayWindow | undefined, cur: DelayWindow): WindowDelta | null {
  if (!prev) return null;
  return {
    totalDelay: cur.project.totalDelay - prev.project.totalDelay,
    approvedEot: cur.project.approvedEot - prev.project.approvedEot,
    unmitigatedDelay: cur.project.unmitigatedDelay - prev.project.unmitigatedDelay,
    ldExposure: cur.project.ldExposure - prev.project.ldExposure,
    costImpact: cur.project.costImpact - prev.project.costImpact,
    delayEventCount: cur.project.delayEventCount - prev.project.delayEventCount,
  };
}


// ── Subcontract windows ────────────────────────────────────────────────
//
// A subcontract keeps its OWN monthly history, independent of the project's.
// Each entry also carries the project position for the same month so the two
// can be compared side by side without re-deriving anything.
//
// STORAGE
//   pactum-sub-windows-${projectId}  ->  Record<subId, SubWindow[]>

export interface SubWindow {
  id: string;
  closesOn: string;
  updatedAt: string;
  /** This subcontract, as at the close of the month. */
  subcontract: SubcontractSnapshot;
  /** The project's position in the same month, for comparison. */
  project: ProjectSnapshot;
  /** Delay events on record for this subcontract at the cut-off. */
  delayEventCount: number;
}

const SUB_KEY = (projectId: string) => `pactum-sub-windows-${projectId}`;

type SubWindowMap = Record<string, SubWindow[]>;

function readSubWindowMap(projectId: string): SubWindowMap {
  try {
    const raw = JSON.parse(localStorage.getItem(SUB_KEY(projectId)) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function readSubWindows(projectId: string, subId: string): SubWindow[] {
  const rows = readSubWindowMap(projectId)[subId];
  return Array.isArray(rows) ? rows.slice().sort((a, b) => a.id.localeCompare(b.id)) : [];
}

export type SubWindowBuilder = (closesOn: string, windowId: string) =>
  { subcontract: SubcontractSnapshot; project: ProjectSnapshot; delayEventCount: number };

/**
 * Same rule as the project: one window per month from `startId` to now,
 * closed months frozen, current month refreshed.
 */
export function backfillSubWindows(
  projectId: string,
  subId: string,
  startId: string,
  build: SubWindowBuilder,
  now: Date = new Date(),
): SubWindow[] {
  const map = readSubWindowMap(projectId);
  const existing = Array.isArray(map[subId]) ? map[subId] : [];
  const byId = new Map(existing.map(w => [w.id, w]));
  const currentId = windowIdFor(now);
  const from = startId && startId <= currentId ? startId : currentId;
  const ids = monthRange(from, currentId);

  let changed = false;
  const out: SubWindow[] = [];

  ids.forEach(id => {
    const closesOn = windowClosesOn(id);
    const prior = byId.get(id);
    if (prior && isWindowClosed(id, now)) { out.push(prior); return; }

    const built = build(closesOn, id);
    const next: SubWindow = {
      id,
      closesOn,
      updatedAt: now.toISOString(),
      subcontract: built.subcontract,
      project: built.project,
      delayEventCount: built.delayEventCount,
    };

    if (prior &&
        JSON.stringify(prior.subcontract) === JSON.stringify(next.subcontract) &&
        JSON.stringify(prior.project) === JSON.stringify(next.project) &&
        prior.delayEventCount === next.delayEventCount) {
      out.push(prior);
      return;
    }
    out.push(next);
    changed = true;
  });

  existing.forEach(w => { if (!ids.includes(w.id)) out.push(w); });
  out.sort((a, b) => a.id.localeCompare(b.id));

  if (changed) {
    map[subId] = out;
    try { localStorage.setItem(SUB_KEY(projectId), JSON.stringify(map)); } catch { /* quota */ }
  }
  return out;
}
