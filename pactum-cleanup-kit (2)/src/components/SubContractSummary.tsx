import React, { useState } from 'react';
import { cn, formatMoney } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { formatDateOrDash } from '../lib/dateFormat';
import { EditableNumber } from './EditableCell';
import { ChevronDown, ChevronUp } from 'lucide-react';

/** One cell of the strip. `manual` / `auto` drive the provenance badge. */
interface Cell {
  label: string;
  val: string;
  c: string;
  manual?: boolean;
  auto?: boolean;
  editable?: boolean;
  /** Underlying number, needed by the inline editor. */
  raw?: number;
  note?: string;
  /**
   * Rendered under the figure — the same amount in the currency it was
   * AGREED in, with a link to the rate that converted it. A subcontract
   * signed in USD is paid and certified in USD, so the converted figure
   * alone is an incomplete statement of the commercial position.
   */
  native?: React.ReactNode;
}

/**
 * Per-subcontract commercial summary strip.
 *
 * ONE component, used in three places, so the numbers and labels can never
 * drift apart:
 *   1. Project -> Subcontracts -> card header      (compact)
 *   2. Project -> Subcontracts -> Commercial tab   (full)
 *   3. Subcontractor Dashboard -> Commercial tab   (full, per project)
 *
 * Pure presentation. Reads nothing, writes nothing — every figure is passed in
 * by the owner of the data.
 */

export interface ContractFigures {
  /**
   * pactum-subs-* : sub.contractValue — the SIGNED contract value.
   * Manual: it is typed once by the commercial team and everything
   * downstream derives from it. Labelled "Contract Value" on screen.
   */
  originalContract: number;
  /** Σ approved change orders */
  approvedChangeOrders: number;
  /** Σ pending change orders — reported, never added to current */
  pendingChangeOrders?: number;
  /**
   * Contract Amount = Contract Value + approved change orders.
   * Automatic — never typed. (Named `currentContract` in storage terms.)
   */
  currentContract: number;
  /** Σ approved claims */
  approvedClaims: number;
  /** Σ approved EOT days */
  approvedEotDays: number;
  /** pactum-sub-certs-* derived */
  certified: number;
  paid: number;
  outstanding: number;
  retentionHeld: number;
  /** pactum-subs-* : sub.retention */
  retentionContract?: number;
  /** Liquidated damages exposure for this subcontract. Automatic. */
  ldExposure?: number;
  /** Baseline Finish + Approved Extension, ISO. Automatic. */
  approvedFinish?: string;
  /** Subcontract commencement date, ISO. Manual, owned by the schedule. */
  commencementDate?: string;
}

interface Props extends ContractFigures {
  /**
   * SPRINT 3 · R5 — the currency every figure here is expressed in.
   *
   * This component is pure presentation: it receives numbers and knows
   * nothing about projects, so it cannot resolve a currency itself. The
   * default keeps existing call sites compiling and preserves exactly the
   * behaviour they had (formatMoney's own 'SAR' default); each caller is
   * updated to pass the real one.
   */
  ccy?: string;
  /**
   * 'compact' = the four primary figures only.
   * 'full'    = primary figures + a collapsible "More Financial Details".
   */
  variant?: 'compact' | 'full';
  className?: string;
  /**
   * Turns the Contract Value cell into an inline editor. Only the owner of
   * the record (the project subcontract card) passes this; every aggregated
   * view leaves it out and stays read-only.
   */
  onEditContractValue?: (v: number) => void;
  canEdit?: boolean;
  /**
   * The contract value in the currency it was AGREED in, with a link to
   * the rate that converted it. Supplied by the caller (which owns the
   * stored row) rather than derived here, so this component performs no
   * conversion and cannot disagree with the record.
   */
  contractNative?: React.ReactNode;
}

