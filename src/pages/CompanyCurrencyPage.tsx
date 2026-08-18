import React, { useState, useMemo, useEffect } from 'react';
import ContextBar from '../components/ContextBar';
import CompanyTabs from '../components/CompanyTabs';
import ReportButton from '../components/reporting/ReportButton';
// Phase 8 — project contract currency.
import {
  contractCurrencyOf, setContractCurrency, hasExplicitCurrency,
  requiredRatePairs, readProjectCurrencies,
} from '../lib/projectCurrency';
import { findCompanyById } from '../mock/companies';
// Task 4 — company owns reporting currency, time zone and calendar.
import { setReportingCurrency, updateCompany, CALENDARS } from '../lib/masterData';
import { findSectorsByCompany } from '../mock/sectors';
import { useProjects, useAuth } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { cn, formatMoney } from '../lib/utils';
import { formatDateOrDash } from '../lib/dateFormat';
import { abbrevMoney, exactMoney } from '../lib/moneyFormat';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  Coins, Plus, Check, Ban, TrendingUp, AlertTriangle, Info, Lock, History, Pencil
} from 'lucide-react';
import {
  readCurrencySettings, writeCurrencySettings, readFx, appendRate, supersedeRate,
  reinstateRate,
  rateOn, rateHistory, ratedCurrencies, convert, fxImpact,
  correctRate, fxRegister, fxCorrections, fxIntegrity, versionsOf,
  crossRate,
  CurrencySettings, FxStore, CurrencyDef, MoneyRecord,
  formatCurrency, moneyFrom,
} from '../lib/currency';
// PHASE 3F-UX Task 2 — live master data: re-renders on any registry write.
import { useCompany, useCompanySectors } from '../lib/useMasterData';

/**
 * Currency Management + FX Dashboard.
 * Destination: src/pages/CompanyCurrencyPage.tsx
 * Route:       /company/:id/currency
 *
 * Two jobs on one screen because they answer one question between them:
 * what are our rates, and what have they done to us.
 *
 * This page never converts a stored record. It publishes rates and reads
 * exposure. Conversion happens once, at data entry, in lib/currency.
 */

const C_GRID = 'rgba(212,175,55,0.08)';
const AXIS = { stroke: '#a5a49f', tick: { fontSize: 11, fill: '#a5a49f' } };
const TT: React.CSSProperties = {
  background: '#1b1c1c', border: '1px solid rgba(212,175,55,0.3)', borderRadius: 0, fontSize: 12,
};
/** Muted series palette — existing tokens only. */
const SERIES = ['#d4af37', '#6f9b78', '#a85450', '#c08a3e', '#8b8a86', '#a5a49f'];

type Tab = 'rates' | 'currencies' | 'dashboard' | 'register' | 'projects';

