/**
 * Company data access.
 * Destination: src/mock/companies.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 3G — this file is now a THIN ADAPTER, not a data source.
 *
 * WHAT CHANGED AND WHY
 *
 *   Phase 3E CRIT-3E-02: a company rename was written to
 *   `pactum-enterprise-companies` by EnterprisePortfolioPage, but TWELVE
 *   other consumers imported the `MOCK_COMPANIES` array straight from this
 *   file. The array is a module constant, so it never saw the edit — the
 *   new name appeared on exactly one screen and nowhere else.
 *
 *   Every function below now delegates to `lib/masterData`, which reads
 *   and writes one canonical store. A rename is therefore visible
 *   everywhere the instant it is saved, because there is no longer a
 *   second copy to fall out of step.
 *
 * PUBLIC API IS UNCHANGED
 *
 *   Company · MOCK_COMPANIES · fetchCompanies · persistCompanies ·
 *   findCompanyById
 *
 *   All 13 importing files keep working with no edit. `MOCK_COMPANIES` is
 *   retained as the FIRST-RUN SEED and is still exported so any direct
 *   reader compiles — but it is seed data now, not live state.
 *
 * ── Reading MOCK_COMPANIES directly is no longer correct ──────────────
 *
 *   Two files still do: PortfolioAnalyticsPage:73 and
 *   FinancialIntelligencePage:70. Both are repointed in this same phase to
 *   call `fetchCompanies()` instead, which returns live data.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  type Company as MdCompany,
  type RiskRating,
  type Compliance,
  fetchCompanies as mdFetchCompanies,
  findCompanyById as mdFindCompanyById,
  seedMasterData,
} from '../lib/masterData';

/**
 * Unchanged public shape. Re-exported from the registry so there is one
 * definition rather than two that can drift apart.
 */
export type Company = MdCompany;
export type { RiskRating, Compliance };

/**
 * FIRST-RUN SEED ONLY.
 *
 * Kept verbatim so a fresh browser produces exactly the dataset the app
 * has always shown. Once seeded, the registry owns the data and this array
 * is never read again — edits are not written back here.
 */
/**
 * ══════════════════════════════════════════════════════════════════════
 * PRE-PRODUCTION CLEAN SLATE — NO DEMO COMPANIES.
 *
 * Five demonstration companies used to live here and were seeded into
 * master data by `fetchCompanies()`, `fetchSectors()` and
 * `bootstrapMasterData()` — all of which run automatically, from many
 * modules, on ordinary page loads.
 *
 * The array is now EMPTY and every one of those paths therefore seeds
 * nothing, without a single call site changing. `seedMasterData` is
 * idempotent and skips empty input.
 *
 * The export is retained: it is imported by store.ts and by the sectors
 * mock, and an empty array is the honest answer for a system with no
 * companies yet. Create the first one in Company Management.
 * ══════════════════════════════════════════════════════════════════════
 */
export const MOCK_COMPANIES: Company[] = [];

/**
 * Live companies from the registry.
 *
 * Self-seeds on first call so a consumer that renders before
 * `bootstrapMasterData()` runs still sees the full dataset rather than an
 * empty grid. `seedMasterData` is idempotent and non-destructive, so this
 * is safe to call from anywhere, any number of times.
 */
export function fetchCompanies(): Company[] {
  seedMasterData(MOCK_COMPANIES, []);
  return mdFetchCompanies();
}

/**
 * Retained for API compatibility.
 *
 * Now genuinely a no-op: the registry persists on every mutation, so there
 * is nothing left for a caller to flush. Previously this was also a no-op,
 * which is part of why edits never propagated.
 */
export function persistCompanies(_companies: Company[]): boolean {
  return true;
}

export function findCompanyById(id: string): Company | undefined {
  seedMasterData(MOCK_COMPANIES, []);
  return mdFindCompanyById(id);
}
