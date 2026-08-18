import React, { useMemo } from 'react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { AlertTriangle } from 'lucide-react';
import {
  FxStore, CurrencySettings, MoneyRecord,
  convert, formatCurrency, conversionNote,
} from '../lib/currency';

/**
 * Currency-aware money input and display.
 * Destination: src/components/CurrencyAmount.tsx
 *
 * ONE component so every module captures foreign money the same way. A
 * module drops it in and receives a MoneyRecord back — it never performs a
 * conversion itself, which is what keeps the arithmetic in one place.
 *
 * The converted figure is what the module stores in its existing amount
 * field, so nothing downstream changes.
 */

interface InputProps {
  amount: string;
  currency: string;
  onAmount: (v: string) => void;
  onCurrency: (v: string) => void;
  /** Transaction date. The rate is looked up against this, not against today. */
  date: string;
  fx: FxStore;
  settings: CurrencySettings;
  projectId?: string;
  label?: string;
  disabled?: boolean;
}

/** Amount + currency selector, with the live conversion shown beneath. */
export function CurrencyAmountInput({
  amount, currency, onAmount, onCurrency, date, fx, settings,
  projectId = '', label, disabled,
}: InputProps) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const base = settings.baseCurrency;

  const rec = useMemo(
    () => convert(fx, Number(amount) || 0, currency, date, base, projectId),
    [fx, amount, currency, date, base, projectId],
  );

  const active = settings.currencies.filter(c => c.active);
  const foreign = currency && currency !== base;

  return (
    <div className="field">
      {label && <label className="field-label">{label}</label>}
      <div className="flex gap-2">
        <select
          className="field-input !w-24 font-mono"
          value={currency || base}
          onChange={e => onCurrency(e.target.value)}
          disabled={disabled}
          aria-label={isRtl ? 'العملة' : 'Currency'}
        >
          {active.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
        </select>
        <input
          className="field-input font-mono number-ltr flex-1"
          type="number" dir="ltr" placeholder="0"
          value={amount}
          onChange={e => onAmount(e.target.value)}
          disabled={disabled}
        />
      </div>

      {foreign && (
        rec.resolved ? (
          <p className="text-(length:--t-second) text-muted-foreground mt-1 font-mono">
            {conversionNote(settings, rec)}
          </p>
        ) : (
          <p className="text-(length:--t-second) text-chart-5 mt-1 flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            {isRtl
              ? `لا يوجد سعر صرف لـ ${currency} بتاريخ ${date || '—'}. أضف السعر في إدارة العملات قبل الحفظ.`
              : `No ${currency} rate on record for ${date || '—'}. Publish one in Currency Management before saving.`}
          </p>
        )
      )}
    </div>
  );
}

interface DisplayProps {
  /** The stored row. Read with moneyFrom() by the caller. */
  record: MoneyRecord;
  settings: CurrencySettings;
  /** Show the conversion line under the figure. */
  showNote?: boolean;
  className?: string;
}

/**
 * Displays a converted figure with its origin.
 *
 * The base amount leads because that is what every calculation used; the
 * original is secondary but never hidden, so a reader can always trace the
 * number back to what was actually signed.
 */
export function CurrencyAmountDisplay({ record, settings, showNote = true, className }: DisplayProps) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const foreign = record.originalCurrency !== record.baseCurrency;

  return (
    <span className={cn('inline-flex flex-col', className)}>
      <span className="val-sm">
        {formatCurrency(settings, record.converted, record.baseCurrency)}
      </span>
      {foreign && showNote && (
        <span className={cn('text-(length:--t-micro) font-mono mt-0.5',
          record.resolved ? 'text-muted-foreground' : 'text-chart-5')}>
          {record.resolved
            ? `${formatCurrency(settings, record.original, record.originalCurrency)} @ ${record.appliedRate.toFixed(4)}`
            : `${formatCurrency(settings, record.original, record.originalCurrency)} — ${isRtl ? 'بلا سعر' : 'no rate'}`}
        </span>
      )}
    </span>
  );
}

/** Small chip marking a row that was captured in a foreign currency. */
export function CurrencyBadge({ code, base }: { code: string; base: string }) {
  if (!code || code === base) return null;
  return (
    <span className="text-(length:--t-micro) tracking-widest text-primary/70 border border-primary/25 px-1 leading-[1.4] font-mono">
      {code}
    </span>
  );
}

// ── Transaction amount input (Phase 8) ─────────────────────────────────

import { contractCurrencyOf } from '../lib/projectCurrency';
import { convertBetween, crossRate } from '../lib/currency';
import { formatDateOrDash } from '../lib/dateFormat';

