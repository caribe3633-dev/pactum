import React, { useState, useEffect, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useTranslation } from '../../lib/i18n';
import { formatMoney, cn } from '../../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LabelList } from 'recharts';
import { Plus, Trash2 } from 'lucide-react';
import ReportButton from '../reporting/ReportButton';
import { fetchSectors } from '../../mock/sectors';
// Who classified a line is part of the record — an unattributed financial
// decision is not auditable.
import { useAuth } from '../../lib/store';
import {
  moneyContext, resolveTxnDate,
  // Phase 3.2 — transaction layer. One rate across every amount on the row,
  // so gross - retention = net still holds after conversion.
  transactionContext, prepareTransactionGroup, transactionFields,
} from '../../lib/moneyEntry';
import { contractCurrencyOf } from '../../lib/projectCurrency';
import { CurrencyBadge, TransactionAmountInput, NativeAmount } from '../CurrencyAmount';
import { EditableNumber } from '../EditableCell';
// Task 5 — authoritative company link; the projectIds cache can be stale.
import { companyIdOfProject } from '../../lib/projectMaster';
/**
 * PHASE 4 · STEP 2 — the classification the cost model introduced in Step 1
 * is exposed here. This screen OWNS the budget store, so it is the single
 * writer; `costModel` stays pure and never persists.
 */
import {
  deriveBudget, costTypeOf, classifyLine, costTypeLabel,
  SELECTABLE_COST_TYPES, type CostType,
} from '../../lib/costModel';
import { kpiMoney, exactMoney } from '../../lib/moneyFormat';
/**
 * SOURCE VERSIONING. This register is one of the five a Baseline Package
 * is built from, so the version line belongs on the screen that owns the
 * data — not only on the Baseline screen. Capturing a version reads this
 * store; it never writes to it.
 */
import SourceVersionsPanel from '../SourceVersionsPanel';


