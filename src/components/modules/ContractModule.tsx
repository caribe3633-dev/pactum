import React, { useMemo, useState } from 'react';
import { Save, Info, Plus, Trash2, ExternalLink, FileSignature, Landmark, Clock, CalendarCheck, Link2, FileText, GitBranch, AlertTriangle } from 'lucide-react';
import { useTranslation } from '../../lib/i18n';
import { useProjects, useAuth } from '../../lib/store';
import { useProjectCurrency } from '../../lib/useProjectCurrency';
import { commercialTotals } from '../../lib/commercialTotals';
import { companyIdOfProject } from '../../lib/projectMaster';
import { fetchSectors } from '../../mock/sectors';
import { computeApprovedEOT } from '../../lib/delayCalculations';
import { abbrevMoney, exactMoney } from '../../lib/moneyFormat';
import { formatDateOrDash, toInputDate } from '../../lib/dateFormat';
import { cn } from '../../lib/utils';
import { Project } from '../../lib/data';
import {
  CONTRACT_PHASE_GROUPS, CONTRACT_PHASE_EXCEPTIONS,
  contractPhaseOption, contractPhaseGroupOf, isContractPhaseException,
} from '../../lib/contractPhases';
import SourceVersionsPanel from '../SourceVersionsPanel';

/**
 * CONTRACT — the commercial identity of the project, versioned.
 *
 * Contract Value is the ONE number entered by hand here; everything else
 * is derived:
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
 *
 * CONTRACT DOCUMENTS — an independent register of links (name + URL
 * only; PACTUM never stores files). Not part of the version snapshot.
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

// ── Contract documents register (independent, links only) ──────────────

interface ContractDoc {
  id: string;
  name: string;
  url: string;
  addedBy: string;
  addedAt: string; // ISO
}

const DOCS_KEY = (projectId: string) => `pactum-contract-docs-${projectId}`;

function readDocs(projectId: string): ContractDoc[] {
  try {
    const raw = localStorage.getItem(DOCS_KEY(projectId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDocs(projectId: string, docs: ContractDoc[]): void {
  localStorage.setItem(DOCS_KEY(projectId), JSON.stringify(docs));
}

export default function ContractModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const { updateProject } = useProjects();
  const { user } = useAuth();
  const ccy = useProjectCurrency(project).base;

  const [draftValue, setDraftValue] = useState<string>('');
  const [savedFlash, setSavedFlash] = useState(false);

  // ── Contract phase (state) card ──
  const phase = contractPhaseOption(project.contractPhase);
  const phaseGroup = contractPhaseGroupOf(project.contractPhase);
  const phaseException = isContractPhaseException(project.contractPhase ?? '');
  const phaseRisky = phaseException || project.contractPhase === 'SUSPENDED';
  const setPhase = (value: string) => {
    updateProject({ ...project, contractPhase: value });
  };

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

  // ── Documents state ──
  const [docs, setDocs] = useState<ContractDoc[]>(() => readDocs(project.id));
  const [docForm, setDocForm] = useState<{ open: boolean; name: string; url: string }>({ open: false, name: '', url: '' });
  const [docErr, setDocErr] = useState('');

  const openDocForm = () => { setDocForm({ open: true, name: '', url: '' }); setDocErr(''); };
  const addDoc = () => {
    const name = docForm.name.trim();
    const url = docForm.url.trim();
    if (!name) { setDocErr(isRtl ? 'اسم المستند مطلوب.' : 'Document name is required.'); return; }
    if (!url || !/^(https?:\/\/|www\.|\/|file:|\\\\|drive:|sharepoint)/i.test(url)) {
      setDocErr(isRtl ? 'لينك المستند مطلوب (مثال: https://...).' : 'Document link is required (e.g. https://...).');
      return;
    }
    const next = [...docs, {
      id: `cdoc-${Date.now()}`,
      name,
      url,
      addedBy: user?.username || 'unknown',
      addedAt: new Date().toISOString(),
    }];
    setDocs(next);
    writeDocs(project.id, next);
    setDocForm({ open: false, name: '', url: '' });
    setDocErr('');
  };

  const removeDoc = (id: string) => {
    const next = docs.filter(d => d.id !== id);
    setDocs(next);
    writeDocs(project.id, next);
  };

  // KPI cards — built on the SAME tile pattern as the Overview grid:
  // ds-card-raised + icon + t-metric + uppercase label + Auto/Manual badge.
  const cards = [
    {
      key: 'value',
      icon: FileSignature,
      color: 'text-primary',
      badge: <span className="badge badge-neutral">{isRtl ? 'يدوي' : 'Manual'}</span>,
      label: isRtl ? 'القيمة التعاقدية' : 'Contract Value',
      node: (
        <div>
          <p className="t-metric" title={exactMoney(project.contractValue, totals.contractCurrency || ccy)}>
            {project.contractValue !== undefined && project.contractValue !== null
              ? abbrevMoney(project.contractValue)
              : '—'}
          </p>
          {canEdit && (
            <div className="mt-1.5">
              {draftValue === '' ? (
                <button onClick={startEdit} className="text-(length:--t-label) text-muted-foreground uppercase tracking-widest hover:text-primary transition-colors">
                  {isRtl ? 'تعديل' : 'Edit'}
                </button>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input
                    type="number"
                    dir="ltr"
                    className="field-input !py-1 !px-2 font-mono w-32"
                    value={draftValue}
                    onChange={e => setDraftValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveValue(); }}
                  />
                  <button onClick={saveValue} className="btn btn-primary btn-sm"><Save className="w-3 h-3" />{isRtl ? 'حفظ' : 'Save'}</button>
                  <button onClick={() => setDraftValue('')} className="btn btn-secondary btn-sm">{isRtl ? 'إلغاء' : 'Cancel'}</button>
                </div>
              )}
            </div>
          )}
          {savedFlash && <p className="kpi-sub text-(--c-success) mt-1">{isRtl ? 'تم الحفظ ✓' : 'Saved ✓'}</p>}
        </div>
      ),
    },
    {
      key: 'amount',
      icon: Landmark,
      color: 'text-white',
      badge: <span className="badge badge-ok">{isRtl ? 'تلقائي' : 'Auto'}</span>,
      label: isRtl ? 'إجمالي العقد' : 'Contract Amount',
      node: (
        <div>
          <p className="t-metric" title={exactMoney(totals.revisedContract, totals.contractCurrency || ccy)}>
            {abbrevMoney(totals.revisedContract)}
          </p>
          <p className="kpi-sub text-muted-foreground mt-1">
            {isRtl
              ? `${totals.contractCurrency || ccy} · أصلي ${abbrevMoney(totals.originalContract)} + أوامر تغيير ${abbrevMoney(totals.approvedChangeOrders)} + مطالبات ${abbrevMoney(totals.approvedClaims)}`
              : `${totals.contractCurrency || ccy} · original ${abbrevMoney(totals.originalContract)} + COs ${abbrevMoney(totals.approvedChangeOrders)} + claims ${abbrevMoney(totals.approvedClaims)}`}
          </p>
        </div>
      ),
    },
    {
      key: 'commencement',
      icon: Clock,
      color: 'text-chart-5',
      badge: <span className="badge badge-ok">{isRtl ? 'مرتبط بالتأخير' : 'Linked'}</span>,
      label: isRtl ? 'تاريخ المباشرة' : 'Commencement Date',
      node: (
        <p className="t-metric font-mono !text-(length:--t-large)">
          {formatDateOrDash(project.commencementDate || '', isRtl ? 'ar' : 'en')}
        </p>
      ),
    },
    {
      key: 'finish',
      icon: CalendarCheck,
      color: 'text-chart-3',
      badge: <span className="badge badge-ok">{isRtl ? 'مرتبط بالتأخير' : 'Linked'}</span>,
      label: isRtl ? 'الانتهاء المعتمد' : 'Approved Finish',
      node: (
        <div>
          <p className={cn('t-metric font-mono !text-(length:--t-large)', eot.totalApprovedEOT > 0 ? 'kpi-v-warn' : 'kpi-v-ok')}>
            {formatDateOrDash(approvedFinish, isRtl ? 'ar' : 'en')}
          </p>
          <p className="kpi-sub text-muted-foreground mt-1 font-mono">
            {isRtl
              ? `تعاقدي + EOT معتمد (${eot.totalApprovedEOT} يوم)`
              : `contractual + approved EOT (${eot.totalApprovedEOT}d)`}
          </p>
        </div>
      ),
    },
    {
      key: 'phase',
      icon: phaseRisky ? AlertTriangle : GitBranch,
      color: phaseRisky ? 'text-chart-3' : 'text-chart-4',
      badge: <span className="badge badge-neutral">{isRtl ? 'يدوي' : 'Manual'}</span>,
      label: isRtl ? 'حالة العقد (Phase)' : 'Contract Phase',
      node: (
        <div>
          <p className={cn('t-metric !text-(length:--t-large)', phaseRisky ? 'kpi-v-warn' : '')}>
            {phase ? (isRtl ? phase.ar : phase.en) : (isRtl ? 'لم ت\u062cحدد' : 'Not set')}
          </p>
          <p className="kpi-sub text-muted-foreground mt-1 font-mono">
            {phase
              ? `${phase.value}${phaseGroup ? ` · ${isRtl ? phaseGroup.ar : phaseGroup.en}` : phaseException ? (isRtl ? ' · حالة استثنائية' : ' · exception') : ''}`
              : (isRtl ? 'اختر الحالة من القائمة' : 'pick a status below')}
          </p>
          {phase && (
            <p className="kpi-sub text-muted-foreground/80 mt-1 max-w-md">{phase.desc}</p>
          )}
          {canEdit && (
            <select
              className="field-input !py-1.5 mt-2 max-w-md"
              value={project.contractPhase ?? ''}
              onChange={e => setPhase(e.target.value)}
            >
              <option value="">{isRtl ? '— اختر حالة العقد —' : '— select contract phase —'}</option>
              {CONTRACT_PHASE_GROUPS.map(g => (
                <optgroup key={g.key} label={`${g.key}. ${isRtl ? g.ar : g.en}`}>
                  {g.options.map(o => (
                    <option key={o.value} value={o.value}>{isRtl ? o.ar : o.en}</option>
                  ))}
                </optgroup>
              ))}
              <optgroup label={isRtl ? 'حالات استثنائية' : 'Exceptions'}>
                {CONTRACT_PHASE_EXCEPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{isRtl ? o.ar : o.en}</option>
                ))}
              </optgroup>
            </select>
          )}
        </div>
      ),
    },
  ];

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

      {/* ── KPI grid — same tile design as Overview ── */}
      <div className="ds-grid">
        {cards.map(card => (
          <div key={card.key} className="ds-card ds-card-raised hover:bg-black/40 transition-colors">
            <div className="flex justify-between items-start !mt-0">
              <card.icon className={cn('w-5 h-5', card.color, 'opacity-60')} />
              {card.badge}
            </div>
            <div className="mb-2">{card.node}</div>
            <h3 className="text-(length:--t-label) uppercase tracking-wider text-muted-foreground leading-tight">
              {card.label}
            </h3>
          </div>
        ))}
      </div>

      {/* ── The contract approval line — same versioning as Budget/Claims/COs ── */}
      <SourceVersionsPanel projectId={project.id} only="contract" canEdit={canEdit} compact />

      {/* ── Contract documents — independent register of links ── */}
      <div className="ds-card">
        <div className="flex items-center justify-between gap-4 flex-wrap !mt-0">
          <h3 className="sec-head !mb-0">
            <FileText className="w-4 h-4 inline-block me-2 text-primary/70" />
            {isRtl ? 'المستندات التعاقدية' : 'Contract Documents'}
          </h3>
          {canEdit && !docForm.open && (
            <button onClick={openDocForm} className="btn btn-primary btn-sm">
              <Plus className="w-3 h-3" />
              {isRtl ? 'إضافة مستند تعاقدي' : 'Add Contract Document'}
            </button>
          )}
        </div>

        {canEdit && docForm.open && (
          <div className="form-grid">
            <div className="field">
              <label className="field-label" data-required>{isRtl ? 'اسم المستند' : 'Document name'}</label>
              <input
                className="field-input"
                value={docForm.name}
                onChange={e => setDocForm({ ...docForm, name: e.target.value })}
                placeholder={isRtl ? 'مثال: اتفاقية العقد — الموقع' : 'e.g. Contract Agreement — signed'}
                onKeyDown={e => { if (e.key === 'Enter') addDoc(); }}
              />
            </div>
            <div className="field">
              <label className="field-label" data-required>{isRtl ? 'لينك المستند' : 'Document link'}</label>
              <input
                className="field-input font-mono"
                dir="ltr"
                value={docForm.url}
                onChange={e => setDocForm({ ...docForm, url: e.target.value })}
                placeholder="https://..."
                onKeyDown={e => { if (e.key === 'Enter') addDoc(); }}
              />
            </div>
          </div>
        )}
        {canEdit && docForm.open && (
          <div className="flex items-center gap-2 mt-3">
            <button onClick={addDoc} className="btn btn-primary btn-sm">
              <Plus className="w-3 h-3" /> {isRtl ? 'إضافة' : 'Add'}
            </button>
            <button onClick={() => { setDocForm({ open: false, name: '', url: '' }); setDocErr(''); }} className="btn btn-secondary btn-sm">
              {isRtl ? 'إلغاء' : 'Cancel'}
            </button>
            {docErr && <p className="text-(length:--t-second) text-(--c-destructive)">{docErr}</p>}
          </div>
        )}

        {docs.length === 0 ? (
          <p className="text-(length:--t-second) text-muted-foreground italic">
            {isRtl
              ? 'لا توجد مستندات بعد — اتفافية العقد، المخططات، المواصفات، عرض السعر، جدول الكميات… أول مستند بيبدأ السجل.'
              : 'No documents yet — contract agreement, drawings, specifications, quotation, BOQ… the first one starts the register.'}
          </p>
        ) : (
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{isRtl ? 'المستند' : 'Document'}</th>
                  <th>{isRtl ? 'اللينك' : 'Link'}</th>
                  <th>{isRtl ? 'أضافه' : 'Added By'}</th>
                  <th>{isRtl ? 'التاريخ' : 'Date'}</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {docs.map(d => (
                  <tr key={d.id}>
                    <td className="col-pin text-white">{d.name}</td>
                    <td>
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-primary hover:underline font-mono text-(length:--t-second)"
                        dir="ltr"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        {d.url.length > 48 ? d.url.slice(0, 45) + '…' : d.url}
                      </a>
                    </td>
                    <td className="text-muted-foreground">{d.addedBy}</td>
                    <td className="text-muted-foreground font-mono whitespace-nowrap">
                      {formatDateOrDash(d.addedAt.slice(0, 10), isRtl ? 'ar' : 'en')}
                    </td>
                    {canEdit && (
                      <td>
                        <button
                          onClick={() => removeDoc(d.id)}
                          className="btn btn-secondary btn-sm"
                          aria-label={isRtl ? 'حذف' : 'Delete'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