interface TxnInputProps {
  amount: string;
  currency: string;
  date: string;
  onAmount: (v: string) => void;
  onCurrency: (v: string) => void;
  onDate: (v: string) => void;
  fx: FxStore;
  settings: CurrencySettings;
  projectId: string;
  label?: string;
  disabled?: boolean;
  /** Hides the date field for modules that own the date elsewhere. */
  hideDate?: boolean;
}

/**
 * The five things every financial input must show.
 *
 *   Amount · Currency Selector · Effective Date ·
 *   Exchange Rate Preview · Converted Reporting Amount Preview
 *
 * The project's contract currency is pre-selected, so the common case is
 * one keystroke. The preview is computed live but nothing is stored until
 * the module saves — and at that moment the conversion is frozen.
 *
 * When no rate route exists the preview says so and offers no number.
 * Showing an amount the platform cannot actually justify would be worse
 * than showing none, because it would be saved.
 */
export function TransactionAmountInput({
  amount, currency, date, onAmount, onCurrency, onDate,
  fx, settings, projectId, label, disabled, hideDate,
}: TxnInputProps) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  /**
   * THE UNIT THIS INPUT CONVERTS INTO — the PROJECT CONTRACT currency.
   *
   * ══════════════════════════════════════════════════════════════════
   * A REGRESSION I INTRODUCED AND MISSED.
   *
   * When storage moved to the contract currency, `transactionContext()`
   * changed its conversion target accordingly — but this component kept
   * reading `settings.baseCurrency`, the COMPANY currency. The two then
   * disagreed:
   *
   *   SAVE  (transactionContext)  EGP -> SAR   the project's contract
   *   INPUT (this preview)        EGP -> AED   the company's reporting
   *
   * So a SAR project under an AED company demanded an EGP->AED rate and
   * refused the entry, while the save path only ever needed EGP->SAR.
   * The screen blocked a record the engine would have accepted.
   *
   * The company currency is deliberately no longer read here at all:
   * this input belongs to a project screen, and a project screen is
   * denominated in the contract currency.
   * ══════════════════════════════════════════════════════════════════
   */
  const companyReporting = settings.baseCurrency;
  const contract = useMemo(
    () => contractCurrencyOf(projectId, companyReporting),
    [projectId, companyReporting]);
  /** What the entered amount is converted into. Must match the save path. */
  const reporting = contract;
  const active = currency || contract;

  const conv = useMemo(
    () => convertBetween(fx, Number(amount) || 0, active, reporting, date, projectId, reporting),
    [fx, amount, active, reporting, date, projectId],
  );

  const foreign = active !== reporting;
  const rateInfo = useMemo(
    () => crossRate(fx, active, reporting, date, projectId, reporting),
    [fx, active, reporting, date, projectId],
  );

  return (
    <div className="field">
      {label && <label className="field-label">{label}</label>}

      <div className="flex gap-2">
        <select
          className="field-input !w-28 font-mono"
          value={active}
          onChange={e => onCurrency(e.target.value)}
          disabled={disabled}
        >
          {settings.currencies.filter(c => c.active).map(c => (
            <option key={c.code} value={c.code}>
              {c.code}{c.code === contract ? ' •' : ''}
            </option>
          ))}
        </select>
        <input
          className="field-input font-mono number-ltr flex-1"
          type="number" step="0.01" dir="ltr"
          value={amount}
          onChange={e => onAmount(e.target.value)}
          disabled={disabled}
        />
        {!hideDate && (
          <input
            className="field-input !w-40 font-mono number-ltr"
            type="date" dir="ltr" style={{ colorScheme: 'dark' }}
            value={date}
            onChange={e => onDate(e.target.value)}
            disabled={disabled}
            title={isRtl ? 'تاريخ المعاملة — السعر يُبحث به' : 'Transaction date — the rate is looked up against this'}
          />
        )}
      </div>

      {/* Rate + converted preview. Only meaningful for a foreign amount. */}
      {foreign && (
        <div className="mt-1.5 text-(length:--t-second)">
          {!rateInfo.resolved ? (
            <div className="flex items-start gap-1.5 text-chart-3">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                {isRtl
                  ? `لا يوجد سعر صرف من ${active} إلى ${reporting} بتاريخ ${formatDateOrDash(date, 'ar')}. لن يُحفظ السجل بقيمة محوَّلة — انشر السعر أولاً.`
                  : `No exchange rate from ${active} to ${reporting} on ${formatDateOrDash(date, 'en')}. The record cannot be saved with a converted value — publish the rate first.`}
              </span>
            </div>
          ) : (
            <div className="font-mono text-muted-foreground">
              <span className="text-white">
                {active} {(Number(amount) || 0).toLocaleString('en-US')}
              </span>
              {' × '}
              <span className="text-primary">{rateInfo.rate.toFixed(6)}</span>
              {' = '}
              <span className="text-white">
                {reporting} {Math.round(conv.converted).toLocaleString('en-US')}
              </span>
              <span className="ms-2 text-(length:--t-micro)">
                {rateInfo.source === 'cross'
                  ? (isRtl ? `مشتق عبر ${rateInfo.pivot}` : `crossed via ${rateInfo.pivot}`)
                  : rateInfo.source === 'inverse'
                  ? (isRtl ? 'معكوس' : 'inverse')
                  : (isRtl ? 'مباشر' : 'direct')}
                {rateInfo.effectiveDate && ` · ${formatDateOrDash(rateInfo.effectiveDate, isRtl ? 'ar' : 'en')}`}
              </span>
            </div>
          )}
        </div>
      )}

      {!foreign && (
        <p className="mt-1.5 text-(length:--t-second) text-muted-foreground">
          {isRtl
            ? `بعملة التقارير — لا تحويل${active === contract ? ' · عملة العقد' : ''}`
            : `In the reporting currency — no conversion${active === contract ? ' · contract currency' : ''}`}
        </p>
      )}
    </div>
  );
}

