/**
 * Company Subcontractor Registry — master data + read-only aggregation.
 * Destination: src/lib/subcontractors.ts
 *
 * ARCHITECTURE
 *   Company -> Subcontractor Registry (master identity)
 *   Project -> Assignment -> Contract -> Monthly Certificates (execution)
 *
 * The registry owns identity ONLY:
 *   internalId | subcontractorId | companyName | status
 *
 * Everything else is derived by scanning projects that belong to THIS
 * company. The registry never writes to project storage.
 *
 * COMPANY-SCOPED
 *   Each company owns an independent registry. The same subcontractorId
 *   and the same companyName may legally exist in different companies.
 *   Projects outside the current company are never scanned.
 *
 * STORAGE — existing keys are read as-is, never modified:
 *   pactum-subs-${projectId}        SubcontractorRecord[]   (project-owned)
 *   pactum-sub-certs-${projectId}   Record<subId, SubCertRow[]> (project-owned)
 *
 * New key, registry only:
 *   pactum-sub-registry-${companyId}
 */

import {
  readCommercial, rollupCommercial, currentContractValue,
  type CommercialRollup, type LatestRecord,
} from './subcontractCommercial';
// The single authority for a performance score. `subPerformance` imports
// only `subcontractCommercial`, so this introduces no cycle.
import { evaluateAssignment } from './subPerformance';

// â”€â”€ Registry master record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type RegistryStatus = 'Active' | 'Inactive';

/** Contact person. Identity data — owned by the registry, never by projects. */
export interface RegistryContact {
  id: string;
  /** Required. */
  name: string;
  /** Optional. */
  position: string;
  /** Required. */
  mobile: string;
  /** Optional — validated when present. */
  email: string;
}

export interface RegistrySubcontractor {
  /**
   * Immutable internal identifier.
   * PHASE 1: not yet used for linking.
   * PHASE 2: assignments will carry this as registryInternalId.
   * Present from day one so the future migration needs no schema change.
   */
  internalId: string;

  /** Official business code. Editable. Matches project `code` in Phase 1. */
  subcontractorId: string;

  /** Editable. */
  companyName: string;

  /** Editable. */
  status: RegistryStatus;

  /** Contact persons. Optional — legacy rows have none. */
  contacts?: RegistryContact[];

  /** Owning company — registry is company-scoped. */
  companyId: string;

  createdAt: string;
}

const REGISTRY_KEY = (companyId: string) => `pactum-sub-registry-${companyId}`;

export function readRegistry(companyId: string): RegistrySubcontractor[] {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY(companyId));
    return raw ? (JSON.parse(raw) as RegistrySubcontractor[]) : [];
  } catch {
    return [];
  }
}

function writeRegistry(companyId: string, records: RegistrySubcontractor[]): void {
  try {
    localStorage.setItem(REGISTRY_KEY(companyId), JSON.stringify(records));
  } catch {
    /* quota exceeded — ignore */
  }
}