export default function CompanyCurrencyPage({ params }: any) {
  const id = params?.id || '';
  const company = useCompany(id);
  const sectors = useCompanySectors(id);
  const { projects } = useProjects();
  const { user } = useAuth();
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const canEdit = user?.role === 'admin';

  const [settings, setSettings] = useState<CurrencySettings>(() => readCurrencySettings(id));
  const [fx, setFx] = useState<FxStore>(() => readFx(id));
  const [tab, setTab] = useState<Tab>('rates');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    currency: 'USD', rate: '', effectiveDate: new Date().toISOString().slice(0, 10),
    approvalDate: new Date().toISOString().slice(0, 10),
    projectId: '', reason: '',
    /**
     * THE CURRENCY THIS RATE IS PRICED IN.
     *
     * ════════════════════════════════════════════════════════════════
     * This form used to hardcode the target to the company's reporting
     * currency, so every rate could only ever be published "to AED" and
     * the label said so. That was a restriction of the FORM, never of
     * the engine: `appendRate()` has always taken `baseCurrency` as a
     * free parameter, and `crossRate()` resolves direct, inverse and
     * pivoted routes equally well whatever the pair.
     *
     * Empty means "the company's reporting currency", which keeps the
     * common case a single click and every existing rate unchanged.
     * ════════════════════════════════════════════════════════════════
     */
    targetCurrency: '',
  });
  const [err, setErr] = useState('');
  /** The standing rate that blocked a publish, highlighted in the table. */
  const [conflictId, setConflictId] = useState('');
  /**
   * DEEP LINK — `?rate=<id>`.
   *
   * A converted figure elsewhere in the platform states the rate it used
   * and links here. Landing on a page of forty rates with no indication
   * of which one was meant would answer nothing, so the referenced row
   * is highlighted and scrolled to. Read once on mount: it is an
   * arrival instruction, not state to keep in sync.
   */
  const [linkedRateId] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('rate') || '';
    } catch { return ''; }
  });

  useEffect(() => {
    if (!linkedRateId) return;
    // After the table has painted. A rate that is not in this company's
    // store simply does not scroll — nothing is invented to match it.
    const t = setTimeout(() => {
      const el = document.getElementById(`fx-rate-${linkedRateId}`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 300);
    return () => clearTimeout(t);
  }, [linkedRateId, fx.rates.length]);
  // Phase 5 — correcting a published rate. Never an edit: a correction
  // appends the next version and retires the one it replaces.
  const [correcting, setCorrecting] = useState<string>('');
  /** Rate awaiting a withdrawal confirmation. '' when none. */
  const [withdrawing, setWithdrawing] = useState<string>('');
  /** Message shown when a reinstatement is refused. */
  const [reinstateErr, setReinstateErr] = useState<string>('');
  const [fix, setFix] = useState({ rate: '', correctionReason: '' });
  const [fixErr, setFixErr] = useState('');

  useEffect(() => {
    setSettings(readCurrencySettings(id));
    setFx(readFx(id));
  }, [id]);

  const base = settings.baseCurrency;
  /** The unit the drafted rate prices into. Declared AFTER `base`:
      reading it above would be a temporal dead zone. */
  const draftTarget = (draft.targetCurrency || base).toUpperCase();
  const today = new Date().toISOString().slice(0, 10);

  // Projects owned by this company — used for project-scoped rates and exposure.
  const companyProjects = useMemo(() => {
    const ids = new Set(sectors.flatMap(s => s.projectIds));
    return projects.filter(p => ids.has(p.id));
  }, [projects, sectors]);

  const saveSettings = (next: CurrencySettings) => {
    setSettings(next);
    writeCurrencySettings(id, next);
  };

  /**
   * Task 4 — reporting currency belongs ONLY to the company.
   *
   * The FX settings store stays the authority every conversion reads;
   * `setReportingCurrency` additionally keeps the mirror on the Company
   * record in step and notifies subscribers, so a rename-style change
   * shows everywhere immediately.
   *
   * FORWARD-LOOKING ONLY. No stored amount is rewritten and no published
   * rate is touched — a past record keeps the rate it was converted at.
   */
  const setBase = (code: string) => {
    saveSettings({ ...settings, baseCurrency: code });
    setReportingCurrency(id, code);
  };

  /** Task 4 — company profile fields, stored on the Company record. */
  const saveProfile = (patch: { timeZone?: string; calendar?: any }) => {
    updateCompany(id, patch as any);
  };

  const toggleCurrency = (code: string) =>
    saveSettings({
      ...settings,
      currencies: settings.currencies.map(c =>
        c.code === code ? { ...c, active: !c.active } : c),
    });

  const publish = () => {
    setErr('');
    setConflictId('');
    const res = appendRate(id, {
      currency: draft.currency,
      baseCurrency: draftTarget,
      rate: Number(draft.rate),
      effectiveDate: draft.effectiveDate,
      projectId: draft.projectId,
      approvedBy: user?.username ?? 'unknown',
      reason: draft.reason.trim(),
      approvalDate: draft.approvalDate,
      reportingCurrency: draftTarget,
    });
    if (!res.ok) {
      const conflict = res.conflict;
      const map: Record<string, string> = {
        'invalid-rate': isRtl ? 'السعر يجب أن يكون أكبر من صفر' : 'Rate must be greater than zero',
        'invalid-currency': isRtl ? 'رمز عملة غير صالح' : 'Invalid currency code',
        'missing-date': isRtl ? 'تاريخ السريان مطلوب' : 'Effective date is required',
        'duplicate': isRtl ? 'نفس السعر مسجَّل بالفعل لهذا التاريخ' : 'That exact rate is already on record for this date',
        // A refusal that tells the user what blocked them and what to do
        // instead. "Rejected" with no route forward is an obstacle, not a
        // guard rail.
        'slot-occupied': conflict
          ? (isRtl
              ? `يوجد سعر سارٍ بالفعل لـ ${conflict.currency} بتاريخ ${conflict.effectiveDate} وقدره ${conflict.rate.toFixed(4)}. لا يمكن وجود سعرين معتمدين لنفس العملة والتاريخ. لتغييره استخدم «تصحيح» على السعر القائم — يُنشئ نسخة جديدة ويحفظ السبب ومَن أجراه.`
              : `A rate of ${conflict.rate.toFixed(4)} is already standing for ${conflict.currency} on ${conflict.effectiveDate}. Two approved rates cannot occupy the same currency and date. To change it, use Correct on the existing rate — that appends a new version and records who restated it and why.`)
          : (isRtl ? 'يوجد سعر سارٍ لهذه العملة والتاريخ.' : 'A rate already stands for this currency and date.'),
      };
      setErr(map[res.reason ?? ''] ?? 'Could not publish');
      // Surface the blocking rate so the user can act on it without hunting.
      if (res.reason === 'slot-occupied' && conflict) setConflictId(conflict.id);
      return;
    }
    setFx(res.store);
    setDraft({ ...draft, rate: '', reason: '' });
    setAdding(false);
  };

  const submitCorrection = (rateId: string) => {
    setFixErr('');
    const res = correctRate(id, {
      rateId,
      rate: Number(fix.rate),
      approvedBy: user?.username ?? 'unknown',
      correctionReason: fix.correctionReason.trim(),
    });
    if (!res.ok) {
      const map: Record<string, string> = {
        'invalid-rate': isRtl ? 'السعر يجب أن يكون أكبر من صفر' : 'Rate must be greater than zero',
        'missing-reason': isRtl ? 'سبب التصحيح إجباري' : 'A correction reason is required',
        'not-approved': isRtl ? 'لا يمكن تصحيح سعر مسحوب' : 'A withdrawn rate cannot be corrected',
        'already-corrected': isRtl ? 'هذا السعر مُصحَّح بالفعل' : 'This rate has already been corrected',
        'not-found': isRtl ? 'السعر غير موجود' : 'Rate not found',
      };
      setFixErr(map[res.reason ?? ''] ?? 'Could not correct');
      return;
    }
    setFx(res.store);
    setCorrecting('');
    setFix({ rate: '', correctionReason: '' });
  };

  // Phase 8 — project contract currencies.
  const [pcTick, setPcTick] = useState(0);
  const [pcDraft, setPcDraft] = useState<Record<string, string>>({});
  const projectCurrencies = useMemo(() => {
    void pcTick;
    return readProjectCurrencies();
  }, [pcTick]);
  const missingPairs = useMemo(() => {
    void pcTick;
    return requiredRatePairs(companyProjects.map(p => p.id), base)
      .map(pair => ({
        ...pair,
        // A project contracted in a currency the book cannot reach is not a
        // warning, it is a blocker: nothing on it can be reported at all.
        resolved: crossRate(fx, pair.currency, base, today, '', base).resolved,
      }));
  }, [companyProjects, base, fx, today, pcTick]);

  const applyProjectCurrency = (projectId: string, code: string) => {
    setContractCurrency(projectId, code, user?.username ?? 'unknown', base,
      'Set from Currency Management');
    setPcTick(t => t + 1);
  };

  const codes = ratedCurrencies(fx);
  const register = useMemo(() => fxRegister(fx), [fx]);
  const corrections = useMemo(() => fxCorrections(fx), [fx]);
  const integrity = useMemo(() => fxIntegrity(fx), [fx]);

  // ── FX chart: one line per currency across every published date ──
  const chart = useMemo(() => {
    const dates = Array.from(new Set(
      fx.rates.filter(r => r.status === 'approved').map(r => r.effectiveDate))).sort();
    return dates.map(d => {
      const row: any = { date: formatDateOrDash(d, isRtl ? 'ar' : 'en'), iso: d };
      codes.forEach(c => {
        const r = rateOn(fx, c, d);
        row[c] = r ? r.rate : null;
      });
      return row;
    });
  }, [fx, codes, isRtl]);

  /**
   * Exposure per project.
   *
   * Reads each project's contract value through moneyFrom(), so a legacy
   * row with no currency fields is correctly treated as already in base and
   * shows zero exposure — which is the truth, not a gap.
   */
  const exposure = useMemo(() => {
    return companyProjects.map(p => {
      const rec: MoneyRecord = moneyFrom(p as any, 'contractValue', base, (p as any).commencementDate ?? '');
      const imp = fxImpact(fx, rec, today, p.id);
      return {
        id: p.id, code: p.code, name: isRtl ? p.nameAr : p.nameEn,
        currency: rec.originalCurrency,
        original: rec.original,
        atOriginal: imp.atOriginalRate,
        atCurrent: imp.atCurrentRate,
        impact: imp.impact,
        originalRate: imp.originalRate,
        currentRate: imp.currentRate,
        comparable: imp.comparable,
        foreign: rec.originalCurrency !== base,
      };
    }).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  }, [companyProjects, fx, base, today, isRtl]);

  const totalImpact = exposure.reduce((a, e) => a + e.impact, 0);
  const foreignCount = exposure.filter(e => e.foreign).length;

  if (!company) {
    return (
      <div className="min-h-full w-full bg-background">
        <ContextBar items={[{ label: 'Enterprise Portfolio', href: '/enterprise-portfolio' }, { label: 'Unknown company' }]} />
        <div className="pg pg-stack">
          <div className="ds-empty"><div className="ds-empty-title">
            {isRtl ? 'الشركة غير موجودة' : 'Company Not Found'}</div></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full bg-background">
      <ContextBar
        items={[
          { label: 'Enterprise Portfolio', href: '/enterprise-portfolio' },
          { label: company.name, href: `/company/${id}` },
          { label: isRtl ? 'إدارة العملات' : 'Currency Management' },
        ]}
      />
      <div className="pg pg-stack">
        <CompanyTabs companyId={id} active="currency" />

        <div className="pg-head">
          <div className="pg-eyebrow">{isRtl ? 'المالية' : 'Finance'}</div>
          <h2 className="pg-title">{isRtl ? 'إدارة العملات' : 'Currency Management'}</h2>
        </div>

        {/* Base currency */}
        <div className="ds-card ds-card-raised">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-2.5 flex-1 min-w-[280px]">
              <Coins className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="sec-head !mb-1">{isRtl ? 'عملة التقارير' : 'Reporting Currency'}</h3>
                <p className="text-(length:--t-second) text-muted-foreground max-w-2xl">
                  {isRtl
                    ? 'كل رقم مُحوَّل ينتهي بهذه العملة، وكل الحسابات القائمة تعمل عليها. تغييرها لا يعيد تحويل أي سجل محفوظ — السجلات السابقة تحتفظ بالسعر الذي حُوِّلت به.'
                    : 'Every converted figure lands in this currency and every existing calculation operates on it. Changing it does not re-convert a single stored record — past records keep the rate they were converted at.'}
                </p>
              </div>
            </div>
            <select
              className="field-input !w-32 font-mono"
              value={base}
              onChange={e => setBase(e.target.value)}
              disabled={!canEdit}
            >
              {settings.currencies.filter(c => c.active).map(c =>
                <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </div>

          {/* ── Task 4 · Company profile — time zone + calendar ────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-white/[0.04]">
            <div className="flex flex-col gap-1">
              <label className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
                {isRtl ? 'المنطقة الزمنية' : 'Time Zone'}
              </label>
              <input
                value={company?.timeZone ?? ''}
                onChange={e => saveProfile({ timeZone: e.target.value })}
                placeholder="Asia/Riyadh"
                disabled={!canEdit}
                dir="ltr"
                className="field-input font-mono"
              />
              <span className="text-(length:--t-micro) text-muted-foreground">
                {isRtl
                  ? 'للعرض فقط — لا يدخل في أي حساب مالي أو زمني.'
                  : 'Display only — enters no financial or schedule calculation.'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
                {isRtl ? 'تقويم العمل' : 'Working Calendar'}
              </label>
              <select
                value={company?.calendar ?? ''}
                onChange={e => saveProfile({ calendar: e.target.value || undefined })}
                disabled={!canEdit}
                className="field-input"
              >
                <option value="">{isRtl ? 'غير محدد' : 'Not set'}</option>
                {CALENDARS.map(c => (
                  <option key={c.value} value={c.value}>{isRtl ? c.ar : c.en}</option>
                ))}
              </select>
              <span className="text-(length:--t-micro) text-muted-foreground">
                {isRtl
                  ? 'موثَّق فقط — محرك التأخير يعدّ بالأيام التقويمية ولا يقرأ هذا.'
                  : 'Recorded only — the Delay engine counts calendar days and does not read this.'}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {([
            { id: 'rates' as const,     icon: TrendingUp, en: 'Exchange Rates',  ar: 'أسعار الصرف' },
            { id: 'currencies' as const,icon: Coins,      en: 'Currencies',      ar: 'العملات' },
            { id: 'dashboard' as const, icon: TrendingUp, en: 'FX Dashboard',    ar: 'لوحة العملات' },
            { id: 'register' as const,  icon: History,    en: 'FX Register',     ar: 'سجل الأسعار' },
            { id: 'projects' as const,  icon: Coins,      en: 'Project Currency', ar: 'عملات المشاريع' },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 text-(length:--t-second) border rounded-md transition-colors uppercase tracking-wider',
                tab === t.id ? 'bg-primary/10 text-primary border-primary'
                             : 'border-white/[0.06] text-muted-foreground hover:text-white',
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {isRtl ? t.ar : t.en}
            </button>
          ))}
        </div>

        {/* ══ EXCHANGE RATES ══ */}
        {tab === 'rates' && (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-(length:--t-second) text-muted-foreground max-w-3xl flex items-start gap-1.5">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-primary/60" />
                {isRtl
                  ? 'الأسعار تُضاف ولا تُعدَّل أبداً. كل سعر يسري من تاريخه فصاعداً، والتحويل يستخدم السعر الساري في تاريخ المعاملة — لا سعر اليوم. تصحيح سعر يعني إضافة سعر جديد بتاريخ لاحق.'
                  : 'Rates are appended, never edited. Each applies from its effective date forward, and a conversion uses the rate in force on the transaction date — not today’s. Correcting a rate means publishing a new one with a later date.'}
              </p>
              <div className="flex items-center gap-2">
                <ReportButton reportId="fx-history" context={{
                  company: company?.name,
                  register, corrections, integrity,
                  reportingCurrency: base,
                }} />
                {canEdit && (
                  <button onClick={() => setAdding(v => !v)} className="btn btn-primary btn-sm">
                    <Plus className="w-3 h-3" />
                    {isRtl ? 'نشر سعر' : 'Publish Rate'}
                  </button>
                )}
              </div>
            </div>

            {adding && canEdit && (
              <div className="ds-card ds-card-tight">
                <h3 className="sec-head">{isRtl ? 'سعر صرف جديد' : 'New Exchange Rate'}</h3>
                <div className="form-grid">
                  <div className="field">
                    <label className="field-label" data-required>{isRtl ? 'العملة' : 'Currency'}</label>
                    <select className="field-input font-mono" value={draft.currency}
                            onChange={e => setDraft({ ...draft, currency: e.target.value })}>
                      {settings.currencies.filter(c => c.active && c.code !== draftTarget).map(c =>
                        <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                    </select>
                  </div>

                  {/* THE TARGET, CHOSEN — not assumed.
                      Defaults to the company's reporting currency because
                      that is the common case, but any pair may be priced
                      directly: a contractual USD/EUR fixing no longer has
                      to be expressed as two rates through AED. */}
                  <div className="field">
                    <label className="field-label" data-required>
                      {isRtl ? 'مقابل عملة' : 'Priced In'}
                    </label>
                    <select className="field-input font-mono" value={draftTarget}
                            onChange={e => setDraft({ ...draft, targetCurrency: e.target.value })}>
                      {settings.currencies.filter(c => c.active && c.code !== draft.currency).map(c =>
                        <option key={c.code} value={c.code}>
                          {c.code}{c.code === base ? (isRtl ? ' — عملة الشركة' : ' — company') : ''}
                        </option>)}
                    </select>
                  </div>

                  <div className="field">
                    <label className="field-label" data-required>
                      {isRtl ? `السعر مقابل ${draftTarget}` : `Rate to ${draftTarget}`}
                    </label>
                    <input className="field-input font-mono number-ltr" type="number" step="0.0001" dir="ltr"
                           placeholder="3.7500" value={draft.rate}
                           onChange={e => setDraft({ ...draft, rate: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="field-label" data-required>{isRtl ? 'تاريخ السريان' : 'Effective Date'}</label>
                    <input className="field-input font-mono number-ltr" type="date" dir="ltr"
                           style={{ colorScheme: 'dark' }} value={draft.effectiveDate}
                           onChange={e => setDraft({ ...draft, effectiveDate: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="field-label" data-required>
                      {isRtl ? 'تاريخ الاعتماد' : 'Approval Date'}
                      <span className="text-muted-foreground ms-2 normal-case tracking-normal">
                        {isRtl ? 'غير تاريخ السريان' : 'not the effective date'}
                      </span>
                    </label>
                    <input className="field-input font-mono number-ltr" type="date" dir="ltr"
                           style={{ colorScheme: 'dark' }} value={draft.approvalDate}
                           onChange={e => setDraft({ ...draft, approvalDate: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="field-label">
                      {isRtl ? 'خاص بمشروع' : 'Project Scope'}
                      <span className="text-muted-foreground ms-2 normal-case tracking-normal">
                        {isRtl ? 'اختياري' : 'optional'}
                      </span>
                    </label>
                    <select className="field-input" value={draft.projectId}
                            onChange={e => setDraft({ ...draft, projectId: e.target.value })}>
                      <option value="">{isRtl ? 'كل المشاريع' : 'All projects'}</option>
                      {companyProjects.map(p =>
                        <option key={p.id} value={p.id}>{p.code}</option>)}
                    </select>
                  </div>
                  <div className="field xl:col-span-2">
                    <label className="field-label">{isRtl ? 'السبب / المرجع' : 'Reason / Reference'}</label>
                    <input className="field-input" value={draft.reason}
                           placeholder={isRtl ? 'مثال: سعر البنك المركزي، أو بند العقد 14.2' : 'e.g. central bank fixing, or contract clause 14.2'}
                           onChange={e => setDraft({ ...draft, reason: e.target.value })} />
                  </div>
                </div>
                {draft.rate && Number(draft.rate) > 0 && (
                  <p className="text-(length:--t-second) text-muted-foreground mt-2 font-mono">
                    1 {draft.currency} = {Number(draft.rate).toFixed(4)} {draftTarget}
                    {' · '}1,000,000 {draft.currency} ={' '}
                    {(1_000_000 * Number(draft.rate)).toLocaleString('en-US')} {draftTarget}
                  </p>
                )}
                {err && <p className="field-error mt-2">{err}</p>}
                <div className="form-actions">
                  <button type="button" onClick={() => { setAdding(false); setErr(''); setConflictId(''); }} className="btn btn-ghost">
                    {isRtl ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button type="button" onClick={publish} className="btn btn-primary">
                    <Check className="w-3 h-3" />{isRtl ? 'نشر' : 'Publish'}
                  </button>
                </div>
              </div>
            )}

            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'العملة' : 'Currency'}</th>
                    <th className="money">{isRtl ? 'السعر' : 'Rate'}</th>
                    <th className="money">V</th>
                    <th>{isRtl ? 'تاريخ السريان' : 'Effective Date'}</th>
                    <th>{isRtl ? 'تاريخ الاعتماد' : 'Approval Date'}</th>
                    <th>{isRtl ? 'النطاق' : 'Scope'}</th>
                    <th>{isRtl ? 'السبب' : 'Reason'}</th>
                    <th>{isRtl ? 'اعتمده' : 'Approved By'}</th>
                    <th>{isRtl ? 'الحالة' : 'Status'}</th>
                    <th className="col-act" />
                  </tr>
                </thead>
                <tbody>
                  {fx.rates.length === 0 && (
                    <tr><td colSpan={10}><div className="ds-empty">
                      <div className="ds-empty-title">{isRtl ? 'لا توجد أسعار منشورة' : 'No rates published'}</div>
                      <p className="text-(length:--t-second) text-muted-foreground mt-2">
                        {isRtl
                          ? 'حتى يُنشر سعر، تُعامل كل المبالغ على أنها بعملة التقارير.'
                          : 'Until a rate is published, every amount is treated as already being in the reporting currency.'}
                      </p>
                    </div></td></tr>
                  )}
                  {[...fx.rates].sort((a, b) =>
                    a.currency !== b.currency ? a.currency.localeCompare(b.currency)
                                              : (a.effectiveDate < b.effectiveDate ? 1 : -1)
                  ).map(r => (
                    <React.Fragment key={r.id}>
                    <tr id={`fx-rate-${r.id}`} className={cn(
                      r.status === 'superseded' && 'opacity-50',
                      r.id === conflictId && 'ring-1 ring-inset ring-chart-5/50 bg-chart-5/[0.06]',
                      // The rate a converted figure linked here to show.
                      r.id === linkedRateId && 'ring-1 ring-inset ring-primary/60 bg-primary/[0.07]')}>
                      <td className="col-pin font-mono text-primary">
                        {r.currency}
                        <span className="text-muted-foreground ms-1">/ {r.baseCurrency}</span>
                      </td>
                      <td className="money">{r.rate.toFixed(4)}</td>
                      <td className="money font-mono">
                        {r.version > 1
                          ? <span className="badge badge-warn">V{r.version}</span>
                          : <span className="text-muted-foreground">V1</span>}
                      </td>
                      <td className="font-mono text-muted-foreground whitespace-nowrap">
                        {formatDateOrDash(r.effectiveDate, isRtl ? 'ar' : 'en')}
                      </td>
                      <td className="font-mono text-muted-foreground whitespace-nowrap">
                        {formatDateOrDash(r.approvalDate, isRtl ? 'ar' : 'en')}
                      </td>
                      <td className="text-muted-foreground">
                        {r.projectId
                          ? <span className="badge badge-gold">{companyProjects.find(p => p.id === r.projectId)?.code ?? r.projectId}</span>
                          : (isRtl ? 'كل المشاريع' : 'All projects')}
                      </td>
                      <td className="text-white/70 max-w-[240px] truncate" title={r.reason}>{r.reason || '—'}</td>
                      <td className="text-muted-foreground">{r.approvedBy}</td>
                      <td>
                        <span className={cn('badge',
                          r.status === 'approved' ? 'badge-ok' : 'badge-neutral')}>
                          {r.status === 'approved'
                            ? <><Lock className="w-3 h-3" />{isRtl ? 'معتمد' : 'Approved'}</>
                            : (isRtl ? 'مسحوب' : 'Superseded')}
                        </span>
                      </td>
                      <td className="col-act">
                        {canEdit && r.status === 'approved' && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setCorrecting(correcting === r.id ? '' : r.id);
                                setFix({ rate: String(r.rate), correctionReason: '' });
                                setFixErr('');
                              }}
                              title={isRtl
                                ? 'تصحيح — يُنشئ نسخة جديدة ولا يعدّل هذه'
                                : 'Correct — appends a new version, never edits this one'}
                              className="text-muted-foreground hover:text-primary transition-colors p-1"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            {/* Withdrawal now ASKS. A single stray click used
                                to remove a rate permanently, and because
                                `crossRate` only reads approved rows that can
                                break conversion on screens far from here. */}
                            <button
                              onClick={() => { setWithdrawing(r.id); setReinstateErr(''); }}
                              title={isRtl ? 'سحب — يبقى في السجل ويمكن إرجاعه' : 'Withdraw — stays on record, and can be reinstated'}
                              className="text-muted-foreground hover:text-chart-5 transition-colors p-1"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                        {/* A withdrawn rate can be put back. Withdrawal is an
                            operational decision, not a restatement of fact,
                            so unlike a correction it is reversible. */}
                        {canEdit && r.status === 'superseded' && (
                          <button
                            onClick={() => {
                              const res = reinstateRate(id, r.id, user?.username ?? 'unknown');
                              if (!res.ok) {
                                setReinstateErr(res.reason === 'slot-occupied' && res.conflict
                                  ? (isRtl
                                      ? `يوجد سعر معتمد بالفعل لـ ${res.conflict.currency}/${res.conflict.baseCurrency} بتاريخ ${res.conflict.effectiveDate} وقدره ${res.conflict.rate.toFixed(4)}. اسحبه أولاً ثم أعد المحاولة.`
                                      : `A rate of ${res.conflict.rate.toFixed(4)} already stands for ${res.conflict.currency}/${res.conflict.baseCurrency} on ${res.conflict.effectiveDate}. Withdraw that one first.`)
                                  : (isRtl ? 'تعذّر إرجاع السعر.' : 'Could not reinstate this rate.'));
                                if (res.conflict) setConflictId(res.conflict.id);
                                return;
                              }
                              setReinstateErr('');
                              setFx(res.store);
                            }}
                            title={isRtl ? 'إرجاع السعر إلى الاعتماد' : 'Reinstate this rate'}
                            className="text-muted-foreground hover:text-chart-4 transition-colors p-1 inline-flex items-center gap-1"
                          >
                            <History className="w-4 h-4" />
                            <span className="text-(length:--t-micro) uppercase tracking-wider">
                              {isRtl ? 'إرجاع' : 'Reinstate'}
                            </span>
                          </button>
                        )}
                      </td>
                    </tr>
                  {/* Correction form — emitted by the row it corrects, so it
                          appears directly beneath it. */}
                  {canEdit && withdrawing === r.id && (
                    <tr>
                      <td colSpan={10} className="!p-0">
                        <div className="ds-card ds-card-tight border-chart-5/30 bg-chart-5/[0.05] !my-0">
                          <p className="text-(length:--t-second) text-chart-5 mb-3">
                            {isRtl
                              ? `سحب ${r.currency}/${r.baseCurrency} بتاريخ ${r.effectiveDate}؟ لن تُستخدم في أي تحويل جديد، وقد يتعذّر تحويل مبالغ تعتمد عليها. تبقى في السجل ويمكن إرجاعها.`
                              : `Withdraw ${r.currency}/${r.baseCurrency} effective ${r.effectiveDate}? It will no longer be used for any conversion, and amounts relying on it may become unconvertible. It stays on record and can be reinstated.`}
                          </p>
                          <div className="form-actions">
                            <button type="button" onClick={() => setWithdrawing('')}
                                    className="btn btn-ghost">
                              {isRtl ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setFx(supersedeRate(id, r.id, user?.username ?? 'unknown'));
                                setWithdrawing('');
                              }}
                              className="btn btn-primary"
                            >
                              <Ban className="w-3 h-3" />
                              {isRtl ? 'تأكيد السحب' : 'Confirm withdrawal'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {reinstateErr && conflictId === r.id && (
                    <tr>
                      <td colSpan={10} className="!p-0">
                        <p className="field-error !m-2">{reinstateErr}</p>
                      </td>
                    </tr>
                  )}
                  {canEdit && correcting === r.id && (() => {
                      const target = r;
                    const newRate = Number(fix.rate);
                    const delta = Number.isFinite(newRate) ? newRate - target.rate : 0;
                    return (
                      <tr>
                        <td colSpan={10} className="!p-0">
                          <div className="ds-card ds-card-tight !border-primary/25 !bg-primary/[0.03] m-0">
                            <h3 className="sec-head">
                              {isRtl
                                ? `تصحيح ${target.currency} — النسخة V${target.version + 1}`
                                : `Correct ${target.currency} — version V${target.version + 1}`}
                            </h3>
                            <p className="text-(length:--t-second) text-muted-foreground mb-3">
                              {isRtl
                                ? 'السعر الحالي لا يُعدَّل ولا يُحذف. يُسجَّل سعر جديد بنفس تاريخ السريان، ويُحال القديم إلى «مسحوب» مع الإشارة إلى بديله. كل سجل حُوِّل بالسعر القديم يحتفظ بسعره المُجمَّد.'
                                : 'The existing rate is neither edited nor deleted. A new rate is recorded for the same effective date, and the old one is retired to superseded with a pointer to its replacement. Every record already converted at the old rate keeps its frozen rate.'}
                            </p>
                            <div className="form-grid">
                              <div className="field">
                                <label className="field-label">{isRtl ? 'السعر المسجَّل' : 'Rate on record'}</label>
                                <input className="field-input font-mono number-ltr" dir="ltr"
                                       value={target.rate.toFixed(4)} disabled />
                              </div>
                              <div className="field">
                                <label className="field-label" data-required>
                                  {isRtl ? 'السعر الصحيح' : 'Corrected rate'}
                                </label>
                                <input className="field-input font-mono number-ltr" type="number" step="0.0001" dir="ltr"
                                       value={fix.rate}
                                       onChange={e => setFix({ ...fix, rate: e.target.value })} />
                              </div>
                              <div className="field xl:col-span-2">
                                <label className="field-label" data-required>
                                  {isRtl ? 'سبب التصحيح' : 'Correction reason'}
                                </label>
                                <input className="field-input" value={fix.correctionReason}
                                       placeholder={isRtl
                                         ? 'مثال: خطأ إدخال — نشرة البنك المركزي تقول 3.7512'
                                         : 'e.g. keying error — central bank bulletin states 3.7512'}
                                       onChange={e => setFix({ ...fix, correctionReason: e.target.value })} />
                              </div>
                            </div>
                            {Number.isFinite(newRate) && newRate > 0 && delta !== 0 && (
                              <p className={cn('text-(length:--t-second) font-mono mt-2',
                                delta > 0 ? 'text-chart-5' : 'text-chart-4')}>
                                {delta > 0 ? '+' : ''}{delta.toFixed(4)}{' '}
                                <span className="text-muted-foreground">
                                  ({((delta / target.rate) * 100).toFixed(2)}%)
                                  {' · '}
                                  {isRtl ? 'أثر على 1,000,000' : 'impact on 1,000,000'}{': '}
                                  {(1_000_000 * delta).toLocaleString('en-US', { maximumFractionDigits: 0 })} {base}
                                </span>
                              </p>
                            )}
                            {fixErr && <p className="field-error mt-2">{fixErr}</p>}
                            <div className="form-actions">
                              <button type="button" onClick={() => { setCorrecting(''); setFixErr(''); }}
                                      className="btn btn-ghost">
                                {isRtl ? 'إلغاء' : 'Cancel'}
                              </button>
                              <button type="button" onClick={() => submitCorrection(target.id)}
                                      className="btn btn-primary">
                                <Check className="w-3 h-3" />
                                {isRtl ? `نشر V${target.version + 1}` : `Publish V${target.version + 1}`}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ══ PROJECT CONTRACT CURRENCY ══ */}
        {tab === 'projects' && (
          <>
            <p className="text-(length:--t-second) text-muted-foreground max-w-3xl flex items-start gap-1.5">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-primary/60" />
              {isRtl
                ? `عملة العقد لكل مشروع مستقلة عن عملة تقارير الشركة (${base}). هي العملة الافتراضية للسجلات المالية الجديدة، ويمكن لأي معاملة تجاوزها. تغيير عملة العقد لا يمسّ أي مبلغ مخزَّن — يغيّر ما تفترضه السجلات الجديدة فقط.`
                : `Each project's contract currency is independent of the company reporting currency (${base}). It is the default for new financial records, and any single transaction may override it. Changing it alters what new records assume and touches no stored amount.`}
            </p>

            {missingPairs.some(x => !x.resolved) && (
              <div className="ds-card ds-card-tight !border-chart-3/30">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-chart-3 mt-0.5 flex-shrink-0" />
                  <div className="text-(length:--t-second) text-muted-foreground">
                    <p className="text-chart-3 mb-1">
                      {isRtl ? 'عملات عقود بلا سعر صرف' : 'Contract currencies with no exchange rate'}
                    </p>
                    <p>
                      {isRtl
                        ? `لا يمكن تحويل أي مبلغ من هذه العملات إلى ${base}، ولن تُحفظ سجلاتها بقيمة محوَّلة حتى يُنشر سعر:`
                        : `No amount in these currencies can be converted into ${base}, and their records cannot be saved with a converted value until a rate is published:`}
                      {' '}
                      <span className="font-mono text-white">
                        {missingPairs.filter(x => !x.resolved).map(x => `${x.currency}→${base}`).join(' · ')}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th>{isRtl ? 'عملة العقد' : 'Contract Currency'}</th>
                    <th>{isRtl ? 'المصدر' : 'Source'}</th>
                    <th className="money">{isRtl ? `السعر إلى ${base}` : `Rate to ${base}`}</th>
                    <th>{isRtl ? 'ضبطها' : 'Set By'}</th>
                    <th>{isRtl ? 'التاريخ' : 'Date'}</th>
                    <th className="col-act" />
                  </tr>
                </thead>
                <tbody>
                  {companyProjects.length === 0 && (
                    <tr><td colSpan={7}><div className="ds-empty">
                      <div className="ds-empty-title">{isRtl ? 'لا توجد مشاريع' : 'No projects'}</div>
                    </div></td></tr>
                  )}
                  {companyProjects.map(p => {
                    const explicit = hasExplicitCurrency(p.id);
                    const cur = contractCurrencyOf(p.id, base);
                    const rec = projectCurrencies[p.id];
                    const r = cur === base
                      ? null
                      : crossRate(fx, cur, base, today, p.id, base);
                    const draft = pcDraft[p.id] ?? cur;
                    return (
                      <tr key={p.id}>
                        <td className="col-pin">
                          <span className="font-mono text-primary">{p.code}</span>
                          <span className="text-muted-foreground ms-2">
                            {isRtl ? p.nameAr : p.nameEn}
                          </span>
                        </td>
                        <td>
                          <select
                            className="field-input !py-1 !w-28 font-mono"
                            value={draft}
                            disabled={!canEdit}
                            onChange={e => setPcDraft({ ...pcDraft, [p.id]: e.target.value })}
                          >
                            {settings.currencies.filter(c => c.active).map(c =>
                              <option key={c.code} value={c.code}>{c.code}</option>)}
                          </select>
                        </td>
                        <td>
                          <span className={cn('badge', explicit ? 'badge-gold' : 'badge-neutral')}>
                            {explicit
                              ? (isRtl ? 'محدَّدة' : 'Explicit')
                              : (isRtl ? 'موروثة' : 'Inherited')}
                          </span>
                        </td>
                        <td className="money font-mono">
                          {cur === base
                            ? <span className="text-muted-foreground">1.000000</span>
                            : r?.resolved
                              ? <>
                                  {r.rate.toFixed(6)}
                                  {r.source === 'cross' && (
                                    <span className="text-muted-foreground ms-1 text-(length:--t-micro)">
                                      via {r.pivot}
                                    </span>
                                  )}
                                </>
                              : <span className="text-chart-3">
                                  {isRtl ? 'لا سعر' : 'No rate'}
                                </span>}
                        </td>
                        <td className="text-muted-foreground">{rec?.setBy || '—'}</td>
                        <td className="text-muted-foreground font-mono whitespace-nowrap">
                          {rec?.setAt ? formatDateOrDash(rec.setAt.slice(0, 10), isRtl ? 'ar' : 'en') : '—'}
                        </td>
                        <td className="col-act">
                          {canEdit && draft !== cur && (
                            <button
                              onClick={() => { applyProjectCurrency(p.id, draft);
                                               setPcDraft({ ...pcDraft, [p.id]: draft }); }}
                              className="btn btn-primary btn-sm"
                            >
                              <Check className="w-3 h-3" />
                              {isRtl ? 'حفظ' : 'Save'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-(length:--t-second) text-muted-foreground italic">
              {isRtl
                ? 'مشروع بلا عملة محدَّدة يرث عملة تقارير الشركة — وهذا ما كانت عليه سجلاته فعلاً قبل هذه الطبقة، فالوراثة توصيف لا تخمين. الأسعار المشتقّة عبر عملة محورية مُعلَّمة بكلمة via.'
                : 'A project with no explicit currency inherits the company reporting currency — which is what its records actually were before this layer existed, so the inheritance describes rather than guesses. Rates derived through a pivot are marked with via.'}
            </p>
          </>
        )}

        {/* ══ FX REGISTER — the complete append-only audit trail ══ */}
        {tab === 'register' && (
          <>
            <p className="text-(length:--t-second) text-muted-foreground max-w-3xl flex items-start gap-1.5">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-primary/60" />
              {isRtl
                ? 'السجل الكامل بكل نسخه، بما فيها المسحوبة والمُصحَّحة. لا يُخفي شيئاً — سجل يُخفي ما نشره سابقاً لا يستطيع الإجابة على السؤال الوحيد المطلوب منه: ماذا قلنا من قبل، ولماذا تغيّر؟'
                : 'The complete register, every version, including withdrawn and corrected rows. Nothing is hidden — a register that conceals what it used to publish cannot answer the only question asked of it: what did we say before, and why did it change?'}
            </p>

            {/* Integrity — reported, never silently repaired. */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-white/5">
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'إجمالي الأسعار' : 'Total Rates'}</div>
                <div className="val">{integrity.totalRates}</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'سارية' : 'Approved'}</div>
                <div className="val text-chart-4">{integrity.approved}</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'مسحوبة' : 'Superseded'}</div>
                <div className="val text-muted-foreground">{integrity.superseded}</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'تصحيحات' : 'Corrections'}</div>
                <div className={cn('val', integrity.corrections > 0 ? 'text-chart-5' : 'text-muted-foreground')}>
                  {integrity.corrections}
                </div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'العملات' : 'Currencies'}</div>
                <div className="val text-primary">{integrity.currencies}</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'سلامة السجل' : 'Integrity'}</div>
                <div className={cn('val', integrity.clean ? 'text-chart-4' : 'text-chart-3')}>
                  {integrity.clean ? (isRtl ? 'سليم' : 'Clean') : (isRtl ? 'يحتاج مراجعة' : 'Review')}
                </div>
              </div>
            </div>

            {!integrity.clean && (
              <div className="ds-card ds-card-tight !border-chart-3/30">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-chart-3 mt-0.5 flex-shrink-0" />
                  <div className="text-(length:--t-second) text-muted-foreground space-y-1">
                    {integrity.missingApprovalDate.length > 0 && (
                      <p>{isRtl ? 'أسعار بلا تاريخ اعتماد — لا يمكن استخدامها في إعادة بناء نقطة زمنية' : 'Rates with no approval date — they cannot take part in point-in-time reconstruction'}
                        {': '}<span className="font-mono text-white">{integrity.missingApprovalDate.length}</span></p>
                    )}
                    {integrity.duplicateStanding.length > 0 && (
                      <p className="text-chart-3">{isRtl ? 'أكثر من سعر سارٍ لنفس العملة والتاريخ والنطاق — البحث سيختار بالترجيح لا بالحقيقة' : 'More than one standing rate for the same currency, date and scope — a lookup must tie-break rather than read a fact'}
                        {': '}<span className="font-mono">{integrity.duplicateStanding.join(' · ')}</span></p>
                    )}
                    {integrity.reportingMismatch.length > 0 && (
                      <p>{isRtl ? 'عملة تقارير تختلف عن عملة الأساس' : 'Reporting currency differs from base currency'}
                        {': '}<span className="font-mono text-white">{integrity.reportingMismatch.length}</span></p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {corrections.length > 0 && (
              <>
                <h3 className="sec-head">{isRtl ? 'التصحيحات' : 'Corrections'}</h3>
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th className="col-pin">{isRtl ? 'العملة' : 'Currency'}</th>
                        <th className="money">V</th>
                        <th className="money">{isRtl ? 'السعر الجديد' : 'New Rate'}</th>
                        <th className="money">{isRtl ? 'الفرق' : 'Delta'}</th>
                        <th>{isRtl ? 'تاريخ السريان' : 'Effective'}</th>
                        <th>{isRtl ? 'تاريخ الاعتماد' : 'Approved'}</th>
                        <th>{isRtl ? 'سبب التصحيح' : 'Correction Reason'}</th>
                        <th>{isRtl ? 'اعتمده' : 'By'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {corrections.map(r => (
                        <tr key={r.id}>
                          <td className="col-pin font-mono text-primary">{r.currency}</td>
                          <td className="money"><span className="badge badge-warn">V{r.version}</span></td>
                          <td className="money font-mono">{r.rate.toFixed(4)}</td>
                          <td className={cn('money font-mono',
                            r.delta === null || r.delta === 0 ? 'text-muted-foreground'
                            : r.delta > 0 ? 'text-chart-5' : 'text-chart-4')}>
                            {r.delta === null || r.delta === 0 ? '—'
                              : `${r.delta > 0 ? '+' : ''}${r.delta.toFixed(4)}`}
                          </td>
                          <td className="font-mono text-muted-foreground whitespace-nowrap">
                            {formatDateOrDash(r.effectiveDate, isRtl ? 'ar' : 'en')}
                          </td>
                          <td className="font-mono text-muted-foreground whitespace-nowrap">
                            {formatDateOrDash(r.approvalDate, isRtl ? 'ar' : 'en')}
                          </td>
                          <td className="text-white">{r.correctionReason || '—'}</td>
                          <td className="text-muted-foreground">{r.approvedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <h3 className="sec-head">{isRtl ? 'السجل الكامل' : 'Complete Register'}</h3>
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'العملة' : 'Currency'}</th>
                    <th>{isRtl ? 'عملة التقارير' : 'Reporting'}</th>
                    <th className="money">{isRtl ? 'السعر' : 'Rate'}</th>
                    <th className="money">V</th>
                    <th>{isRtl ? 'النوع' : 'Kind'}</th>
                    <th>{isRtl ? 'تاريخ السريان' : 'Effective'}</th>
                    <th>{isRtl ? 'تاريخ الاعتماد' : 'Approved'}</th>
                    <th>{isRtl ? 'اعتمده' : 'By'}</th>
                    <th>{isRtl ? 'النطاق' : 'Scope'}</th>
                    <th>{isRtl ? 'السبب' : 'Reason'}</th>
                    <th>{isRtl ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody>
                  {register.length === 0 && (
                    <tr><td colSpan={11}><div className="ds-empty">
                      <div className="ds-empty-title">{isRtl ? 'السجل فارغ' : 'Register is empty'}</div>
                    </div></td></tr>
                  )}
                  {register.map(r => (
                    <tr key={r.id} className={cn(r.status === 'superseded' && 'opacity-60')}>
                      <td className="col-pin font-mono text-primary">{r.currency}</td>
                      <td className="font-mono text-muted-foreground">{r.reportingCurrency}</td>
                      <td className="money font-mono">{r.rate.toFixed(4)}</td>
                      <td className="money font-mono">
                        {r.version > 1
                          ? <span className="badge badge-warn">V{r.version}</span>
                          : <span className="text-muted-foreground">V1</span>}
                      </td>
                      <td className="text-muted-foreground">
                        {r.kind === 'correction'
                          ? (isRtl ? 'تصحيح' : 'Correction')
                          : (isRtl ? 'أصلي' : 'Original')}
                      </td>
                      <td className="font-mono text-muted-foreground whitespace-nowrap">
                        {formatDateOrDash(r.effectiveDate, isRtl ? 'ar' : 'en')}
                      </td>
                      <td className="font-mono text-muted-foreground whitespace-nowrap">
                        {formatDateOrDash(r.approvalDate, isRtl ? 'ar' : 'en')}
                      </td>
                      <td className="text-muted-foreground">{r.approvedBy || '—'}</td>
                      <td className="text-muted-foreground">
                        {r.projectId
                          ? <span className="badge badge-gold">{companyProjects.find(p => p.id === r.projectId)?.code ?? r.projectId}</span>
                          : (isRtl ? 'كل المشاريع' : 'All projects')}
                      </td>
                      <td className="text-white/70 max-w-[220px] truncate"
                          title={r.correctionReason || r.reason}>
                        {r.correctionReason || r.reason || '—'}
                      </td>
                      <td>
                        <span className={cn('badge',
                          r.status === 'approved' ? 'badge-ok' : 'badge-neutral')}>
                          {r.status === 'approved'
                            ? <><Lock className="w-3 h-3" />{isRtl ? 'معتمد' : 'Approved'}</>
                            : (isRtl ? 'مسحوب' : 'Superseded')}
                          {r.correctedBy && <span className="ms-1 font-mono">→ {r.correctedBy}</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-(length:--t-second) text-muted-foreground italic">
              {isRtl
                ? 'لا يُحذف سعر ولا يُعدَّل أبداً. التصحيح يُنشئ نسخة جديدة بنفس تاريخ السريان ويُحيل القديمة إلى «مسحوب» مع الإشارة إلى بديلها. كل مبلغ حُوِّل بالسعر القديم يحتفظ بسعره المُجمَّد، ولذلك تظل التقارير الصادرة سابقاً قابلة لإعادة الإصدار بنفس الأرقام.'
                : 'No rate is ever deleted or edited. A correction creates a new version for the same effective date and retires the old one to superseded with a pointer to its replacement. Every amount already converted at the old rate keeps its frozen rate, which is what allows a previously issued report to be reissued with the same figures.'}
            </p>
          </>
        )}

        {/* ══ CURRENCIES ══ */}
        {tab === 'currencies' && (
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{isRtl ? 'الرمز' : 'Code'}</th>
                  <th>{isRtl ? 'الاسم' : 'Name'}</th>
                  <th>{isRtl ? 'الرمز المختصر' : 'Symbol'}</th>
                  <th className="money">{isRtl ? 'الخانات العشرية' : 'Decimals'}</th>
                  <th className="money">{isRtl ? 'آخر سعر' : 'Latest Rate'}</th>
                  <th>{isRtl ? 'الحالة' : 'Status'}</th>
                  <th className="col-act" />
                </tr>
              </thead>
              <tbody>
                {settings.currencies.map(c => {
                  const latest = c.code === base ? null : rateOn(fx, c.code, today);
                  return (
                    <tr key={c.code} className={cn(!c.active && 'opacity-45')}>
                      <td className="col-pin font-mono text-primary">
                        {c.code}
                        {c.code === base && (
                          <span className="badge badge-gold ms-2">{isRtl ? 'الأساس' : 'BASE'}</span>
                        )}
                      </td>
                      <td className="text-white">{c.name}</td>
                      <td className="text-muted-foreground font-mono">{c.symbol}</td>
                      <td className="money">{c.decimals}</td>
                      <td className="money">
                        {c.code === base ? '—' : latest ? latest.rate.toFixed(4)
                          : <span className="text-chart-5">{isRtl ? 'لا يوجد' : 'none'}</span>}
                      </td>
                      <td>
                        <span className={cn('badge', c.active ? 'badge-ok' : 'badge-neutral')}>
                          {c.active ? (isRtl ? 'مفعّلة' : 'Active') : (isRtl ? 'معطّلة' : 'Inactive')}
                        </span>
                      </td>
                      <td className="col-act">
                        {canEdit && c.code !== base && (
                          <button onClick={() => toggleCurrency(c.code)}
                                  className="text-muted-foreground hover:text-primary transition-colors p-1"
                                  title={c.active ? (isRtl ? 'تعطيل' : 'Deactivate') : (isRtl ? 'تفعيل' : 'Activate')}>
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ══ FX DASHBOARD ══ */}
        {tab === 'dashboard' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5">
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'عملة التقارير' : 'Reporting Currency'}</div>
                <div className="val text-primary">{base}</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'عملات مسعّرة' : 'Rated Currencies'}</div>
                <div className="val">{codes.length}</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'مشاريع بعملة أجنبية' : 'Foreign-Currency Projects'}</div>
                <div className={cn('val', foreignCount > 0 ? 'text-chart-5' : 'text-muted-foreground')}>
                  {foreignCount}
                </div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'أثر الصرف اليوم' : 'FX Impact Today'}</div>
                <div className={cn('val', totalImpact > 0 ? 'text-chart-5'
                                     : totalImpact < 0 ? 'text-chart-4' : 'text-muted-foreground')}
                     title={exactMoney(totalImpact, base)}>
                  {totalImpact === 0 ? '—' : (totalImpact > 0 ? '+' : '') + abbrevMoney(totalImpact)}
                </div>
              </div>
            </div>

            <div className="ds-card ds-card-raised">
              <h3 className="sec-head">
                {isRtl ? `تغير أسعار الصرف مقابل ${base}` : `Exchange Rate Movement against ${base}`}
              </h3>
              {chart.length > 1 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chart} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
                    <XAxis dataKey="date" {...AXIS} />
                    <YAxis {...AXIS} tickFormatter={(v: number) => v.toFixed(2)} />
                    <Tooltip contentStyle={TT}
                             formatter={(v: any) => v === null ? '—' : Number(v).toFixed(4)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {codes.map((c, i) => (
                      <Line key={c} type="monotone" dataKey={c} name={c}
                            stroke={SERIES[i % SERIES.length]} strokeWidth={2}
                            dot={{ r: 2 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-(length:--t-second) text-muted-foreground italic py-8 text-center">
                  {isRtl
                    ? 'يظهر المنحنى بعد نشر سعرين على تاريخين مختلفين.'
                    : 'The chart appears once two rates exist on different dates.'}
                </p>
              )}
            </div>

            <div className="ds-card ds-card-tight">
              <p className="text-(length:--t-second) text-muted-foreground flex items-start gap-1.5">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-primary/60" />
                {isRtl
                  ? 'الجدول أدناه تحليلي بحت. «القيمة اليوم» تُظهر ما ستساويه القيمة الأصلية بسعر اليوم — وهي لا تغيّر القيمة التعاقدية ولا يستخدمها أي حساب في المنصة.'
                  : 'The table below is analytical only. “Value Today” shows what the original amount would be worth at today’s rate — it does not change the contractual value and no calculation in the platform consumes it.'}
              </p>
            </div>

            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th>{isRtl ? 'العملة' : 'Currency'}</th>
                    <th className="money">{isRtl ? 'المبلغ الأصلي' : 'Original Amount'}</th>
                    <th className="money">{isRtl ? 'السعر المطبَّق' : 'Applied Rate'}</th>
                    <th className="money">{isRtl ? 'القيمة التعاقدية' : 'Contract Value'}</th>
                    <th className="money">{isRtl ? 'سعر اليوم' : 'Rate Today'}</th>
                    <th className="money">{isRtl ? 'القيمة اليوم' : 'Value Today'}</th>
                    <th className="money">{isRtl ? 'أثر الصرف' : 'FX Impact'}</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.length === 0 && (
                    <tr><td colSpan={8}><div className="ds-empty">
                      <div className="ds-empty-title">{isRtl ? 'لا توجد مشاريع' : 'No projects'}</div>
                    </div></td></tr>
                  )}
                  {exposure.map(e => (
                    <tr key={e.id}>
                      <td className="col-pin">
                        <span className="font-mono text-primary">{e.code}</span>
                        <span className="block text-(length:--t-second) text-muted-foreground truncate max-w-[220px]">
                          {e.name}
                        </span>
                      </td>
                      <td>
                        <span className={cn('font-mono', e.foreign ? 'text-primary' : 'text-muted-foreground')}>
                          {e.currency}
                        </span>
                      </td>
                      <td className="money" title={exactMoney(e.original, base)}>
                        {e.foreign ? abbrevMoney(e.original) : '—'}
                      </td>
                      <td className="money text-muted-foreground">
                        {e.foreign && e.originalRate > 0 ? e.originalRate.toFixed(4) : '—'}
                      </td>
                      <td className="money" title={exactMoney(e.atOriginal, base)}>{abbrevMoney(e.atOriginal)}</td>
                      <td className="money text-muted-foreground">
                        {e.comparable && e.foreign ? e.currentRate.toFixed(4) : '—'}
                      </td>
                      <td className="money" title={exactMoney(e.atCurrent, base)}>
                        {e.comparable && e.foreign ? abbrevMoney(e.atCurrent) : '—'}
                      </td>
                      <td className={cn('money',
                        e.impact > 0 ? 'text-chart-5' : e.impact < 0 ? 'text-chart-4' : 'text-muted-foreground')}
                          title={exactMoney(e.impact, base)}>
                        {e.impact === 0 ? '—' : (e.impact > 0 ? '+' : '') + abbrevMoney(e.impact)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {exposure.some(e => e.foreign) && (
                  <tfoot>
                    <tr>
                      <td colSpan={7}>{isRtl ? 'إجمالي أثر الصرف' : 'Total FX Impact'}</td>
                      <td className={cn('money', totalImpact > 0 ? 'text-chart-5' : 'text-chart-4')}
                          title={exactMoney(totalImpact, base)}>
                        {(totalImpact > 0 ? '+' : '') + abbrevMoney(totalImpact)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
