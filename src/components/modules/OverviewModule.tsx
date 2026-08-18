import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useTranslation } from '../../lib/i18n';
import { useProjects } from '../../lib/store';
import { formatMoney, formatPercent, cn } from '../../lib/utils';
import { formatDate, toInputDate } from '../../lib/dateFormat';
import { Activity, Clock, FileWarning, Wallet, Landmark, RefreshCw } from 'lucide-react';
import { EditableNumber, EditableDate } from '../EditableCell';
import { computeApprovedEOT, syncDelayRegister } from '../../lib/delayCalculations';
import ReportButton from '../reporting/ReportButton';
// SPRINT 1 · TASK 1 — commercial totals must never add two currencies.
// The rows were already converted at save time; the contract base was not.
// commercialTotals() brings every term into ONE currency before summing.
import { commercialTotals, sumInReporting } from '../../lib/commercialTotals';
import { companyIdOfProject } from '../../lib/projectMaster';
import { contractCurrencyOf } from '../../lib/projectCurrency';
import { fetchSectors } from '../../mock/sectors';

// ── localStorage helpers ──────────────────────────────────────────────
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// ── Date arithmetic ───────────────────────────────────────────────────
/** Add `days` to a date string (DD/MM/YYYY or YYYY-MM-DD). Returns DD/MM/YYYY. */
function addDaysToDate(dateStr: string, days: number): string {
  if (!dateStr || days === 0) return dateStr;
  const iso = toInputDate(dateStr); // → YYYY-MM-DD
  const d = new Date(iso);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10); // ISO in storage; formatted on display
}

// ── Derived KPI calculation ───────────────────────────────────────────
interface Computed {
  totalApprovedEOT:        number;
  approvedCompletion:      string;   // DD/MM/YYYY
  currentDelay:            number;
  revisedContractValue:    number;
  totalApprovedCOs:        number;
  totalApprovedClaims:     number;
  totalCashReceived:       number;
  totalCashDisbursed:      number;
  /** The currency every money figure above is expressed in. */
  reportingCurrency:       string;
  /** Original contract brought into the reporting currency. */
  originalContractValue:   number;
  /** False when a conversion had no rate on the transaction date. */
  currencyResolved:        boolean;
}