function newInternalId(): string {
  return `reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Duplicate check is scoped to the company only.
 * The same code in another company is legal.
 */
export function isDuplicateCode(
  companyId: string,
  subcontractorId: string,
  exceptInternalId?: string,
): boolean {
  const code = subcontractorId.trim().toLowerCase();
  return readRegistry(companyId).some(
    r => r.internalId !== exceptInternalId && r.subcontractorId.trim().toLowerCase() === code,
  );
}

export function createRegistrySubcontractor(
  companyId: string,
  data: { subcontractorId: string; companyName: string; status?: RegistryStatus },
): RegistrySubcontractor {
  const record: RegistrySubcontractor = {
    internalId: newInternalId(),
    subcontractorId: data.subcontractorId.trim(),
    companyName: data.companyName.trim(),
    status: data.status ?? 'Active',
    companyId,
    createdAt: new Date().toISOString(),
  };
  writeRegistry(companyId, [...readRegistry(companyId), record]);
  return record;
}

/** Only the three editable business fields may be patched. */
export function updateRegistrySubcontractor(
  companyId: string,
  internalId: string,
  patch: Partial<Pick<RegistrySubcontractor, 'subcontractorId' | 'companyName' | 'status' | 'contacts'>>,
): void {
  writeRegistry(
    companyId,
    readRegistry(companyId).map(r => (r.internalId === internalId ? { ...r, ...patch } : r)),
  );
}

// â”€â”€ Contacts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function readContacts(companyId: string, internalId: string): RegistryContact[] {
  return readRegistry(companyId).find(r => r.internalId === internalId)?.contacts ?? [];
}

export function saveContacts(companyId: string, internalId: string, contacts: RegistryContact[]): void {
  updateRegistrySubcontractor(companyId, internalId, { contacts });
}

export function newContactId(): string {
  return `ct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function deleteRegistrySubcontractor(companyId: string, internalId: string): void {
  writeRegistry(companyId, readRegistry(companyId).filter(r => r.internalId !== internalId));
}

// â”€â”€ Project-owned shapes (read-only mirrors of SubsModule) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Mirrors SubsModule.SubcontractorRecord. Project-owned. Never written here. */
interface ProjectSubRecord {
  id: string;
  /**
   * Immutable link to the registry. Written by every NEW assignment.
   * Absent on legacy rows — those fall back to `code`.
   */
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

/** Mirrors SubsModule.SubCertRow. Project-owned. Never written here. */
interface ProjectCertRow {
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

function readProjectSubs(projectId: string): ProjectSubRecord[] {
  try {
    const raw = JSON.parse(localStorage.getItem(`pactum-subs-${projectId}`) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function readProjectCerts(projectId: string): Record<string, ProjectCertRow[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(`pactum-sub-certs-${projectId}`) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

// â”€â”€ PHASE 1 LINKAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Resolves a project assignment to a registry record.
 *
 * Priority:
 *   1. registryInternalId  — immutable, written by all NEW assignments
 *   2. subcontractorId     — legacy fallback for pre-existing rows
 *
 * Read-only. Never writes, never migrates. Legacy rows keep resolving by
 * code until they are manually reassigned.
 */
function matchesRegistryRecord(assignment: ProjectSubRecord, record: RegistrySubcontractor): boolean {
  // 1. Immutable id wins whenever present — a renamed code cannot break it.
  if (assignment.registryInternalId) {
    return assignment.registryInternalId === record.internalId;
  }

  // 2. Legacy compatibility.
  const a = (assignment.code ?? '').trim().toLowerCase();
  const b = (record.subcontractorId ?? '').trim().toLowerCase();
  return a !== '' && a === b;
}

// â”€â”€ Derived aggregation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface RegistryProjectLink {
  projectId: string;
  projectName: string;
  projectCode: string;
  sectorId?: string;
  sectorName?: string;

  /** Project-owned execution data — displayed read-only in the registry. */
  trade: string;
  contractValue: number;
  retention: number;
  progressPct: number;
  delayDays: number;
  certified: number;
  certifiedPending: number;
  retentionHeld: number;
  outstanding: number;
  paidToDate: number;
  certificatesCount: number;
  latestCertificatePeriod: string | null;
  executionStatus: string;
  performanceScore: number;

  /**
   * Commercial data — owned by the project subcontract, read-only here.
   * Source: pactum-sub-commercial-${projectId}
   */
  originalContractValue: number;
  approvedChangeOrders: number;
  pendingChangeOrders: number;
  currentContractValue: number;
  approvedClaims: number;
  submittedClaims: number;
  approvedEotDays: number;
  pendingEotDays: number;
  changeOrdersCount: number;
  claimsCount: number;
  eotCount: number;

  /** Most recent record of each kind for this subcontract. */
  latestChangeOrder: LatestRecord | null;
  latestClaim: LatestRecord | null;
  latestEot: LatestRecord | null;

  /** Deep link to this subcontract inside its project. */
  subId: string;
}

export interface RegistryAggregate {
  record: RegistrySubcontractor;

  /**
   * true  -> no registry row exists; `record` is an in-memory placeholder
   *          derived from project assignments. Never persisted.
   * false -> a real registry row backs this aggregate.
   */
  isDerived: boolean;

  /** Derived — never stored. */
  trades: string[];
  sectors: { id: string; name: string }[];
  projects: RegistryProjectLink[];

  /** Unique projects. */
  projectsCount: number;
  /** Assignment rows — one project may hold several contracts. */
  contractsCount: number;
  totalContractValue: number;
  totalCertified: number;
  /** Certified but not yet paid. */
  totalCertifiedPending: number;
  totalOutstanding: number;
  totalPaid: number;
  certificatesCount: number;
  latestCertificatePeriod: string | null;

  overallProgress: number;
  /** Max delayDays — management needs the worst case, not the mean. */
  worstDelay: number;
  kpi: number;

  /** Contract-level retention agreed at award. */
  totalRetentionContract: number;
  /** Retention actually withheld across certificates to date. */
  totalRetentionHeld: number;

  /** 1-based rank after sorting. */
  rank: number;

  /**
   * Commercial totals aggregated across every project assignment.
   * Reporting only — editing happens in the project subcontract.
   */
  totalOriginalContract: number;
  totalApprovedChangeOrders: number;
  totalPendingChangeOrders: number;
  totalCurrentContract: number;
  totalApprovedClaims: number;
  totalSubmittedClaims: number;
  totalApprovedEotDays: number;
  totalPendingEotDays: number;
  changeOrdersCount: number;
  claimsCount: number;
  eotCount: number;

  /** Latest across every project, carrying the project it belongs to. */
  latestChangeOrder: (LatestRecord & { projectName: string; projectId: string }) | null;
  latestClaim: (LatestRecord & { projectName: string; projectId: string }) | null;
  latestEot: (LatestRecord & { projectName: string; projectId: string }) | null;
}

/** Certificate maths — mirrors SubsModule exactly. */
function summariseCerts(certs: ProjectCertRow[]) {
  // "Total Certified to Date" — cumulative. Mirrors SubsModule's header card:
  // a paid certificate WAS certified, so it must stay counted. Using
  // `certified` alone makes the figure shrink whenever a payment lands.
  const certified = certs
    .filter(c => c.status === 'certified' || c.status === 'paid')
    .reduce((a, c) => a + (c.grossAmount || 0), 0);

  // Certified but not yet paid — SubsModule labels this "Certified (Pending)".
  const certifiedPending = certs
    .filter(c => c.status === 'certified')
    .reduce((a, c) => a + (c.netPayable || 0), 0);

  const outstanding = certs.reduce((a, c) => a + (c.remainingAmount || 0), 0);

  const paid = certs
    .filter(c => c.status === 'paid')
    .reduce((a, c) => a + (c.paidAmount || 0), 0);

  const retentionHeld = certs.reduce((a, c) => a + (c.retentionHeld || 0), 0);

  // Decision (5): last inserted certificate. `period` is free text — never parsed.
  const latest = certs.length > 0 ? certs[certs.length - 1].period || null : null;

  return { certified, certifiedPending, outstanding, paid, retentionHeld, count: certs.length, latest };
}

/**
 * Build read-only aggregates for every registry record in a company.
 *
 * @param companyId  the company that owns this registry
 * @param projects   all projects (filtered internally to this company)
 * @param sectors    sectors belonging to this company — from findSectorsByCompany
 */
export function aggregateRegistry(
  companyId: string,
  projects: any[],
  sectors: { id: string; name: string; projectIds: string[] }[],
): RegistryAggregate[] {
  // Registry ENRICHES the analytics — it never gates them.
  // Projects are the source of truth for execution data.
  const registry = readRegistry(companyId);

  // projectId -> sector, company-scoped
  const sectorOf = new Map<string, { id: string; name: string }>();
  sectors.forEach(s => s.projectIds.forEach(pid => sectorOf.set(pid, { id: s.id, name: s.name })));

  // Only projects inside this company's sectors — never scan outside
  const companyProjects = projects.filter(p => sectorOf.has(p.id));

  // Read every relevant project once
  const projectData = companyProjects.map(project => ({
    project,
    sector: sectorOf.get(project.id),
    subs: readProjectSubs(project.id),
    certs: readProjectCerts(project.id),
  }));

  // â”€â”€ Discover every subcontractor code present in company projects â”€â”€
  // Grouping key is the normalised business code (Phase 1 relationship).
  const codeIndex = new Map<string, { code: string; name: string }>();
  const linkedIds = new Set(registry.map(r => r.internalId));
  projectData.forEach(({ subs }) => {
    subs.forEach(sub => {
      // Already bound to a real registry row by immutable id — not derived.
      if (sub.registryInternalId && linkedIds.has(sub.registryInternalId)) return;
      const key = (sub.code ?? '').trim().toLowerCase();
      if (!key) return;                       // unusable as a grouping key
      if (!codeIndex.has(key)) {
        codeIndex.set(key, { code: (sub.code ?? '').trim(), name: (sub.company ?? '').trim() });
      }
    });
  });

  // Registry rows first, then derived placeholders for unmatched project codes.
  const registryCodes = new Set(
    registry.map(r => (r.subcontractorId ?? '').trim().toLowerCase()),
  );

  const derived: RegistrySubcontractor[] = [];
  codeIndex.forEach((info, key) => {
    if (registryCodes.has(key)) return;       // already covered by a real row
    derived.push({
      // IN-MEMORY ONLY. Never written. A future Import creates the real row.
      internalId: `derived:${key}`,
      subcontractorId: info.code,
      companyName: info.name || info.code,
      status: 'Active',
      contacts: [],
      companyId,
      createdAt: '',
    });
  });

  const allRecords: { record: RegistrySubcontractor; isDerived: boolean }[] = [
    ...registry.map(record => ({ record, isDerived: false })),
    ...derived.map(record => ({ record, isDerived: true })),
  ];

  const aggregates: RegistryAggregate[] = allRecords.map(({ record, isDerived }) => {
    const links: RegistryProjectLink[] = [];

    projectData.forEach(({ project, sector, subs, certs }) => {
      subs
        .filter(sub => matchesRegistryRecord(sub, record))
        .forEach(sub => {
          const c = summariseCerts(certs[sub.id] || []);

          // Commercial data lives with the project subcontract. Read-only here.
          const comm: CommercialRollup = rollupCommercial(readCommercial(project.id, sub.id));
          const original = sub.contractValue || 0;

          links.push({
            projectId: project.id,
            projectName: project.nameEn ?? project.name ?? project.id,
            projectCode: project.code ?? '',
            sectorId: sector?.id,
            sectorName: sector?.name,
            trade: sub.trade || '',
            contractValue: sub.contractValue || 0,
            retention: sub.retention || 0,
            progressPct: sub.progressPct || 0,
            delayDays: sub.delayDays || 0,
            certified: c.certified,
            certifiedPending: c.certifiedPending,
            retentionHeld: c.retentionHeld,
            outstanding: c.outstanding,
            paidToDate: c.paid,
            certificatesCount: c.count,
            latestCertificatePeriod: c.latest,
            executionStatus: sub.status || '',
            /**
             * SCORED BY THE KPI ENGINE, NOT BY WHOEVER FILLED THE FORM.
             *
             * ════════════════════════════════════════════════════════════
             * This used to read `sub.performanceScore`, a number typed
             * into the assignment form and defaulted to 80. So a
             * subcontractor nobody had evaluated still contributed a
             * confident 80 to the company KPI ranking, and a real
             * evaluation recorded later never reached this rollup at all:
             * the card badge showed the engine's score while the company
             * ranking showed the typed one.
             *
             * `evaluateAssignment` is the same call the card badge makes,
             * so the two can no longer disagree. An assignment that has
             * not been evaluated scores 0 and is not silently promoted to
             * a passing grade.
             * ════════════════════════════════════════════════════════════
             */
            performanceScore: (() => {
              const p = evaluateAssignment(project.id, sub.id, original);
              return p.scored ? p.score : 0;
            })(),

            originalContractValue: original,
            approvedChangeOrders: comm.approvedChangeOrders,
            pendingChangeOrders: comm.pendingChangeOrders,
            currentContractValue: currentContractValue(original, comm),
            approvedClaims: comm.approvedClaims,
            submittedClaims: comm.submittedClaims,
            approvedEotDays: comm.approvedEotDays,
            pendingEotDays: comm.pendingEotDays,
            changeOrdersCount: comm.changeOrdersCount,
            claimsCount: comm.claimsCount,
            eotCount: comm.eotCount,

            latestChangeOrder: comm.latestChangeOrder,
            latestClaim: comm.latestClaim,
            latestEot: comm.latestEot,

            subId: sub.id,
          });
        });
    });

    const n = links.length;

    // Unique trades, alphabetical
    const tradeSet = new Set<string>();
    links.forEach(l => { const t = l.trade.trim(); if (t) tradeSet.add(t); });
    const trades = Array.from(tradeSet).sort((a, b) => a.localeCompare(b));

    // Unique sectors, alphabetical
    const sectorSet = new Set<string>();
    const sectorList: { id: string; name: string }[] = [];
    links.forEach(l => {
      if (l.sectorId && !sectorSet.has(l.sectorId)) {
        sectorSet.add(l.sectorId);
        sectorList.push({ id: l.sectorId, name: l.sectorName ?? l.sectorId });
      }
    });
    sectorList.sort((a, b) => a.name.localeCompare(b.name));

    // Projects sorted by contract value, descending
    links.sort((a, b) => b.contractValue - a.contractValue);

    // Unique projects vs contract rows
    const uniqueProjects = new Set(links.map(l => l.projectId)).size;

    const totalContractValue = sum(links, l => l.contractValue);

    // Contract-value weighted progress; falls back to simple mean
    const overallProgress = totalContractValue > 0
      ? sum(links, l => l.progressPct * l.contractValue) / totalContractValue
      : (n ? sum(links, l => l.progressPct) / n : 0);

    const latestPeriods = links.map(l => l.latestCertificatePeriod).filter(Boolean) as string[];

    // Latest record across all projects — same date rule as within a project.
    const latestAcross = (
      pick: (l: RegistryProjectLink) => LatestRecord | null,
    ): (LatestRecord & { projectName: string; projectId: string }) | null => {
      let best: (LatestRecord & { projectName: string; projectId: string }) | null = null;
      links.forEach(l => {
        const r = pick(l);
        if (!r) return;
        const cand = { ...r, projectName: l.projectName, projectId: l.projectId };
        if (!best) { best = cand; return; }
        const a = (cand.date || '').trim();
        const b = (best.date || '').trim();
        if (a && !b) { best = cand; return; }
        if (!a && b) return;
        if (a >= b) best = cand;
      });
      return best;
    };

    return {
      record,
      isDerived,
      trades,
      sectors: sectorList,
      projects: links,
      projectsCount: uniqueProjects,
      contractsCount: n,
      totalContractValue,
      totalCertified: sum(links, l => l.certified),
      totalCertifiedPending: sum(links, l => l.certifiedPending),
      totalOutstanding: sum(links, l => l.outstanding),
      totalPaid: sum(links, l => l.paidToDate),
      certificatesCount: sum(links, l => l.certificatesCount),
      latestCertificatePeriod: latestPeriods.length ? latestPeriods[latestPeriods.length - 1] : null,

      // Commercial rollup across all project assignments
      totalOriginalContract: sum(links, l => l.originalContractValue),
      totalApprovedChangeOrders: sum(links, l => l.approvedChangeOrders),
      totalPendingChangeOrders: sum(links, l => l.pendingChangeOrders),
      totalCurrentContract: sum(links, l => l.currentContractValue),
      totalApprovedClaims: sum(links, l => l.approvedClaims),
      totalSubmittedClaims: sum(links, l => l.submittedClaims),
      totalApprovedEotDays: sum(links, l => l.approvedEotDays),
      totalPendingEotDays: sum(links, l => l.pendingEotDays),
      changeOrdersCount: sum(links, l => l.changeOrdersCount),
      claimsCount: sum(links, l => l.claimsCount),
      eotCount: sum(links, l => l.eotCount),

      latestChangeOrder: latestAcross(l => l.latestChangeOrder),
      latestClaim: latestAcross(l => l.latestClaim),
      latestEot: latestAcross(l => l.latestEot),
      overallProgress,
      worstDelay: n ? Math.max(...links.map(l => l.delayDays)) : 0,
      kpi: n ? sum(links, l => l.performanceScore) / n : 0,
      totalRetentionContract: sum(links, l => l.retention),
      totalRetentionHeld: sum(links, l => l.retentionHeld),
      rank: 0,
    };
  });

  // Ranking: KPI desc -> worst delay asc -> contract value desc -> contracts desc
  aggregates.sort((a, b) => {
    if (b.kpi !== a.kpi) return b.kpi - a.kpi;
    if (a.worstDelay !== b.worstDelay) return a.worstDelay - b.worstDelay;
    if (b.totalContractValue !== a.totalContractValue) return b.totalContractValue - a.totalContractValue;
    return b.contractsCount - a.contractsCount;
  });
  aggregates.forEach((a, i) => { a.rank = i + 1; });

  return aggregates;
}

/** Aggregate for one subcontractor, resolved by immutable internalId. */
export function aggregateOne(
  companyId: string,
  internalId: string,
  projects: any[],
  sectors: { id: string; name: string; projectIds: string[] }[],
): RegistryAggregate | undefined {
  return aggregateRegistry(companyId, projects, sectors)
    .find(a => a.record.internalId === internalId);
  // Works for both real ids and `derived:<code>` placeholders.
}

function sum<T>(list: T[], pick: (t: T) => number): number {
  return list.reduce((acc, t) => acc + (pick(t) || 0), 0);
}

/**
 * Assignment count for the delete guard.
 * Company-scoped, read-only.
 */
export function countProjectAssignments(
  record: RegistrySubcontractor,
  projects: any[],
  sectors: { id: string; projectIds: string[] }[],
): number {
  const ids = new Set<string>();
  sectors.forEach(s => s.projectIds.forEach(pid => ids.add(pid)));

  return projects.filter(
    p => ids.has(p.id) && readProjectSubs(p.id).some(sub => matchesRegistryRecord(sub, record)),
  ).length;
}
