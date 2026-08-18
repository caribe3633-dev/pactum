/**
 * Master data start-up sequence.
 * Destination: src/lib/masterDataBootstrap.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * Runs ONCE per page load, before the first screen renders.
 *
 *   1 · SEED       first run only, from the mock modules
 *   2 · BACKFILL   recover companyId/sectorId for pre-3F projects
 *   3 · RECONCILE  rebuild the projectIds cache, refresh counts
 *   4 · VALIDATE   report anything still inconsistent
 *
 * Every step is non-destructive and idempotent. Running it twice changes
 * nothing the second time, which is what makes it safe to call from a
 * React effect that may fire twice under StrictMode.
 *
 * ── Why backfill is here and not in a migration script ────────────────
 *
 *   PACTUM has no backend and no migration runner. The only moment we can
 *   guarantee code executes against a user's data is app start-up. The
 *   operation is idempotent — a project that already carries both parents
 *   is skipped — so it costs nothing on every subsequent load.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  seedMasterData, reconcile, validateMasterData,
  type ValidationIssue,
} from './masterData';
import {
  backfillParentage, toLinks, type ProjectRecord,
} from './projectMaster';

export interface BootstrapReport {
  seeded: { companies: number; sectors: number };
  /** Projects that gained companyId/sectorId from the legacy cache. */
  linked: string[];
  /** Projects in two sectors — REPORTED, never guessed. */
  ambiguous: string[];
  /** Projects in no sector at all. */
  unlinked: string[];
  /** True when a project record was patched and must be persisted. */
  projectsChanged: boolean;
  projects: ProjectRecord[];
  issues: ValidationIssue[];
}

let hasRun = false;

/**
 * Full start-up sequence.
 *
 * PURE with respect to the projects array: the patched list is RETURNED
 * rather than written, because `useProjects` owns that store and is the
 * only thing allowed to commit it.
 *
 * @param projects   current projects from `useProjects()`
 * @param mockCompanies  seed data, only used on first ever run
 * @param mockSectors    seed data, only used on first ever run
 */
export function bootstrapMasterData(
  projects: ProjectRecord[],
  mockCompanies: any[] = [],
  mockSectors: any[] = [],
): BootstrapReport {
  // 1 · Seed. Non-destructive — an existing store is left untouched.
  const seeded = seedMasterData(mockCompanies, mockSectors);

  // 2 · Backfill from the legacy `projectIds` linkage.
  //     Uses the SEED sectors, because that is where the historical
  //     relationship was recorded before the registry existed.
  const legacySectors = (mockSectors ?? []).map((s: any) => ({
    id: String(s?.id ?? ''),
    companyId: String(s?.companyId ?? ''),
    projectIds: Array.isArray(s?.projectIds) ? s.projectIds.map(String) : [],
  }));

  const bf = backfillParentage(projects, legacySectors);

  // 3 · Rebuild the derived cache and the company counters.
  reconcile(toLinks(bf.projects));

  // 4 · Report what is still wrong. Never auto-repaired.
  const issues = validateMasterData(toLinks(bf.projects));

  hasRun = true;

  return {
    seeded,
    linked: bf.linked,
    ambiguous: bf.ambiguous,
    unlinked: bf.unlinked,
    projectsChanged: bf.linked.length > 0,
    projects: bf.projects,
    issues,
  };
}

/** Whether the sequence has already run this page load. */
export function isBootstrapped(): boolean {
  return hasRun;
}

/** Test hook. Not used by the app. */
export function resetBootstrapForTests(): void {
  hasRun = false;
}
