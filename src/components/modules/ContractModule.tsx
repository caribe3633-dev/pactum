import React, { useMemo, useState } from 'react';
import { Save, Info } from 'lucide-react';
import { useTranslation } from '../../lib/i18n';
import { useProjects } from '../../lib/store';
import { useProjectCurrency } from '../../lib/useProjectCurrency';
import { commercialTotals } from '../../lib/commercialTotals';
import { companyIdOfProject } from '../../lib/projectMaster';
import { fetchSectors } from '../../mock/sectors';
import { computeApprovedEOT } from '../../lib/delayCalculations';
import { abbrevMoney, exactMoney } from '../../lib/moneyFormat';
import { formatDateOrDash, toInputDate } from '../../lib/dateFormat';
import { cn } from '../../lib/utils';
import { Project } from '../../lib/data';
import SourceVersionsPanel from '../SourceVersionsPanel';

/**
 * CONTRACT — the commercial identity of the project, versioned.
 *
 * Contract Value is the ONE number entered by hand here; everything else
 * on this screen is derived:
 *   - Contract Amount = original + approved change orders + approved
 *     claims, via commercialTotals() — the exact same engine Overview
 *     uses, so the two screens can never disagree.
 *   - Commencement Date and Approved Finish come from the delay
 *     analysis (Approved Finish = contractual completion + approved
 *     EOT), linked — never re-entered.
 *
 * The contract carries its own baseline approval line (draft → submitted
 * → approved) exactly like Budget, Claims and Change Orders, and the
 * Baseline page reads its approved version as a source.
 */

