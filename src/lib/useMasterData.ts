/**
 * Master data React bindings.
 * Destination: src/lib/useMasterData.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 3F-UX · Task 2 — reactive master data.
 *
 * Phase 3E found master data correct on disk but STALE on screen: a
 * company rename appeared on the page that made it and nowhere else until
 * that page remounted. Two pages had each grown their own local workaround
 * (`CompanySectorsPage` a `tick` counter, `EnterprisePortfolioPage` a
 * manual `setCompanies`), and neither helped any OTHER mounted page.
 *
 * These hooks replace both workarounds with one subscription.
 *
 * ── Why `useSyncExternalStore` ────────────────────────────────────────
 *
 *   It is React's own primitive for exactly this: an external mutable
 *   source that components must stay in step with. It handles tearing,
 *   StrictMode double-invocation and unmount-during-notify correctly,
 *   which a hand-rolled `useEffect` + `useState` pair does not.
 *
 * ── Why the snapshot is a VERSION NUMBER ──────────────────────────────
 *
 *   `useSyncExternalStore` demands a snapshot that is referentially stable
 *   between changes — returning a fresh array each call causes an infinite
 *   render loop. Master data is read through eight different functions
 *   (`findCompanyById`, `fetchSectors`, `findSectorsByCompany`, …), so
 *   there is no single value to snapshot. The version integer is stable,
 *   changes exactly once per write, and the derived `useMemo` below
 *   re-reads whatever that particular screen actually needs.
 *
 * ── No business logic ─────────────────────────────────────────────────
 *
 *   These hooks read and subscribe. They compute nothing.
 * ══════════════════════════════════════════════════════════════════════
 */

import { useMemo, useSyncExternalStore } from 'react';
import {
  subscribeMasterData,
  masterDataVersion,
  readCompanies,
  readSectors,
  fetchCompanies,
  findCompanyById,
  findSectorById,
  findSectorsByCompany,
  companyNameOf,
  sectorNameOf,
  type Company,
  type Sector,
} from './masterData';

/**
 * The current master data version.
 *
 * Any component calling this re-renders when companies or sectors change,
 * anywhere in the app. Prefer the derived hooks below; this is the escape
 * hatch for a screen with an unusual read.
 */
export function useMasterDataVersion(): number {
  return useSyncExternalStore(
    subscribeMasterData,
    masterDataVersion,
    // Server snapshot — same value, so SSR and hydration agree.
    masterDataVersion,
  );
}

/** Every company, live. Archived included — filter at the call site. */
export function useCompanies(): Company[] {
  const v = useMasterDataVersion();
  return useMemo(() => fetchCompanies(), [v]);
}

/** Companies that can receive new work. */
export function useActiveCompanies(): Company[] {
  const v = useMasterDataVersion();
  return useMemo(() => fetchCompanies().filter(c => c.status !== 'Archived'), [v]);
}

/** One company, live. `undefined` when the id is unknown — never invented. */
export function useCompany(id: string | undefined): Company | undefined {
  const v = useMasterDataVersion();
  return useMemo(() => (id ? findCompanyById(id) : undefined), [id, v]);
}

/** Every sector, live, ordered. */
export function useSectors(): Sector[] {
  const v = useMasterDataVersion();
  return useMemo(() => readSectors(), [v]);
}

/** One sector, live. */
export function useSector(id: string | undefined): Sector | undefined {
  const v = useMasterDataVersion();
  return useMemo(() => (id ? findSectorById(id) : undefined), [id, v]);
}

/** A company's sectors, live, in display order. */
export function useCompanySectors(companyId: string | undefined): Sector[] {
  const v = useMasterDataVersion();
  return useMemo(
    () => (companyId ? findSectorsByCompany(companyId) : []),
    [companyId, v],
  );
}

/**
 * A company's display name, live and language-aware.
 * Returns an em dash for an unknown id rather than inventing a name.
 */
export function useCompanyName(id: string | undefined, lang: 'en' | 'ar' = 'en'): string {
  const v = useMasterDataVersion();
  return useMemo(() => (id ? companyNameOf(id, lang) : '—'), [id, lang, v]);
}

/** A sector's display name, live and language-aware. */
export function useSectorName(id: string | undefined, lang: 'en' | 'ar' = 'en'): string {
  const v = useMasterDataVersion();
  return useMemo(() => (id ? sectorNameOf(id, lang) : '—'), [id, lang, v]);
}

/** Raw company records, live — for a screen that needs the unsorted list. */
export function useRawCompanies(): Company[] {
  const v = useMasterDataVersion();
  return useMemo(() => readCompanies(), [v]);
}