// ── Native amount + FX reference ───────────────────────────────────────

import { Link2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { readTransactionMoney } from '../lib/moneyEntry';

interface NativeAmountProps {
  /** The stored row. Carries its own frozen conversion, or nothing. */
  row: any;
  /** Field holding the CONVERTED figure, e.g. 'contractValue', 'gross'. */
  field: string;
  /** Unit the converted figure is in — the project contract currency. */
  displayCurrency: string;
  /** Company that published the rate; its currency page holds the record. */
  companyId: string;
  /** Recovers the native amount when the row stores no explicit original. */
  originalField?: string;
  className?: string;
}

/**
 * The amount AS AGREED, in the currency it was agreed in, linked to the
 * rate that converted it.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 *   A subcontract signed in USD is converted to the project currency at
 *   assignment and the converted figure is what every rollup consumes.
 *   That is correct for the project's arithmetic and wrong for the
 *   commercial reality: the subcontractor is PAID in USD, their
 *   certificates are valued in USD, and a dispute is argued in USD. A
 *   screen showing only "AED 3,674,482.22" has silently discarded the
 *   number both parties actually signed.
 *
 *   The native amount is not recomputed here. `readTransactionMoney`
 *   returns what the row froze at save time, so this displays the
 *   agreed figure rather than today's opinion of it.
 *
 * THE RATE IS A LINK, NOT A FOOTNOTE
 *
 *   Stating "@ 0.9790" invites the question "which rate row is that?".
 *   The reference navigates to the company's Currency Management page,
 *   deep-linked to the exact rate id, so the published record — its
 *   version, effective date, approver — is one click away.
 * ══════════════════════════════════════════════════════════════════════
 */
export function NativeAmount({
  row, field, displayCurrency, companyId, originalField, className,
}: NativeAmountProps) {
  const { lang } = useTranslation();
  const [, setLocation] = useLocation();
  const isRtl = lang === 'ar';

  const m = readTransactionMoney(row, field, displayCurrency, displayCurrency);

  // Nothing to add when the row was never converted.
  if (!m.originalCurrency || m.originalCurrency === displayCurrency) return null;

  const native = originalField && row?.[originalField] !== undefined
    ? Number(row[originalField]) || 0
    : m.originalAmount;

  const rateId = (m.rateLegIds && m.rateLegIds[0]) || '';
  const canLink = Boolean(companyId);

  return (
    <div className={cn('mt-0.5 leading-tight', className)}>
      <div className="text-(length:--t-data) font-mono text-primary number-ltr">
        {m.originalCurrency} {native.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        <span className="text-muted-foreground ms-1.5 text-(length:--t-micro)">
          {isRtl ? 'العملة الأصلية' : 'as agreed'}
        </span>
      </div>
      <button
        type="button"
        disabled={!canLink}
        onClick={() => canLink && setLocation(
          `/company/${companyId}/currency${rateId ? `?rate=${encodeURIComponent(rateId)}` : ''}`)}
        title={isRtl
          ? 'اعرض سعر الصرف المنشور الذي استُخدم في هذا التحويل'
          : 'Open the published exchange rate used for this conversion'}
        className="inline-flex items-center gap-1 text-(length:--t-micro) font-mono
                   text-muted-foreground hover:text-primary underline decoration-dotted
                   underline-offset-2 disabled:opacity-40 disabled:no-underline"
      >
        <Link2 className="w-2.5 h-2.5" aria-hidden="true" />
        @ {m.exchangeRateSnapshot.toFixed(6)}
        {m.exchangeRateEffectiveDate &&
          ` · ${formatDateOrDash(m.exchangeRateEffectiveDate, isRtl ? 'ar' : 'en')}`}
      </button>
    </div>
  );
}