export default function SubContractSummary({
  originalContract, approvedChangeOrders, pendingChangeOrders = 0, currentContract,
  approvedClaims, approvedEotDays, certified, paid, outstanding,
  retentionHeld, retentionContract, ldExposure, approvedFinish, commencementDate,
  variant = 'full', className, onEditContractValue, canEdit = false, ccy = 'SAR',
  contractNative,
}: Props) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  // Collapsed by default: the four primary figures answer most questions.
  const [showMore, setShowMore] = useState(false);

  const coColor = approvedChangeOrders < 0
    ? 'text-chart-3'
    : approvedChangeOrders > 0 ? 'text-chart-4' : 'text-muted-foreground';

  // ── PRIMARY — always visible ──
  // Four figures, and only four: the ones every conversation starts with.
  // Contract Value leads because it is the one manual input; everything
  // else is derived from it.
  const primary: Cell[] = [
    { label: isRtl ? 'قيمة العقد' : 'Contract Value', val: formatMoney(originalContract, { currency: ccy }),
      c: 'text-white', manual: true, editable: true, raw: originalContract,
      native: contractNative },
    { label: isRtl ? 'المعتمد' : 'Certified', val: formatMoney(certified, { currency: ccy }), c: 'text-primary', auto: true },
    { label: isRtl ? 'المدفوع' : 'Paid', val: formatMoney(paid, { currency: ccy }), c: 'text-chart-4', auto: true },
    // Outstanding = Contract Amount − Certified.
    { label: isRtl ? 'المستحق' : 'Outstanding', val: formatMoney(outstanding, { currency: ccy }),
      c: 'text-chart-3', auto: true },
  ];

  // ── PRIMARY, SECOND ROW — always visible ──
  // Contract Amount closes the money story the first row opens; the three
  // dates and the LD figure are what a commercial conversation turns on
  // next. Same cell treatment as row one, so the two read as one block.
  //
  // A rollup across several projects has no single commencement date, no
  // single approved finish and no one LD figure, so the caller passes none
  // of them. In that case the row is not rendered at all and Contract Amount
  // falls back to the detail list — better than four cells of "—" and a
  // fabricated SAR 0.
  const hasSchedule =
    commencementDate !== undefined || approvedFinish !== undefined || ldExposure !== undefined;

  const primaryTwo: Cell[] = hasSchedule ? [
    { label: isRtl ? 'مبلغ العقد' : 'Contract Amount', val: formatMoney(currentContract, { currency: ccy }),
      c: 'text-primary', auto: true,
      note: isRtl ? 'قيمة العقد + أوامر التغيير' : 'Contract Value + Change Orders' },
    { label: isRtl ? 'تاريخ البدء' : 'Commencement Date',
      val: formatDateOrDash(commencementDate, isRtl ? 'ar' : 'en'),
      c: 'text-white', auto: true },
    { label: isRtl ? 'تاريخ الانتهاء المعتمد' : 'Approved Finish',
      val: formatDateOrDash(approvedFinish, isRtl ? 'ar' : 'en'),
      c: 'text-primary', auto: true },
    { label: isRtl ? 'الغرامة' : 'LD Exposure',
      val: ldExposure === undefined ? '—' : formatMoney(ldExposure, { currency: ccy }),
      c: (ldExposure ?? 0) > 0 ? 'text-chart-3' : 'text-muted-foreground', auto: true },
  ] : [];

  // ── MORE DETAIL — collapsed by default ──
  // Every figure is still here; none was deleted. They simply do not compete
  // with the four above until the reader asks for them.
  //
  // Approved EOT is absent on purpose: the approved extension is already
  // expressed by Approved Finish Date, and the two side by side invited the
  // reader to add them together.
  // Contract Amount, Approved Finish and LD Exposure were promoted to the
  // second primary row above and are deliberately not repeated here.
  const more: Cell[] = [
    ...(hasSchedule ? [] : [{
      label: isRtl ? 'مبلغ العقد' : 'Contract Amount', val: formatMoney(currentContract, { currency: ccy }),
      c: 'text-primary', auto: true,
      note: isRtl ? 'قيمة العقد + أوامر التغيير' : 'Contract Value + Change Orders',
    } as Cell]),
    { label: isRtl ? 'الضمان المحتجز' : 'Retention Held', val: formatMoney(retentionHeld, { currency: ccy }), c: 'text-chart-5', auto: true },
    { label: isRtl ? 'أوامر التغيير المعتمدة' : 'Approved Change Orders', val: formatMoney(approvedChangeOrders, { currency: ccy }), c: coColor, auto: true },
    { label: isRtl ? 'المطالبات المعتمدة' : 'Approved Claims', val: formatMoney(approvedClaims, { currency: ccy }), c: 'text-white', auto: true },
    ...(retentionContract !== undefined
      ? [{ label: isRtl ? 'الضمان (العقد)' : 'Retention (Contract)', val: formatMoney(retentionContract, { currency: ccy }), c: 'text-chart-5', auto: true } as Cell]
      : []),
    ...(pendingChangeOrders !== 0
      ? [{ label: isRtl ? 'أوامر تغيير معلّقة' : 'Pending Change Orders', val: formatMoney(pendingChangeOrders, { currency: ccy }), c: 'text-chart-5', auto: true } as Cell]
      : []),
  ];

  /** One cell. `lead` gives the headline row its larger figure and padding. */
  const renderCell = (k: Cell, i: number, lead: boolean) => (
    <div key={i} className={cn('bg-black/30 px-4', lead ? 'py-4' : 'py-2.5')}>
      <div className={cn(
        'uppercase text-muted-foreground flex items-center gap-1.5 flex-wrap',
        lead ? 'text-(length:--t-second) font-medium mb-1.5' : 'text-(length:--t-second) font-medium mb-1',
      )}>
        <span>{k.label}</span>
        {k.manual && (
          <span className="text-(length:--t-micro) tracking-widest text-chart-5/70 border border-chart-5/25 px-1 leading-[1.4]">
            {isRtl ? 'يدوي' : 'MANUAL'}
          </span>
        )}
        {k.auto && lead && (
          <span className="text-(length:--t-micro) tracking-widest text-primary/50 border border-primary/20 px-1 leading-[1.4]">
            AUTO
          </span>
        )}
      </div>
      {k.editable && onEditContractValue ? (
        <EditableNumber
          value={k.raw ?? 0}
          onSave={v => onEditContractValue(Number(v) || 0)}
          canEdit={canEdit}
          display={k.val}
          className={cn('font-mono number-ltr font-semibold', lead ? 'text-base' : 'text-xs', k.c)}
        />
      ) : (
        <div className={cn('font-mono number-ltr font-semibold', lead ? 'text-base' : 'text-xs', k.c)}>
          {k.val}
        </div>
      )}
      {/* The agreed amount in its own currency. Shown at every size, not
          only on the lead cell: it is the figure the subcontractor is
          actually paid, so hiding it in a compact view would drop the
          one number the commercial conversation turns on. */}
      {k.native}
      {k.note && lead && <div className="text-(length:--t-second) text-white/45 mt-0.5">{k.note}</div>}
    </div>
  );

  return (
    <div className={className}>
      {/* Primary — always visible. Four cells on a 4-column grid: one row,
          no wrapping, at every breakpoint above mobile. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5">
        {primary.map((k, i) => renderCell(k, i, true))}
      </div>

      {/* Second row of four. Same grid, so the column edges line up exactly
          with the row above and the two read as a single block. */}
      {primaryTwo.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5 border-t border-white/5">
          {primaryTwo.map((k, i) => renderCell(k, i, true))}
        </div>
      )}

      {variant === 'full' && more.length > 0 && (
        <>
          {/* Disclosure control — identical pattern to the Windows section
              already in the Commercial panel. No new style is introduced. */}
          <button
            type="button"
            onClick={() => setShowMore(v => !v)}
            aria-expanded={showMore}
            className="w-full flex items-center justify-between gap-2 px-4 py-2 bg-black/30 border-t border-white/5 text-(length:--t-label) uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            <span>{isRtl ? 'تفاصيل مالية إضافية' : 'More Financial Details'}</span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono">({more.length})</span>
              {showMore ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>

          {showMore && (
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-px bg-white/5 border-t border-white/5">
              {more.map((k, i) => renderCell(k, i, false))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Compact "latest activity" line — reused by both views. */
export function LatestActivity({
  latestChangeOrder, latestClaim, latestEot, className, ccy = 'SAR',
}: {
  /** SPRINT 3 · R5 — see SubContractSummary: presentation only. */
  ccy?: string;
  latestChangeOrder?: { ref: string; date: string; value: number; projectName?: string } | null;
  latestClaim?: { ref: string; date: string; value: number; projectName?: string } | null;
  latestEot?: { ref: string; date: string; value: number; projectName?: string } | null;
  className?: string;
}) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';

  const rows = [
    { label: isRtl ? 'آخر أمر تغيير' : 'Latest Change Order', r: latestChangeOrder, money: true },
    { label: isRtl ? 'آخر مطالبة' : 'Latest Claim', r: latestClaim, money: true },
    { label: isRtl ? 'آخر تمديد' : 'Latest EOT', r: latestEot, money: false },
  ];

  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5', className)}>
      {rows.map((row, i) => (
        <div key={i} className="bg-black/30 p-3">
          <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{row.label}</div>
          {row.r ? (
            <>
              <div className="text-sm font-mono text-white number-ltr">
                <span className="text-primary">{row.r.ref}</span>
                {'  '}
                <span>{row.money ? formatMoney(row.r.value, { currency: ccy }) : `${row.r.value}${isRtl ? ' يوم' : 'd'}`}</span>
              </div>
              <div className="text-(length:--t-second) text-muted-foreground mt-0.5">
                {formatDateOrDash(row.r.date, isRtl ? 'ar' : 'en')}
                {row.r.projectName ? ` · ${row.r.projectName}` : ''}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground italic">{isRtl ? 'لا يوجد' : 'None'}</div>
          )}
        </div>
      ))}
    </div>
  );
}