export default function BudgetModule({ project, canEdit = true }:
  { project: Project; canEdit?: boolean }) {
  const { t, lang } = useTranslation();
  const isRtl = lang === 'ar';
  const { user } = useAuth();

  const [data, setData] = useState<any[]>([]);
  
  useEffect(() => {
    const stored = localStorage.getItem(`pactum-budget-${project.id}`);
    if (stored) {
      setData(JSON.parse(stored));
    } else {
      // PHASE 3G — no auto-seed. Opening a screen must never CREATE
      // data. An empty store stays empty until the user enters a row or
      // presses "Load Sample Data".
      setData([]);
    }
  }, [project.id]);

  // FX book is company-scoped.
  const companyId = useMemo(
    () => companyIdOfProject(project as any, fetchSectors()),
    [project.id],
  );
  const money = useMemo(() => moneyContext(companyId, project.id), [companyId, project.id]);
  /** Project contract currency — the default for a new record. */
  const contractCcy = useMemo(
    () => contractCurrencyOf(project.id, money.base), [project.id, money.base]);
  const txnCtx = useMemo(
    () => transactionContext(companyId, project.id, contractCcy),
    [companyId, project.id, contractCcy]);

  const [isAdding, setIsAdding] = useState(false);
  // TABLES / DASHBOARD (owner rule): entry and tables on one tab, the
  // charts on their own Dashboard tab — the module's reporting surface.
  const [tab, setTab] = useState<'tables' | 'dashboard'>('tables');
  const [saveErr, setSaveErr] = useState('');
  const [newRow, setNewRow] = useState({
    category: '', planned: '', actual: '',
    currency: contractCcy, date: new Date().toISOString().slice(0, 10),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRow.category) return;
    
    setSaveErr('');
    const p = Number(newRow.planned) || 0;
    const a = Number(newRow.actual) || 0;

    /**
     * ══════════════════════════════════════════════════════════════════
     * PLANNED AND ACTUAL SHARE ONE RATE.
     *
     * They are converted as a GROUP, so `planned − actual` still equals
     * Remaining after conversion. Converting them separately at two
     * rates would make the subtraction arithmetic between two different
     * currencies wearing the same symbol.
     * ══════════════════════════════════════════════════════════════════
     */
    const txn = resolveTxnDate({ date: newRow.date }, ['date']);
    const g = prepareTransactionGroup(txnCtx, { planned: p, actual: a },
                                      newRow.currency, txn);
    if (!g.money.resolved) {
      setSaveErr(`No rate from ${newRow.currency} to ${txnCtx.reportingCurrency} on ${txn.date}. Publish one in Currency Management first.`);
      return;
    }

    /**
     * FORECAST IS NO LONGER CAPTURED, AND IS NOT WRITTEN AS ZERO.
     *
     * The key is simply ABSENT on a new row. Writing `forecast: 0` would
     * state that somebody forecast nothing, which is a financial claim
     * nobody made — NO DATA is not ZERO. Rows filed before this change
     * keep the forecast they were saved with; nothing is rewritten.
     *
     * `variance` is likewise not written. It meant `planned − forecast`,
     * and that subtraction no longer has a second operand. Reusing the
     * key for `planned − actual` would silently change what every filed
     * record means — the one thing a persisted key must never do.
     */
    const row: any = {
      category: newRow.category,
      planned: g.values.planned,
      actual: g.values.actual,
    };

    // A reporting-currency row receives {} and stays byte-identical.
    const nextData = [...data,
      { ...row, ...transactionFields({ ...g.money, originalAmount: p }) }];

    setData(nextData);
    localStorage.setItem(`pactum-budget-${project.id}`, JSON.stringify(nextData));
    setNewRow({ category: '', planned: '', actual: '',
                currency: contractCcy, date: new Date().toISOString().slice(0, 10) });
    setIsAdding(false);
  };
  
  const handleDelete = (index: number) => {
    const nextData = data.filter((_, i) => i !== index);
    setData(nextData);
    localStorage.setItem(`pactum-budget-${project.id}`, JSON.stringify(nextData));
  };

  /**
   * ══════════════════════════════════════════════════════════════════
   * EDIT ONE AMOUNT ON ONE LINE — Planned or Actual.
   *
   * The screen previously had NO way to enter an actual or correct a
   * planned figure after the row was saved. A cost register you can only
   * append to is a register that goes stale the first week of the job.
   *
   * WHAT THE USER TYPES IS IN THE ROW'S OWN CURRENCY.
   *
   * That is the part that has to be right. A row captured in EGP stores
   * the CONVERTED reporting-currency figure in `planned`, with the
   * native amount in `originalAmount` and the rate in `exchangeRate`.
   * If an edit wrote the typed number straight into `planned`, a user
   * looking at "EGP 500,000" and typing 600000 would silently overwrite
   * the SAR figure with an EGP one, and every total on the project would
   * be wrong by the exchange rate.
   *
   * So the edit is re-converted through the SAME published rate the row
   * was originally booked at — not today's rate. Re-rating a historical
   * line because somebody fixed a typo would move money that never
   * moved. The rate, its effective date and the provenance block are all
   * left exactly as they were.
   *
   * A reporting-currency row has no rate and no metadata; it takes the
   * typed number directly and stays byte-identical in shape.
   * ══════════════════════════════════════════════════════════════════
   */
  const editAmount = (index: number, field: 'planned' | 'actual', typed: number) => {
    const nextData = data.map((row, i) => {
      if (i !== index) return row;

      const rowCcy = String(row.currency || '');
      const foreign = !!rowCcy && rowCcy !== money.base;

      if (!foreign) {
        // Domestic row. The typed figure IS the stored figure.
        return { ...row, [field]: typed };
      }

      // Foreign row: the user typed a NATIVE amount. Convert with the
      // rate this row was booked at, and keep the native figure beside
      // it so the reference line below the cell stays truthful.
      const rate = Number(row.exchangeRate) || 0;
      if (rate <= 0) {
        // No usable rate on the row. Refusing is correct: guessing one
        // would fabricate a conversion. Named, not swallowed.
        setSaveErr(isRtl
          ? `الصف بعملة ${rowCcy} ولا يحمل سعر صرف مخزَّناً — لا يمكن التعديل دون اختراع سعر.`
          : `This row is in ${rowCcy} and carries no stored rate — it cannot be edited without inventing one.`);
        return row;
      }
      setSaveErr('');
      const next: any = { ...row, [field]: typed * rate };
      // `originalAmount` tracks the PLANNED native figure, which is what
      // the reference line under the Planned cell reports.
      if (field === 'planned') next.originalAmount = typed;
      else next.actualOriginalAmount = typed;
      return next;
    });
    setData(nextData);
    localStorage.setItem(`pactum-budget-${project.id}`, JSON.stringify(nextData));
  };

  /**
   * What a cell should SHOW for editing: the native figure on a foreign
   * row, the stored figure on a domestic one. Reading it any other way
   * is how the currency bug above gets reintroduced.
   */
  const nativeOf = (row: any, field: 'planned' | 'actual'): number => {
    const rowCcy = String(row.currency || '');
    if (!rowCcy || rowCcy === money.base) return Number(row[field]) || 0;
    if (field === 'planned') {
      return Number(row.originalAmount ?? 0) || 0;
    }
    // An actual entered before this change has no native twin recorded;
    // derive it from the row's own rate rather than showing a converted
    // number in a native-currency cell.
    if (row.actualOriginalAmount !== undefined) return Number(row.actualOriginalAmount) || 0;
    const rate = Number(row.exchangeRate) || 0;
    return rate > 0 ? (Number(row.actual) || 0) / rate : 0;
  };

  /**
   * ══════════════════════════════════════════════════════════════════
   * REMAINING = PLANNED − ACTUAL. DERIVED, NEVER STORED.
   *
   * This replaces the Forecast and Variance columns, which is what you
   * asked for. Two notes on how it was done, because both were choices
   * that could have been made badly:
   *
   * 1. NOTHING WAS RENAMED. The old `forecast` and `variance` keys are
   *    still read by `captureBudget()` in baselines.ts, by the Budget
   *    report, by Timeline snapshots and by portfolio analytics. Rows
   *    already filed keep them and keep meaning what they meant. New
   *    rows simply do not carry them.
   *
   * 2. REMAINING IS NOT WRITTEN TO STORAGE. It is arithmetic over two
   *    stored numbers, so it can never disagree with them. A stored
   *    remainder would be a third figure that drifts the moment either
   *    operand is edited.
   * ══════════════════════════════════════════════════════════════════
   */
  const remainingOf = (row: any): number =>
    (Number(row.planned) || 0) - (Number(row.actual) || 0);

  /**
   * ══════════════════════════════════════════════════════════════════
   * CLASSIFY ONE LINE — the only write this feature performs.
   *
   * It writes ONE row and only the `costType` triplet on it, via
   * `classifyLine`, which spreads every existing key through untouched.
   * No other row is read, rewritten or re-saved, so a bulk rewrite of the
   * register cannot happen by accident.
   *
   * There is deliberately NO "classify all remaining as X" action. That
   * would be a guess wearing a button, and the approved rule is that a
   * classification is always an explicit human decision per line.
   * ══════════════════════════════════════════════════════════════════
   */
  const classify = (index: number, costType: string) => {
    if (costType !== 'direct' && costType !== 'indirect') return;
    const nextData = data.map((row, i) =>
      i === index ? classifyLine(row, costType, user?.username || 'unknown') : row);
    setData(nextData);
    localStorage.setItem(`pactum-budget-${project.id}`, JSON.stringify(nextData));
  };

  /**
   * DERIVED, NEVER STORED.
   *
   * Direct / Indirect / Total are computed from the lines on every render.
   * There is no aggregate field to edit and none to drift: change a line's
   * classification and these move in the same commit, because they are the
   * same data read a second way.
   */
  const budget = useMemo(
    () => deriveBudget(data, money.base, 'planned'),
    [data, money.base]);

  /** Planned / Actual / Remaining per line, for the CBS chart. */
  const chartData = useMemo(
    () => data.map(r => ({
      category: r.category,
      planned: Number(r.planned) || 0,
      actual: Number(r.actual) || 0,
      remaining: remainingOf(r),
    })),
    [data]);

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      <SourceVersionsPanel projectId={project.id} only="budget" canEdit={canEdit} compact />

      {/* TABS — Tables (entry) / Dashboard (charts). */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { id: 'tables',    icon: null, en: 'Tables',    ar: 'جداول' },
          { id: 'dashboard', icon: null, en: 'Dashboard', ar: 'داش بورد' },
        ] as const).map(x => (
          <button key={x.id} onClick={() => setTab(x.id)}
                  className={cn('inline-flex items-center gap-2 px-4 py-2 text-xs border rounded-md transition-colors uppercase tracking-wider',
                    tab === x.id
                      ? 'bg-primary/10 text-primary border-primary'
                      : 'border-white/[0.06] text-muted-foreground hover:text-white')}>
            {isRtl ? x.ar : x.en}
          </button>
        ))}
      </div>

      {tab === 'tables' && (<>


      {/* ── Derived cost split ────────────────────────────────────────────
          Three tiles, matching the strip used on every other module. The
          figures are DERIVED on each render — there is no editable
          aggregate anywhere on this screen. */}
      <div className="kpi-strip !grid-cols-2 md:!grid-cols-3">
        <div className="kpi">
          <div className="kpi-k">{isRtl ? 'الموازنة المباشرة' : 'Direct Budget'}</div>
          <div className="kpi-v money" title={exactMoney(budget.direct, money.base)}>
            {kpiMoney(budget.direct, money.base)}
          </div>
          <div className="kpi-sub">
            {budget.counts.direct} {isRtl ? 'بند' : budget.counts.direct === 1 ? 'LINE' : 'LINES'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{isRtl ? 'الموازنة غير المباشرة' : 'Indirect Budget'}</div>
          <div className="kpi-v money" title={exactMoney(budget.indirect, money.base)}>
            {kpiMoney(budget.indirect, money.base)}
          </div>
          <div className="kpi-sub">
            {budget.counts.indirect} {isRtl ? 'بند' : budget.counts.indirect === 1 ? 'LINE' : 'LINES'}
          </div>
        </div>
        <div className="kpi kpi-hero">
          <div className="kpi-k">{isRtl ? 'إجمالي الموازنة' : 'Total Budget'}</div>
          <div className="kpi-v kpi-v-gold money" title={exactMoney(budget.total, money.base)}>
            {kpiMoney(budget.total, money.base)}
          </div>
          {/* Stating the identity on the tile is what stops a reader
              assuming an unclassified line is somewhere inside it. */}
          <div className="kpi-sub">
            {isRtl ? 'مباشرة + غير مباشرة' : 'DIRECT + INDIRECT'}
          </div>
        </div>
      </div>

      {/* A total that excludes value must say so, and name what is missing.
          This is a STATEMENT OF FACT, not the baseline gate — the blocking
          rule lives in baselineGate.ts and is not duplicated here. */}
      {budget.counts.unclassified > 0 && (
        <div className="ds-card border-chart-3/30 bg-chart-3/[0.05] !py-3">
          <p className="text-(length:--t-second) text-chart-3">
            {isRtl
              ? `${budget.counts.unclassified} بند غير مصنَّف بقيمة ${formatMoney(budget.unclassified, { currency: money.base })} — غير مُدرَج في الإجماليات أعلاه: ${budget.unclassifiedRefs.join(' · ')}`
              : `${budget.counts.unclassified} unclassified line(s) worth ${formatMoney(budget.unclassified, { currency: money.base })} are NOT included in the totals above: ${budget.unclassifiedRefs.join(' · ')}`}
          </p>
        </div>
      )}

      {/* Off-unit rows are excluded by the derivation, so the screen has to
          say which — otherwise the headline is quietly partial. */}
      {budget.counts.excluded > 0 && (
        <div className="ds-card border-chart-3/30 bg-chart-3/[0.05] !py-3">
          <p className="text-(length:--t-second) text-chart-3">
            {isRtl
              ? `${budget.counts.excluded} بند مخزَّن بعملة أخرى ومستبعد من الإجماليات: ${budget.excludedRefs.join(' · ')}`
              : `${budget.counts.excluded} line(s) stored in another currency, excluded from the totals: ${budget.excludedRefs.join(' · ')}`}
          </p>
        </div>
      )}

      {/* The CBS bar chart moved to the DASHBOARD tab (owner rule):
          charts live on their own tab now — planned vs actual per line,
          the spent/remaining donut and the direct/indirect split pie. */}

      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="sec-head !mb-0 flex-1">Budget Ledger</h3>
          <ReportButton reportId="budget" context={{ project, rows: data, reportCurrency: money.base }} />
          <button onClick={() => setIsAdding(!isAdding)} className="btn btn-secondary btn-sm">
            <Plus className="w-3 h-3" /> {t.add}
          </button>
        </div>
        
        {isAdding && (
          <form onSubmit={handleAdd} className="ds-card ds-card-tight mb-3">
            <div className="form-grid">
              <div className="field">
                <label className="field-label" data-required>{t.category}</label>
                <input className="field-input" value={newRow.category} onChange={e=>setNewRow({...newRow, category: e.target.value})} required />
              </div>
              <TransactionAmountInput
                label={t.planned}
                amount={newRow.planned}
                currency={newRow.currency}
                onAmount={v => setNewRow({ ...newRow, planned: v })}
                onCurrency={v => setNewRow({ ...newRow, currency: v })}
                date={newRow.date}
                fx={money.fx}
                settings={money.settings}
                projectId={project.id}
                onDate={v => setNewRow({ ...newRow, date: v })}
                hideDate
              />
              {/* Actual is entered in the SAME currency chosen above and
                  converted on the same rate as Planned. */}
              <div className="field">
                <label className="field-label">
                  {t.actual}
                  {newRow.currency !== money.base && (
                    <span className="text-(length:--t-micro) text-muted-foreground ms-1.5 font-mono">
                      {newRow.currency}
                    </span>
                  )}
                </label>
                <input className="field-input font-mono number-ltr" type="number" value={newRow.actual} onChange={e=>setNewRow({...newRow, actual: e.target.value})} dir="ltr" />
              </div>
              {/* Budget line date drives the rate lookup. */}
              <div className="field">
                <label className="field-label">Date</label>
                <input className="field-input font-mono number-ltr" type="date" dir="ltr"
                       style={{ colorScheme: 'dark' }} value={newRow.date}
                       onChange={e => setNewRow({ ...newRow, date: e.target.value })} />
              </div>
            </div>
            {saveErr && <p className="field-error mt-2">{saveErr}</p>}
            <div className="form-actions">
              <button type="button" onClick={() => setIsAdding(false)} className="btn btn-ghost">Cancel</button>
              <button type="submit" className="btn btn-primary">{t.save}</button>
            </div>
          </form>
        )}

        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th className="col-pin">{t.category}</th>
                <th>{isRtl ? 'نوع التكلفة' : 'Cost Type'}</th>
                <th className="money">{t.planned}</th>
                <th className="money">{t.actual}</th>
                {/* Forecast and Variance are gone. Remaining is Planned
                    minus Actual, derived on render and never stored. */}
                <th className="money">{isRtl ? 'المتبقي' : 'Remaining'}</th>
                <th className="col-act" />
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => {
                const ct: CostType = costTypeOf(row);
                return (
                <tr key={i}>
                  <td className="col-pin text-white">
                    <span className="inline-flex items-center gap-1.5">
                      {row.category}
                      {/* The same badge the CO, Claims and Certificates
                          registers use. A foreign row is identifiable
                          before a single figure is read. */}
                      <CurrencyBadge code={row.currency ?? ''} base={money.base} />
                    </span>
                  </td>
                  {/* ── Classification ──────────────────────────────────
                      Unclassified renders as an EMPTY selection, not as a
                      third option the user can choose. "Unclassified" is
                      the absence of a decision; offering it as a choice
                      would invite someone to actively set it, which is not
                      a thing a person should be able to decide. */}
                  <td>
                    {canEdit ? (
                      <span className="inline-flex items-center gap-1.5">
                        <select
                          value={ct === 'unclassified' ? '' : ct}
                          onChange={e => classify(i, e.target.value)}
                          aria-label={isRtl ? 'نوع التكلفة' : 'Cost type'}
                          className={cn(
                            'bg-black/60 border px-2 py-1 text-(length:--t-second) focus:outline-none focus:border-primary',
                            ct === 'unclassified'
                              ? 'border-chart-3/40 text-chart-3'
                              : 'border-white/10 text-white',
                          )}
                        >
                          {ct === 'unclassified' && (
                            <option value="" disabled>
                              {isRtl ? 'غير مصنَّفة' : 'Unclassified'}
                            </option>
                          )}
                          {SELECTABLE_COST_TYPES.map(o => (
                            <option key={o.value} value={o.value}>
                              {isRtl ? o.ar : o.en}
                            </option>
                          ))}
                        </select>
                        {row.classifiedBy && (
                          <span
                            className="text-(length:--t-micro) text-muted-foreground"
                            title={`${isRtl ? 'صنَّفها' : 'Classified by'} ${row.classifiedBy}${row.classifiedAt ? ' · ' + String(row.classifiedAt).slice(0, 10) : ''}`}
                          >
                            ✓
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className={cn(
                        'badge',
                        ct === 'unclassified' && 'text-chart-3 border-chart-3/30 bg-chart-3/10',
                      )}>
                        {costTypeLabel(ct, isRtl ? 'ar' : 'en')}
                      </span>
                    )}
                  </td>
                  {/* ── PLANNED ─────────────────────────────────────────
                      Editable in the ROW'S OWN currency. The reference
                      line beneath reports the native figure, the rate it
                      was booked at and its effective date, and links to
                      the published rate — the same NativeAmount block
                      the rest of the project uses. */}
                  <td className="money text-muted-foreground">
                    <EditableNumber
                      value={nativeOf(row, 'planned')}
                      onSave={v => editAmount(i, 'planned', v)}
                      canEdit={canEdit}
                      display={formatMoney(row.planned, { currency: money.base })} />
                    <NativeAmount row={row} field="planned" displayCurrency={money.base}
                                  companyId={companyId} originalField="originalAmount" />
                  </td>

                  {/* ── ACTUAL — the entry point that did not exist ──── */}
                  <td className="money">
                    {/* NO DATA is not ZERO. A row where nobody has entered
                        an actual shows a dash, and the dash is clickable
                        to enter one. It is never rendered as 0. */}
                    <EditableNumber
                      value={nativeOf(row, 'actual')}
                      onSave={v => editAmount(i, 'actual', v)}
                      canEdit={canEdit}
                      display={row.actual === undefined || row.actual === null || row.actual === ''
                        ? '—'
                        : formatMoney(row.actual, { currency: money.base })} />
                    {row.actual !== undefined && row.actual !== null && row.actual !== '' && (
                      <NativeAmount row={row} field="actual" displayCurrency={money.base}
                                    companyId={companyId} originalField="actualOriginalAmount" />
                    )}
                  </td>

                  {/* ── REMAINING = PLANNED − ACTUAL ─────────────────────
                      Derived. Not editable, because it is not a figure
                      anybody enters — it is a subtraction, and offering
                      to edit it would invite a third number that
                      contradicts its own two operands. */}
                  <td className={`money ${remainingOf(row) >= 0 ? 'money-pos' : 'money-neg'}`}>
                    {formatMoney(remainingOf(row), { currency: money.base })}
                  </td>
                  <td className="col-act">
                    {canEdit && (
                      <button onClick={() => handleDelete(i)} aria-label="Delete" className="text-muted-foreground hover:text-destructive transition-colors p-1.5">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>)}

      {/* ══════════════════ DASHBOARD — the charts ══════════════════ */}
      {tab === 'dashboard' && (() => {
        /** Whole-budget totals from the SAME chartData the ledger reads —
         *  one rule, read twice; chart and table can never disagree. */
        const totals = chartData.reduce(
          (a, r) => ({ planned: a.planned + r.planned, actual: a.actual + r.actual }),
          { planned: 0, actual: 0 },
        );
        const remaining = totals.planned - totals.actual;
        const spentPct = totals.planned > 0 ? totals.actual / totals.planned : null;
        const classTotal = budget.direct + budget.indirect;

        /** Compact money for the bar value labels: 12M, 850K. */
        const shortM = (v: number): string => {
          const a = Math.abs(v);
          if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
          if (a >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
          if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
          return String(Math.round(v));
        };

        // Readable tooltips — the platform standard: gold label, white
        // mono figures, soft gold cursor band.
        const TT = {
          contentStyle: { backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--primary)/0.35)', borderRadius: 4, padding: '8px 12px', fontSize: '12px', color: '#ffffff' },
          labelStyle: { color: 'hsl(var(--primary))', fontWeight: 600, marginBottom: 4 },
          itemStyle: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#ffffff' },
          cursor: { fill: 'rgba(212,175,55,0.10)', stroke: 'rgba(212,175,55,0.35)' },
        };

        return (
          <>
          {/* ═══ 1 · PLANNED vs ACTUAL — one pair of bars per budget line.
                 The plan is quiet grey, the actual is bright gold: what
                 happened reads before what was intended. Values on top. */}
          <div className="ds-card ds-card-raised" style={{ height: 440 }}>
            <h3 className="sec-head">
              {isRtl ? 'المخطط مقابل الفعلي — لكل بند' : 'Planned vs Actual — by Budget Line'}
            </h3>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 20, bottom: 20 }} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.08)" vertical={false} />
                <XAxis dataKey="category" stroke="#a5a49f" tick={{ fontSize: 12 }} angle={-45} textAnchor="end" height={60} interval={0} />
                <YAxis stroke="#a5a49f" tick={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}
                       tickFormatter={(val) => `${Math.round(val / 1000000)}M`} />
                <Tooltip {...TT} formatter={(value: number) => formatMoney(value, { currency: money.base })} />
                <Legend wrapperStyle={{ fontSize: '12px' }} verticalAlign="top" height={36} />
                <Bar dataKey="planned" name={isRtl ? 'مخطط (الخطة)' : 'Planned (the plan)'}
                     fill="#a5a49f" radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="planned" position="top" fontSize={10}
                             fill="#a5a49f" formatter={(v: number) => shortM(v)} />
                </Bar>
                <Bar dataKey="actual" name={isRtl ? 'فعلي (المنصرف)' : 'Actual (spent)'}
                     fill="#d4af37" radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="actual" position="top" fontSize={10}
                             fill="#d4af37" formatter={(v: number) => shortM(v)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* ═══ 2 · SPENT vs REMAINING — the donut. Gold is what has
                   gone, dark grey what is left; the hole states the
                   headline number: the spent percentage. */}
            <div className="ds-card ds-card-raised" style={{ height: 360 }}>
              <h3 className="sec-head">
                {isRtl ? 'المنصرف من البادجت' : 'Spent vs Remaining'}
              </h3>
              {totals.planned <= 0 ? (
                <div className="ds-empty" style={{ height: '75%' }}>
                  <div className="ds-empty-title">
                    {isRtl ? 'لا توجد بنود مخططة بعد' : 'No planned lines yet'}
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="80%">
                  <PieChart>
                    <Tooltip {...TT} formatter={(value: number) => formatMoney(value, { currency: money.base })} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} verticalAlign="bottom" />
                    <Pie
                      data={[
                        { name: isRtl ? 'المنصرف' : 'Spent', value: Math.max(0, totals.actual) },
                        { name: isRtl ? 'المتبقي' : 'Remaining', value: Math.max(0, remaining) },
                      ]}
                      dataKey="value" nameKey="name"
                      innerRadius="58%" outerRadius="85%" paddingAngle={2} strokeWidth={0}
                    >
                      <Cell fill="#d4af37" />
                      <Cell fill="#3f4040" />
                      <text x="50%" y="47%" textAnchor="middle" fill="#d4af37" fontSize="26" fontWeight="700">
                        {spentPct === null ? '—' : `${Math.round(spentPct * 100)}%`}
                      </text>
                      <text x="50%" y="58%" textAnchor="middle" fill="#a5a49f" fontSize="11">
                        {isRtl ? 'منصرف من البادجت' : 'of budget spent'}
                      </text>
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              )}
              {remaining < 0 && (
                <p className="text-(length:--t-second) text-chart-3 mt-1">
                  {isRtl
                    ? `تجاوز المخطط بمقدار ${formatMoney(-remaining, { currency: money.base })}`
                    : `Over plan by ${formatMoney(-remaining, { currency: money.base })}`}
                </p>
              )}
            </div>

            {/* ═══ 3 · DIRECT vs INDIRECT — the split of the budget, from
                   the SAME classification the KPI strip reads. */}
            <div className="ds-card ds-card-raised" style={{ height: 360 }}>
              <h3 className="sec-head">
                {isRtl ? 'المباشر وغير المباشر من البادجت' : 'Direct vs Indirect — Budget Split'}
              </h3>
              {classTotal <= 0 ? (
                <div className="ds-empty" style={{ height: '75%' }}>
                  <div className="ds-empty-title">
                    {isRtl ? 'لا توجد بنود مصنّفة بعد' : 'No classified lines yet'}
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="80%">
                  <PieChart>
                    <Tooltip {...TT} formatter={(value: number) => formatMoney(value, { currency: money.base })} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} verticalAlign="bottom" />
                    <Pie
                      data={[
                        { name: isRtl ? 'مباشر' : 'Direct', value: budget.direct },
                        { name: isRtl ? 'غير مباشر' : 'Indirect', value: budget.indirect },
                      ]}
                      dataKey="value" nameKey="name"
                      outerRadius="80%" strokeWidth={0}
                      label={(d: any) => `${Math.round((d.value / classTotal) * 100)}%`}
                      labelLine={false}
                    >
                      <Cell fill="#6f9b78" />
                      <Cell fill="#c08a3e" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              )}
              {budget.counts.unclassified > 0 && (
                <p className="text-(length:--t-second) text-chart-5 mt-1">
                  {isRtl
                    ? `${budget.counts.unclassified} بند غير مصنَّف خارج هذا الرسم`
                    : `${budget.counts.unclassified} unclassified line(s) sit outside this chart`}
                </p>
              )}
            </div>
          </div>
          </>
        );
      })()}
    </div>
  );
}
