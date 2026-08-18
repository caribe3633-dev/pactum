/**
 * Sector data access.
 * Destination: src/mock/sectors.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 3G — thin adapter over `lib/masterData`.
 *
 * WHAT CHANGED AND WHY
 *
 *   Phase 3E CRIT-3E-04: sectors had no CRUD whatsoever. They lived here
 *   as a module constant with no writer, which meant a user could not
 *   create, rename, delete or reorder one — and, because `projectIds` was
 *   the only thing linking a project to its parents, it also meant a newly
 *   created project could never be attached to anything (CRIT-3E-01).
 *
 *   The registry now owns sectors. This file keeps the same four exports
 *   so all 17 importing files compile untouched.
 *
 * ── `projectIds` is now a DERIVED CACHE ───────────────────────────────
 *
 *   The authoritative link is `Project.sectorId` (see `lib/projectMaster`).
 *   `masterData.reconcile()` rebuilds `projectIds` from the projects array
 *   on start-up and after any mutation.
 *
 *   It is retained precisely so the 13 existing call sites of the form
 *
 *       sectors.find(s => s.projectIds.includes(project.id))
 *
 *   keep working with no edit. Where cache and record disagree, the
 *   project record wins — it is what a human actually filled in.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  type Sector as MdSector,
  fetchSectors as mdFetchSectors,
  findSectorById as mdFindSectorById,
  findSectorsByCompany as mdFindSectorsByCompany,
  seedMasterData,
} from '../lib/masterData';
import { MOCK_COMPANIES } from './companies';

/**
 * Unchanged public shape, widened by the registry's additive fields
 * (`status`, `order`, `nameAr`, `createdAt`, `createdBy`). Every existing
 * reader uses only `id`, `name`, `companyId` and `projectIds`.
 */
export type Sector = MdSector;

/**
 * FIRST-RUN SEED ONLY. Verbatim from the original file.
 *
 * `projectIds` here is the historical linkage; `backfillParentage()` in
 * `lib/projectMaster` uses exactly this to recover `companyId`/`sectorId`
 * for projects created before Phase 3F.
 */
/**
 * PRE-PRODUCTION CLEAN SLATE — NO DEMO SECTORS.
 *
 * Four demonstration sectors were seeded here by `ensureSeeded()`, which
 * runs on every `fetchSectors()` call — and that is called from Budget,
 * Baseline, Currency Migration, Cash Repair and the subcontractor panel.
 * Emptying the source neutralises all of them at once.
 */
export const MOCK_SECTORS = [];

/** Seeds both stores together — sectors are meaningless without parents. */
function ensureSeeded(): void {
  seedMasterData(MOCK_COMPANIES, MOCK_SECTORS);
}

export function fetchSectors(): Sector[] {
  ensureSeeded();
  return mdFetchSectors();
}

export function findSectorById(id: string): Sector | undefined {
  ensureSeeded();
  return mdFindSectorById(id);
}

export function findSectorsByCompany(companyId: string): Sector[] {
  ensureSeeded();
  return mdFindSectorsByCompany(companyId);
}