function computeFromStorage(project: Project): Computed {
  const id = project.id;

  // ── Currency frame ─────────────────────────────────────────────────
  // Every money figure below lands in the project's CONTRACT currency —
  // the native unit of the signed contract, and what this screen's
  // figures are stated in. (It used to be the COMPANY reporting
  // currency, which printed the parent company's unit over a project's
  // own numbers.) Establishing it ONCE, here, is what stops the
  // mixed-unit sum: the old code added converted rows to an unconverted
  // contract value.
  //
  // With the contract currency governing, `contractCcy` and
  // `reportingCurrency` are now equal on a normal project, so the
  // "= €105,168,000" equivalence line under the editable tile correctly
  // stops rendering — the two units it existed to reconcile are one.
  const companyId = companyIdOfProject(project as any, fetchSectors());
  const totals = commercialTotals(project as any, companyId);
  const reportingCurrency = totals.reportingCurrency;
  const contractCcy = totals.contractCurrency;

  // ── Change Orders ──────────────────────────────────────────────────
  const totalApprovedCOs = totals.approvedChangeOrders;

  // ── Claims ────────────────────────────────────────────────────────
  const totalApprovedClaims = totals.approvedClaims;

  // ── Total approved EOT ────────────────────────────────────────────
  // Shared with DelayModule via lib/delayCalculations.ts so the two can never
  // drift apart.
  //
  //   totalApprovedEOT = coEOT + claimEOT
  //
  // DelayRow.eotDays is DELIBERATELY EXCLUDED. It is a documentation /
  // evidence field on the delay event, not a second grant of time. A DelayRow
  // with linkedClaimNos points at a Claim whose timeDays already carries that
  // EOT — counting both doubles it (DLY-001 eotDays 36 ↔ CLM-001 timeDays 45).
  // Refresh the register first so newly approved Claims / time-bearing
  // Change Orders are reflected, then read the deduplicated total from it.
  syncDelayRegister(id);
  const { totalApprovedEOT } = computeApprovedEOT(id);

  // ── Approved Completion Date ──────────────────────────────────────
  // = Original Contract Completion Date + Total Approved EOT Days
  const approvedCompletion = project.contractualCompletion
    ? addDaysToDate(project.contractualCompletion, totalApprovedEOT)
    : (project.approvedCompletion || '');

  // ── Current Delay ─────────────────────────────────────────────────
  // = max(0, actual delay days − total approved EOT)
  const currentDelay = Math.max(0, (project.delayDays || 0) - totalApprovedEOT);

  // ── Revised Contract Value ────────────────────────────────────────
  // = Original CV + Approved COs + Approved Claims — ALL in the reporting
  // currency.
  //
  // THE FIX. The old line was:
  //
  //   (project.contractValue || 0) + totalApprovedCOs + totalApprovedClaims
  //
  // `project.contractValue` is entered in the CONTRACT currency and stored
  // raw; the two row totals were already converted at save time. Adding
  // them produced AED + EUR + EUR — a number that is not a quantity of any
  // currency. commercialTotals() converts the base before summing, so every
  // term is in one unit.
  const revisedContractValue = totals.revisedContract;

  // ── Cash Flow ─────────────────────────────────────────────────────
  // Sum monthly rows from cashflow module; fall back to project values if
  // empty. Rows are read through the transaction layer so a row entered in
  // a foreign currency contributes its CONVERTED value, at the rate frozen
  // when it was saved.
  const cashRows: any[] = readJson(`pactum-cashflow-${id}`, []);
  const hasCashRows = cashRows.length > 0;
  const totalCashReceived  = hasCashRows
    ? sumInReporting(cashRows, 'in',  contractCcy, reportingCurrency)
    : (project.totalCashReceived  || 0);
  const totalCashDisbursed = hasCashRows
    ? sumInReporting(cashRows, 'out', contractCcy, reportingCurrency)
    : (project.totalCashDisbursed || 0);

  return {
    totalApprovedEOT,
    approvedCompletion,
    currentDelay,
    revisedContractValue,
    totalApprovedCOs,
    totalApprovedClaims,
    totalCashReceived,
    totalCashDisbursed,
    reportingCurrency,
    originalContractValue: totals.originalContract,
    currencyResolved: totals.resolved,
  };
}