/** Same helper Overview uses — identical date arithmetic, no drift. */
function addDaysToDate(dateStr: string, days: number): string {
  if (!dateStr || days === 0) return dateStr;
  const iso = toInputDate(dateStr); // → YYYY-MM-DD
  const d = new Date(iso);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ContractModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const { updateProject } = useProjects();
  const ccy = useProjectCurrency(project).base;

  const [draftValue, setDraftValue] = useState<string>('');
  const [savedFlash, setSavedFlash] = useState(false);

  /** Same computation path as Overview — single authority. */
  const totals = useMemo(
    () => commercialTotals(
      project as any,
      companyIdOfProject(project as any, fetchSectors()),
    ),
    [project],
  );

  /** Delay-analysis linkage: approved EOT moves the approved finish. */
  const eot = useMemo(() => computeApprovedEOT(project.id), [project.id]);
  const approvedFinish = project.contractualCompletion
    ? addDaysToDate(project.contractualCompletion, eot.totalApprovedEOT)
    : (project.approvedCompletion || '');

  const startEdit = () => setDraftValue(project.contractValue !== undefined && project.contractValue !== null ? String(project.contractValue) : '');
  const saveValue = () => {
    const n = Number(draftValue.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) return;
    updateProject({ ...project, contractValue: n });
    setDraftValue('');
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const card = 'bg-black/30 px-4 py-3';

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      {/* ── What this screen is ── */}
      <div className="ds-card ds-card-tight">
        <div className="flex items-start gap-2.5">
          <Info className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" />
          <p className="text-(length:--t-second) text-muted-foreground leading-relaxed">
            {isRtl
              ? 'القيمة التعاقدية هي الرقم الوحيد المُدخل يدويًا هنا. إجمالي العقد يُحسب بنفس محرك النظرة العامة (الأصلي + أوامر التغيير المعتمدة + المطالبات المعتمدة)، وتواريخ البدء والانتهاء المعتمد مقروءة من تحليل التأخير ومربوطة به. وللعقد خط اعتماد خاص به (مسودة ← مُقدَّمة ← معتمدة) مثل الموازنة والمطالبات وأوامر التغيير تمامًا، وتقرأه صفحة خطوط الأساس كمصدر.'
              : 'The Contract Value is the only number entered by hand here. The Contract Amount is computed by the same engine Overview uses (original + approved change orders + approved claims), and the Commencement / Approved Finish dates are read from — and linked to — the delay analysis. The contract carries its own approval line (draft → submitted → approved) exactly like Budget, Claims and Change Orders, and the Baseline page reads it as a source.'}
          </p>
        </div>
      </div>

      {/* ── The four cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-white/5">

        {/* Contract Value — manual entry */}
        <div className={card}>
          <div className="lbl mb-1.5">{isRtl ? 'القيمة التعاقدية (يدوي)' : 'Contract Value (manual)'}</div>
          <div className="val" title={exactMoney(project.contractValue, totals.contractCurrency || ccy)}>
            {project.contractValue !== undefined && project.contractValue !== null
              ? abbrevMoney(project.contractValue)
              : '—'}
          </div>
          <div className="text-(length:--t-second) text-muted-foreground mt-1 font-mono">
            {totals.contractCurrency || ccy}
          </div>
          {canEdit && (
            <div className="mt-2">
              {draftValue === '' ? (
                <button onClick={startEdit} className="btn btn-secondary btn-sm">
                  {isRtl ? 'تعديل القيمة' : 'Edit value'}
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    dir="ltr"
                    className="field-input !py-1 !px-2 font-mono w-32"
                    value={draftValue}
                    onChange={e => setDraftValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveValue(); }}
                  />
                  <button onClick={saveValue} className="btn btn-primary btn-sm">
                    <Save className="w-3 h-3" /> {isRtl ? 'حفظ' : 'Save'}
                  </button>
                  <button onClick={() => setDraftValue('')} className="btn btn-secondary btn-sm">
                    {isRtl ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              )}
            </div>
          )}
          {savedFlash && (
            <p className={cn('text-xs mt-1.5', 'text-success')}>{isRtl ? 'تم الحفظ ✓' : 'Saved ✓'}</p>
          )}
        </div>

        {/* Contract Amount — computed exactly like Overview */}
        <div className={card}>
          <div className="lbl mb-1.5">{isRtl ? 'إجمالي العقد (محسوب)' : 'Contract Amount (computed)'}</div>
          <div className="val" title={exactMoney(totals.revisedContract, totals.contractCurrency || ccy)}>
            {abbrevMoney(totals.revisedContract)}
          </div>
          <div className="text-(length:--t-second) text-muted-foreground mt-1 font-mono">
            {isRtl
              ? `${totals.contractCurrency || ccy} · أصلي ${abbrevMoney(totals.originalContract)} + أوامر تغيير ${abbrevMoney(totals.approvedChangeOrders)} + مطالبات ${abbrevMoney(totals.approvedClaims)}`
              : `${totals.contractCurrency || ccy} · original ${abbrevMoney(totals.originalContract)} + COs ${abbrevMoney(totals.approvedChangeOrders)} + claims ${abbrevMoney(totals.approvedClaims)}`}
          </div>
        </div>

        {/* Commencement Date — linked to delay analysis */}
        <div className={card}>
          <div className="lbl mb-1.5">{isRtl ? 'تاريخ المباشرة' : 'Commencement Date'}</div>
          <div className="val font-mono !text-(length:--t-mid)">
            {formatDateOrDash(project.commencementDate || '', isRtl ? 'ar' : 'en')}
          </div>
          <div className="text-(length:--t-second) text-muted-foreground mt-1">
            {isRtl ? 'من تحليل التأخير' : 'from Delay Analysis'}
          </div>
        </div>

        {/* Approved Finish — contractual completion + approved EOT */}
        <div className={card}>
          <div className="lbl mb-1.5">{isRtl ? 'الانتهاء المعتمد' : 'Approved Finish'}</div>
          <div className="val font-mono !text-(length:--t-mid)">
            {formatDateOrDash(approvedFinish, isRtl ? 'ar' : 'en')}
          </div>
          <div className="text-(length:--t-second) text-muted-foreground mt-1 font-mono">
            {isRtl
              ? `التعاقدي + EOT معتمد (${eot.totalApprovedEOT} يوم)`
              : `contractual + approved EOT (${eot.totalApprovedEOT}d)`}
          </div>
        </div>
      </div>

      {/* ── The contract approval line — same versioning as Budget/Claims/COs ── */}
      <SourceVersionsPanel projectId={project.id} only="contract" canEdit={canEdit} compact />
    </div>
  );
}
