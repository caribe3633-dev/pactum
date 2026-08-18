import React, { useMemo, useState } from 'react';
import { useTranslation } from '../lib/i18n';
import { useLocation } from 'wouter';
import EnterpriseHeader from '../components/EnterpriseHeader';
import CompanyGrid from '../components/CompanyGrid';
import CompanyManagementModal from '../components/CompanyManagementModal';
import ContextBar from '../components/ContextBar';
import { BarChart3, LineChart } from 'lucide-react';
import { MOCK_COMPANIES, Company, fetchCompanies } from '../mock/companies';
// PHASE 3H — company writes are routed through the validated mutators
// instead of being persisted raw. Phase 3E proved the raw path accepted an
// empty name, a duplicate id and a duplicate name, and silently dropped a row.
import { applyCompanyChanges, summarise } from '../lib/companyGateway';
import { useCompanies } from '../lib/useMasterData';
import { toLinks } from '../lib/projectMaster';
import { AlertTriangle } from 'lucide-react';
import ReportButton from '../components/reporting/ReportButton';
import { useProjects } from '../lib/store';
// Phase 6 — the portfolio report reads each project's latest APPROVED
// snapshot, never its live state.
import { portfolioContext } from '../lib/reporting/timelineSource';
// SPRINT 3 — portfolio totals must convert BEFORE summing. Companies may
// each report in a different currency; adding them raw is a mixed-unit sum.
import { aggregatePortfolio, aggregateCaveat } from '../lib/portfolioAggregate';

export default function EnterprisePortfolio() {
  const { lang } = useTranslation();
  const trPage = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { projects } = useProjects();
  // PHASE 3F-UX · Task 2 — live from the registry.
  //
  // Was a local useState mirror refreshed only by this page's own save.
  // A rename made on the Sectors page, or by any other screen, left this
  // grid stale until remount. The hook subscribes, so the grid is always
  // current no matter who wrote.
  const companies = useCompanies();
  /** Refusals from the last save, shown rather than swallowed. */
  const [saveErrors, setSaveErrors] = useState('');
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalShowWizard, setModalShowWizard] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Exclude archived companies from the portfolio view
    const visible = companies.filter(c => c.status !== 'Archived');
    if (!q) return visible;
    return visible.filter(c => c.name.toLowerCase().includes(q));
  }, [companies, query]);

  /**
   * SPRINT 3 — the group total, converted before summing.
   *
   * Presented in the FIRST visible company's reporting currency rather
   * than a hardcoded default: on a single-company portfolio that means no
   * conversion at all, and on a mixed one it picks a currency actually in
   * use instead of inventing a third.
   */
  const aggregate = useMemo(
    () => aggregatePortfolio(filtered as any, projects as any),
    [filtered, projects],
  );

  /**
   * Persists whatever the modal produced — through validation.
   *
   * The modal still hands back a whole array; the gateway diffs it against
   * the registry and routes each difference to `createCompany` /
   * `updateCompany` / `deleteCompany`. A refused row does not abort the
   * batch, so four good edits are not lost to one bad name.
   *
   * State is set from `result.companies` — the registry as it ACTUALLY is
   * after the batch — not from `next`. Rendering `next` would show the user
   * a company that was rejected and never saved.
   */
  const handleChange = (next: Company[]) => {
    const result = applyCompanyChanges(next, toLinks(projects as any), 'admin');
    // No setState for the list: the gateway's write notifies every
    // subscriber, including this component. Only the error banner is local.
    setSaveErrors(result.ok ? '' : summarise(result, 'en'));
  };

  const [loc, setLoc] = useLocation();
  const handleEnter = (c: Company) => {
    setLoc(`/company/${c.id}`);
  };

  return (
    // The canvas is the page: .pg fills the monitor and owns the padding.
    <div className="min-h-full w-full bg-background">
      <ContextBar items={[{ label: trPage('Enterprise Portfolio', 'محفظة المشاريع') }]} />
      <div className="pg pg-stack">
      <EnterpriseHeader
        title={trPage('Enterprise Portfolio', 'محفظة المشاريع')}
        searchValue={query}
        onSearchChange={setQuery}
        onManage={() => setModalOpen(true)}
        onNew={() => { setModalShowWizard(true); setModalOpen(true); }}
      />
      {/* Controlled modal instance opened by header Manage button */}
      <CompanyManagementModal
        companies={companies}
        onChange={handleChange}
        open={modalOpen}
        onOpenChange={(v) => { if (!v) setModalShowWizard(false); setModalOpen(v); }}
        hideTrigger
        initialShowWizard={modalShowWizard}
      />
      {/* Refusals from the last save. Named, not swallowed. */}
      {saveErrors && (
        <div className="flex items-start gap-2 border border-chart-3/40 bg-chart-3/[0.07] px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-chart-3 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            {saveErrors.split('\n').map((line, i) => (
              <p key={i} className="text-(length:--t-second) text-chart-3">{line}</p>
            ))}
          </div>
          <button
            onClick={() => setSaveErrors('')}
            className="text-(length:--t-micro) text-chart-3/70 hover:text-chart-3 uppercase tracking-wider"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={() => setLoc('/enterprise-portfolio/analytics')}
                className="btn btn-secondary btn-sm">
          <BarChart3 className="w-3.5 h-3.5" />
          Analytics
        </button>
        <button onClick={() => setLoc('/enterprise-portfolio/intelligence')}
                className="btn btn-secondary btn-sm">
          <LineChart className="w-3.5 h-3.5" />
          Intelligence
        </button>
        <ReportButton
          reportId="tl-portfolio"
          label="Portfolio (Timeline)"
          context={portfolioContext(projects.map(p => ({
            id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr,
          })))}
        />
        <ReportButton
          reportId="portfolio-summary"
          context={{
            companies: filtered.map(c => ({
              name: c.name, country: c.country ?? c.city ?? '',
              portfolioValue: c.portfolioValue, sectors: c.sectors, projects: c.projects,
              status: c.status,
            })),
            // SPRINT 3 — was:
            //   filtered.reduce((a, c) => a + (Number(c.portfolioValue) || 0), 0)
            //
            // Two faults. `portfolioValue` is a stored field nothing
            // updates (always 0), and the companies it added may report in
            // different currencies — a mixed-unit sum at portfolio level.
            //
            // `aggregatePortfolio` derives each company's value in its own
            // currency, converts every one into a single presentation
            // currency, and reports what it could NOT convert instead of
            // quietly dropping it.
            aggregate: aggregate.total,
            aggregateCurrency: aggregate.currency,
            aggregateAsAt: aggregate.asAt,
            aggregateComplete: aggregate.complete,
            aggregateCaveat: aggregateCaveat(aggregate),
            contributions: aggregate.contributions.map(c => ({
              name: c.name,
              nativeValue: c.nativeValue,
              nativeCurrency: c.nativeCurrency,
              convertedValue: c.convertedValue,
              rate: c.rate,
              resolved: c.resolved,
            })),
          }}
        />
      </div>
      <CompanyGrid companies={filtered} onEnter={handleEnter} />
      </div>
    </div>
  );
}