// ── Component ─────────────────────────────────────────────────────────
export default function OverviewModule({
  project,
  canEdit = true,
}: {
  project: Project;
  canEdit?: boolean;
}) {
  const { t, lang }        = useTranslation();
  const { updateProject }  = useProjects();

  const [computed, setComputed] = useState<Computed>(() => computeFromStorage(project));
  const [syncing,  setSyncing]  = useState(false);
  const [synced,   setSynced]   = useState(false);

  /**
   * The two currencies on this screen, named apart on purpose.
   *
   *   ccy         — the company's reporting currency. Every DERIVED total
   *                 (revised value, approved COs, claims, cash) is in it.
   *   contractCcy — the project's contract currency. Only the raw
   *                 `project.contractValue` field is still in it.
   *
   * Labelling both from one variable is what produced "SAR 540,000,000"
   * on a EUR company: formatMoney defaults to SAR when no currency is
   * passed, so an omitted argument silently invented a unit.
   */
  const ccy = computed.reportingCurrency;
  const contractCcy = useMemo(
    () => contractCurrencyOf(project.id, ccy),
    [project.id, ccy],
  );

  // ── Re-compute whenever project prop changes ──────────────────────
  // Other modules call updateProject → React re-renders → new project prop → recompute.
  useEffect(() => {
    setComputed(computeFromStorage(project));
    setSynced(false);
  }, [project]);

  // ── Re-compute on cross-tab localStorage writes ───────────────────
  useEffect(() => {
    const handler = () => {
      setComputed(computeFromStorage(project));
      setSynced(false);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [project]);

  // ── Editable patch (manual overrides for progress / contractualCompletion) ──
  const patch = (field: keyof Project, value: any) => {
    updateProject({ ...project, [field]: value });
  };

  // ── Auto Calculate ────────────────────────────────────────────────
  const calculate = useCallback(() => {
    setSyncing(true);
    setSynced(false);
    setTimeout(() => {
      const c = computeFromStorage(project);
      setComputed(c);
      // Persist computed values back to project store
      updateProject({
        ...project,
        revisedContractValue: c.revisedContractValue,
        totalApprovedCOs:     c.totalApprovedCOs,
        totalApprovedClaims:  c.totalApprovedClaims,
        approvedCompletion:   c.approvedCompletion,
        totalCashReceived:    c.totalCashReceived,
        totalCashDisbursed:   c.totalCashDisbursed,
      });
      setSyncing(false);
      setSynced(true);
    }, 350);
  }, [project, updateProject]);

  // ── Executive Summary ─────────────────────────────────────────────
  const netCash = computed.totalCashReceived - computed.totalCashDisbursed;

  const summaryEn =
    `Project is at ${formatPercent(project.progress)} physical completion with a net delay of ` +
    `${computed.currentDelay} days` +
    (computed.totalApprovedEOT > 0
      ? ` (${computed.totalApprovedEOT} days of approved EOT have been applied)`
      : '') +
    `. Revised contract value stands at ${formatMoney(computed.revisedContractValue, { currency: ccy })}, ` +
    `comprising the original ${formatMoney(project.contractValue, { currency: contractCcy })}` +
    (computed.totalApprovedCOs > 0
      ? `, ${formatMoney(computed.totalApprovedCOs, { currency: ccy })} in approved change orders`
      : '') +
    (computed.totalApprovedClaims > 0
      ? `, and ${formatMoney(computed.totalApprovedClaims, { currency: ccy })} in approved claims`
      : '') +
    `. Net cash position: ${formatMoney(netCash, { currency: ccy })}.`;

  const summaryAr =
    `المشروع عند نسبة إنجاز فعلية ${formatPercent(project.progress)} مع تأخير صافٍ ` +
    `${computed.currentDelay} يوماً` +
    (computed.totalApprovedEOT > 0
      ? ` (تم تطبيق ${computed.totalApprovedEOT} يوم تمديد وقت معتمد)`
      : '') +
    `. قيمة العقد المعدلة ${formatMoney(computed.revisedContractValue, { currency: ccy })}، ` +
    `تشمل القيمة الأصلية ${formatMoney(project.contractValue, { currency: contractCcy })}` +
    (computed.totalApprovedCOs > 0
      ? `، وأوامر تغيير معتمدة بقيمة ${formatMoney(computed.totalApprovedCOs, { currency: ccy })}`
      : '') +
    (computed.totalApprovedClaims > 0
      ? `، ومطالبات معتمدة بقيمة ${formatMoney(computed.totalApprovedClaims, { currency: ccy })}`
      : '') +
    `. الوضع النقدي الصافي: ${formatMoney(netCash, { currency: ccy })}.`;

  // ── KPI cards ─────────────────────────────────────────────────────
  const cards = [
    {
      label: t.originalContractValue,
      icon: Landmark,
      color: 'text-primary',
      editable: true,
      node: (
        <>
          <EditableNumber
            value={project.contractValue}
            onSave={(v) => patch('contractValue', v)}
            canEdit={canEdit}
            display={formatMoney(project.contractValue, { currency: contractCcy })}
            className="font-mono text-lg text-primary number-ltr"
          />
          {/*
            THE CONVERTED EQUIVALENT, STATED.

            This tile is EDITABLE, so it must keep showing the figure the
            user typed, in the currency they typed it in — the contract
            currency. Every other tile on this screen is in the REPORTING
            currency.

            With nothing said about that, the screen read:

              AED 420,000,000   Original Contract Value
              EUR 112,760,760   Contract Amount
              EUR   6,333,768   Approved COs
              EUR   1,258,992   Approved Claims

            and the arithmetic looked broken, because 420,000,000 +
            6,333,768 + 1,258,992 is not 112,760,760. The figures were
            always right; the screen simply never said that the first one
            is quoted in a different unit from the rest.

            420,000,000 AED x 0.2504 = 105,168,000 EUR, and
            105,168,000 + 6,333,768 + 1,258,992 = 112,760,760 exactly.

            `computed.originalContractValue` is that converted figure,
            produced by commercialTotals — nothing is calculated here.
            Shown only when the two currencies actually differ, so a
            single-currency project gains no noise.
          */}
          {contractCcy !== ccy && (
            <p className="text-(length:--t-micro) text-muted-foreground mt-1 font-mono number-ltr">
              = {formatMoney(computed.originalContractValue, { currency: ccy })}
            </p>
          )}
        </>
      ),
    },
    {
      label: t.revisedContractValue,
      icon: Landmark,
      color: 'text-white',
      editable: false,
      node: (
        <span className="font-mono text-lg text-white number-ltr">
          {formatMoney(computed.revisedContractValue, { currency: ccy })}
        </span>
      ),
    },
    {
      label: t.totalApprovedCO,
      icon: FileWarning,
      color: 'text-chart-5',
      editable: false,
      node: (
        <span className="font-mono text-lg text-chart-5 number-ltr">
          {formatMoney(computed.totalApprovedCOs, { currency: ccy })}
        </span>
      ),
    },
    {
      label: t.totalApprovedClaims,
      icon: Activity,
      color: 'text-chart-3',
      editable: false,
      node: (
        <span className="font-mono text-lg text-chart-3 number-ltr">
          {formatMoney(computed.totalApprovedClaims, { currency: ccy })}
        </span>
      ),
    },
    {
      label: t.totalCashReceived,
      icon: Wallet,
      color: 'text-chart-4',
      editable: false,
      node: (
        <span className="font-mono text-lg text-chart-4 number-ltr">
          {formatMoney(computed.totalCashReceived, { currency: ccy })}
        </span>
      ),
    },
    {
      label: t.totalCashDisbursed,
      icon: Wallet,
      color: 'text-muted-foreground',
      editable: false,
      node: (
        <span className="font-mono text-lg text-muted-foreground number-ltr">
          {formatMoney(computed.totalCashDisbursed, { currency: ccy })}
        </span>
      ),
    },
    {
      label: t.contractualCompletion,
      icon: Clock,
      color: 'text-white',
      editable: true,
      node: (
        <EditableDate
          value={project.contractualCompletion}
          onSave={(v) => patch('contractualCompletion', v)}
          canEdit={canEdit}
          className="font-mono text-lg text-white number-ltr"
        />
      ),
    },
    {
      label: t.approvedCompletion,
      icon: Clock,
      color: 'text-primary',
      editable: false,
      node: (
        <span className="font-mono text-lg text-primary number-ltr">
          {computed.approvedCompletion ? formatDate(computed.approvedCompletion) : '—'}
        </span>
      ),
    },
  ];

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="pg-stack animate-in fade-in duration-500">

      {/* Auto Calculate bar — matches Enterprise Portfolio design */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/*
            WHAT THIS PILL ACTUALLY MEANS.

            ────────────────────────────────────────────────────────────
            It read "Pending Sync" on every visit, because `synced`
            starts false and only turns true if someone presses Auto
            Calculate in that session. So a project whose figures were
            correct, current, and on screen still announced that it was
            waiting for something — and the one thing a status pill must
            never do is contradict the page it sits on.

            The figures on this screen are ALWAYS live: they are computed
            from storage on every render. What Auto Calculate does is
            different — it WRITES those computed values back onto the
            project record, which is what the portfolio and report layers
            read. So the honest statement is not "pending sync" but
            "these figures are live; the stored record may lag".

            The pill is now silent in the normal case and speaks only
            after a recalculation has actually written something.
            ──────────────────────────────────────────────────────────── */}
          {synced && (
            <span className="badge badge-ok">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
              {lang === 'ar' ? 'حُفظت في سجل المشروع' : 'Saved to project record'}
            </span>
          )}
        </div>

        {/* Auto Calculate button — same design as Portfolio page */}
        <button
          type="button"
          onClick={calculate}
          disabled={syncing}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-black text-xs font-bold uppercase tracking-widest hover:bg-primary/90 active:scale-[0.97] transition-all disabled:opacity-60"
          aria-label={lang === 'ar' ? 'حساب تلقائي' : 'Auto Calculate'}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} aria-hidden="true" />
          {lang === 'ar' ? 'حساب تلقائي' : 'Auto Calculate'}
        </button>
      </div>

      {/* Status chips — Progress & Current Delay */}
      <div className="flex gap-4 flex-wrap">
        {/* Actual Progress */}
        <div className="ds-card ds-card-key !flex-row items-center justify-between flex-1 min-w-[180px]">
          <div className="!mt-0">
            <p className="kpi-k">{t.actualProgress}</p>
            <p className="t-metric kpi-v-ok">
              <EditableNumber
                value={Math.round(project.progress * 1000) / 10}
                onSave={(v) => patch('progress', Math.min(1, Math.max(0, v / 100)))}
                canEdit={canEdit}
                display={formatPercent(project.progress)}
                className="t-metric kpi-v-ok"
              />
            </p>
          </div>
          <Activity className="text-chart-4 opacity-40 w-8 h-8 flex-shrink-0 !mt-0" />
        </div>

        {/* Current Delay (adjusted for EOT) */}
        <div
          className="ds-card ds-card-key !flex-row items-center justify-between flex-1 min-w-[180px]"
        >
          <div className="!mt-0">
            <p className="kpi-k">{t.currentDelay}</p>
            <p className={cn('t-metric', computed.currentDelay > 0 ? 'kpi-v-warn' : 'kpi-v-ok')}>
              {computed.currentDelay}
              <span className="t-label ms-1">{t.days}</span>
            </p>
            {computed.totalApprovedEOT > 0 && (
              <p className="kpi-sub text-primary/60">
                −{computed.totalApprovedEOT}d {lang === 'ar' ? 'تمديد وقت معتمد' : 'approved EOT'}
              </p>
            )}
          </div>
          <Clock
            className={cn(
              'opacity-40 w-8 h-8 flex-shrink-0 !mt-0',
              computed.currentDelay > 0 ? 'text-chart-5' : 'text-chart-4',
            )}
          />
        </div>
      </div>

      {/* 2×4 KPI grid */}
      <div className="ds-grid">
        {cards.map((card, i) => (
          <div
            key={i}
            className="ds-card ds-card-raised hover:bg-black/40 transition-colors"
          >
            <div className="flex justify-between items-start !mt-0">
              <card.icon className={`w-5 h-5 ${card.color} opacity-60`} />
              {canEdit && card.editable && (
                <span className="text-(length:--t-label) text-muted-foreground uppercase tracking-widest">
                  {t.clickToEdit}
                </span>
              )}
              {!card.editable && (
                <span className="badge badge-ok">
                  {lang === 'ar' ? 'تلقائي' : 'Auto'}
                </span>
              )}
            </div>
            <div className="mb-2">{card.node}</div>
            <h3 className="text-(length:--t-label) uppercase tracking-wider text-muted-foreground leading-tight">
              {card.label}
            </h3>
          </div>
        ))}
      </div>

      {/* Executive Summary — auto-regenerates from latest computed values */}
      <div className="ds-card ds-card-exec relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(179,138,61,1) 1px,transparent 1px),linear-gradient(90deg,rgba(179,138,61,1) 1px,transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />
        <div className="flex items-center gap-3 relative z-10">
          <h4 className="sec-head !mt-0 !mb-0 flex-1">{t.executiveSummary}</h4>
          <ReportButton
            reportId="project-dashboard"
            context={{ project, computed, summary: lang === 'ar' ? summaryAr : summaryEn,
                       reportCurrency: ccy }}
          />
        </div>
        {/*
          A PARAGRAPH IS NOT A LABEL.

          This was `t-label` — 12px, and 11px in compact density. That
          token exists for the tiny caption ABOVE a value, where the text
          is two or three words. Here it was setting a full paragraph of
          prose carrying six figures, which is the one block on the page
          a director actually reads end to end.

          `t-body` is the platform's own size for running text (15px). It
          is the token the table rows already use, so this is the house
          size rather than a new one.
        */}
        <p className="t-body font-serif leading-relaxed relative z-10 !mt-0 max-w-[85ch]">
          {lang === 'ar' ? summaryAr : summaryEn}
        </p>
      </div>
    </div>
  );
}
