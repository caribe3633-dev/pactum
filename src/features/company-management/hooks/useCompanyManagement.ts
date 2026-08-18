import { useEffect, useState } from 'react';
import type { Company } from '../types';
import {
  readCompanies, subscribeMasterData, masterDataVersion,
} from '../../../lib/masterData';

/**
 * Company Management — state hook.
 * Destination: src/features/company-management/hooks/useCompanyManagement.ts
 *
 * RECONSTRUCTED. Not present in the bundle; rebuilt from its call site in
 * `CompanyManagementModal`:
 *
 *   const { companies, loading, add, update, remove, archive, setCompanies }
 *     = useCompanyManagement(initial);
 *
 *   handleCreate  -> const next = add(c);      then onChange(next)
 *   handleUpdate  -> const next = update(c);   then onChange(next)
 *   handleArchive -> const next = archive(id); then onChange(next)
 *   confirmDelete -> const next = remove(id);  then onChange(next)
 *
 * ── The contract that matters ─────────────────────────────────────────
 *
 *   Each mutator returns the WHOLE NEXT ARRAY, which the modal hands to
 *   `onChange`. `EnterprisePortfolioPage.handleChange` then routes that
 *   array through `applyCompanyChanges`, which diffs it against the
 *   registry and calls the validated mutators.
 *
 *   So this hook deliberately does NOT write to storage. It computes the
 *   next array optimistically and lets the gateway decide what actually
 *   persists — otherwise a write would land here, unvalidated, and the
 *   gateway would be bypassed exactly as it was before Phase 3H.
 *
 *   It subscribes to the registry so the list re-renders when the gateway
 *   commits, or when any other screen changes a company.
 */
export function useCompanyManagement(initial?: Company[]) {
  const [companies, setCompanies] = useState<Company[]>(
    () => (initial && initial.length ? initial : readCompanies()),
  );
  const [loading, setLoading] = useState(false);

  // Live: re-read whenever the registry commits, from anywhere.
  useEffect(() => {
    const sync = () => setCompanies(readCompanies());
    sync();
    return subscribeMasterData(sync);
  }, [masterDataVersion()]);

  // A controlled parent may pass a fresher list than the registry read.
  useEffect(() => {
    if (initial && initial.length) setCompanies(initial);
  }, [initial]);

  /** Append. The gateway validates and may refuse. */
  const add = (c: Company): Company[] => {
    const next = [...companies, c];
    setCompanies(next);
    return next;
  };

  /** Replace by id. */
  const update = (c: Company): Company[] => {
    const next = companies.map(x => (x.id === c.id ? c : x));
    setCompanies(next);
    return next;
  };

  /**
   * Omit by id.
   *
   * Omission is how the gateway detects a delete. If the company still
   * has sectors or projects the gateway REFUSES, and the next
   * subscription tick restores it — which is the correct outcome, and
   * why nothing is deleted from storage here.
   */
  const remove = (id: string): Company[] => {
    const next = companies.filter(x => x.id !== id);
    setCompanies(next);
    return next;
  };

  /** Non-destructive. Allowed even when the company has dependents. */
  const archive = (id: string): Company[] => {
    const next = companies.map(x =>
      x.id === id ? { ...x, status: 'Archived' as const } : x);
    setCompanies(next);
    return next;
  };

  /**
   * SPRINT 2 — the inverse of `archive`.
   *
   * Archiving was reachable from the table but nothing could bring a
   * company back, so an accidental archive was permanent from the UI.
   * Like every other mutator here this only computes the next array; the
   * gateway validates and persists it.
   */
  const restore = (id: string): Company[] => {
    const next = companies.map(x =>
      x.id === id ? { ...x, status: 'Active' as const } : x);
    setCompanies(next);
    return next;
  };

  return { companies, loading, setLoading, add, update, remove, archive, restore, setCompanies };
}

export default useCompanyManagement;
