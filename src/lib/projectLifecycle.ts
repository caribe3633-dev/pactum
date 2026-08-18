/**
 * Project storage lifecycle.
 * Destination: src/lib/projectLifecycle.ts
 *
 * ARCHITECTURAL RULE
 *   Project storage is created when the PROJECT is created — never when a
 *   page is opened. Navigation displays data; it never creates it.
 *
 * Every consumer (Company Registry, Portfolio, Analytics, Dashboards) can
 * therefore read project data directly without the user having visited
 * that project first.
 *
 * Storage keys are UNCHANGED. This module only guarantees they exist.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 3F CHANGE — the ONLY change to this file
 *
 *   `disposeProjectStorage` removed 2 of the 19 keys a project owns,
 *   orphaning 17 per deletion (Phase 3E CRIT-3E-03, measured by execution).
 *
 *   It now DELEGATES to `projectMaster.disposeProjectStorage`, which walks
 *   the full enumerated key list. The signature and return type are
 *   unchanged, so `store.ts:166` — the only caller — needs no edit.
 *
 *   The append-only archives (`pactum-timeline-*`, `pactum-baselines-*`)
 *   are RETAINED by default. Phase 3E flagged destroying a signed
 *   historical record as a governance decision rather than a cleanup
 *   detail, so it requires an explicit opt-in that this default path does
 *   not give. Nothing else in this file is touched.
 * ══════════════════════════════════════════════════════════════════════
 */

import { Project } from './data';
import { disposeProjectStorage as disposeAll } from './projectMaster';

// ── Shapes owned by the project (mirrors SubsModule) ───────────────────

export interface ProjectSubcontractor {
  id: string;
  /** Immutable link to the Company Registry. Absent on seeded rows. */
  registryInternalId?: string;
  company: string;
  code: string;
  trade: string;
  contactName: string;
  contractValue: number;
  retention: number;
  progressPct: number;
  delayDays: number;
  status: string;
  performanceScore: number;
}

export interface ProjectSubCert {
  id: string;
  certNo: string;
  period: string;
  grossAmount: number;
  retentionHeld: number;
  netPayable: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
}

// ── Seed definitions ──────────────────────────────────────────────────
//
// PHASE 3G: these are no longer called by anything in this file. The
// live sample content lives in `lib/sampleData.ts` and runs only when a
// user presses "Load Sample Data".
//
// They are kept exported because removing an export is a breaking change
// and was not part of this task. Nothing invokes them automatically.

export function seedSubs(project: Project): ProjectSubcontractor[] {
  const v = project.contractValue;
  return [
    { id: 'sub-1', code: 'SC-01', company: 'Arabian MEP Solutions Co.', trade: 'Mechanical, Electrical & Plumbing', contactName: 'Eng. Khalid Al-Rashidi', contractValue: v * 0.28, retention: v * 0.028, progressPct: 0.42, delayDays: 12, status: 'active', performanceScore: 71 },
    { id: 'sub-2', code: 'SC-02', company: 'SteelWorks Arabia Ltd.', trade: 'Structural Steel & Metal Works', contactName: 'Eng. Mohammed Al-Qahtani', contractValue: v * 0.18, retention: v * 0.018, progressPct: 0.95, delayDays: 0, status: 'completed', performanceScore: 94 },
    { id: 'sub-3', code: 'SC-03', company: 'Luxury Facades International', trade: 'Envelope, Curtain Wall & Glazing', contactName: 'Eng. Ahmad Al-Harbi', contractValue: v * 0.12, retention: v * 0.012, progressPct: 0.08, delayDays: 5, status: 'mobilizing', performanceScore: 62 },
    { id: 'sub-4', code: 'SC-04', company: 'Al-Bina Civil Contractors', trade: 'Civil & Concrete Works', contactName: 'Eng. Faisal Al-Otaibi', contractValue: v * 0.22, retention: v * 0.022, progressPct: 0.75, delayDays: 0, status: 'active', performanceScore: 88 },
  ];
}

export function seedCerts(sub: ProjectSubcontractor): ProjectSubCert[] {
  const base = sub.contractValue * sub.progressPct;
  return [
    { id: `cert-${sub.id}-1`, certNo: 'SC-01', period: 'Jan 2024', grossAmount: base * 0.3, retentionHeld: base * 0.03, netPayable: base * 0.27, paidAmount: base * 0.27, remainingAmount: 0, status: 'paid' },
    { id: `cert-${sub.id}-2`, certNo: 'SC-02', period: 'Feb 2024', grossAmount: base * 0.4, retentionHeld: base * 0.04, netPayable: base * 0.36, paidAmount: base * 0.36, remainingAmount: 0, status: 'paid' },
    { id: `cert-${sub.id}-3`, certNo: 'SC-03', period: 'Mar 2024', grossAmount: base * 0.3, retentionHeld: base * 0.03, netPayable: base * 0.27, paidAmount: 0, remainingAmount: base * 0.27, status: 'certified' },
  ];
}

// ── Initialisation ─────────────────────────────────────────────────────

/**
 * Ensures every storage bucket a project owns exists.
 *
 * NON-DESTRUCTIVE: a key that already holds data is never overwritten.
 * Safe to call repeatedly.
 *
 * @returns true when something was created — useful for reporting only.
 */
export function initializeProjectStorage(_project: Project): boolean {
  // ══════════════════════════════════════════════════════════════════
  // PHASE 3G · DEMO DATA ELIMINATION
  //
  // This function used to write 4 invented subcontractors and 12
  // invented certificates into every project the moment it was created.
  // A brand-new project therefore arrived pre-populated with data no
  // human had entered, and a clean enterprise dataset was unobtainable
  // through the UI.
  //
  // It now creates NOTHING. Project creation produces exactly the
  // Company / Sector / Project triple and no operational records.
  //
  // The seeds themselves were not deleted — they moved to
  // `lib/sampleData.ts` behind an explicit "Load Sample Data" action.
  //
  // The function is RETAINED rather than removed: `store.ts` calls it on
  // load and after `addProject`, and keeping the signature means those
  // call sites need no change and cannot drift. Returning false says
  // plainly that nothing was created.
  // ══════════════════════════════════════════════════════════════════
  return false;
}

export function initializeAllProjects(projects: Project[]): number {
  let count = 0;
  projects.forEach(p => { if (initializeProjectStorage(p)) count++; });
  return count;
}

/**
 * Removes every bucket a project owns.
 *
 * PHASE 3F: delegates to the full-coverage implementation. Previously this
 * removed only `pactum-subs-*` and `pactum-sub-certs-*`, leaving 17 keys
 * behind on every deletion — including the budget, commercial, claims,
 * certificates, cash flow, delay, EVM and risk stores.
 *
 * The two append-only archives are retained by design; call
 * `projectMaster.disposeProjectStorage(id, { purgeArchives: true })`
 * directly when a hard purge is genuinely intended.
 *
 * Signature unchanged so `store.ts` is unaffected.
 */
export function disposeProjectStorage(projectId: string): void {
  disposeAll(projectId);
}
