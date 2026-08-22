/**
 * Report definitions — one per module.
 * Destination: src/lib/reporting/definitions.ts
 *
 * Each definition is a pure mapping: context in, ReportDocument out. No
 * calculation happens here. Every figure arrives already computed by the
 * module that owns it, exactly as the screen shows it.
 *
 * To add a report: write a definition, register it, done. The engine, the
 * renderer and every other report are untouched.
 */

import { registerReport } from './registry';
import { ReportDocument, BuildMeta, Section } from './types';
import { money, percent, days, reportDate } from './format';

// ── Shared context shapes ──────────────────────────────────────────────
// Deliberately loose: a module passes what it already holds in state.

interface ProjectLike {
  id: string; code?: string; nameEn?: string; nameAr?: string;
  contractValue?: number; progress?: number; delayDays?: number;
  contractualCompletion?: string; approvedCompletion?: string;
  commencementDate?: string; plannedDurationDays?: number;
  ldRatePerDay?: number; ldCapAmount?: number;
}

interface Ctx {
  project?: ProjectLike;
  company?: string;
  sector?: string;
  lang?: 'en' | 'ar';
  [k: string]: unknown;
}

/** The identity block every report shares. */
/**
 * Bilingual report text: the report body speaks the reader's language.
 * Arabic covers the four commercial-core reports (Budget, Project
 * Dashboard, Cash Flow, Earned Value); English stays the fallback.
 */
const L = (m: BuildMeta, en: string, ar: string): string => (m.lang === 'ar' ? ar : en);

function meta(ctx: Ctx, m: BuildMeta, title: string, subtitle?: string, version = '1.0') {
  const p = ctx.project;
  return {
    title,
    subtitle,
    company: ctx.company,
    sector: ctx.sector,
    project: p ? (m.lang === 'ar' ? p.nameAr : p.nameEn) || p.nameEn : undefined,
    reference: p?.code,
    generatedBy: m.generatedBy,
    generatedAt: m.generatedAt,
    version,
    systemVersion: m.systemVersion,
    // SPRINT 4 — every report now declares its own unit. `cur()` returns
    // '' when nothing in the context states one, and `undefined` here
    // means the renderer and the Office writers omit the row entirely
    // rather than printing a currency nobody asserted.
    currency: cur(ctx) || undefined,
    confidentiality: 'Confidential' as const,
  };
}

const A4: ReportDocument['page'] = { size: 'A4', orientation: 'portrait' };
const A4L: ReportDocument['page'] = { size: 'A4', orientation: 'landscape' };

const sig = (roles: string[]): Section => ({
  kind: 'signature', title: 'Approvals',
  signatories: roles.map(role => ({ role })),
});

// ══ 1 · DELAY ANALYSIS ═════════════════════════════════════════════════

registerReport<Ctx & {
  rows?: any[]; ld?: any; programme?: any; windows?: any[]; summary?: string;
}>({
  id: 'delay-analysis',
  label: 'Delay Analysis',
  labelAr: 'تحليل التأخير',
  scope: 'Project',
  page: A4L,
  build: (ctx, m) => {
    const rows = (ctx.rows ?? []) as any[];
    const ld = (ctx.ld ?? {}) as Record<string, any>;
    const pr = (ctx.programme ?? {}) as Record<string, any>;
    const sections: Section[] = [];

    if (ctx.summary) sections.push({ kind: 'summary', title: 'Executive Summary', text: ctx.summary });

    sections.push({
      kind: 'kpi', title: 'Position', columns: 6,
      items: [
        { label: 'Total Delay',    value: ld.totalDelay ?? 0,       unit: 'DAYS', tone: 'warn' },
        { label: 'Approved EOT',   value: ld.totalApprovedEOT ?? 0, unit: 'DAYS', tone: 'gold' },
        { label: 'Culpable Delay', value: ld.culpableDelay ?? 0,    unit: 'DAYS', tone: 'risk' },
        { label: 'LD Rate / Day',  value: money(ld.ldRatePerDay),   unit: unit(ctx) },
        { label: 'LD Exposure',    value: money(ld.ldExposure),     unit: unit(ctx), tone: 'risk' },
        { label: 'Delay Events',   value: rows.length },
      ],
    });

    sections.push({
      kind: 'info', title: 'Schedule Impact', columns: 4,
      items: [
        { label: 'Commencement',    value: reportDate(pr.commencementDate, m.lang) },
        { label: 'Planned Duration',value: pr.plannedDurationDays ? days(pr.plannedDurationDays) : '—' },
        { label: 'Baseline Finish', value: reportDate(pr.baselineFinish, m.lang) },
        { label: 'Approved Finish', value: reportDate(pr.approvedFinish, m.lang), tone: 'gold' },
        { label: 'Estimated Finish',value: reportDate(pr.estimatedFinish, m.lang), tone: 'warn' },
        { label: 'Forecast Finish', value: reportDate(pr.forecastFinish, m.lang) },
        { label: 'LD Cap',          value: ld.ldCapAmount ? money(ld.ldCapAmount) : 'No cap entered' },
        { label: 'Net Cost Impact', value: money(ld.netCostImpact ?? 0), tone: 'risk' },
      ],
    });

    sections.push({
      kind: 'table', title: 'Delay Register',
      columns: [
        { key: 'id', label: 'Delay ID', width: 11 },
        { key: 'description', label: 'Description', width: 24 },
        { key: 'responsibleParty', label: 'Responsible', width: 10 },
        { key: 'startDate', label: 'Start Date', width: 11 },
        { key: 'endDate', label: 'End Date', width: 11 },
        { key: 'delayDays', label: 'Delay Days', money: true, width: 8 },
        { key: 'eotDays', label: 'EOT', money: true, width: 7 },
        { key: 'costImpact', label: 'Cost Impact', money: true, width: 11 },
        { key: 'status', label: 'Status', status: true, width: 7 },
      ],
      rows: rows.map(r => ({
        ...r,
        startDate: reportDate(r.startDate, m.lang),
        endDate: reportDate(r.endDate, m.lang),
      })),
      total: {
        label: `Total — ${rows.length} events`, span: 5,
        values: {
          delayDays:  rows.reduce((a, r) => a + (Number(r.delayDays) || 0), 0),
          eotDays:    rows.filter(r => r.status === 'approved')
                          .reduce((a, r) => a + (Number(r.eotDays) || 0), 0),
          costImpact: rows.reduce((a, r) => a + (Number(r.costImpact) || 0), 0),
        },
      },
      note: 'Approved change orders and claims generate their own events. EOT totals count approved rows only.',
    });

    if (ctx.windows?.length) {
      sections.push({ kind: 'pagebreak' });
      sections.push({
        kind: 'timeline', title: 'Windows Analysis',
        items: ctx.windows.map((w: any) => ({
          label: w.label ?? w.id,
          date: w.closesOn,
          value: `${w.project?.totalDelay ?? 0}d delay · ${w.project?.approvedEot ?? 0}d EOT`,
          note: w.closed ? 'Closed' : 'Open',
          tone: w.closed ? 'default' : 'gold',
        })),
      });
    }

    sections.push(sig(['Planning Manager', 'Contracts Manager', 'Project Director']));

    return { meta: meta(ctx, m, 'Delay Analysis', 'Schedule Impact & Liquidated Damages'),
             page: A4L, cover: true, toc: true, sections };
  },
});

// ══ 2 · DELAY REGISTER (register only, portrait) ═══════════════════════

registerReport<Ctx & { rows?: any[] }>({
  id: 'delay-register',
  label: 'Delay Register',
  labelAr: 'سجل التأخيرات',
  scope: 'Project',
  page: A4L,
  build: (ctx, m) => {
    const rows = (ctx.rows ?? []) as any[];
    return {
      meta: meta(ctx, m, 'Delay Register'),
      page: A4L,
      sections: [{
        kind: 'table',
        columns: [
          { key: 'id', label: 'Delay ID' },
          { key: 'description', label: 'Description' },
          { key: 'category', label: 'Category' },
          { key: 'responsibleParty', label: 'Responsible' },
          { key: 'startDate', label: 'Start' },
          { key: 'endDate', label: 'End' },
          { key: 'delayDays', label: 'Days', money: true },
          { key: 'eotDays', label: 'EOT', money: true },
          { key: 'costImpact', label: 'Cost Impact', money: true },
          { key: 'status', label: 'Status', status: true },
        ],
        rows: rows.map(r => ({ ...r,
          startDate: reportDate(r.startDate, m.lang),
          endDate: reportDate(r.endDate, m.lang) })),
        total: { label: `${rows.length} events`, span: 6, values: {
          delayDays: rows.reduce((a, r) => a + (Number(r.delayDays) || 0), 0),
          eotDays: rows.reduce((a, r) => a + (Number(r.eotDays) || 0), 0),
          costImpact: rows.reduce((a, r) => a + (Number(r.costImpact) || 0), 0),
        }},
      }],
    };
  },
});

// ══ 3 · CHANGE ORDERS ══════════════════════════════════════════════════

registerReport<Ctx & { rows?: any[] }>({
  id: 'change-orders',
  label: 'Change Orders',
  labelAr: 'أوامر التغيير',
  scope: 'Project',
  build: (ctx, m) => {
    const rows = (ctx.rows ?? []) as any[];
    const approved = rows.filter(r => r.status === 'approved');
    const review   = rows.filter(r => r.status === 'review');
    return {
      meta: meta(ctx, m, 'Change Orders', 'Variation Register'),
      page: A4, cover: true,
      sections: [
        { kind: 'kpi', columns: 4, items: [
          { label: 'Approved Value', value: money(approved.reduce((a, r) => a + (Number(r.value) || 0), 0)), unit: unit(ctx), tone: 'gold' },
          { label: 'Under Review',   value: money(review.reduce((a, r) => a + (Number(r.value) || 0), 0)), unit: unit(ctx), tone: 'warn' },
          { label: 'Approved Time',  value: approved.reduce((a, r) => a + (Number(r.time) || 0), 0), unit: 'DAYS' },
          { label: 'Total Orders',   value: rows.length },
        ]},
        { kind: 'table', title: 'Change Order Log',
          columns: [
            { key: 'no', label: 'CO No.' },
            { key: 'desc', label: 'Description' },
            { key: 'value', label: 'Value', money: true },
            { key: 'time', label: 'Time Impact', money: true },
            { key: 'status', label: 'Status', status: true },
            { key: 'document', label: 'Document' },
          ],
          // A printed page cannot be clicked, so the URL is spelled out.
          rows: rows.map(r => ({ ...r, document: r.documentUrl || '—' })),
          total: { label: `${rows.length} orders`, span: 2, values: {
            value: rows.reduce((a, r) => a + (Number(r.value) || 0), 0),
            time:  rows.reduce((a, r) => a + (Number(r.time) || 0), 0),
          }},
          note: 'Current Contract = Original Contract + approved change orders.' },
        sig(['Quantity Surveyor', 'Commercial Manager', 'Project Director']),
      ],
    };
  },
});

// ══ 4 · CLAIMS ═════════════════════════════════════════════════════════

registerReport<Ctx & { rows?: any[] }>({
  id: 'claims',
  label: 'Claims',
  labelAr: 'المطالبات',
  scope: 'Project',
  build: (ctx, m) => {
    const rows = (ctx.rows ?? []) as any[];
    return {
      meta: meta(ctx, m, 'Claims', 'Contractual Claims Register'),
      page: A4, cover: true,
      sections: [
        { kind: 'kpi', columns: 4, items: [
          { label: 'Total Claimed', value: money(rows.reduce((a, r) => a + (Number(r.claimed) || 0), 0)), unit: unit(ctx) },
          { label: 'Total Settled', value: money(rows.reduce((a, r) => a + (Number(r.settled) || 0), 0)), unit: unit(ctx), tone: 'ok' },
          { label: 'Time Claimed',  value: rows.reduce((a, r) => a + (Number(r.timeDays) || 0), 0), unit: 'DAYS', tone: 'gold' },
          { label: 'Claims',        value: rows.length },
        ]},
        { kind: 'table', title: 'Claims Register',
          columns: [
            { key: 'no', label: 'Claim No.' },
            { key: 'type', label: 'Type' },
            { key: 'claimed', label: 'Claimed', money: true },
            { key: 'settled', label: 'Settled', money: true },
            { key: 'timeDays', label: 'Time (Days)', money: true },
            { key: 'status', label: 'Status', status: true },
            { key: 'document', label: 'Document' },
          ],
          // A printed page cannot be clicked, so the URL is spelled out.
          rows: rows.map(r => ({ ...r, document: r.documentUrl || '—' })),
          total: { label: `${rows.length} claims`, span: 2, values: {
            claimed:  rows.reduce((a, r) => a + (Number(r.claimed) || 0), 0),
            settled:  rows.reduce((a, r) => a + (Number(r.settled) || 0), 0),
            timeDays: rows.reduce((a, r) => a + (Number(r.timeDays) || 0), 0),
          }},
          note: 'Claims do not change the Current Contract until converted into an approved change order.' },
        sig(['Contracts Manager', 'Commercial Manager', 'Project Director']),
      ],
    };
  },
});

// ══ 5 · CASH FLOW ══════════════════════════════════════════════════════

registerReport<Ctx & { rows?: any[]; totalIn?: number; totalOut?: number; netFlow?: number }>({
  id: 'cash-flow',
  label: 'Cash Flow',
  labelAr: 'التدفق النقدي',
  scope: 'Project',
  build: (ctx, m) => {
    const rows = (ctx.rows ?? []) as any[];
    /** The CHRONOLOGICAL cumulative position (owner review): the old
     *  column printed the stored `cumNet`, accumulated in ENTRY order —
     *  a running total that could go down. ctx.cum is the engine's
     *  date-ordered derivation, the same one the screen's cumulative
     *  table prints; planned columns and variance match the ledger. */
    const cum = (ctx.cum ?? []) as any[];
    const lines = cum.map((r: any) => {
      const row = rows.find(x => x.month === r.month) ?? {};
      return {
        month: r.month,
        plannedIn: r.cumPlannedIn,
        plannedOut: r.cumPlannedOut,
        in: Number(row.in) || 0,
        out: Number(row.out) || 0,
        variance: r.variance,
        net: r.cumNet,
      };
    });
    return {
      meta: meta(ctx, m, 'Cash Flow', 'Monthly Ledger'),
      page: A4, cover: true,
      sections: [
        { kind: 'kpi', columns: 3, items: [
          { label: L(m, 'Cash In', 'نقدية داخل'), value: money(ctx.totalIn), unit: unit(ctx), tone: 'ok' },
          { label: L(m, 'Cash Out', 'نقدية خارج'), value: money(ctx.totalOut), unit: unit(ctx), tone: 'risk' },
          { label: L(m, 'Net Position', 'الصافي'), value: money(ctx.netFlow), unit: unit(ctx),
            tone: (Number(ctx.netFlow) || 0) >= 0 ? 'gold' : 'risk' },
        ]},
        { kind: 'table', title: L(m, 'Cumulative Position — by Period', 'الموقف التراكمي — لكل فترة'),
          columns: [
            { key: 'month', label: L(m, 'Month', 'الفترة') },
            { key: 'plannedIn', label: L(m, 'Cum. Planned In', 'تراكمي وارد مخطط'), money: true },
            { key: 'plannedOut', label: L(m, 'Cum. Planned Out', 'تراكمي صادر مخطط'), money: true },
            { key: 'in', label: L(m, 'Cash In', 'وارد فعلي'), money: true },
            { key: 'out', label: L(m, 'Cash Out', 'صادر فعلي'), money: true },
            { key: 'variance', label: L(m, 'Cum. Variance', 'الانحراف التراكمي'), money: true },
            { key: 'net', label: L(m, 'Cumulative Net', 'الصافي التراكمي'), money: true },
          ],
          rows: lines,
          total: { label: L(m, 'Closing', 'المقفل'), span: 5, values: {
            variance: lines.length ? lines[lines.length - 1].variance : '',
            net: lines.length ? lines[lines.length - 1].net : '',
          }} },
        sig(['Cost Control Engineer', 'Finance Manager']),
      ],
    };
  },
});

// ══ 6 · OWNER CERTIFICATES ═════════════════════════════════════════════

registerReport<Ctx & { rows?: any[]; certified?: number; retention?: number }>({
  id: 'certificates',
  label: 'Payment Certificates',
  labelAr: 'المستخلصات',
  scope: 'Project',
  page: A4L,
  build: (ctx, m) => {
    const rows = (ctx.rows ?? []) as any[];
    return {
      meta: meta(ctx, m, 'Payment Certificates', 'Interim Payment Certificates'),
      page: A4L, cover: true,
      sections: [
        { kind: 'kpi', columns: 4, items: [
          { label: 'Total Certified', value: money(ctx.certified), unit: unit(ctx), tone: 'gold' },
          { label: 'Retention Held',  value: money(ctx.retention), unit: unit(ctx), tone: 'risk' },
          { label: 'Net Receivable',  value: money((Number(ctx.certified) || 0) - (Number(ctx.retention) || 0)), unit: unit(ctx), tone: 'ok' },
          { label: 'Certificates',    value: rows.length },
        ]},
        { kind: 'table', title: 'Certificate Register',
          columns: [
            { key: 'no', label: 'Cert No.' },
            { key: 'period', label: 'Period' },
            { key: 'gross', label: 'Gross', money: true },
            { key: 'retention', label: 'Retention', money: true },
            { key: 'net', label: 'Net Payable', money: true },
            { key: 'approvalDate', label: 'Approved' },
            { key: 'paymentDate', label: 'Paid' },
            { key: 'status', label: 'Status', status: true },
            { key: 'document', label: 'Document' },
          ],
          // A printed page cannot be clicked, so the URL is spelled out.
          rows: rows.map(r => ({ ...r,
            approvalDate: reportDate(r.approvalDate, m.lang),
            paymentDate: reportDate(r.paymentDate, m.lang),
            document: r.documentUrl || '—' })),
          total: { label: `${rows.length} certificates`, span: 2, values: {
            gross:     rows.reduce((a, r) => a + (Number(r.gross) || 0), 0),
            retention: rows.reduce((a, r) => a + (Number(r.retention) || 0), 0),
            net:       rows.reduce((a, r) => a + (Number(r.net) || 0), 0),
          }} },
        sig(['Quantity Surveyor', 'Commercial Manager', 'Employer Representative']),
      ],
    };
  },
});

// ══ 7 · RISK REGISTER ══════════════════════════════════════════════════

registerReport<Ctx & { rows?: any[]; exposure?: number }>({
  id: 'risk-register',
  label: 'Risk Register',
  labelAr: 'سجل المخاطر',
  scope: 'Project',
  build: (ctx, m) => {
    const rows = (ctx.rows ?? []) as any[];
    const band = (v: number) => Math.max(1, Math.min(5, Math.ceil(v * 5))) as 1|2|3|4|5;
    const maxImpact = Math.max(1, ...rows.map((r: any) => Number(r.impact) || 0));
    return {
      meta: meta(ctx, m, 'Risk Register', 'Probability & Impact Assessment'),
      page: A4, cover: true,
      sections: [
        { kind: 'kpi', columns: 2, items: [
          { label: 'Total Expected Exposure', value: money(ctx.exposure), unit: unit(ctx), tone: 'risk' },
          { label: 'Registered Risks', value: rows.length },
        ]},
        { kind: 'table', title: 'Register',
          columns: [
            { key: 'id', label: 'Risk ID' },
            { key: 'event', label: 'Risk Event' },
            { key: 'category', label: 'Category' },
            { key: 'prob', label: 'Probability', money: true },
            { key: 'impact', label: 'Impact', money: true },
            { key: 'expected', label: 'Expected Value', money: true },
          ],
          rows: rows.map((r: any) => ({ ...r,
            prob: percent(r.prob),
            expected: (Number(r.prob) || 0) * (Number(r.impact) || 0) })),
          total: { label: `${rows.length} risks`, span: 5, values: { expected: ctx.exposure ?? 0 } } },
        { kind: 'risk', title: 'Risk Matrix',
          cells: rows.slice(0, 25).map((r: any) => ({
            probability: band(Number(r.prob) || 0),
            impact: band((Number(r.impact) || 0) / maxImpact),
            label: String(r.id ?? ''),
          })) },
        sig(['Risk Manager', 'Project Director']),
      ],
    };
  },
});

// ══ 8 · SUBCONTRACTORS ═════════════════════════════════════════════════

registerReport<Ctx & { rows?: any[]; totalValue?: number; totalCertified?: number; outstanding?: number }>({
  id: 'subcontractors',
  label: 'Subcontractors',
  labelAr: 'مقاولو الباطن',
  scope: 'Project',
  page: A4L,
  build: (ctx, m) => {
    const rows = (ctx.rows ?? []) as any[];
    return {
      meta: meta(ctx, m, 'Subcontractors', 'Subcontract Commercial Position'),
      page: A4L, cover: true,
      sections: [
        { kind: 'kpi', columns: 4, items: [
          { label: 'Total Subcontract Value', value: money(ctx.totalValue), unit: unit(ctx), tone: 'gold' },
          { label: 'Certified to Date', value: money(ctx.totalCertified), unit: unit(ctx) },
          { label: 'Outstanding', value: money(ctx.outstanding), unit: unit(ctx), tone: 'risk' },
          { label: 'Subcontracts', value: rows.length },
        ]},
        { kind: 'table', title: 'Subcontract Register',
          columns: [
            { key: 'code', label: 'Code' },
            { key: 'company', label: 'Subcontractor' },
            { key: 'trade', label: 'Trade' },
            { key: 'originalContract', label: 'Original', money: true },
            { key: 'currentContract', label: 'Current', money: true },
            { key: 'certified', label: 'Certified', money: true },
            { key: 'paid', label: 'Paid', money: true },
            { key: 'outstanding', label: 'Outstanding', money: true },
            { key: 'totalDelay', label: 'Delay', money: true },
            { key: 'approvedExtension', label: 'EOT', money: true },
          ],
          rows,
          total: { label: `${rows.length} subcontracts`, span: 3, values: {
            originalContract: rows.reduce((a, r) => a + (Number(r.originalContract) || 0), 0),
            currentContract:  rows.reduce((a, r) => a + (Number(r.currentContract) || 0), 0),
            certified:        rows.reduce((a, r) => a + (Number(r.certified) || 0), 0),
            paid:             rows.reduce((a, r) => a + (Number(r.paid) || 0), 0),
            outstanding:      rows.reduce((a, r) => a + (Number(r.outstanding) || 0), 0),
          }} },
        sig(['Commercial Manager', 'Project Director']),
      ],
    };
  },
});

// ══ 9 · PROJECT DASHBOARD ══════════════════════════════════════════════

registerReport<Ctx & { computed?: any; summary?: string }>({
  id: 'project-dashboard',
  label: 'Project Dashboard',
  labelAr: 'لوحة المشروع',
  scope: 'Project',
  build: (ctx, m) => {
    const p = (ctx.project ?? {}) as Record<string, any>;
    const c = (ctx.computed ?? {}) as Record<string, any>;
    const ev = (ctx.evm ?? {}) as Record<string, any>;
    /** PROGRESS IS EARNED (owner rule): EV ÷ BAC from the engine, the
     *  same number every screen prints. The stored manual field is a
     *  fallback only, for projects with nothing measurable yet. */
    const earned = typeof ev.progressPct === 'number' ? ev.progressPct : null;
    const progressPct = earned ?? (Number(p.progress) || 0);
    return {
      meta: meta(ctx, m, 'Project Dashboard', 'Executive Overview'),
      page: A4, cover: true, toc: true,
      sections: [
        ...(ctx.summary ? [{ kind: 'summary' as const, title: L(m, 'Executive Summary', 'الملخص التنفيذي'), text: ctx.summary }] : []),
        { kind: 'kpi', title: L(m, 'Contract Position', 'الموقف التعاقدي'), columns: 4, items: [
          { label: L(m, 'Contract Value', 'قيمة العقد'), value: money(p.contractValue), unit: unit(ctx) },
          { label: L(m, 'Contract Amount', 'المبلغ التعاقدي'), value: money(c.revisedContractValue), unit: unit(ctx), tone: 'gold' },
          { label: L(m, 'Approved COs', 'أوامر تغيير معتمدة'), value: money(c.totalApprovedCOs), unit: unit(ctx) },
          { label: L(m, 'Approved Claims', 'مطالبات معتمدة'), value: money(c.totalApprovedClaims), unit: unit(ctx) },
        ]},
        { kind: 'kpi', title: L(m, 'Progress & Time', 'التقدم والزمن'), columns: 4, items: [
          { label: L(m, 'Progress (Earned — EV ÷ BAC)', 'التقدم (مكتسب — EV ÷ BAC)'),
            value: earned === null ? percent(p.progress) : percent(earned), tone: 'ok' },
          { label: L(m, 'Current Delay', 'التأخير الحالي'), value: c.currentDelay ?? p.delayDays ?? 0, unit: 'DAYS', tone: 'warn' },
          { label: L(m, 'Approved EOT', 'تمديد معتمد'), value: c.totalApprovedEOT ?? 0, unit: 'DAYS', tone: 'gold' },
          { label: L(m, 'Contract Completion', 'الإنجاز التعاقدي'), value: reportDate(p.contractualCompletion, m.lang) },
        ]},
        { kind: 'kpi', title: L(m, 'Performance Position', 'موقف الأداء'), columns: 3, items: [
          { label: L(m, 'EVM Position', 'موقف القيمة المكتسبة'),
            value: String(ev.position ?? '—'), tone: 'gold' },
          { label: L(m, 'Basis Period', 'فترة الأساس'), value: String(ev.period ?? '—') },
          { label: L(m, 'SPI · CPI', 'SPI · CPI'),
            value: `${ev.spi ?? '—'} · ${ev.cpi ?? '—'}` },
        ]},
        { kind: 'kpi', title: L(m, 'Cash Position', 'الموقف النقدي'), columns: 3, items: [
          { label: L(m, 'Cash Received', 'نقدية واردة'), value: money(c.totalCashReceived), unit: unit(ctx), tone: 'ok' },
          { label: L(m, 'Cash Disbursed', 'نقدية صادرة'), value: money(c.totalCashDisbursed), unit: unit(ctx), tone: 'risk' },
          { label: L(m, 'Net Position', 'الصافي'), value: money((Number(c.totalCashReceived) || 0) - (Number(c.totalCashDisbursed) || 0)), unit: unit(ctx), tone: 'gold' },
        ]},
        { kind: 'bars', title: L(m, 'Completion', 'الإنجاز'), items: [
          { label: L(m, 'Earned Progress', 'التقدم المكتسب'), ratio: progressPct, value: percent(progressPct), tone: 'ok' },
        ]},
        sig(['Project Manager', 'Project Director']),
      ],
    };
  },
});

// ══ 10 · PORTFOLIO SUMMARY ═════════════════════════════════════════════

registerReport<Ctx & { companies?: any[]; aggregate?: number }>({
  id: 'portfolio-summary',
  label: 'Portfolio Summary',
  labelAr: 'ملخص المحفظة',
  scope: 'Portfolio',
  build: (ctx, m) => {
    const rows = (ctx.companies ?? []) as any[];
    return {
      meta: { ...meta(ctx, m, 'Enterprise Portfolio', 'Consolidated Summary'), project: undefined, reference: undefined },
      page: A4, cover: true,
      sections: [
        { kind: 'kpi', columns: 3, items: [
          { label: 'Aggregate Value', value: money(ctx.aggregate), unit: unit(ctx), tone: 'gold' },
          { label: 'Companies', value: rows.length },
          { label: 'Projects', value: rows.reduce((a: number, r: any) => a + (Number(r.projects) || 0), 0) },
        ]},
        { kind: 'table', title: 'Companies',
          columns: [
            { key: 'name', label: 'Company' },
            { key: 'country', label: 'Location' },
            { key: 'portfolioValue', label: 'Portfolio Value', money: true },
            { key: 'sectors', label: 'Sectors', money: true },
            { key: 'projects', label: 'Projects', money: true },
            { key: 'status', label: 'Status', status: true },
          ],
          rows,
          total: { label: `${rows.length} companies`, span: 2, values: {
            portfolioValue: rows.reduce((a: number, r: any) => a + (Number(r.portfolioValue) || 0), 0),
            sectors:  rows.reduce((a: number, r: any) => a + (Number(r.sectors) || 0), 0),
            projects: rows.reduce((a: number, r: any) => a + (Number(r.projects) || 0), 0),
          }} },
        sig(['Chief Executive Officer']),
      ],
    };
  },
});

// ══ 11 · BUDGET ════════════════════════════════════════════════════════

registerReport<Ctx & { rows?: any[] }>({
  id: 'budget',
  label: 'Budget',
  labelAr: 'الموازنة',
  scope: 'Project',
  build: (ctx, m) => {
    const rows = (ctx.rows ?? []) as any[];
    /** Cost class + Remaining derived per line — exactly what the
     *  screen's ledger shows. The dead Forecast/Variance columns are
     *  gone from print (owner review): they printed zeros since the
     *  fields left the screen. */
    const ct = (r: any) => {
      const t = String(r?.costType ?? '').toLowerCase();
      const v = t === 'direct' || t === 'indirect' ? t : 'unclassified';
      return L(m, v === 'unclassified' ? 'Unclassified' : v === 'direct' ? 'Direct' : 'Indirect',
               v === 'unclassified' ? 'غير مصنَّف' : v === 'direct' ? 'مباشر' : 'غير مباشر');
    };
    const lines = rows.map(r => ({
      category: r.category,
      costType: ct(r),
      planned: Number(r.planned) || 0,
      actual: Number(r.actual) || 0,
      remaining: (Number(r.planned) || 0) - (Number(r.actual) || 0),
    }));
    const tot = lines.reduce(
      (a, r) => ({ planned: a.planned + r.planned, actual: a.actual + r.actual, remaining: a.remaining + r.remaining }),
      { planned: 0, actual: 0, remaining: 0 },
    );
    return {
      meta: meta(ctx, m, 'Budget', 'Cost Breakdown Structure'),
      page: A4, cover: true,
      sections: [
        { kind: 'table', title: L(m, 'Budget Ledger', 'سجل الموازنة'),
          columns: [
            { key: 'category', label: L(m, 'Category', 'البند') },
            { key: 'costType', label: L(m, 'Cost Type', 'نوع التكلفة') },
            { key: 'planned', label: L(m, 'Planned', 'المخطط'), money: true },
            { key: 'actual', label: L(m, 'Actual', 'الفعلي'), money: true },
            { key: 'remaining', label: L(m, 'Remaining', 'المتبقي'), money: true },
          ],
          rows: lines,
          total: { label: L(m, 'Total', 'الإجمالي'), span: 2, values: {
            planned: tot.planned, actual: tot.actual, remaining: tot.remaining,
          }} },
        sig(['Cost Control Engineer', 'Commercial Manager']),
      ],
    };
  },
});

// ══ 12 · EARNED VALUE ══════════════════════════════════════════════════

registerReport<Ctx & { evm?: any }>({
  id: 'earned-value',
  label: 'Earned Value',
  labelAr: 'القيمة المكتسبة',
  scope: 'Project',
  // TWELVE COLUMNS. Portrait gives a 178mm content box, so each column
  // would get ~15mm — narrower than the numbers it must hold. This is the
  // widest table in the report set and the only one that clearly needed
  // the change; the audit left the other seven undeclared reports on the
  // portrait default because their tables are 5-7 columns and fit.
  page: A4L,
  build: (ctx, m) => {
    const e = (ctx.evm ?? {}) as Record<string, any>;
    const per = (ctx.periods ?? []) as any[];
    // An index of null means the denominator was zero. Printing "0.00" there
    // would assert a measurement that was never taken.
    const idx = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toFixed(3));
    const sections: Section[] = [];

    sections.push({ kind: 'info', title: L(m, 'Reporting Basis', 'أساس التقرير'), columns: 4, items: [
      { label: L(m, 'Reporting Period', 'فترة التقرير'), value: String(e.period ?? '—') },
      { label: L(m, 'Period Status',    'حالة الفترة'), value: String(e.periodStatus ?? '—') },
      { label: L(m, 'Cadence',          'الدورية'), value: String(e.cadence ?? '—') },
      { label: L(m, 'Approved Periods', 'فترات معتمدة'), value: String(e.approvedPeriods ?? 0) },
      { label: L(m, 'Baseline',         'الأساس'), value: String(e.baselineName ?? '—') },
      { label: L(m, 'EAC Method',       'طريقة EAC'), value: String(e.eacMethodLabel ?? '—') },
      { label: L(m, 'Forecast Basis',   'أساس التوقع'), value: `${e.cumulativePeriods ?? 0} cumulative periods` },
      { label: L(m, 'Current Position', 'الموقف الحالي'), value: String(e.quadrant ?? '—') },
      { label: L(m, 'Index Basis (SPI/CPI)', 'أساس المؤشرات (SPI/CPI)'),
        value: L(m, 'latest approved period', 'آخر فترة معتمدة') },
    ]});

    if (e.healthReasons) {
      sections.push({ kind: 'summary', title: 'Status Assessment', text: String(e.healthReasons) });
    }

    sections.push({ kind: 'kpi', title: 'Performance Indices', columns: 3, items: [
      { label: 'SPI — Schedule Performance', value: idx(e.spi),
        tone: e.spi === null || e.spi === undefined ? 'default' : (e.spi as number) >= 1 ? 'ok' : 'risk' },
      { label: 'CPI — Cost Performance', value: idx(e.cpi),
        tone: e.cpi === null || e.cpi === undefined ? 'default' : (e.cpi as number) >= 1 ? 'ok' : 'risk' },
      { label: 'TCPI — To Complete', value: idx(e.tcpi) },
    ]});

    sections.push({ kind: 'kpi', title: 'Value Measures', columns: 4, items: [
      { label: 'BAC — Budget at Completion', value: money(e.bac), unit: unit(ctx) },
      { label: 'PV — Planned Value',  value: money(e.pv), unit: unit(ctx) },
      { label: 'EV — Earned Value',   value: money(e.ev), unit: unit(ctx), tone: 'gold' },
      { label: 'AC — Actual Cost',    value: money(e.ac), unit: unit(ctx) },
      { label: 'SV — Schedule Variance', value: money(e.sv), unit: unit(ctx), tone: (e.sv ?? 0) < 0 ? 'risk' : 'ok' },
      { label: 'CV — Cost Variance',     value: money(e.cv), unit: unit(ctx), tone: (e.cv ?? 0) < 0 ? 'risk' : 'ok' },
      { label: 'EAC — Estimate at Completion', value: money(e.eac), unit: unit(ctx) },
      { label: 'VAC — Variance at Completion', value: money(e.vac), unit: unit(ctx), tone: (e.vac ?? 0) < 0 ? 'risk' : 'ok' },
    ]});

    sections.push({ kind: 'bars', title: 'Budget Consumption', items: [
      { label: 'Planned (PV)', ratio: Number(e.percentPlanned) || 0,  value: percent(e.percentPlanned) },
      { label: 'Earned (EV)',  ratio: Number(e.percentComplete) || 0, value: percent(e.percentComplete), tone: 'gold' },
      { label: 'Actual (AC)',  ratio: Number(e.percentSpent) || 0,    value: percent(e.percentSpent),
        tone: (Number(e.percentSpent) || 0) > (Number(e.percentComplete) || 0) ? 'risk' : 'ok' },
    ]});

    sections.push({ kind: 'info', title: 'Schedule Forecast', columns: 4, items: [
      { label: 'Baseline Finish', value: reportDate(e.baselineFinish as string, m.lang) },
      { label: 'Forecast Finish', value: reportDate(e.forecastFinish as string, m.lang),
        tone: (Number(e.slipDays) || 0) > 0 ? 'risk' : 'ok' },
      { label: 'Slippage',        value: days(e.slipDays),
        tone: (Number(e.slipDays) || 0) > 0 ? 'risk' : 'ok' },
      { label: 'Position',        value: String(e.quadrant ?? '—') },
    ]});

    /** PERFORMANCE BY COST CLASS (owner review): the approved split the
     *  screen prints — Direct / Indirect / Total at the latest approved
     *  period. No per-class CPI: the indirect class carries little or
     *  no AC by nature; cost verdicts live in CV / VAC. */
    const cs = (ctx.classSplit ?? null) as any;
    if (cs && cs.available) {
      sections.push({ kind: 'table', title: L(m, 'Performance by Cost Class', 'الأداء حسب فئة التكلفة'),
        columns: [
          { key: 'k', label: L(m, 'Class', 'الفئة') },
          { key: 'bac', label: 'BAC', money: true },
          { key: 'pv', label: 'PV', money: true },
          { key: 'ev', label: 'EV', money: true },
          { key: 'ac', label: 'AC', money: true },
          { key: 'cv', label: 'CV', money: true },
          { key: 'eac', label: 'EAC', money: true },
          { key: 'etc', label: 'ETC', money: true },
          { key: 'vac', label: 'VAC', money: true },
        ],
        rows: [
          { k: L(m, 'Direct', 'مباشرة'),   ...cs.direct },
          { k: L(m, 'Indirect', 'غير مباشرة'), ...cs.indirect },
          { k: L(m, 'Total', 'الإجمالي'),  ...cs.total },
        ],
      });
    }

    const opts = (ctx.eacOptions ?? []) as any[];
    if (opts.length) {
      sections.push({ kind: 'table', title: 'EAC Method Comparison',
        columns: [
          { key: 'label', label: 'Method' },
          { key: 'formula', label: 'Formula' },
          { key: 'eac', label: 'EAC', money: true },
          { key: 'etc', label: 'ETC', money: true },
          { key: 'vac', label: 'VAC', money: true },
          { key: 'official', label: 'Official' },
        ],
        rows: opts.map((o: any) => ({
          label: o.label, formula: o.formula,
          eac: o.eac, etc: o.etc, vac: o.vac,
          official: o.official ? 'OFFICIAL' : (o.applicable ? '' : 'n/a'),
        })),
      });
    }

    const bls = (ctx.baselines ?? []) as any[];
    if (bls.length) {
      sections.push({ kind: 'table', title: 'Baseline Register',
        columns: [
          { key: 'name', label: 'Version' },
          { key: 'start', label: 'Start' },
          { key: 'finish', label: 'Finish' },
          { key: 'durationDays', label: 'Duration', align: 'right' },
          { key: 'bac', label: 'BAC', money: true },
          { key: 'reason', label: 'Reason' },
          { key: 'approvedBy', label: 'Approved By' },
          { key: 'active', label: 'Active' },
        ],
        rows: bls.map((b: any) => ({
          name: b.name,
          start: reportDate(b.start, m.lang),
          finish: reportDate(b.finish, m.lang),
          durationDays: days(b.durationDays),
          bac: b.bac,
          reason: b.reason || '—',
          approvedBy: b.approvedBy || '—',
          active: b.active ? 'ACTIVE' : '',
        })),
      });
    }

    if (per.length) {
      sections.push({ kind: 'table', title: 'Period History',
        columns: [
          { key: 'label', label: 'Period' },
          { key: 'end', label: 'Ending' },
          { key: 'pv', label: 'PV', money: true },
          { key: 'ev', label: 'EV', money: true },
          { key: 'ac', label: 'AC', money: true },
          { key: 'spi', label: 'SPI', align: 'right' },
          { key: 'cpi', label: 'CPI', align: 'right' },
          { key: 'sv', label: 'SV', money: true },
          { key: 'cv', label: 'CV', money: true },
          { key: 'eac', label: 'EAC', money: true },
          { key: 'status', label: 'Status', status: true },
          { key: 'reviewer', label: 'Reviewer' },
        ],
        rows: per.map((r: any) => ({
          label: r.frozen ? `${r.label} *` : r.label,
          end: reportDate(r.end, m.lang),
          pv: r.pv, ev: r.ev, ac: r.ac,
          spi: idx(r.spi), cpi: idx(r.cpi),
          sv: r.sv ?? 0, cv: r.cv ?? 0, eac: r.eac ?? 0,
          status: r.status,
          reviewer: r.reviewer || '—',
        })),
      });
      sections.push({ kind: 'appendix', title: 'Note',
        text: 'Periods marked * are approved and frozen. Their figures are preserved exactly as signed off and are never recalculated, including after a change of baseline or forecasting method.' });
    }

    sections.push(sig(['Planning Manager', 'Cost Control Engineer']));

    return {
      meta: meta(ctx, m, 'Earned Value Analysis', `EVM Performance — ${e.period ?? ''}`),
      page: A4, cover: true, toc: true,
      sections,
    };
  },
});

// ══ 13 · SUBCONTRACTOR — ONE SUBCONTRACT, ONE PROJECT ══════════════════
//
// The register report above lists every subcontract on a project. This one
// is the opposite: the complete file for a SINGLE subcontractor inside a
// SINGLE project — commercial position, programme, LD, the three registers
// and the performance evaluation, on one document that can be handed over.
//
// Every figure arrives pre-computed. Nothing is calculated here.

registerReport<Ctx & {
  sub?: any; roll?: any; ld?: any; programme?: any; perf?: any;
  changeOrders?: any[]; claims?: any[]; delays?: any[]; certificates?: any[];
}>({
  id: 'subcontractor-file',
  label: 'Subcontractor Report',
  labelAr: 'تقرير مقاول الباطن',
  scope: 'Project',
  page: A4,
  build: (ctx, m) => {
    const s   = (ctx.sub ?? {}) as Record<string, any>;
    const r   = (ctx.roll ?? {}) as Record<string, any>;
    const ld  = (ctx.ld ?? {}) as Record<string, any>;
    const pr  = (ctx.programme ?? {}) as Record<string, any>;
    const pf  = (ctx.perf ?? {}) as Record<string, any>;
    const cos    = (ctx.changeOrders ?? []) as any[];
    const claims = (ctx.claims ?? []) as any[];
    const delays = (ctx.delays ?? []) as any[];
    const certs  = (ctx.certificates ?? []) as any[];
    const isAr = m.lang === 'ar';

    const sections: Section[] = [];

    sections.push({ kind: 'info', title: 'Subcontract Identity', columns: 3, items: [
      { label: 'Subcontractor', value: String(s.company ?? '—') },
      { label: 'Code',  value: String(s.code ?? '—') },
      { label: 'Trade', value: String(s.trade ?? '—') },
      { label: 'Status', value: String(s.status ?? '—') },
      { label: 'Progress', value: percent(s.progressPct) },
      { label: 'Retention (Contract)', value: money(s.retention) },
    ]});

    // Contract Value is manual; Contract Amount = Value + approved COs.
    sections.push({ kind: 'kpi', title: 'Commercial Position', columns: 4, items: [
      { label: 'Contract Value', value: money(s.contractValue), unit: unit(ctx),
        note: 'Signed contract — manual entry' },
      { label: 'Contract Amount', value: money(ctx.currentContract), unit: unit(ctx), tone: 'gold',
        note: 'Contract Value + approved change orders' },
      { label: 'LD Exposure', value: money(ld.ldExposure), unit: unit(ctx),
        tone: (ld.ldExposure ?? 0) > 0 ? 'risk' : 'default' },
      { label: 'Approved Finish Date', value: reportDate(pr.approvedFinish, m.lang) },
      { label: 'Certified to Date', value: money(ctx.certified), unit: unit(ctx) },
      { label: 'Paid to Date', value: money(ctx.paid), unit: unit(ctx), tone: 'ok' },
      { label: 'Outstanding', value: money(ctx.outstanding), unit: unit(ctx), tone: 'risk' },
      { label: 'Retention Held', value: money(ctx.retentionHeld), unit: unit(ctx), tone: 'warn' },
    ]});

    sections.push({ kind: 'info', title: 'Programme & Delay', columns: 4, items: [
      { label: 'Commencement', value: reportDate(pr.commencementDate, m.lang) },
      { label: 'Baseline Duration', value: days(pr.baselineDuration) },
      { label: 'Baseline Finish', value: reportDate(pr.baselineFinish, m.lang) },
      { label: 'Approved Extension', value: days(ld.approvedExtension), tone: 'gold' },
      { label: 'Current Approved Duration',
        value: days((Number(pr.baselineDuration) || 0) + (Number(ld.approvedExtension) || 0)) },
      { label: 'Approved Finish Date', value: reportDate(pr.approvedFinish, m.lang), tone: 'gold' },
      { label: 'Total Delay', value: days(ld.totalDelay) },
      { label: 'Culpable Delay', value: days(ld.culpableDelay),
        tone: (ld.culpableDelay ?? 0) > 0 ? 'risk' : 'ok' },
      { label: 'Forecast Finish', value: reportDate(pr.forecastFinish, m.lang), tone: 'warn' },
      { label: 'Estimated Finish', value: reportDate(pr.estimatedFinish, m.lang), tone: 'warn' },
      { label: 'LD Rate / Day', value: money(ld.ldRatePerDay) },
      { label: 'LD Cap', value: (ld.ldCapAmount ?? 0) > 0 ? money(ld.ldCapAmount) : 'No cap entered' },
    ]});

    // Performance evaluation — read from the KPI engine, never recomputed.
    if (pf && Array.isArray(pf.categories) && pf.categories.length > 0) {
      sections.push({ kind: 'kpi', title: 'Performance Evaluation', columns: 3, items: [
        { label: 'Overall Performance', value: pf.scored ? `${pf.score} / 100` : 'Not evaluated',
          tone: pf.scored ? 'gold' : 'default' },
        { label: 'Grade', value: pf.scored ? String(pf.grade?.grade ?? '—') : '—' },
        { label: 'Status', value: pf.scored ? String(pf.grade?.en ?? '—') : 'Not evaluated' },
      ]});
      sections.push({ kind: 'table', title: 'Performance Categories',
        columns: [
          { key: 'category', label: 'Category' },
          { key: 'weight', label: 'Weight', align: 'right' },
          { key: 'score', label: 'Score', align: 'right' },
          { key: 'comment', label: 'Comment' },
          { key: 'reviewer', label: 'Reviewer' },
          { key: 'reviewDate', label: 'Review Date' },
        ],
        rows: pf.categories.map((c: any) => ({
          category: c.label ?? c.key,
          weight: `${c.weight}%`,
          score: c.score === null || c.score === undefined ? '—' : c.score,
          comment: c.automatic ? 'Automatic — delay engine' : (c.comment || '—'),
          reviewer: c.automatic ? 'System' : (c.reviewer || '—'),
          reviewDate: c.automatic ? '—' : reportDate(c.reviewDate, m.lang),
        })),
      });
    }

    if (cos.length) {
      sections.push({ kind: 'table', title: 'Change Orders',
        columns: [
          { key: 'ref', label: 'Ref' },
          { key: 'description', label: 'Description' },
          { key: 'amount', label: 'Amount', money: true },
          { key: 'timeImpactDays', label: 'Time', align: 'right' },
          { key: 'status', label: 'Status' },
          { key: 'date', label: 'Date' },
        ],
        rows: cos.map((c: any) => ({
          ref: c.ref, description: c.description, amount: c.amount,
          timeImpactDays: days(c.timeImpactDays), status: c.status,
          date: reportDate(c.date, m.lang),
        })),
        total: { label: `${cos.length} change orders`, span: 2, values: {
          amount: r.approvedChangeOrders ?? 0,
        }},
      });
    }

    if (claims.length) {
      sections.push({ kind: 'table', title: 'Claims',
        columns: [
          { key: 'ref', label: 'Ref' },
          { key: 'description', label: 'Description' },
          { key: 'amount', label: 'Amount', money: true },
          { key: 'timeImpactDays', label: 'Time', align: 'right' },
          { key: 'status', label: 'Status' },
          { key: 'date', label: 'Date' },
        ],
        rows: claims.map((c: any) => ({
          ref: c.ref, description: c.description, amount: c.amount,
          timeImpactDays: days(c.timeImpactDays), status: c.status,
          date: reportDate(c.date, m.lang),
        })),
        total: { label: `${claims.length} claims`, span: 2, values: {
          amount: r.approvedClaims ?? 0,
        }},
      });
    }

    if (delays.length) {
      sections.push({ kind: 'table', title: 'Delay Register',
        columns: [
          { key: 'delayId', label: 'ID' },
          { key: 'description', label: 'Description' },
          { key: 'startDate', label: 'Start' },
          { key: 'delayDays', label: 'Days', align: 'right' },
          { key: 'responsibleParty', label: 'Responsible' },
          { key: 'status', label: 'Status' },
          { key: 'costImpact', label: 'Cost', money: true },
        ],
        rows: delays.map((d: any) => ({
          delayId: d.delayId, description: d.description,
          startDate: reportDate(d.startDate, m.lang),
          delayDays: d.delayDays, responsibleParty: d.responsibleParty,
          status: d.status, costImpact: d.costImpact,
        })),
        total: { label: `${delays.length} events`, span: 3, values: {
          costImpact: r.grossDelayCost ?? 0,
        }},
      });
    }

    if (certs.length) {
      sections.push({ kind: 'table', title: 'Payment Certificates',
        columns: [
          { key: 'certNo', label: 'Cert No' },
          { key: 'period', label: 'Period' },
          { key: 'grossAmount', label: 'Gross', money: true },
          { key: 'retentionHeld', label: 'Retention', money: true },
          { key: 'netPayable', label: 'Net Payable', money: true },
          { key: 'paidAmount', label: 'Paid', money: true },
          { key: 'status', label: 'Status' },
        ],
        rows: certs,
        total: { label: `${certs.length} certificates`, span: 2, values: {
          grossAmount:   certs.reduce((a: number, c: any) => a + (Number(c.grossAmount) || 0), 0),
          retentionHeld: certs.reduce((a: number, c: any) => a + (Number(c.retentionHeld) || 0), 0),
          netPayable:    certs.reduce((a: number, c: any) => a + (Number(c.netPayable) || 0), 0),
          paidAmount:    certs.reduce((a: number, c: any) => a + (Number(c.paidAmount) || 0), 0),
        }},
      });
    }

    sections.push(sig(['Commercial Manager', 'Project Director']));

    return {
      meta: meta(ctx, m,
        isAr ? 'تقرير مقاول الباطن' : 'Subcontractor Report',
        `${s.company ?? ''}${s.trade ? ' — ' + s.trade : ''}`),
      page: A4, cover: true, toc: true,
      sections,
    };
  },
});

// ══ 14 · TIMELINE SNAPSHOT — ONE APPROVED REPORTING PERIOD ═════════════
//
// Prints an ARCHIVED period exactly as it was signed off.
//
// Nothing in this definition computes anything. Every figure was frozen by
// the Timeline Engine at approval and is reproduced verbatim, which is the
// whole reason the archive exists: re-deriving a past period against
// today's baseline produces a different statement wearing the same date.

registerReport<Ctx & { timeline?: any; snapshot?: any; snapshots?: any[] }>({
  id: 'timeline-snapshot',
  label: 'Timeline Snapshot',
  labelAr: 'لقطة الخط الزمني',
  scope: 'Project',
  page: A4,
  build: (ctx, m) => {
    const t = (ctx.timeline ?? {}) as Record<string, any>;
    const s = (ctx.snapshot ?? {}) as Record<string, any>;
    const hist = (ctx.snapshots ?? []) as any[];
    const idx = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toFixed(3));
    const sections: Section[] = [];

    sections.push({ kind: 'info', title: 'Reporting Period', columns: 4, items: [
      { label: 'Period',      value: String(t.periodLabel ?? '—') },
      { label: 'Data Date',   value: reportDate(t.dataDate, m.lang) },
      { label: 'Approved By', value: String(t.approvedBy ?? '—') },
      { label: 'Approved On', value: reportDate(String(t.approvedAt ?? '').slice(0, 10), m.lang) },
      { label: 'Baseline',    value: String(t.baselineName || '—') },
      { label: 'Exchange',    value: `${t.exchangeCurrency ?? ''} ${t.exchangeRate ?? 1}` },
      { label: 'Status',      value: 'Frozen' },
      { label: 'Note',        value: String(t.note || '—') },
    ]});

    if (s.delay) {
      sections.push({ kind: 'kpi', title: 'Delay Position', columns: 4, items: [
        { label: 'Total Delay',    value: days(s.delay.totalDelay) },
        { label: 'Approved EOT',   value: days(s.delay.approvedEOT), tone: 'gold' },
        { label: 'Unmitigated',    value: days(s.delay.unmitigated),
          tone: (s.delay.unmitigated ?? 0) > 0 ? 'risk' : 'ok' },
        { label: 'Culpable Delay', value: days(s.delay.culpableDelay) },
        { label: 'Delay Events',   value: String(s.delay.delayEventCount ?? 0) },
        { label: 'Approved Events',value: String(s.delay.approvedEventCount ?? 0) },
        { label: 'Approved Cost',  value: money(s.delay.approvedCostImpact), unit: unit(ctx) },
        ...(s.ld ? [{ label: 'Net Cost (after LD)', value: money(s.ld.netCostImpact), unit: unit(ctx),
                      tone: (s.ld.netCostImpact ?? 0) < 0 ? 'risk' as const : 'default' as const }] : []),
      ]});
    }

    if (s.ld) {
      sections.push({ kind: 'info', title: 'Liquidated Damages', columns: 4, items: [
        { label: 'Rate / Day',     value: money(s.ld.ratePerDay) },
        { label: 'Cap',            value: (s.ld.capAmount ?? 0) > 0 ? money(s.ld.capAmount) : 'No cap entered' },
        { label: 'Gross Exposure', value: money(s.ld.grossExposure) },
        { label: 'LD Exposure',    value: money(s.ld.exposure),
          tone: (s.ld.exposure ?? 0) > 0 ? 'risk' : 'ok' },
      ]});
    }

    if (s.contract) {
      sections.push({ kind: 'info', title: 'Contract Dates', columns: 4, items: [
        { label: 'Commencement',    value: reportDate(s.contract.commencementDate, m.lang) },
        { label: 'Baseline Finish', value: reportDate(s.contract.baselineFinish, m.lang) },
        { label: 'Approved Finish', value: reportDate(s.contract.approvedFinish, m.lang), tone: 'gold' },
        { label: 'Forecast Finish', value: reportDate(s.contract.forecastFinish, m.lang), tone: 'warn' },
      ]});
    }

    if (s.evm) {
      sections.push({ kind: 'kpi', title: 'Earned Value', columns: 4, items: [
        { label: 'SPI', value: idx(s.evm.spi),
          tone: s.evm.spi == null ? 'default' : s.evm.spi >= 1 ? 'ok' : 'risk' },
        { label: 'CPI', value: idx(s.evm.cpi),
          tone: s.evm.cpi == null ? 'default' : s.evm.cpi >= 1 ? 'ok' : 'risk' },
        { label: 'BAC', value: money(s.evm.bac), unit: unit(ctx), tone: 'gold' },
        { label: 'EAC', value: money(s.evm.eac), unit: unit(ctx) },
        { label: 'PV',  value: money(s.evm.pv), unit: unit(ctx) },
        { label: 'EV',  value: money(s.evm.ev), unit: unit(ctx) },
        { label: 'AC',  value: money(s.evm.ac), unit: unit(ctx) },
        { label: 'VAC', value: money(s.evm.vac), unit: unit(ctx),
          tone: (s.evm.vac ?? 0) < 0 ? 'risk' : 'ok' },
      ]});
    }

    // ── Sections added in Phase 3B ──
    if (s.budget) {
      sections.push({ kind: 'kpi', title: 'Budget Position', columns: 4, items: [
        { label: 'Planned',  value: money(s.budget.totalPlanned),  unit: unit(ctx) },
        { label: 'Actual',   value: money(s.budget.totalActual),   unit: unit(ctx) },
        { label: 'Forecast', value: money(s.budget.totalForecast), unit: unit(ctx) },
        { label: 'Variance', value: money(s.budget.variance), unit: unit(ctx),
          tone: (s.budget.variance ?? 0) < 0 ? 'risk' : 'ok' },
      ]});
      if ((s.budget.categories ?? []).length) {
        sections.push({ kind: 'table', title: 'Budget by Category',
          columns: [
            { key: 'category', label: 'Category' },
            { key: 'planned',  label: 'Planned',  money: true },
            { key: 'actual',   label: 'Actual',   money: true },
            { key: 'forecast', label: 'Forecast', money: true },
            { key: 'variance', label: 'Variance', money: true },
          ],
          rows: s.budget.categories.map((c: any) => ({
            category: c.category,
            planned: c.planned, actual: c.actual, forecast: c.forecast,
            variance: (Number(c.planned) || 0) - (Number(c.forecast) || 0),
          })),
        });
      }
    }

    if (s.certificates) {
      sections.push({ kind: 'kpi', title: 'Owner Certificates', columns: 4, items: [
        { label: 'Certificates', value: String(s.certificates.count) },
        { label: 'Gross',        value: money(s.certificates.totalGross), unit: unit(ctx) },
        { label: 'Certified',    value: money(s.certificates.certified), unit: unit(ctx), tone: 'gold' },
        { label: 'Paid',         value: money(s.certificates.paid), unit: unit(ctx), tone: 'ok' },
        { label: 'Retention',    value: money(s.certificates.totalRetention), unit: unit(ctx), tone: 'warn' },
        { label: 'Outstanding',  value: money(s.certificates.outstanding), unit: unit(ctx), tone: 'risk' },
      ]});
    }

    if (s.forecast) {
      sections.push({ kind: 'info', title: 'Forecast at Approval', columns: 4, items: [
        { label: 'Method',          value: String(s.forecast.method || '—') },
        { label: 'EAC',             value: money(s.forecast.eac) },
        { label: 'VAC',             value: money(s.forecast.vac),
          tone: (s.forecast.vac ?? 0) < 0 ? 'risk' : 'ok' },
        { label: 'Forecast Finish', value: reportDate(s.forecast.forecastFinish, m.lang) },
        { label: 'Slippage',        value: days(s.forecast.slipDays),
          tone: (s.forecast.slipDays ?? 0) > 0 ? 'risk' : 'ok' },
        { label: 'Basis',           value: `${s.forecast.basisPeriods ?? 0} cumulative periods` },
        { label: 'Cumulative CPI',  value: idx(s.forecast.cpiCum) },
        { label: 'Cumulative SPI',  value: idx(s.forecast.spiCum) },
      ]});
    }

    if (s.projectStatus) {
      sections.push({ kind: 'info', title: 'Project Status', columns: 4, items: [
        { label: 'Health',          value: String(s.projectStatus.health || '—') },
        { label: 'Position',        value: String(s.projectStatus.quadrant || '—') },
        { label: 'Progress',        value: percent(s.projectStatus.progressPct) },
        { label: 'Contract Value',  value: money(s.projectStatus.contractValue), unit: unit(ctx) },
      ]});
      if ((s.projectStatus.reasons ?? []).length) {
        sections.push({ kind: 'summary', title: 'Status Reasons',
          text: s.projectStatus.reasons.join(' · ') });
      }
    }

    if (s.claims || s.cash || s.subcontracts) {
      const items: any[] = [];
      if (s.claims) {
        items.push({ label: 'Claims', value: String(s.claims.count) });
        items.push({ label: 'Claimed', value: money(s.claims.totalClaimed), unit: unit(ctx) });
        items.push({ label: 'Settled', value: money(s.claims.totalSettled), unit: unit(ctx), tone: 'ok' });
        items.push({ label: 'Time Claimed', value: days(s.claims.timeClaimed) });
      }
      if (s.cash) {
        items.push({ label: 'Cash In', value: money(s.cash.totalIn), unit: unit(ctx) });
        items.push({ label: 'Cash Out', value: money(s.cash.totalOut), unit: unit(ctx) });
      }
      if (s.subcontracts) {
        items.push({ label: 'Subcontracts', value: String(s.subcontracts.count) });
        items.push({ label: 'Sub Certified', value: money(s.subcontracts.totalCertified), unit: unit(ctx) });
      }
      sections.push({ kind: 'kpi', title: 'Commercial Position', columns: 4, items });
    }

    // The FX environment frozen with this period. Printed in full because a
    // reader auditing a converted figure needs the rate that produced it,
    // and that rate must come from the archive rather than a fresh lookup.
    const fxRows = (t.exchangeRates ?? []) as any[];
    if (fxRows.length) {
      sections.push({ kind: 'table', title: 'Exchange Rates — Frozen at Approval',
        columns: [
          { key: 'currency', label: 'Currency' },
          { key: 'rate', label: `Rate to ${t.exchangeCurrency ?? 'base'}`, align: 'right' },
          { key: 'effectiveDate', label: 'Effective From' },
        ],
        rows: fxRows.map((r: any) => ({
          currency: r.currency,
          rate: Number(r.rate).toFixed(4),
          effectiveDate: reportDate(r.effectiveDate, m.lang),
        })),
      });
    }

    if (hist.length > 1) {
      sections.push({ kind: 'table', title: 'Approved Period History',
        columns: [
          { key: 'period', label: 'Period' },
          { key: 'dataDate', label: 'Data Date' },
          { key: 'totalDelay', label: 'Delay', align: 'right' },
          { key: 'approvedEOT', label: 'EOT', align: 'right' },
          { key: 'ldExposure', label: 'LD', money: true },
          { key: 'spi', label: 'SPI', align: 'right' },
          { key: 'cpi', label: 'CPI', align: 'right' },
          { key: 'approvedBy', label: 'Approved By' },
        ],
        rows: hist.map((r: any) => ({
          period: r.period,
          dataDate: reportDate(r.dataDate, m.lang),
          totalDelay: r.totalDelay == null ? '—' : days(r.totalDelay),
          approvedEOT: r.approvedEOT == null ? '—' : days(r.approvedEOT),
          ldExposure: r.ldExposure ?? 0,
          spi: idx(r.spi), cpi: idx(r.cpi),
          approvedBy: r.approvedBy || '—',
        })),
      });
    }

    // Phase 4 — which plan each period was measured against.
    const refs: any = ctx.baselineRefs ?? null;
    if (refs && Object.values(refs).some(Boolean)) {
      const ref = (k: string) => (refs[k] ? `${refs[k].name} (V${refs[k].version})` : 'Not baselined');
      sections.push({ kind: 'info', title: 'Baselines Referenced', columns: 3, items: [
        { label: 'Contract',  value: ref('contract'),  tone: refs.contract ? 'gold' : 'warn' },
        { label: 'Budget',    value: ref('budget'),    tone: refs.budget ? 'gold' : 'warn' },
        { label: 'Cash Flow', value: ref('cashflow'),  tone: refs.cashflow ? 'gold' : 'warn' },
        { label: 'Schedule',  value: ref('schedule'),  tone: refs.schedule ? 'gold' : 'warn' },
        { label: 'Forecast',  value: ref('forecast'),  tone: refs.forecast ? 'gold' : 'warn' },
      ]});
    }

    const trail: any[] = (ctx.baselineTrail as any[]) ?? [];
    if (trail.length > 1) {
      sections.push({ kind: 'table', title: 'Baseline Trail Across Periods',
        columns: [
          { key: 'period',   label: 'Period' },
          { key: 'dataDate', label: 'Data Date' },
          { key: 'contract', label: 'Contract', align: 'center' },
          { key: 'budget',   label: 'Budget', align: 'center' },
          { key: 'cashflow', label: 'Cash Flow', align: 'center' },
          { key: 'schedule', label: 'Schedule', align: 'center' },
          { key: 'forecast', label: 'Forecast', align: 'center' },
          { key: 'rebaselined', label: 'Re-baselined', align: 'center' },
        ],
        rows: trail.map((r: any) => ({
          period: r.period,
          dataDate: reportDate(r.dataDate, m.lang),
          contract: r.contract, budget: r.budget, cashflow: r.cashflow,
          schedule: r.schedule, forecast: r.forecast,
          rebaselined: r.rebaselined ? 'Yes' : '—',
        })),
      });
    }

    sections.push({ kind: 'appendix', title: 'Basis of Preparation',
      text: 'This report reproduces an approved reporting period exactly as it was filed. '
          + 'No figure was recalculated at print time. Values were produced by the Delay, '
          + 'Liquidated Damages, Earned Value, Claims and Subcontract modules and frozen on '
          + 'approval; a later change to a baseline, a forecasting method or the live '
          + 'registers does not alter them. The exchange rate shown was recorded with the '
          + 'period. Amounts captured in a foreign currency were converted once, at '
          + 'their transaction date, using the rate in force then; those conversions are '
          + 'frozen and are not revisited when a later rate is published.' });

    sections.push(sig(['Project Director', 'Commercial Manager']));

    return {
      meta: meta(ctx, m, 'Timeline Snapshot', `Approved Reporting Period — ${t.periodLabel ?? ''}`),
      page: A4, cover: true, toc: true,
      sections,
    };
  },
});

// ══ 15 · BASELINE REGISTER ═════════════════════════════════════════════
//
// Phase 4. Reproduces the baseline register exactly as it stands: every
// version of every family, why each was raised, and what moved between the
// two versions selected on screen. No figure is recalculated here — each was
// frozen when the baseline was adopted.

registerReport<Ctx & {
  baselineType?: string; baselineTypeLabel?: string;
  register?: any[]; history?: any[]; active?: any;
  comparison?: any; detail?: any[]; drift?: any[]; coverage?: any;
}>({
  id: 'baseline-register',
  label: 'Baseline Register',
  labelAr: 'سجل خطوط الأساس',
  scope: 'Project',
  page: A4L,
  build: (ctx, m) => {
    const reg: any[] = (ctx.register ?? []) as any[];
    const hist: any[] = (ctx.history ?? []) as any[];
    const drift: any[] = (ctx.drift ?? []) as any[];
    const cmp = ctx.comparison ?? null;
    const detail: any[] = (ctx.detail ?? []) as any[];
    const active = ctx.active ?? null;
    const cov = ctx.coverage ?? null;
    const sections: Section[] = [];

    // Position: which plans are in force, and which families have none.
    if (cov) {
      sections.push({ kind: 'info', title: 'Baseline Coverage', columns: 3, items: [
        { label: 'Families in force', value: String((cov.present ?? []).length) + ' of 5',
          tone: cov.complete ? 'ok' : 'warn' },
        { label: 'In force',  value: (cov.present ?? []).join(', ') || 'None' },
        { label: 'Not baselined', value: (cov.missing ?? []).join(', ') || 'None',
          tone: (cov.missing ?? []).length ? 'warn' : 'ok' },
      ]});
    }

    if (active) {
      sections.push({ kind: 'info', title: `Active — ${ctx.baselineTypeLabel ?? ''}`, columns: 4, items: [
        { label: 'Version',    value: String(active.name ?? '—'), tone: 'gold' },
        { label: 'Adopted',    value: reportDate(String(active.activatedAt ?? '').slice(0, 10), m.lang) },
        { label: 'Adopted By', value: String(active.activatedBy || active.createdBy || '—') },
        { label: 'Data Date',  value: reportDate(active.dataDate, m.lang) },
        { label: 'Cause',      value: String(active.cause ?? '—') },
        { label: 'Reason',     value: String(active.reason || '—') },
        { label: 'Notes',      value: String(active.notes || '—') },
        { label: 'Status',     value: 'Frozen' },
      ]});
    }

    // Version history of the selected family, with headline movement.
    if (hist.length) {
      const deltaFor = (v: number) => {
        const d = drift.find((x: any) => x.version === v);
        return d && d.delta !== null && d.delta !== undefined ? d.delta : '—';
      };
      const valueFor = (v: number) => {
        const d = drift.find((x: any) => x.version === v);
        return d && d.value !== null && d.value !== undefined ? d.value : '—';
      };
      sections.push({ kind: 'table', title: `Version History — ${ctx.baselineTypeLabel ?? ''}`,
        columns: [
          { key: 'version',  label: 'Version' },
          { key: 'headline', label: 'Headline', money: true },
          { key: 'movement', label: 'Movement', money: true },
          { key: 'dataDate', label: 'Data Date' },
          { key: 'cause',    label: 'Cause' },
          { key: 'reason',   label: 'Reason', width: 24 },
          { key: 'createdBy',label: 'Created By' },
          { key: 'status',   label: 'Status', status: true },
        ],
        rows: hist.map((b: any) => ({
          version: b.name,
          headline: valueFor(b.version),
          movement: deltaFor(b.version),
          dataDate: reportDate(b.dataDate, m.lang),
          cause: b.cause || '—',
          reason: b.reason || '—',
          createdBy: b.createdBy || '—',
          status: b.status,
        })),
      });
    }

    // The comparison the user selected on screen, reproduced verbatim.
    if (cmp && cmp.ok && (cmp.rows ?? []).length) {
      sections.push({ kind: 'info', title: 'Comparison Basis', columns: 3, items: [
        { label: 'From', value: String(cmp.from?.name ?? '—') },
        { label: 'To',   value: String(cmp.to?.name ?? '—'), tone: 'gold' },
        { label: 'Fields Changed', value: String(cmp.changedCount ?? 0),
          tone: (cmp.changedCount ?? 0) > 0 ? 'warn' : 'ok' },
      ]});

      const fmtVal = (kind: string, v: unknown) => {
        if (v === null || v === undefined || v === '') return '—';
        if (kind === 'money') return money(v);
        if (kind === 'days') return days(v);
        if (kind === 'date') return reportDate(String(v), m.lang);
        return String(v);
      };

      sections.push({ kind: 'table', title: 'Baseline Comparison',
        columns: [
          { key: 'field', label: 'Field', width: 28 },
          { key: 'from',  label: String(cmp.from?.name ?? 'From'), align: 'right' },
          { key: 'to',    label: String(cmp.to?.name ?? 'To'), align: 'right' },
          { key: 'delta', label: 'Delta', align: 'right' },
          { key: 'pct',   label: '%', align: 'right' },
        ],
        rows: (cmp.rows ?? []).map((r: any) => ({
          field: m.lang === 'ar' ? r.labelAr : r.label,
          from: fmtVal(r.kind, r.from),
          to: fmtVal(r.kind, r.to),
          delta: r.delta === null || r.delta === 0 ? '—'
                 : `${r.delta > 0 ? '+' : ''}${fmtVal(r.kind, r.delta)}`,
          pct: r.pctDelta === null || r.pctDelta === 0 ? '—'
               : `${r.pctDelta > 0 ? '+' : ''}${(r.pctDelta * 100).toFixed(1)}%`,
        })),
      });
    }

    if (detail.length) {
      sections.push({ kind: 'table', title: 'Line-Level Movement',
        columns: [
          { key: 'line',   label: 'Line', width: 34 },
          { key: 'from',   label: 'From', money: true },
          { key: 'to',     label: 'To', money: true },
          { key: 'delta',  label: 'Delta', money: true },
          { key: 'status', label: 'Status', status: true },
        ],
        rows: detail.map((d: any) => ({
          line: d.key || '—',
          from: d.from === null ? '—' : d.from,
          to: d.to === null ? '—' : d.to,
          delta: d.delta === null ? '—' : d.delta,
          status: d.status,
        })),
      });
    }

    // The whole register, every family, every version.
    if (reg.length) {
      sections.push({ kind: 'table', title: 'Full Baseline Register',
        columns: [
          { key: 'type',      label: 'Type', width: 16 },
          { key: 'version',   label: 'V' },
          { key: 'headline',  label: 'Headline', money: true },
          { key: 'created',   label: 'Created' },
          { key: 'createdBy', label: 'Created By' },
          { key: 'cause',     label: 'Cause' },
          { key: 'reason',    label: 'Reason', width: 22 },
          { key: 'status',    label: 'Status', status: true },
        ],
        rows: reg.map((r: any) => ({
          type: r.typeLabel,
          version: `V${r.version}`,
          headline: r.headline === null ? '—' : r.headline,
          created: reportDate(String(r.createdAt ?? '').slice(0, 10), m.lang),
          createdBy: r.createdBy || '—',
          cause: r.cause || '—',
          reason: r.reason || '—',
          status: r.status,
        })),
      });
    }

    sections.push({ kind: 'appendix', title: 'Basis of Preparation',
      text: 'A baseline is a frozen statement of the plan as it stood when it was adopted. '
          + 'Every figure in this register was produced by the module that owns it — Contract, '
          + 'Budget, Cash Flow, Delay and Earned Value — and copied verbatim at the moment of '
          + 'adoption. Nothing was recalculated at print time. An adopted baseline is never '
          + 'edited: the plan is changed by issuing the next version, which retires the previous '
          + 'one to superseded and keeps it readable. Timeline snapshots reference the version '
          + 'in force when each period was approved, so a movement between two periods can be '
          + 'read as performance or as a re-baseline, and never confused for the other.' });

    sections.push(sig(['Project Director', 'Commercial Manager', 'Planning Manager']));

    return {
      meta: meta(ctx, m, 'Baseline Register',
        ctx.baselineTypeLabel ? `${ctx.baselineTypeLabel} — versions and movement` : undefined),
      page: A4L, cover: true, toc: true,
      sections,
    };
  },
});

// ══ 16 · FX HISTORY ════════════════════════════════════════════════════
//
// Phase 5. Reproduces the exchange-rate register and the rates each approved
// period actually applied. Every rate printed here was frozen when it was
// published or when a period was approved; none is looked up at print time,
// and today's rate appears nowhere in this report.

registerReport<Ctx & {
  register?: any[]; corrections?: any[]; integrity?: any;
  appliedHistory?: any[]; reportingTrail?: any[]; mixedReporting?: boolean;
  frozenRates?: any[]; appliedRatesFrozen?: any[]; ratesKnownAsOf?: string;
  periodLabel?: string; reportingCurrency?: string;
}>({
  id: 'fx-history',
  label: 'FX History',
  labelAr: 'سجل أسعار الصرف',
  scope: 'Company',
  page: A4L,
  build: (ctx, m) => {
    const reg: any[] = (ctx.register ?? []) as any[];
    const corr: any[] = (ctx.corrections ?? []) as any[];
    const integ = ctx.integrity ?? null;
    const applied: any[] = (ctx.appliedHistory ?? []) as any[];
    const trail: any[] = (ctx.reportingTrail ?? []) as any[];
    const frozen: any[] = (ctx.frozenRates ?? []) as any[];
    const frozenApplied: any[] = (ctx.appliedRatesFrozen ?? []) as any[];
    const sections: Section[] = [];
    const rate4 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v).toFixed(4) : '—');

    if (integ) {
      sections.push({ kind: 'kpi', title: 'Register Position', columns: 4, items: [
        { label: 'Total Rates',  value: String(integ.totalRates ?? 0) },
        { label: 'Approved',     value: String(integ.approved ?? 0), tone: 'ok' },
        { label: 'Superseded',   value: String(integ.superseded ?? 0) },
        { label: 'Corrections',  value: String(integ.corrections ?? 0),
          tone: (integ.corrections ?? 0) > 0 ? 'warn' : 'default' },
        { label: 'Currencies',   value: String(integ.currencies ?? 0), tone: 'gold' },
        { label: 'Integrity',    value: integ.clean ? 'Clean' : 'Review required',
          tone: integ.clean ? 'ok' : 'risk' },
        { label: 'Missing Approval Date', value: String((integ.missingApprovalDate ?? []).length),
          tone: (integ.missingApprovalDate ?? []).length ? 'warn' : 'ok' },
        { label: 'Duplicate Standing', value: String((integ.duplicateStanding ?? []).length),
          tone: (integ.duplicateStanding ?? []).length ? 'risk' : 'ok' },
      ]});
    }

    if (ctx.periodLabel) {
      sections.push({ kind: 'info', title: 'Frozen Rate Basis', columns: 3, items: [
        { label: 'Period', value: String(ctx.periodLabel) },
        { label: 'Reporting Currency', value: String(ctx.reportingCurrency || '—'), tone: 'gold' },
        { label: 'Rates Known As Of', value: reportDate(ctx.ratesKnownAsOf, m.lang) },
      ]});
    }

    if (frozen.length) {
      sections.push({ kind: 'table', title: 'Frozen Rate Table (as approved)',
        columns: [
          { key: 'currency',  label: 'Currency' },
          { key: 'reporting', label: 'Reporting' },
          { key: 'rate',      label: 'Rate', align: 'right' },
          { key: 'version',   label: 'V', align: 'right' },
          { key: 'effective', label: 'Effective Date' },
          { key: 'approval',  label: 'Approval Date' },
          { key: 'by',        label: 'Approved By' },
        ],
        rows: frozen.map((r: any) => ({
          currency: r.currency,
          reporting: r.reportingCurrency || ctx.reportingCurrency || '—',
          rate: rate4(r.rate),
          version: r.version ?? '—',
          effective: reportDate(r.effectiveDate, m.lang),
          approval: reportDate(r.approvalDate, m.lang),
          by: r.approvedBy || '—',
        })),
      });
    }

    if (frozenApplied.length) {
      sections.push({ kind: 'table', title: 'Rates Applied in This Period',
        columns: [
          { key: 'currency',  label: 'Currency' },
          { key: 'rate',      label: 'Applied Rate', align: 'right' },
          { key: 'count',     label: 'Records', align: 'right' },
          { key: 'original',  label: 'Original', money: true },
          { key: 'converted', label: 'Converted', money: true },
          { key: 'first',     label: 'First Txn' },
          { key: 'last',      label: 'Last Txn' },
        ],
        rows: frozenApplied.map((a: any) => ({
          currency: a.currency,
          rate: rate4(a.rate),
          count: a.count,
          original: a.originalTotal,
          converted: a.convertedTotal,
          first: reportDate(a.firstTxn, m.lang),
          last: reportDate(a.lastTxn, m.lang),
        })),
      });
    }

    if (corr.length) {
      sections.push({ kind: 'table', title: 'Corrections',
        columns: [
          { key: 'currency',  label: 'Currency' },
          { key: 'version',   label: 'V', align: 'right' },
          { key: 'rate',      label: 'New Rate', align: 'right' },
          { key: 'delta',     label: 'Delta', align: 'right' },
          { key: 'effective', label: 'Effective' },
          { key: 'approval',  label: 'Approved' },
          { key: 'reason',    label: 'Correction Reason', width: 26 },
          { key: 'by',        label: 'By' },
        ],
        rows: corr.map((r: any) => ({
          currency: r.currency,
          version: `V${r.version}`,
          rate: rate4(r.rate),
          delta: r.delta === null || r.delta === undefined
            ? '—' : `${r.delta > 0 ? '+' : ''}${Number(r.delta).toFixed(4)}`,
          effective: reportDate(r.effectiveDate, m.lang),
          approval: reportDate(r.approvalDate, m.lang),
          reason: r.correctionReason || '—',
          by: r.approvedBy || '—',
        })),
      });
    }

    if (applied.length) {
      sections.push({ kind: 'table', title: 'Applied Rates Across Approved Periods',
        columns: [
          { key: 'period',    label: 'Period' },
          { key: 'reporting', label: 'Reporting' },
          { key: 'currency',  label: 'Currency' },
          { key: 'rate',      label: 'Rate', align: 'right' },
          { key: 'count',     label: 'Records', align: 'right' },
          { key: 'converted', label: 'Converted', money: true },
        ],
        rows: applied.map((a: any) => ({
          period: a.period,
          reporting: a.reportingCurrency || '—',
          currency: a.currency,
          rate: rate4(a.rate),
          count: a.count,
          converted: a.convertedTotal,
        })),
      });
    }

    if (trail.length > 1) {
      sections.push({ kind: 'table', title: 'Reporting Currency by Period',
        columns: [
          { key: 'period',    label: 'Period' },
          { key: 'dataDate',  label: 'Data Date' },
          { key: 'reporting', label: 'Reporting Currency' },
          { key: 'changed',   label: 'Changed', align: 'center' },
        ],
        rows: trail.map((t: any) => ({
          period: t.period,
          dataDate: reportDate(t.dataDate, m.lang),
          reporting: t.reportingCurrency || '—',
          changed: t.changed ? 'Yes' : '—',
        })),
      });
      if (ctx.mixedReporting) {
        sections.push({ kind: 'appendix', title: 'Reporting Currency Warning',
          text: 'The periods above are not all expressed in the same reporting currency. '
              + 'Totals must not be summed across the change without an explicit conversion, '
              + 'and any such conversion is a new statement rather than a restatement of what '
              + 'those periods reported.' });
      }
    }

    if (reg.length) {
      sections.push({ kind: 'table', title: 'Complete Register',
        columns: [
          { key: 'currency',  label: 'Currency' },
          { key: 'reporting', label: 'Reporting' },
          { key: 'rate',      label: 'Rate', align: 'right' },
          { key: 'version',   label: 'V', align: 'right' },
          { key: 'kind',      label: 'Kind' },
          { key: 'effective', label: 'Effective' },
          { key: 'approval',  label: 'Approved' },
          { key: 'by',        label: 'By' },
          { key: 'scope',     label: 'Scope' },
          { key: 'reason',    label: 'Reason', width: 18 },
          { key: 'status',    label: 'Status', status: true },
        ],
        rows: reg.map((r: any) => ({
          currency: r.currency,
          reporting: r.reportingCurrency,
          rate: rate4(r.rate),
          version: `V${r.version}`,
          kind: r.kind === 'correction' ? 'Correction' : 'Original',
          effective: reportDate(r.effectiveDate, m.lang),
          approval: reportDate(r.approvalDate, m.lang),
          by: r.approvedBy || '—',
          scope: r.scope === 'project' ? (r.projectId || 'project') : 'All projects',
          reason: r.correctionReason || r.reason || '—',
          status: r.status,
        })),
      });
    }

    sections.push({ kind: 'appendix', title: 'Basis of Preparation',
      text: 'Exchange rates are append-only. A rate is never edited and never deleted; a '
          + 'correction appends the next version for the same effective date and retires the '
          + 'previous one to superseded, with a pointer to its replacement. Both remain on '
          + 'record. A conversion is performed once, at the transaction date, using the latest '
          + 'approved rate whose effective date falls on or before that date, and the original '
          + 'currency, original amount, applied rate and converted amount are all stored with '
          + 'the record. Those stored values are never recomputed. Every rate printed in this '
          + 'report was frozen when it was published or when a reporting period was approved — '
          + 'none was looked up at print time, and no figure here uses today\u2019s rate.' });

    sections.push(sig(['Finance Director', 'Commercial Manager']));

    return {
      meta: meta(ctx, m, 'FX History', 'Exchange rate register and applied rates'),
      page: A4L, cover: true, toc: true,
      sections,
    };
  },
});


// ══════════════════════════════════════════════════════════════════════
// PHASE 6 · TIMELINE-SOURCED REPORTS
//
// Eleven reports, one source. Every builder below receives a context
// produced by `timelineSource.ts` from an APPROVED SNAPSHOT — never from a
// module's live state. None of them takes a row array, an engine output or a
// rate lookup as an argument, which is not a convention but a property of
// their signatures: there is no parameter through which a live figure could
// arrive.
//
// A missing section prints "Not recorded in this period". It does not fall
// back to a current value, because a document that quietly mixes March's
// archive with June's live registers is worse than one that admits a gap.
// ══════════════════════════════════════════════════════════════════════

/** Header block stating what the figures are and which period they describe. */
function sourceInfo(src: any, m: BuildMeta): Section {
  return { kind: 'info', title: 'Reporting Period', columns: 4, items: [
    { label: 'Period',      value: String(src?.periodLabel ?? '—'), tone: 'gold' },
    { label: 'Data Date',   value: reportDate(src?.dataDate, m.lang) },
    { label: 'Approved By', value: String(src?.approvedBy || '—') },
    { label: 'Approved On', value: reportDate(String(src?.approvedAt ?? '').slice(0, 10), m.lang) },
    { label: 'Source',      value: 'Timeline snapshot (frozen)' },
    { label: 'Reporting Currency', value: String(src?.reportingCurrency || '—') },
    { label: 'View',        value: src?.historical ? 'Historical reissue' : 'Latest approved',
      tone: src?.historical ? 'warn' : 'ok' },
    { label: 'Note',        value: String(src?.note || '—') },
  ]};
}

/**
 * Money in whatever currency the report was asked for.
 *
 * Every Timeline report routes its amounts through this. The presenter was
 * built by `reportEngine.ts` from the period's FROZEN rates, so a March
 * report shown in USD uses March's USD rate — reissue it in June and the
 * numbers are identical. Absent a presenter (a direct definition call), it
 * degrades to the archived figure rather than failing.
 */
function pm(ctx: any, v: unknown): string {
  const p = ctx?.presentation;
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  if (!p || !p.converting) return money(v);
  const out = p.convert(Number(v));
  return out === null ? `n/a in ${p.target}` : money(out);
}

/**
 * The currency label a report prints beside its figures.
 *
 * Resolution order, most specific first:
 *
 *   displayCurrency          the currency a Timeline report is PRESENTED in,
 *                            set by reportEngine from the frozen rate table
 *   source.reportingCurrency the currency the snapshot was ARCHIVED in
 *   reportCurrency           supplied directly by a module that owns its
 *                            currency context (pre-Phase-6 reports)
 *   snapshot.reportingCurrency / project contract currency, where present
 *
 * ── SPRINT 4 · THE SAR FALLBACK IS REMOVED ────────────────────────────
 *
 * The last entry in this chain used to be the literal `'SAR'`. It was
 * introduced as a compatibility measure and it did the one thing a
 * compatibility measure must not: it made a WRONG report look like a
 * complete one. A EUR project whose caller forgot to pass a currency
 * printed correct euro figures under the label SAR — and a labelled
 * figure is believed.
 *
 * The chain now ends in an empty string. `cur()` returning '' means
 * "nobody told me", and every consumer treats that as ABSENT: the KPI
 * unit line is omitted, the identity block skips its currency row, and
 * the Office exports print no currency. A missing unit is visible and
 * gets reported; a wrong unit is invisible and gets acted upon.
 *
 * `projectReportingCurrency` was added ahead of the fallback so a report
 * that carries a project can resolve the currency from the Sprint 2
 * three-tier architecture rather than depending on its caller.
 */
function cur(ctx: any): string {
  return String(
    ctx?.displayCurrency
    || ctx?.source?.reportingCurrency
    || ctx?.reportCurrency
    || ctx?.snapshot?.exchange?.reportingCurrency
    || ctx?.contractCurrency
    || ctx?.project?.reportingCurrency
    || '',
  ).toUpperCase();
}

/**
 * The unit line under a KPI. Omitted entirely when no currency is known,
 * so an unlabelled figure reads as unlabelled rather than as riyals.
 */
function unit(ctx: any): string | undefined {
  const c = cur(ctx);
  return c || undefined;
}

/** Sections the period never recorded, stated rather than filled in. */
function gapNote(src: any): Section | null {
  const missing: string[] = src?.missingSections ?? [];
  if (!missing.length) return null;
  return { kind: 'appendix', title: 'Sections Not Recorded',
    text: 'This period did not record the following sections: ' + missing.join(', ') + '. '
        + 'They are shown as not recorded rather than as zero, and no current value has been '
        + 'substituted. A period approved before a section existed simply lacks it.' };
}

/** The standard closing note. Identical on all eleven, deliberately. */
const TL_BASIS =
  'Every figure in this report was read from an approved Timeline snapshot and was frozen '
  + 'when that reporting period was signed off. Nothing was recalculated at print time and no '
  + 'live module value was consulted. A later change to a baseline, a forecasting method, an '
  + 'exchange rate or any live register does not alter this document, which is why reissuing '
  + 'it for a past period reproduces the original figures exactly. Amounts captured in a '
  + 'foreign currency were converted once, at their transaction date, using the rate in force '
  + 'then; those conversions are frozen and are not revisited.';

/** Renders the "no history" / "unknown period" case as a real document. */
function emptyDoc(ctx: any, m: BuildMeta, title: string): ReportDocument {
  const reason = ctx?.reason === 'unknown-period'
    ? 'The requested reporting period has no approved snapshot. It may never have been '
      + 'approved, or it may have been superseded.'
    : 'This project has no approved reporting period yet. Reports are produced from approved '
      + 'Timeline snapshots, so there is nothing to reproduce until a period is signed off.';
  const avail: any[] = ctx?.available ?? [];
  const sections: Section[] = [
    { kind: 'summary', title: 'No Data', text: reason },
  ];
  if (avail.length) {
    sections.push({ kind: 'table', title: 'Approved Periods Available',
      columns: [
        { key: 'label', label: 'Period' },
        { key: 'dataDate', label: 'Data Date' },
        { key: 'approvedBy', label: 'Approved By' },
        { key: 'complete', label: 'Complete', align: 'center' },
      ],
      rows: avail.map(a => ({
        label: a.label,
        dataDate: reportDate(a.dataDate, m.lang),
        approvedBy: a.approvedBy || '—',
        complete: a.coverage?.complete ? 'Yes' : `${a.coverage?.missing?.length ?? 0} missing`,
      })),
    });
  }
  return {
    meta: meta(ctx, m, title, 'No approved snapshot'),
    page: A4, cover: true, sections,
  };
}

const idx3 = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toFixed(3));
const sgn = (v: number | null | undefined, f: (n: number) => string) =>
  v === null || v === undefined || v === 0 ? '—' : `${v > 0 ? '+' : ''}${f(v)}`;

// ══ 17 · MONTHLY REPORT ════════════════════════════════════════════════

registerReport<any>({
  id: 'tl-monthly',
  label: 'Monthly Report',
  labelAr: 'التقرير الشهري',
  scope: 'Timeline',
  page: A4,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'Monthly Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    { const cb = currencyBlock(ctx, m); if (cb) s.push(cb); }
    const mv = ctx.movement;

    if (ctx.projectStatus) {
      s.push({ kind: 'kpi', title: 'Position', columns: 4, items: [
        { label: 'Health', value: String(ctx.projectStatus.health || '—'),
          tone: /healthy/i.test(ctx.projectStatus.health) ? 'ok'
              : /critical/i.test(ctx.projectStatus.health) ? 'risk' : 'warn' },
        { label: 'Progress', value: percent(ctx.projectStatus.progressPct, true) },
        { label: 'Quadrant', value: String(ctx.projectStatus.quadrant || '—') },
        { label: 'Contract Amount', value: pm(ctx, ctx.projectStatus.revisedContractValue), tone: 'gold' },
      ]});
      if ((ctx.projectStatus.reasons ?? []).length) {
        s.push({ kind: 'summary', title: 'Why', text: ctx.projectStatus.reasons.join(' · ') });
      }
    }

    if (ctx.delay) {
      s.push({ kind: 'kpi', title: 'Delay & Liquidated Damages', columns: 4, items: [
        { label: 'Total Delay',  value: days(ctx.delay.totalDelay),
          note: mv ? sgn(mv.totalDelay, n => days(n)) : undefined },
        { label: 'Approved EOT', value: days(ctx.delay.approvedEOT), tone: 'gold' },
        { label: 'Unmitigated',  value: days(ctx.delay.unmitigated),
          tone: (ctx.delay.unmitigated ?? 0) > 0 ? 'risk' : 'ok' },
        { label: 'LD Exposure',  value: ctx.ld ? money(ctx.ld.exposure) : '—',
          tone: (ctx.ld?.exposure ?? 0) > 0 ? 'risk' : 'ok',
          note: mv ? sgn(mv.ldExposure, money) : undefined },
      ]});
    }

    if (ctx.evm) {
      s.push({ kind: 'kpi', title: 'Earned Value', columns: 4, items: [
        { label: 'SPI', value: idx3(ctx.evm.spi),
          tone: ctx.evm.spi == null ? 'default' : ctx.evm.spi >= 1 ? 'ok' : 'risk',
          note: mv ? sgn(mv.spi, n => n.toFixed(3)) : undefined },
        { label: 'CPI', value: idx3(ctx.evm.cpi),
          tone: ctx.evm.cpi == null ? 'default' : ctx.evm.cpi >= 1 ? 'ok' : 'risk',
          note: mv ? sgn(mv.cpi, n => n.toFixed(3)) : undefined },
        { label: 'BAC', value: pm(ctx, ctx.evm.bac), tone: 'gold' },
        { label: 'EAC', value: pm(ctx, ctx.evm.eac), note: mv ? sgn(mv.eac, money) : undefined },
        { label: 'PV',  value: pm(ctx, ctx.evm.pv) },
        { label: 'EV',  value: pm(ctx, ctx.evm.ev) },
        { label: 'AC',  value: pm(ctx, ctx.evm.ac) },
        { label: 'VAC', value: pm(ctx, ctx.evm.vac), tone: (ctx.evm.vac ?? 0) < 0 ? 'risk' : 'ok' },
      ]});
    }

    if (ctx.commercial) {
      s.push({ kind: 'info', title: 'Commercial', columns: 4, items: [
        { label: 'Contract Value', value: pm(ctx, ctx.commercial.originalContract) },
        { label: 'Approved COs',      value: pm(ctx, ctx.commercial.approvedChangeOrders) },
        { label: 'Approved Claims',   value: pm(ctx, ctx.commercial.approvedClaims) },
        { label: 'Contract Amount',  value: pm(ctx, ctx.commercial.currentContract), tone: 'gold' },
      ]});
    }

    if (ctx.budget) {
      s.push({ kind: 'kpi', title: 'Budget', columns: 4, items: [
        { label: 'Planned',  value: pm(ctx, ctx.budget.totalPlanned) },
        { label: 'Actual',   value: pm(ctx, ctx.budget.totalActual),
          note: mv ? sgn(mv.budgetActual, money) : undefined },
        { label: 'Forecast', value: pm(ctx, ctx.budget.totalForecast) },
        { label: 'Variance', value: pm(ctx, ctx.budget.variance),
          tone: (ctx.budget.variance ?? 0) < 0 ? 'risk' : 'ok' },
      ]});
      if ((ctx.budget.categories ?? []).length) {
        s.push({ kind: 'table', title: 'Budget by Category',
          columns: [
            { key: 'category', label: 'Category' },
            { key: 'planned',  label: 'Planned',  money: true },
            { key: 'actual',   label: 'Actual',   money: true },
            { key: 'forecast', label: 'Forecast', money: true },
          ],
          rows: ctx.budget.categories,
        });
      }
    }

    if (ctx.certificates) {
      s.push({ kind: 'kpi', title: 'Owner Certificates', columns: 4, items: [
        { label: 'Certified',   value: pm(ctx, ctx.certificates.certified), tone: 'gold',
          note: mv ? sgn(mv.certified, money) : undefined },
        { label: 'Paid',        value: pm(ctx, ctx.certificates.paid) },
        { label: 'Outstanding', value: pm(ctx, ctx.certificates.outstanding),
          tone: (ctx.certificates.outstanding ?? 0) > 0 ? 'warn' : 'ok' },
        { label: 'Retention',   value: pm(ctx, ctx.certificates.totalRetention) },
      ]});
    }

    if (ctx.cash) {
      s.push({ kind: 'kpi', title: 'Cash', columns: 4, items: [
        { label: 'Total In',       value: pm(ctx, ctx.cash.totalIn) },
        { label: 'Total Out',      value: pm(ctx, ctx.cash.totalOut) },
        { label: 'Net Flow',       value: pm(ctx, ctx.cash.netFlow),
          tone: (ctx.cash.netFlow ?? 0) < 0 ? 'risk' : 'ok',
          note: mv ? sgn(mv.cashNet, money) : undefined },
        { label: 'Cumulative Net', value: pm(ctx, ctx.cash.cumulativeNet) },
      ]});
    }

    if (ctx.claims) {
      s.push({ kind: 'info', title: 'Claims', columns: 4, items: [
        { label: 'Count',    value: String(ctx.claims.count ?? 0) },
        { label: 'Claimed',  value: pm(ctx, ctx.claims.totalClaimed) },
        { label: 'Settled',  value: pm(ctx, ctx.claims.totalSettled) },
        { label: 'Time Claimed', value: days(ctx.claims.timeClaimed) },
      ]});
    }

    if (ctx.subcontracts) {
      s.push({ kind: 'info', title: 'Subcontracts', columns: 4, items: [
        { label: 'Packages',    value: String(ctx.subcontracts.count ?? 0) },
        { label: 'Value',       value: pm(ctx, ctx.subcontracts.totalContractValue) },
        { label: 'Certified',   value: pm(ctx, ctx.subcontracts.totalCertified) },
        { label: 'Outstanding', value: pm(ctx, ctx.subcontracts.totalOutstanding) },
      ]});
    }

    if (ctx.forecast) {
      s.push({ kind: 'info', title: 'Forecast', columns: 4, items: [
        { label: 'Method',          value: String(ctx.forecast.method || '—') },
        { label: 'EAC',             value: pm(ctx, ctx.forecast.eac) },
        { label: 'Forecast Finish', value: reportDate(ctx.forecast.forecastFinish, m.lang), tone: 'warn' },
        { label: 'Slip',            value: days(ctx.forecast.slipDays),
          tone: (ctx.forecast.slipDays ?? 0) > 0 ? 'risk' : 'ok' },
      ]});
    }

    if ((ctx.appliedRates ?? []).length) {
      s.push({ kind: 'table', title: 'Exchange Rates Applied',
        columns: [
          { key: 'currency',  label: 'Currency' },
          { key: 'rate',      label: 'Applied Rate', align: 'right' },
          { key: 'count',     label: 'Records', align: 'right' },
          { key: 'converted', label: 'Converted', money: true },
        ],
        rows: ctx.appliedRates.map((a: any) => ({
          currency: a.currency, rate: Number(a.rate).toFixed(4),
          count: a.count, converted: a.convertedTotal,
        })),
      });
    }

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Project Director', 'Commercial Manager', 'Planning Manager']));

    return {
      meta: meta(ctx, m, 'Monthly Report', `Month-End Pack — ${ctx.source.periodLabel}`),
      page: A4, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 18 · EXECUTIVE DASHBOARD ═══════════════════════════════════════════

registerReport<any>({
  id: 'tl-executive',
  label: 'Executive Dashboard',
  labelAr: 'لوحة الإدارة التنفيذية',
  scope: 'Timeline',
  page: A4,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'Executive Dashboard');
    const e = ctx.summary;
    const s: Section[] = [sourceInfo(ctx.source, m)];
    { const cb = currencyBlock(ctx, m); if (cb) s.push(cb); }

    if (e) {
      s.push({ kind: 'kpi', title: 'Headline', columns: 4, items: [
        { label: 'Health', value: String(e.health || '—'),
          tone: /healthy/i.test(e.health) ? 'ok' : /critical/i.test(e.health) ? 'risk' : 'warn' },
        { label: 'Contract Value', value: pm(ctx, e.contractValue), tone: 'gold' },
        { label: 'EAC', value: pm(ctx, e.eac), note: sgn(e.deltas?.eac, money) },
        { label: 'VAC', value: pm(ctx, e.vac), tone: (e.vac ?? 0) < 0 ? 'risk' : 'ok' },
        { label: 'SPI', value: idx3(e.spi), tone: e.spi == null ? 'default' : e.spi >= 1 ? 'ok' : 'risk',
          note: sgn(e.deltas?.spi, n => n.toFixed(3)) },
        { label: 'CPI', value: idx3(e.cpi), tone: e.cpi == null ? 'default' : e.cpi >= 1 ? 'ok' : 'risk',
          note: sgn(e.deltas?.cpi, n => n.toFixed(3)) },
        { label: 'Unmitigated Delay', value: days(e.unmitigated),
          tone: (e.unmitigated ?? 0) > 0 ? 'risk' : 'ok' },
        { label: 'LD Exposure', value: pm(ctx, e.ldExposure),
          tone: (e.ldExposure ?? 0) > 0 ? 'risk' : 'ok', note: sgn(e.deltas?.ldExposure, money) },
      ]});

      if ((ctx.reasons ?? []).length) {
        s.push({ kind: 'summary', title: 'Classification Basis', text: ctx.reasons.join(' · ') });
      }
      s.push({ kind: 'info', title: 'Outlook', columns: 3, items: [
        { label: 'Forecast Finish', value: reportDate(e.forecastFinish, m.lang), tone: 'warn' },
        { label: 'Quadrant', value: String(ctx.quadrant || '—') },
        { label: 'Approved Periods', value: String(ctx.periodCount ?? 0) },
      ]});
    }

    const trend: any[] = (ctx.trend ?? []) as any[];
    if (trend.length) {
      s.push({ kind: 'table', title: 'Trend Across Approved Periods',
        columns: [
          { key: 'period',   label: 'Period' },
          { key: 'health',   label: 'Health' },
          { key: 'spi',      label: 'SPI', align: 'right' },
          { key: 'cpi',      label: 'CPI', align: 'right' },
          { key: 'eac',      label: 'EAC', money: true },
          { key: 'vac',      label: 'VAC', money: true },
          { key: 'delay',    label: 'Delay', align: 'right' },
          { key: 'ld',       label: 'LD', money: true },
        ],
        rows: trend.map((r: any) => ({
          period: r.period, health: r.health || '—',
          spi: idx3(r.spi), cpi: idx3(r.cpi),
          eac: r.eac ?? '—', vac: r.vac ?? '—',
          delay: r.totalDelay === null ? '—' : days(r.totalDelay),
          ld: r.ldExposure ?? '—',
        })),
      });
    }

    const fc: any[] = (ctx.forecastSeries ?? []) as any[];
    if (fc.length > 1) {
      s.push({ kind: 'table', title: 'Has Our View of the Outturn Improved?',
        columns: [
          { key: 'period',   label: 'Period' },
          { key: 'method',   label: 'Method' },
          { key: 'eac',      label: 'EAC', money: true },
          { key: 'eacDelta', label: 'Movement', money: true },
          { key: 'finish',   label: 'Forecast Finish' },
          { key: 'slip',     label: 'Slip', align: 'right' },
        ],
        rows: fc.map((r: any) => ({
          period: r.period, method: r.method || '—',
          eac: r.eac ?? '—',
          eacDelta: r.eacDelta === null ? '—' : r.eacDelta,
          finish: reportDate(r.forecastFinish, m.lang),
          slip: r.slipDays === null ? '—' : days(r.slipDays),
        })),
      });
    }

    const bt: any[] = (ctx.baselineTrail ?? []) as any[];
    if (bt.some((r: any) => r.rebaselined)) {
      s.push({ kind: 'table', title: 'Baseline Changes During the Period Range',
        columns: [
          { key: 'period',   label: 'Period' },
          { key: 'contract', label: 'Contract', align: 'center' },
          { key: 'budget',   label: 'Budget', align: 'center' },
          { key: 'schedule', label: 'Schedule', align: 'center' },
          { key: 'forecast', label: 'Forecast', align: 'center' },
          { key: 'flag',     label: 'Re-baselined', align: 'center' },
        ],
        rows: bt.map((r: any) => ({
          period: r.period, contract: r.contract, budget: r.budget,
          schedule: r.schedule, forecast: r.forecast,
          flag: r.rebaselined ? 'Yes' : '—',
        })),
        note: 'A movement between two periods sitting on different baseline versions is not '
            + 'comparable as performance. The version in force is stated so the reader can tell '
            + 'the two apart.',
      });
    }

    if (ctx.mixedReporting) {
      s.push({ kind: 'appendix', title: 'Reporting Currency Warning',
        text: 'The periods above are not all expressed in the same reporting currency. Figures '
            + 'must not be compared across the change without an explicit conversion, and any '
            + 'such conversion is a new statement rather than a restatement.' });
    }

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Chief Executive', 'Project Director']));

    return {
      meta: meta(ctx, m, 'Executive Dashboard', `Position at ${ctx.source.periodLabel}`),
      page: A4, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 19 · PROJECT STATUS REPORT ═════════════════════════════════════════

registerReport<any>({
  id: 'tl-status',
  label: 'Project Status Report',
  labelAr: 'تقرير حالة المشروع',
  scope: 'Timeline',
  page: A4,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'Project Status Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    { const cb = currencyBlock(ctx, m); if (cb) s.push(cb); }
    const st = ctx.status;

    if (st) {
      s.push({ kind: 'kpi', title: 'Status', columns: 4, items: [
        { label: 'Health',   value: String(st.health || '—'),
          tone: /healthy/i.test(st.health) ? 'ok' : /critical/i.test(st.health) ? 'risk' : 'warn' },
        { label: 'Progress', value: percent(st.progressPct, true) },
        { label: 'Quadrant', value: String(st.quadrant || '—') },
        { label: 'Contract Amount', value: pm(ctx, st.revisedContractValue), tone: 'gold' },
      ]});
      if ((st.reasons ?? []).length) {
        s.push({ kind: 'summary', title: 'Classification Basis', text: st.reasons.join(' · ') });
      }
    } else {
      s.push({ kind: 'summary', title: 'Status',
        text: 'This period did not record a project status classification.' });
    }

    if (ctx.contract) {
      s.push({ kind: 'info', title: 'Contract Dates', columns: 4, items: [
        { label: 'Commencement',    value: reportDate(ctx.contract.commencementDate, m.lang) },
        { label: 'Baseline Finish', value: reportDate(ctx.contract.baselineFinish, m.lang) },
        { label: 'Approved Finish', value: reportDate(ctx.contract.approvedFinish, m.lang), tone: 'gold' },
        { label: 'Forecast Finish', value: reportDate(ctx.contract.forecastFinish, m.lang), tone: 'warn' },
      ]});
    }

    if (ctx.evm || ctx.delay) {
      s.push({ kind: 'kpi', title: 'Performance', columns: 4, items: [
        ...(ctx.evm ? [
          { label: 'SPI', value: idx3(ctx.evm.spi),
            tone: (ctx.evm.spi == null ? 'default' : ctx.evm.spi >= 1 ? 'ok' : 'risk') as any },
          { label: 'CPI', value: idx3(ctx.evm.cpi),
            tone: (ctx.evm.cpi == null ? 'default' : ctx.evm.cpi >= 1 ? 'ok' : 'risk') as any },
        ] : []),
        ...(ctx.delay ? [
          { label: 'Total Delay', value: days(ctx.delay.totalDelay) },
          { label: 'Unmitigated', value: days(ctx.delay.unmitigated),
            tone: ((ctx.delay.unmitigated ?? 0) > 0 ? 'risk' : 'ok') as any },
        ] : []),
      ]});
    }

    if (ctx.baselines && Object.values(ctx.baselines).some(Boolean)) {
      const ref = (k: string) => ctx.baselines[k]
        ? `${ctx.baselines[k].name} (V${ctx.baselines[k].version})` : 'Not baselined';
      s.push({ kind: 'info', title: 'Baselines in Force', columns: 3, items: [
        { label: 'Contract', value: ref('contract'), tone: ctx.baselines.contract ? 'gold' : 'warn' },
        { label: 'Budget',   value: ref('budget'),   tone: ctx.baselines.budget ? 'gold' : 'warn' },
        { label: 'Schedule', value: ref('schedule'), tone: ctx.baselines.schedule ? 'gold' : 'warn' },
      ]});
    }

    const tr: any[] = (ctx.trend ?? []) as any[];
    if (tr.length > 1) {
      s.push({ kind: 'table', title: 'Position by Period',
        columns: [
          { key: 'period', label: 'Period' },
          { key: 'date',   label: 'Data Date' },
          { key: 'health', label: 'Health' },
          { key: 'spi',    label: 'SPI', align: 'right' },
          { key: 'cpi',    label: 'CPI', align: 'right' },
          { key: 'delay',  label: 'Delay', align: 'right' },
          { key: 'unmit',  label: 'Unmit.', align: 'right' },
        ],
        rows: tr.map((r: any) => ({
          period: r.period, date: reportDate(r.dataDate, m.lang),
          health: r.health || '—', spi: idx3(r.spi), cpi: idx3(r.cpi),
          delay: r.totalDelay === null ? '—' : days(r.totalDelay),
          unmit: r.unmitigated === null ? '—' : days(r.unmitigated),
        })),
      });
    }

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Project Director', 'Client Representative']));

    return {
      meta: meta(ctx, m, 'Project Status Report', ctx.source.periodLabel),
      page: A4, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 20 · PORTFOLIO REPORT ══════════════════════════════════════════════

registerReport<any>({
  id: 'tl-portfolio',
  label: 'Portfolio Report',
  labelAr: 'تقرير المحفظة',
  scope: 'Timeline',
  page: A4L,
  build: (ctx, m) => {
    // Phase 2 hands a currency-aware portfolio context; Phase 6 handed the
    // rows directly. Accept both so nothing that already calls this breaks.
    const pf: any = ctx?.portfolio ?? ctx;
    const rows: any[] = pf?.rows ?? [];
    const s: Section[] = [];

    if (rows.length && pf?.targetCurrency) {
      s.push({ kind: 'info', title: 'Reporting Currency', columns: 4, items: [
        { label: 'Presented In', value: String(pf.targetCurrency), tone: 'gold' },
        { label: 'Archived In', value: (pf.archivedCurrencies ?? []).join(', ') || '—' },
        { label: 'Rows Converted', value: String(rows.filter((r: any) => r.converted).length) },
        { label: 'Not Convertible', value: String((pf.unconvertible ?? []).length),
          tone: (pf.unconvertible ?? []).length ? 'risk' : 'ok' },
      ]});
      if ((pf.unconvertible ?? []).length) {
        s.push({ kind: 'summary', title: 'Totals Withheld',
          text: `${pf.unconvertible.length} project(s) archived a period holding no rate to `
              + `${pf.targetCurrency}. Their money is shown blank rather than converted at a rate `
              + 'they never reported at, and the portfolio totals are withheld entirely: a total '
              + 'that silently omits some projects understates the portfolio, and a reader cannot '
              + 'tell that from the number.' });
      }
    }

    if (!rows.length) {
      return {
        meta: meta(ctx, m, 'Portfolio Report', 'No approved history'),
        page: A4L, cover: true,
        sections: [{ kind: 'summary', title: 'No Data',
          text: 'No project in this portfolio has an approved reporting period yet. A portfolio '
              + 'report is assembled from each project\u2019s latest approved snapshot, so it has '
              + 'nothing to assemble until at least one period is signed off.' }],
      };
    }

    const hc: Record<string, number> = pf.healthCounts ?? {};
    s.push({ kind: 'kpi', title: 'Portfolio Position', columns: 4, items: [
      { label: 'Projects Reporting', value: String(rows.length), tone: 'gold' },
      { label: 'No Approved History', value: String((pf.noHistory ?? []).length),
        tone: (pf.noHistory ?? []).length ? 'warn' : 'ok' },
      { label: 'Reporting Currencies', value: (pf.archivedCurrencies ?? []).join(', ') || '—',
        tone: pf.mixedReporting ? 'warn' : 'default' },
      ...Object.entries(hc).map(([k, v]) => ({
        label: k || 'unknown', value: String(v),
        tone: (/healthy/i.test(k) ? 'ok' : /critical/i.test(k) ? 'risk' : 'warn') as any,
      })),
    ]});

    s.push({ kind: 'table', title: 'Projects — Latest Approved Position',
      columns: [
        { key: 'code',     label: 'Code' },
        { key: 'name',     label: 'Project', width: 18 },
        { key: 'period',   label: 'Period' },
        { key: 'ccy',      label: 'Ccy' },
        { key: 'health',   label: 'Health' },
        { key: 'progress', label: 'Prog.', align: 'right' },
        { key: 'contract', label: 'Contract', money: true },
        { key: 'eac',      label: 'EAC', money: true },
        { key: 'vac',      label: 'VAC', money: true },
        { key: 'spi',      label: 'SPI', align: 'right' },
        { key: 'cpi',      label: 'CPI', align: 'right' },
        { key: 'delay',    label: 'Delay', align: 'right' },
        { key: 'ld',       label: 'LD', money: true },
      ],
      rows: rows.map((r: any) => ({
        code: r.code || r.projectId,
        name: (m.lang === 'ar' ? r.nameAr : r.nameEn) || r.nameEn || '—',
        period: r.period,
        ccy: r.reportingCurrency || '—',
        health: r.health || '—',
        progress: r.progressPct === null ? '—' : percent(r.progressPct, true),
        contract: r.contractValue ?? '—',
        eac: r.eac ?? '—',
        vac: r.vac ?? '—',
        spi: idx3(r.spi), cpi: idx3(r.cpi),
        delay: r.totalDelay === null ? '—' : days(r.totalDelay),
        ld: r.ldExposure ?? '—',
      })),
      total: pf.totals ? {
        label: 'Portfolio Total',
        values: {
          contract: pf.totals.contractValue === null ? 'Withheld' : money(pf.totals.contractValue),
          eac: pf.totals.eac === null ? 'Withheld' : money(pf.totals.eac),
          vac: pf.totals.vac === null ? 'Withheld' : money(pf.totals.vac),
          ld: pf.totals.ldExposure === null ? 'Withheld' : money(pf.totals.ldExposure),
        },
      } : undefined,
      note: pf.mixedReporting
        ? 'Totals are suppressed: the projects above do not share one reporting currency, and '
        + 'adding amounts across currencies would produce a figure with no unit.'
        : 'Each row states its own data date. Periods are not aligned to a common month, '
        + 'because forcing one would mean either excluding projects that had not closed it or '
        + 'inventing figures for them.',
    });

    if ((pf.noHistory ?? []).length) {
      s.push({ kind: 'table', title: 'Projects With No Approved Period',
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Project' },
          { key: 'note', label: 'Status' },
        ],
        rows: pf.noHistory.map((p: any) => ({
          code: p.code || p.id,
          name: (m.lang === 'ar' ? p.nameAr : p.nameEn) || p.nameEn || '—',
          note: 'No approved snapshot',
        })),
        note: 'Listed rather than omitted or shown as zero. A portfolio table that drops a '
            + 'project under-reports exposure; one that shows it as zero misstates it.',
      });
    }

    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Chief Executive', 'Portfolio Director']));

    return {
      meta: meta(ctx, m, 'Portfolio Report', 'Latest approved position, per project'),
      page: A4L, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 21 · CLAIMS REPORT ═════════════════════════════════════════════════

registerReport<any>({
  id: 'tl-claims',
  label: 'Claims Report',
  labelAr: 'تقرير المطالبات',
  scope: 'Timeline',
  page: A4,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'Claims Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    { const cb = currencyBlock(ctx, m); if (cb) s.push(cb); }

    if (ctx.claims) {
      s.push({ kind: 'kpi', title: 'Claims Position', columns: 4, items: [
        { label: 'Claims',        value: String(ctx.claims.count ?? 0) },
        { label: 'Approved',      value: String(ctx.claims.approvedCount ?? 0), tone: 'ok' },
        { label: 'Total Claimed', value: pm(ctx, ctx.claims.totalClaimed), tone: 'gold' },
        { label: 'Total Settled', value: pm(ctx, ctx.claims.totalSettled) },
        { label: 'Time Claimed',  value: days(ctx.claims.timeClaimed) },
        { label: 'Approved EOT',  value: ctx.delay ? days(ctx.delay.approvedEOT) : '—' },
        { label: 'Unsettled',     value: pm(ctx, (ctx.claims.totalClaimed ?? 0) - (ctx.claims.totalSettled ?? 0)),
          tone: 'warn' },
        { label: 'Contract Amount', value: ctx.commercial ? money(ctx.commercial.currentContract) : '—' },
      ]});
    } else {
      s.push({ kind: 'summary', title: 'Claims',
        text: 'This period did not record a claims section.' });
    }

    s.push({ kind: 'summary', title: 'Contract Effect',
      text: 'Claims do not change the current contract value. Only an approved change order '
          + 'does. A settled claim affects the contract when, and only when, it has been '
          + 'converted into one — which is why the claimed and settled figures above sit '
          + 'beside the contract value rather than inside it.' });

    const h: any[] = (ctx.history ?? []) as any[];
    if (h.length > 1) {
      s.push({ kind: 'table', title: 'Claims by Period',
        columns: [
          { key: 'period',   label: 'Period' },
          { key: 'date',     label: 'Data Date' },
          { key: 'count',    label: 'Claims', align: 'right' },
          { key: 'approved', label: 'Approved', align: 'right' },
          { key: 'claimed',  label: 'Claimed', money: true },
          { key: 'settled',  label: 'Settled', money: true },
          { key: 'time',     label: 'Time', align: 'right' },
        ],
        rows: h.map((r: any) => ({
          period: r.period, date: reportDate(r.dataDate, m.lang),
          count: r.count ?? '—', approved: r.approvedCount ?? '—',
          claimed: r.totalClaimed ?? '—', settled: r.totalSettled ?? '—',
          time: r.timeClaimed === null ? '—' : days(r.timeClaimed),
        })),
      });
    }

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Commercial Manager', 'Contracts Manager']));

    return {
      meta: meta(ctx, m, 'Claims Report', ctx.source.periodLabel),
      page: A4, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 22 · DELAY REPORT ══════════════════════════════════════════════════

registerReport<any>({
  id: 'tl-delay',
  label: 'Delay Report',
  labelAr: 'تقرير التأخير',
  scope: 'Timeline',
  page: A4,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'Delay Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    { const cb = currencyBlock(ctx, m); if (cb) s.push(cb); }

    if (ctx.delay) {
      s.push({ kind: 'kpi', title: 'Delay Position', columns: 4, items: [
        { label: 'Total Delay',     value: days(ctx.delay.totalDelay) },
        { label: 'Approved EOT',    value: days(ctx.delay.approvedEOT), tone: 'gold' },
        { label: 'Unmitigated',     value: days(ctx.delay.unmitigated),
          tone: (ctx.delay.unmitigated ?? 0) > 0 ? 'risk' : 'ok' },
        { label: 'Culpable Delay',  value: days(ctx.delay.culpableDelay) },
        { label: 'Delay Events',    value: String(ctx.delay.delayEventCount ?? 0) },
        { label: 'Approved Events', value: String(ctx.delay.approvedEventCount ?? 0) },
        { label: 'Approved Cost',   value: pm(ctx, ctx.delay.approvedCostImpact) },
        { label: 'Net Cost Impact', value: ctx.ld ? money(ctx.ld.netCostImpact) : '—',
          tone: (ctx.ld?.netCostImpact ?? 0) < 0 ? 'risk' : 'default' },
      ]});
    }

    if (ctx.ld) {
      s.push({ kind: 'info', title: 'Liquidated Damages', columns: 4, items: [
        { label: 'Rate / Day',     value: pm(ctx, ctx.ld.ratePerDay) },
        { label: 'Cap',            value: (ctx.ld.capAmount ?? 0) > 0 ? money(ctx.ld.capAmount) : 'No cap entered' },
        { label: 'Gross Exposure', value: pm(ctx, ctx.ld.grossExposure) },
        { label: 'LD Exposure',    value: pm(ctx, ctx.ld.exposure),
          tone: (ctx.ld.exposure ?? 0) > 0 ? 'risk' : 'ok' },
      ]});
    }

    if (ctx.contract) {
      s.push({ kind: 'info', title: 'Programme', columns: 4, items: [
        { label: 'Commencement',    value: reportDate(ctx.contract.commencementDate, m.lang) },
        { label: 'Baseline Finish', value: reportDate(ctx.contract.baselineFinish, m.lang) },
        { label: 'Approved Finish', value: reportDate(ctx.contract.approvedFinish, m.lang), tone: 'gold' },
        { label: 'Forecast Finish', value: reportDate(ctx.contract.forecastFinish, m.lang), tone: 'warn' },
      ]});
    }

    const h: any[] = (ctx.history ?? []) as any[];
    if (h.length > 1) {
      s.push({ kind: 'table', title: 'Delay by Period',
        columns: [
          { key: 'period', label: 'Period' },
          { key: 'date',   label: 'Data Date' },
          { key: 'total',  label: 'Delay', align: 'right' },
          { key: 'eot',    label: 'EOT', align: 'right' },
          { key: 'unmit',  label: 'Unmit.', align: 'right' },
          { key: 'culp',   label: 'Culpable', align: 'right' },
          { key: 'ld',     label: 'LD', money: true },
          { key: 'events', label: 'Events', align: 'right' },
        ],
        rows: h.map((r: any) => ({
          period: r.period, date: reportDate(r.dataDate, m.lang),
          total: r.totalDelay === null ? '—' : days(r.totalDelay),
          eot: r.approvedEOT === null ? '—' : days(r.approvedEOT),
          unmit: r.unmitigated === null ? '—' : days(r.unmitigated),
          culp: r.culpable === null ? '—' : days(r.culpable),
          ld: r.ldExposure ?? '—',
          events: r.events ?? '—',
        })),
      });
    }

    s.push({ kind: 'summary', title: 'Basis of the Unmitigated Figure',
      text: 'Unmitigated delay is total delay less approved extension of time. Approved EOT '
          + 'comprises time granted through approved change orders and approved claims; the '
          + 'documentary EOT recorded against individual delay events is excluded from it by '
          + 'design, because a documented entitlement is not an award.' });

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Planning Manager', 'Project Director']));

    return {
      meta: meta(ctx, m, 'Delay Report', ctx.source.periodLabel),
      page: A4, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 23 · EVM REPORT ════════════════════════════════════════════════════

registerReport<any>({
  id: 'tl-evm',
  label: 'EVM Report',
  labelAr: 'تقرير القيمة المكتسبة',
  scope: 'Timeline',
  page: A4L,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'EVM Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    { const cb = currencyBlock(ctx, m); if (cb) s.push(cb); }
    const e = ctx.evm;

    if (e) {
      s.push({ kind: 'kpi', title: 'Earned Value', columns: 4, items: [
        { label: 'BAC', value: pm(ctx, e.bac), tone: 'gold' },
        { label: 'PV',  value: pm(ctx, e.pv) },
        { label: 'EV',  value: pm(ctx, e.ev) },
        { label: 'AC',  value: pm(ctx, e.ac) },
        { label: 'SV',  value: pm(ctx, e.sv), tone: (e.sv ?? 0) < 0 ? 'risk' : 'ok' },
        { label: 'CV',  value: pm(ctx, e.cv), tone: (e.cv ?? 0) < 0 ? 'risk' : 'ok' },
        { label: 'SPI', value: idx3(e.spi), tone: e.spi == null ? 'default' : e.spi >= 1 ? 'ok' : 'risk' },
        { label: 'CPI', value: idx3(e.cpi), tone: e.cpi == null ? 'default' : e.cpi >= 1 ? 'ok' : 'risk' },
        { label: 'EAC', value: pm(ctx, e.eac) },
        { label: 'ETC', value: pm(ctx, e.etc) },
        { label: 'VAC', value: pm(ctx, e.vac), tone: (e.vac ?? 0) < 0 ? 'risk' : 'ok' },
        { label: 'TCPI', value: idx3(e.tcpi) },
      ]});
      s.push({ kind: 'info', title: 'Method', columns: 3, items: [
        { label: 'EAC Method',  value: String(e.eacMethod || '—') },
        { label: 'EVM Period',  value: String(e.periodLabel || '—') },
        { label: 'Baseline',    value: ctx.baselines?.forecast
          ? `${ctx.baselines.forecast.name} (V${ctx.baselines.forecast.version})`
          : (ctx.contract?.baselineName || 'Not baselined') },
      ]});
    } else {
      s.push({ kind: 'summary', title: 'Earned Value',
        text: 'This period did not record an earned value section.' });
    }

    if (ctx.forecast) {
      s.push({ kind: 'info', title: 'Forecast as Recorded', columns: 4, items: [
        { label: 'Method',          value: String(ctx.forecast.method || '—') },
        { label: 'EAC',             value: pm(ctx, ctx.forecast.eac) },
        { label: 'ETC',             value: pm(ctx, ctx.forecast.etc) },
        { label: 'VAC',             value: pm(ctx, ctx.forecast.vac),
          tone: (ctx.forecast.vac ?? 0) < 0 ? 'risk' : 'ok' },
        { label: 'Forecast Finish', value: reportDate(ctx.forecast.forecastFinish, m.lang), tone: 'warn' },
        { label: 'Slip',            value: days(ctx.forecast.slipDays),
          tone: (ctx.forecast.slipDays ?? 0) > 0 ? 'risk' : 'ok' },
        { label: 'CPI (cum)',       value: idx3(ctx.forecast.cpiCum) },
        { label: 'SPI (cum)',       value: idx3(ctx.forecast.spiCum) },
      ]});
    }

    const h: any[] = (ctx.history ?? []) as any[];
    if (h.length > 1) {
      s.push({ kind: 'table', title: 'Earned Value by Period',
        columns: [
          { key: 'period', label: 'Period' },
          { key: 'pv',     label: 'PV', money: true },
          { key: 'ev',     label: 'EV', money: true },
          { key: 'ac',     label: 'AC', money: true },
          { key: 'spi',    label: 'SPI', align: 'right' },
          { key: 'cpi',    label: 'CPI', align: 'right' },
          { key: 'eac',    label: 'EAC', money: true },
          { key: 'vac',    label: 'VAC', money: true },
          { key: 'method', label: 'Method' },
        ],
        rows: h.map((r: any) => ({
          period: r.period,
          pv: r.pv ?? '—', ev: r.ev ?? '—', ac: r.ac ?? '—',
          spi: idx3(r.spi), cpi: idx3(r.cpi),
          eac: r.eac ?? '—', vac: r.vac ?? '—',
          method: r.eacMethod || '—',
        })),
        note: 'Where the EAC method differs between rows, the EAC figures are not directly '
            + 'comparable. The method is printed so that difference is visible rather than '
            + 'buried.',
      });
    }

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Planning Manager', 'Cost Manager']));

    return {
      meta: meta(ctx, m, 'EVM Report', ctx.source.periodLabel),
      page: A4L, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 24 · COMMERCIAL REPORT ═════════════════════════════════════════════

registerReport<any>({
  id: 'tl-commercial',
  label: 'Commercial Report',
  labelAr: 'التقرير التجاري',
  scope: 'Timeline',
  page: A4,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'Commercial Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    { const cb = currencyBlock(ctx, m); if (cb) s.push(cb); }
    const c = ctx.commercial;

    if (c) {
      s.push({ kind: 'kpi', title: 'Contract Position', columns: 4, items: [
        { label: 'Contract Value', value: pm(ctx, c.originalContract) },
        { label: 'Approved COs',      value: pm(ctx, c.approvedChangeOrders) },
        { label: 'Pending COs',       value: pm(ctx, c.pendingChangeOrders), tone: 'warn' },
        { label: 'Contract Amount',  value: pm(ctx, c.currentContract), tone: 'gold' },
        { label: 'Approved Claims',   value: pm(ctx, c.approvedClaims) },
        { label: 'Certified',         value: pm(ctx, c.certified) },
        { label: 'Paid',              value: pm(ctx, c.paid) },
        { label: 'Outstanding',       value: pm(ctx, c.outstanding),
          tone: (c.outstanding ?? 0) > 0 ? 'warn' : 'ok' },
      ]});
      s.push({ kind: 'summary', title: 'Composition of the Current Contract',
        text: 'Current contract is the original contract plus approved change orders. Approved '
            + 'claims are shown separately and are not added into it: a claim changes the '
            + 'contract only once it has been converted into an approved change order.' });
    }

    if (ctx.certificates) {
      s.push({ kind: 'kpi', title: 'Owner Certificates', columns: 4, items: [
        { label: 'Certificates', value: String(ctx.certificates.count ?? 0) },
        { label: 'Gross',        value: pm(ctx, ctx.certificates.totalGross) },
        { label: 'Retention',    value: pm(ctx, ctx.certificates.totalRetention) },
        { label: 'Net',          value: pm(ctx, ctx.certificates.totalNet) },
        { label: 'Certified',    value: pm(ctx, ctx.certificates.certified), tone: 'gold' },
        { label: 'Paid',         value: pm(ctx, ctx.certificates.paid) },
        { label: 'Outstanding',  value: pm(ctx, ctx.certificates.outstanding),
          tone: (ctx.certificates.outstanding ?? 0) > 0 ? 'warn' : 'ok' },
      ]});
      s.push({ kind: 'summary', title: 'Certificates and Cost',
        text: 'Owner certificates are revenue. They are never treated as actual cost, and they '
            + 'do not enter the earned value AC figure.' });
    }

    if (ctx.budget) {
      s.push({ kind: 'info', title: 'Budget', columns: 4, items: [
        { label: 'Planned',  value: pm(ctx, ctx.budget.totalPlanned) },
        { label: 'Actual',   value: pm(ctx, ctx.budget.totalActual) },
        { label: 'Forecast', value: pm(ctx, ctx.budget.totalForecast) },
        { label: 'Variance', value: pm(ctx, ctx.budget.variance),
          tone: (ctx.budget.variance ?? 0) < 0 ? 'risk' : 'ok' },
      ]});
    }

    const h: any[] = (ctx.history ?? []) as any[];
    if (h.length > 1) {
      s.push({ kind: 'table', title: 'Commercial Position by Period',
        columns: [
          { key: 'period',   label: 'Period' },
          { key: 'date',     label: 'Data Date' },
          { key: 'original', label: 'Original', money: true },
          { key: 'cos',      label: 'Appr. COs', money: true },
          { key: 'current',  label: 'Current', money: true },
          { key: 'certified',label: 'Certified', money: true },
          { key: 'paid',     label: 'Paid', money: true },
          { key: 'out',      label: 'Outstanding', money: true },
        ],
        rows: h.map((r: any) => ({
          period: r.period, date: reportDate(r.dataDate, m.lang),
          original: r.originalContract ?? '—', cos: r.approvedCOs ?? '—',
          current: r.currentContract ?? '—', certified: r.certified ?? '—',
          paid: r.paid ?? '—', out: r.outstanding ?? '—',
        })),
      });
    }

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Commercial Manager', 'Finance Director']));

    return {
      meta: meta(ctx, m, 'Commercial Report', ctx.source.periodLabel),
      page: A4, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 25 · SUBCONTRACT REPORT ════════════════════════════════════════════

registerReport<any>({
  id: 'tl-subcontract',
  label: 'Subcontract Report',
  labelAr: 'تقرير مقاولي الباطن',
  scope: 'Timeline',
  page: A4,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'Subcontract Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    { const cb = currencyBlock(ctx, m); if (cb) s.push(cb); }
    const sc = ctx.subcontracts;

    if (sc) {
      s.push({ kind: 'kpi', title: 'Subcontract Position', columns: 4, items: [
        { label: 'Packages',         value: String(sc.count ?? 0) },
        { label: 'Contract Value',   value: pm(ctx, sc.totalContractValue), tone: 'gold' },
        { label: 'Current Contract', value: pm(ctx, sc.totalCurrentContract) },
        { label: 'Certified',        value: pm(ctx, sc.totalCertified) },
        { label: 'Paid',             value: pm(ctx, sc.totalPaid) },
        { label: 'Outstanding',      value: pm(ctx, sc.totalOutstanding),
          tone: (sc.totalOutstanding ?? 0) > 0 ? 'warn' : 'ok' },
        { label: 'Performance Score', value: sc.performanceScore === null
          ? 'Not evaluated' : Number(sc.performanceScore).toFixed(1),
          tone: sc.performanceScore === null ? 'default'
              : sc.performanceScore >= 70 ? 'ok' : 'risk' },
      ]});
    } else {
      s.push({ kind: 'summary', title: 'Subcontracts',
        text: 'This period did not record a subcontract section.' });
    }

    const h: any[] = (ctx.history ?? []) as any[];
    if (h.length > 1) {
      s.push({ kind: 'table', title: 'Subcontracts by Period',
        columns: [
          { key: 'period',    label: 'Period' },
          { key: 'date',      label: 'Data Date' },
          { key: 'count',     label: 'Packages', align: 'right' },
          { key: 'value',     label: 'Value', money: true },
          { key: 'certified', label: 'Certified', money: true },
          { key: 'paid',      label: 'Paid', money: true },
          { key: 'out',       label: 'Outstanding', money: true },
          { key: 'score',     label: 'Score', align: 'right' },
        ],
        rows: h.map((r: any) => ({
          period: r.period, date: reportDate(r.dataDate, m.lang),
          count: r.count ?? '—', value: r.contractValue ?? '—',
          certified: r.certified ?? '—', paid: r.paid ?? '—', out: r.outstanding ?? '—',
          score: r.score === null ? '—' : Number(r.score).toFixed(1),
        })),
      });
    }

    s.push({ kind: 'summary', title: 'Data Ownership',
      text: 'Subcontractor commercial data belongs to the project. The company registry holds '
          + 'identity only, which is why the figures above are reported per project and are '
          + 'not aggregated against a company-level subcontractor record.' });

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Commercial Manager', 'Procurement Manager']));

    return {
      meta: meta(ctx, m, 'Subcontract Report', ctx.source.periodLabel),
      page: A4, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 26 · CASH FLOW REPORT ══════════════════════════════════════════════

registerReport<any>({
  id: 'tl-cashflow',
  label: 'Cash Flow Report',
  labelAr: 'تقرير التدفق النقدي',
  scope: 'Timeline',
  page: A4,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'Cash Flow Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    { const cb = currencyBlock(ctx, m); if (cb) s.push(cb); }

    if (ctx.cash) {
      s.push({ kind: 'kpi', title: 'Cash Position', columns: 4, items: [
        { label: 'Total In',       value: pm(ctx, ctx.cash.totalIn), tone: 'ok' },
        { label: 'Total Out',      value: pm(ctx, ctx.cash.totalOut) },
        { label: 'Net Flow',       value: pm(ctx, ctx.cash.netFlow),
          tone: (ctx.cash.netFlow ?? 0) < 0 ? 'risk' : 'ok' },
        { label: 'Cumulative Net', value: pm(ctx, ctx.cash.cumulativeNet),
          tone: (ctx.cash.cumulativeNet ?? 0) < 0 ? 'risk' : 'gold' },
      ]});
    } else {
      s.push({ kind: 'summary', title: 'Cash',
        text: 'This period did not record a cash section.' });
    }

    if (ctx.certificates) {
      s.push({ kind: 'info', title: 'Revenue Position', columns: 4, items: [
        { label: 'Certified',   value: pm(ctx, ctx.certificates.certified), tone: 'gold' },
        { label: 'Paid',        value: pm(ctx, ctx.certificates.paid) },
        { label: 'Outstanding', value: pm(ctx, ctx.certificates.outstanding),
          tone: (ctx.certificates.outstanding ?? 0) > 0 ? 'warn' : 'ok' },
        { label: 'Retention Held', value: pm(ctx, ctx.certificates.totalRetention) },
      ]});
    }

    const h: any[] = (ctx.history ?? []) as any[];
    if (h.length > 1) {
      s.push({ kind: 'table', title: 'Cash by Period',
        columns: [
          { key: 'period',    label: 'Period' },
          { key: 'date',      label: 'Data Date' },
          { key: 'in',        label: 'In', money: true },
          { key: 'out',       label: 'Out', money: true },
          { key: 'net',       label: 'Net', money: true },
          { key: 'cum',       label: 'Cumulative', money: true },
          { key: 'certified', label: 'Certified', money: true },
        ],
        rows: h.map((r: any) => ({
          period: r.period, date: reportDate(r.dataDate, m.lang),
          in: r.totalIn ?? '—', out: r.totalOut ?? '—',
          net: r.netFlow ?? '—', cum: r.cumulativeNet ?? '—',
          certified: r.certified ?? '—',
        })),
      });
    }

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Finance Director', 'Commercial Manager']));

    return {
      meta: meta(ctx, m, 'Cash Flow Report', ctx.source.periodLabel),
      page: A4, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 27 · FX REPORT ═════════════════════════════════════════════════════

registerReport<any>({
  id: 'tl-fx',
  label: 'FX Report',
  labelAr: 'تقرير العملات',
  scope: 'Timeline',
  page: A4L,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'FX Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    { const cb = currencyBlock(ctx, m); if (cb) s.push(cb); }
    const rate4 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v).toFixed(4) : '—');

    s.push({ kind: 'info', title: 'Frozen Rate Basis', columns: 3, items: [
      { label: 'Reporting Currency', value: String(ctx.reportingCurrency || '—'), tone: 'gold' },
      { label: 'Rates Known As Of',  value: reportDate(ctx.ratesKnownAsOf, m.lang) },
      { label: 'Currencies Archived', value: (ctx.currencies ?? []).join(', ') || '—' },
    ]});

    const fr: any[] = (ctx.frozenRates ?? []) as any[];
    if (fr.length) {
      s.push({ kind: 'table', title: 'Frozen Rate Table (as approved)',
        columns: [
          { key: 'currency',  label: 'Currency' },
          { key: 'reporting', label: 'Reporting' },
          { key: 'rate',      label: 'Rate', align: 'right' },
          { key: 'version',   label: 'V', align: 'right' },
          { key: 'effective', label: 'Effective Date' },
          { key: 'approval',  label: 'Approval Date' },
          { key: 'by',        label: 'Approved By' },
        ],
        rows: fr.map((r: any) => ({
          currency: r.currency,
          reporting: r.reportingCurrency || ctx.reportingCurrency || '—',
          rate: rate4(r.rate), version: r.version ?? '—',
          effective: reportDate(r.effectiveDate, m.lang),
          approval: reportDate(r.approvalDate, m.lang),
          by: r.approvedBy || '—',
        })),
      });
    }

    const ar: any[] = (ctx.appliedRatesFrozen ?? []) as any[];
    if (ar.length) {
      s.push({ kind: 'table', title: 'Rates Applied in This Period',
        columns: [
          { key: 'currency',  label: 'Currency' },
          { key: 'rate',      label: 'Applied Rate', align: 'right' },
          { key: 'count',     label: 'Records', align: 'right' },
          { key: 'original',  label: 'Original', money: true },
          { key: 'converted', label: 'Converted', money: true },
          { key: 'first',     label: 'First Txn' },
          { key: 'last',      label: 'Last Txn' },
        ],
        rows: ar.map((a: any) => ({
          currency: a.currency, rate: rate4(a.rate), count: a.count,
          original: a.originalTotal, converted: a.convertedTotal,
          first: reportDate(a.firstTxn, m.lang), last: reportDate(a.lastTxn, m.lang),
        })),
        note: 'The table above records rates that were available. This one records rates that '
            + 'were used. A rate can sit in the book all month without touching a transaction, '
            + 'so only this table proves what a reported total was built from.',
      });
    } else {
      s.push({ kind: 'summary', title: 'Applied Rates',
        text: 'This period applied no foreign exchange rate. Every amount was captured in the '
            + 'reporting currency.' });
    }

    const mv: any[] = (ctx.movements ?? []) as any[];
    mv.forEach((g: any) => {
      if ((g.rows ?? []).length < 2) return;
      s.push({ kind: 'table', title: `${g.currency} — Frozen Rate by Period`,
        columns: [
          { key: 'period', label: 'Period' },
          { key: 'date',   label: 'Data Date' },
          { key: 'rate',   label: 'Rate', align: 'right' },
          { key: 'prior',  label: 'Prior', align: 'right' },
          { key: 'delta',  label: 'Delta', align: 'right' },
          { key: 'pct',    label: '%', align: 'right' },
        ],
        rows: g.rows.map((r: any) => ({
          period: r.period, date: reportDate(r.dataDate, m.lang),
          rate: rate4(r.rate),
          prior: r.priorRate === null ? '—' : rate4(r.priorRate),
          delta: r.delta === null ? '—' : `${r.delta > 0 ? '+' : ''}${Number(r.delta).toFixed(4)}`,
          pct: r.pctDelta === null ? '—' : `${r.pctDelta > 0 ? '+' : ''}${(r.pctDelta * 100).toFixed(2)}%`,
        })),
      });
    });

    const ah: any[] = (ctx.appliedHistory ?? []) as any[];
    if (ah.length > 1) {
      s.push({ kind: 'table', title: 'Applied Rates Across Periods',
        columns: [
          { key: 'period',    label: 'Period' },
          { key: 'reporting', label: 'Reporting' },
          { key: 'currency',  label: 'Currency' },
          { key: 'rate',      label: 'Rate', align: 'right' },
          { key: 'count',     label: 'Records', align: 'right' },
          { key: 'converted', label: 'Converted', money: true },
        ],
        rows: ah.map((a: any) => ({
          period: a.period, reporting: a.reportingCurrency || '—',
          currency: a.currency, rate: rate4(a.rate),
          count: a.count, converted: a.convertedTotal,
        })),
      });
    }

    const rt: any[] = (ctx.reportingTrail ?? []) as any[];
    if (rt.length > 1 && ctx.mixedReporting) {
      s.push({ kind: 'table', title: 'Reporting Currency by Period',
        columns: [
          { key: 'period',    label: 'Period' },
          { key: 'date',      label: 'Data Date' },
          { key: 'reporting', label: 'Reporting Currency' },
          { key: 'changed',   label: 'Changed', align: 'center' },
        ],
        rows: rt.map((t: any) => ({
          period: t.period, date: reportDate(t.dataDate, m.lang),
          reporting: t.reportingCurrency || '—', changed: t.changed ? 'Yes' : '—',
        })),
        note: 'These periods are not all expressed in one reporting currency. Totals must not '
            + 'be summed across the change without an explicit conversion.',
      });
    }

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    s.push({ kind: 'appendix', title: 'Basis of Preparation',
      text: TL_BASIS + ' Every rate printed here was frozen when the period was approved. The '
          + 'live exchange rate register was not opened in producing this document, and no '
          + 'figure uses today\u2019s rate.' });
    s.push(sig(['Finance Director', 'Commercial Manager']));

    return {
      meta: meta(ctx, m, 'FX Report', ctx.source.periodLabel),
      page: A4L, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 28 · PORTFOLIO ANALYTICS ═══════════════════════════════════════════
//
// Phase 7. Ten portfolio metrics and one comparison dimension, all
// aggregated from approved Timeline snapshots by `portfolioAnalytics.ts`.
// Suppressed monetary aggregates print as "Suppressed — mixed currency"
// rather than as a number, because a figure summed across currencies has no
// unit and would look exactly like one that has.

registerReport<any>({
  id: 'tl-analytics',
  label: 'Portfolio Analytics',
  labelAr: 'تحليلات المحفظة',
  scope: 'Timeline',
  page: A4L,
  build: (ctx, m) => {
    const a = ctx?.analytics;
    if (!a || !a.population || a.population.positions.length === 0) {
      return {
        meta: meta(ctx, m, 'Portfolio Analytics', 'No approved data'),
        page: A4L, cover: true,
        sections: [{ kind: 'summary', title: 'No Data',
          text: 'No project in this selection has an approved reporting period. Analytics are '
              + 'aggregated from approved Timeline snapshots, so there is nothing to aggregate '
              + 'until at least one period is signed off.' }],
      };
    }

    const pop = a.population;
    const mixed = pop.mixedCurrency;
    const s: Section[] = [];
    const idx3 = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toFixed(3));
    const pc = (v: unknown, dp = 1) =>
      v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(dp)}%`;
    /** Money that may be suppressed. Says why rather than printing nothing. */
    const M = (v: unknown) =>
      v === null || v === undefined ? (mixed ? 'Suppressed — mixed currency' : '—') : money(v);

    s.push({ kind: 'info', title: 'Basis', columns: 4, items: [
      { label: 'Source', value: 'Approved Timeline snapshots', tone: 'gold' },
      { label: 'Alignment', value: pop.align === 'asOf'
        ? `Common period — ${pop.periodId}` : 'Latest per project' },
      { label: 'Projects Analysed', value: `${pop.positions.length}` },
      { label: 'Reporting Currency', value: (pop.currencies ?? []).join(', ') || '—',
        tone: mixed ? 'warn' : 'default' },
      { label: 'Distinct Data Dates', value: String((pop.dataDates ?? []).length),
        tone: (pop.dataDates ?? []).length > 1 ? 'warn' : 'ok' },
      { label: 'No Approved History', value: String((pop.noHistory ?? []).length),
        tone: (pop.noHistory ?? []).length ? 'warn' : 'ok' },
      { label: 'Not In This Period', value: String((pop.notInPeriod ?? []).length),
        tone: (pop.notInPeriod ?? []).length ? 'warn' : 'ok' },
      { label: 'Live Modules Read', value: 'None', tone: 'ok' },
    ]});

    if (mixed) {
      s.push({ kind: 'appendix', title: 'Currency Suppression',
        text: 'This selection spans more than one reporting currency ('
            + (pop.currencies ?? []).join(', ') + '). Monetary aggregates are suppressed rather '
            + 'than summed: adding amounts across currencies produces a figure with no unit '
            + 'that is indistinguishable on the page from one that has. Ratios, indices and day '
            + 'counts are unaffected and are reported in full.' });
    }

    s.push({ kind: 'kpi', title: 'Portfolio Performance', columns: 4, items: [
      { label: 'Portfolio SPI (weighted)', value: idx3(a.spi.weighted),
        tone: a.spi.weighted == null ? 'default' : a.spi.weighted >= 1 ? 'ok' : 'risk',
        note: 'Σ EV / Σ PV' },
      { label: 'Portfolio CPI (weighted)', value: idx3(a.cpi.weighted),
        tone: a.cpi.weighted == null ? 'default' : a.cpi.weighted >= 1 ? 'ok' : 'risk',
        note: 'Σ EV / Σ AC' },
      { label: 'SPI — simple mean', value: idx3(a.spi.simpleMean),
        note: a.spi.divergent ? 'Diverges from weighted' : undefined,
        tone: a.spi.divergent ? 'warn' : 'default' },
      { label: 'CPI — simple mean', value: idx3(a.cpi.simpleMean),
        note: a.cpi.divergent ? 'Diverges from weighted' : undefined,
        tone: a.cpi.divergent ? 'warn' : 'default' },
      { label: 'Behind Schedule', value: `${a.spi.behind} of ${a.spi.behind + a.spi.ahead}`,
        tone: a.spi.behind > 0 ? 'risk' : 'ok' },
      { label: 'Over Budget', value: `${a.cpi.overBudget} of ${a.cpi.overBudget + a.cpi.underBudget}`,
        tone: a.cpi.overBudget > 0 ? 'risk' : 'ok' },
      { label: 'Worst SPI', value: a.spi.worst ? `${a.spi.worst.code} ${a.spi.worst.spi.toFixed(3)}` : '—' },
      { label: 'Worst CPI', value: a.cpi.worst ? `${a.cpi.worst.code} ${a.cpi.worst.cpi.toFixed(3)}` : '—' },
    ]});

    if (a.spi.divergent || a.cpi.divergent) {
      s.push({ kind: 'summary', title: 'Weighted Against Mean',
        text: 'The weighted index and the simple mean differ by more than five points. '
            + 'Weighted figures are computed from summed components and so reflect where the '
            + 'money is; the mean treats every project alike. A gap between them means '
            + 'performance is concentrated by project size, and the gap is itself a finding.' });
    }

    s.push({ kind: 'kpi', title: 'Portfolio Delay', columns: 4, items: [
      { label: 'Total Delay', value: days(a.delay.totalDelay) },
      { label: 'Approved EOT', value: days(a.delay.approvedEOT), tone: 'gold' },
      { label: 'Unmitigated', value: days(a.delay.unmitigated),
        tone: (a.delay.unmitigated ?? 0) > 0 ? 'risk' : 'ok' },
      { label: 'LD Exposure', value: M(a.delay.ldExposure),
        tone: (a.delay.ldExposure ?? 0) > 0 ? 'risk' : 'ok' },
      { label: 'Projects Exposed', value: String(a.delay.exposed),
        tone: a.delay.exposed > 0 ? 'warn' : 'ok' },
      { label: 'At LD Cap', value: String(a.delay.atCap), tone: a.delay.atCap > 0 ? 'risk' : 'ok' },
      { label: 'Mean Delay', value: a.delay.meanDelay === null ? '—' : days(Math.round(a.delay.meanDelay)) },
      { label: 'Worst', value: a.delay.worst ? `${a.delay.worst.code} ${a.delay.worst.unmitigated}d` : '—' },
    ]});

    s.push({ kind: 'kpi', title: 'Portfolio Forecast', columns: 4, items: [
      { label: 'BAC', value: M(a.forecast.bac), tone: 'gold' },
      { label: 'EAC', value: M(a.forecast.eac) },
      { label: 'VAC', value: M(a.forecast.vac), tone: (a.forecast.vac ?? 0) < 0 ? 'risk' : 'ok' },
      { label: 'Forecast Overrun', value: M(a.forecast.overrun),
        tone: (a.forecast.overrun ?? 0) > 0 ? 'risk' : 'ok',
        note: pc(a.forecast.overrunPct) },
      { label: 'Projects Overrunning', value: String(a.forecast.projectsOverrunning),
        tone: a.forecast.projectsOverrunning > 0 ? 'risk' : 'ok' },
      { label: 'Total Slip', value: days(a.forecast.totalSlipDays),
        tone: (a.forecast.totalSlipDays ?? 0) > 0 ? 'warn' : 'ok' },
      { label: 'Max Slip', value: a.forecast.maxSlip
        ? `${a.forecast.maxSlip.code} ${a.forecast.maxSlip.slipDays}d` : '—' },
      { label: 'EAC Methods', value: (a.forecast.methods ?? []).join(', ') || '—',
        tone: a.forecast.mixedMethods ? 'warn' : 'default' },
    ]});

    if (a.forecast.mixedMethods) {
      s.push({ kind: 'summary', title: 'Mixed Forecasting Methods',
        text: 'More than one EAC method is in use across this portfolio. Forecasts produced by '
            + 'different methods are not strictly additive, and the aggregate EAC above should '
            + 'be read with that in mind rather than as a single consistent projection.' });
    }

    s.push({ kind: 'kpi', title: 'Portfolio Cash Flow', columns: 4, items: [
      { label: 'Total In', value: M(a.cash.totalIn), tone: 'ok' },
      { label: 'Total Out', value: M(a.cash.totalOut) },
      { label: 'Net Flow', value: M(a.cash.netFlow), tone: (a.cash.netFlow ?? 0) < 0 ? 'risk' : 'ok' },
      { label: 'Cumulative Net', value: M(a.cash.cumulativeNet) },
      { label: 'Certified', value: M(a.cash.certified), tone: 'gold' },
      { label: 'Paid', value: M(a.cash.paid) },
      { label: 'Uncollected', value: M(a.cash.outstanding),
        tone: (a.cash.outstanding ?? 0) > 0 ? 'warn' : 'ok', note: pc(a.cash.collectionGap, 0) },
      { label: 'Cash-Negative Projects', value: String(a.cash.negativeCashProjects),
        tone: a.cash.negativeCashProjects > 0 ? 'risk' : 'ok' },
    ]});

    s.push({ kind: 'kpi', title: 'Portfolio Claims & Change Orders', columns: 4, items: [
      { label: 'Claims', value: a.claims.count === null ? '—' : String(a.claims.count) },
      { label: 'Claimed', value: M(a.claims.claimed) },
      { label: 'Settled', value: M(a.claims.settled) },
      { label: 'Settlement Rate', value: pc(a.claims.settlementRate, 0),
        tone: (a.claims.settlementRate ?? 1) < 0.5 ? 'warn' : 'ok' },
      { label: 'Approved COs', value: M(a.changeOrders.approved), tone: 'gold' },
      { label: 'Pending COs', value: M(a.changeOrders.pending), tone: 'warn' },
      { label: 'Contract Growth', value: pc(a.changeOrders.growthRate),
        tone: (a.changeOrders.growthRate ?? 0) > 0.1 ? 'warn' : 'default' },
      { label: 'Claim Intensity', value: pc(a.claims.claimIntensity),
        note: 'claimed / current contract' },
    ]});

    s.push({ kind: 'kpi', title: 'Portfolio Profitability', columns: 4, items: [
      { label: 'Certified Revenue', value: M(a.profitability.certified), tone: 'gold' },
      { label: 'Cost Incurred', value: M(a.profitability.costIncurred) },
      { label: 'Earned Margin', value: M(a.profitability.earnedMargin),
        tone: (a.profitability.earnedMargin ?? 0) < 0 ? 'risk' : 'ok',
        note: pc(a.profitability.earnedMarginPct) },
      { label: 'Forecast Margin', value: M(a.profitability.forecastMargin),
        tone: (a.profitability.forecastMargin ?? 0) < 0 ? 'risk' : 'ok',
        note: pc(a.profitability.forecastMarginPct) },
      { label: 'Loss-Making Projects', value: String(a.profitability.lossMaking),
        tone: a.profitability.lossMaking > 0 ? 'risk' : 'ok' },
      { label: 'Margin Eroding', value: String(a.profitability.eroding),
        tone: a.profitability.eroding > 0 ? 'warn' : 'ok' },
      { label: 'Best Margin', value: a.profitability.best
        ? `${a.profitability.best.code} ${pc(a.profitability.best.marginPct, 0)}` : '—' },
      { label: 'Worst Margin', value: a.profitability.worst
        ? `${a.profitability.worst.code} ${pc(a.profitability.worst.marginPct, 0)}` : '—',
        tone: 'risk' },
    ]});

    s.push({ kind: 'appendix', title: 'Profitability Basis', text: a.profitability.basis });

    const fx = a.fx;
    if ((fx.rows ?? []).length) {
      s.push({ kind: 'table', title: 'Portfolio FX Exposure',
        columns: [
          { key: 'currency',  label: 'Currency' },
          { key: 'original',  label: 'Original', money: true },
          { key: 'converted', label: 'Converted', money: true },
          { key: 'blended',   label: 'Blended Rate', align: 'right' },
          { key: 'range',     label: 'Rate Range', align: 'right' },
          { key: 'records',   label: 'Records', align: 'right' },
          { key: 'projects',  label: 'Projects', align: 'right' },
          { key: 'share',     label: 'Share', align: 'right' },
        ],
        rows: fx.rows.map((r: any) => ({
          currency: r.currency,
          original: r.originalTotal,
          converted: r.convertedTotal,
          blended: r.blendedRate === null ? '—' : Number(r.blendedRate).toFixed(4),
          range: r.minRate === r.maxRate
            ? Number(r.minRate).toFixed(4)
            : `${Number(r.minRate).toFixed(4)} – ${Number(r.maxRate).toFixed(4)}`,
          records: r.recordCount,
          projects: r.projectCount,
          share: r.share === null ? '—' : pc(r.share, 0),
        })),
        note: 'These are the rates that actually touched transactions, harvested from frozen '
            + 'snapshots. The live exchange rate register was not opened and no figure uses '
            + 'today\u2019s rate.',
      });
    } else {
      s.push({ kind: 'summary', title: 'Portfolio FX Exposure',
        text: 'No foreign exchange rate was applied in the archived periods. Every amount was '
            + 'captured in the reporting currency.' });
    }

    s.push({ kind: 'kpi', title: 'Portfolio Risk', columns: 4, items: [
      { label: 'Composite Index', value: a.risk.portfolioScore === null
        ? '—' : Number(a.risk.portfolioScore).toFixed(0),
        tone: a.risk.portfolioScore == null ? 'default'
          : a.risk.portfolioScore >= 45 ? 'risk' : a.risk.portfolioScore >= 20 ? 'warn' : 'ok',
        note: '0 low · 100 severe' },
      { label: 'Severe', value: String(a.risk.bands?.severe ?? 0), tone: 'risk' },
      { label: 'High', value: String(a.risk.bands?.high ?? 0), tone: 'warn' },
      { label: 'Moderate', value: String(a.risk.bands?.moderate ?? 0) },
      { label: 'Low', value: String(a.risk.bands?.low ?? 0), tone: 'ok' },
      { label: 'Highest', value: a.risk.highest
        ? `${a.risk.highest.code} ${Number(a.risk.highest.score).toFixed(0)}` : '—' },
      { label: 'Poorly Covered', value: String(a.risk.poorlyCovered),
        tone: a.risk.poorlyCovered > 0 ? 'warn' : 'ok', note: 'more than 2 blind signals' },
      { label: 'Signals Scored', value: '5' },
    ]});

    if ((a.risk.projects ?? []).length) {
      s.push({ kind: 'table', title: 'Risk by Project',
        columns: [
          { key: 'code',      label: 'Project' },
          { key: 'score',     label: 'Index', align: 'right' },
          { key: 'band',      label: 'Band', status: true },
          { key: 'schedule',  label: 'Sched.', align: 'right' },
          { key: 'cost',      label: 'Cost', align: 'right' },
          { key: 'delay',     label: 'Delay', align: 'right' },
          { key: 'liquidity', label: 'Liquid.', align: 'right' },
          { key: 'forecast',  label: 'Fcst', align: 'right' },
          { key: 'blind',     label: 'Blind', align: 'right' },
        ],
        rows: a.risk.projects
          .slice()
          .sort((x: any, y: any) => (y.score ?? -1) - (x.score ?? -1))
          .map((p: any) => {
            const sig = (k: string) => {
              const v = p.signals?.find((z: any) => z.key === k)?.score;
              return v === null || v === undefined ? '—' : Number(v).toFixed(0);
            };
            return {
              code: p.code || p.projectId,
              score: p.score === null ? '—' : Number(p.score).toFixed(0),
              band: p.band,
              schedule: sig('schedule'), cost: sig('cost'), delay: sig('delay'),
              liquidity: sig('liquidity'), forecast: sig('forecast'),
              blind: p.blind,
            };
          }),
      });
    }

    s.push({ kind: 'appendix', title: 'Risk Index Basis', text: a.risk.basis });

    // Comparison along the dimension the user had selected.
    const cmp = ctx.comparison;
    if (cmp && (cmp.groups ?? []).length) {
      const dim = String(cmp.dimension ?? 'group');
      s.push({ kind: 'table', title: `Comparison by ${dim.charAt(0).toUpperCase()}${dim.slice(1)}`,
        columns: [
          { key: 'label',    label: 'Group', width: 16 },
          { key: 'projects', label: 'Projects', align: 'right' },
          { key: 'spi',      label: 'SPI', align: 'right' },
          { key: 'cpi',      label: 'CPI', align: 'right' },
          { key: 'contract', label: 'Contract', money: true },
          { key: 'weight',   label: 'Weight', align: 'right' },
          { key: 'eac',      label: 'EAC', money: true },
          { key: 'margin',   label: 'Fcst Margin', money: true },
          { key: 'unmit',    label: 'Unmit.', align: 'right' },
          { key: 'ld',       label: 'LD', money: true },
          { key: 'growth',   label: 'CO Growth', align: 'right' },
          { key: 'risk',     label: 'Risk', align: 'right' },
        ],
        rows: cmp.groups.map((g: any) => ({
          label: g.label + (g.mixedCurrency ? ` (${(g.currencies ?? []).join('/')})` : ''),
          projects: g.projectCount,
          spi: idx3(g.spi), cpi: idx3(g.cpi),
          contract: g.contractValue === null ? '—' : g.contractValue,
          weight: g.weight === null ? '—' : pc(g.weight, 0),
          eac: g.eac === null ? '—' : g.eac,
          margin: g.forecastMargin === null ? '—' : g.forecastMargin,
          unmit: g.unmitigated === null ? '—' : days(g.unmitigated),
          ld: g.ldExposure === null ? '—' : g.ldExposure,
          growth: g.coGrowth === null ? '—' : pc(g.coGrowth),
          risk: g.riskScore === null ? '—' : Number(g.riskScore).toFixed(0),
        })),
        note: (cmp.suppressedGroups ?? []).length
          ? 'Groups spanning more than one reporting currency have their own monetary columns '
          + 'suppressed while the rest of the table stands. Suppressing every row because one '
          + 'group is mixed would discard information that is perfectly sound.'
          : undefined,
      });
    }

    // Trend across periods.
    const tr = ctx.trend;
    if (tr && (tr.points ?? []).length > 1) {
      s.push({ kind: 'table', title: 'Portfolio Trend',
        columns: [
          { key: 'period',   label: 'Period' },
          { key: 'projects', label: 'Projects', align: 'right' },
          { key: 'spi',      label: 'SPI', align: 'right' },
          { key: 'cpi',      label: 'CPI', align: 'right' },
          { key: 'eac',      label: 'EAC', money: true },
          { key: 'eacDelta', label: 'EAC Δ', money: true },
          { key: 'unmit',    label: 'Unmit.', align: 'right' },
          { key: 'ld',       label: 'LD', money: true },
          { key: 'certified',label: 'Certified', money: true },
          { key: 'margin',   label: 'Margin', money: true },
          { key: 'risk',     label: 'Risk', align: 'right' },
        ],
        rows: tr.points.map((p: any) => ({
          period: p.label,
          projects: p.projectCount,
          spi: idx3(p.spi), cpi: idx3(p.cpi),
          eac: p.eac === null ? '—' : p.eac,
          eacDelta: p.eacDelta === null ? '—' : p.eacDelta,
          unmit: p.unmitigated === null ? '—' : days(p.unmitigated),
          ld: p.ldExposure === null ? '—' : p.ldExposure,
          certified: p.certified === null ? '—' : p.certified,
          margin: p.forecastMargin === null ? '—' : p.forecastMargin,
          risk: p.riskScore === null ? '—' : Number(p.riskScore).toFixed(0),
        })),
        note: tr.coverageVaries
          ? `The number of reporting projects varies between ${tr.minProjects} and `
          + `${tr.maxProjects} across these periods. A movement in a total may therefore be a `
          + 'project joining or leaving rather than performance changing; the Projects column '
          + 'is what distinguishes the two.'
          : undefined,
      });
    }

    // Exclusions, stated rather than hidden.
    if ((pop.noHistory ?? []).length || (pop.notInPeriod ?? []).length) {
      s.push({ kind: 'table', title: 'Projects Excluded',
        columns: [
          { key: 'code',   label: 'Code' },
          { key: 'name',   label: 'Project' },
          { key: 'reason', label: 'Reason' },
        ],
        rows: [
          ...(pop.noHistory ?? []).map((p: any) => ({
            code: p.code || p.id, name: (m.lang === 'ar' ? p.nameAr : p.nameEn) || p.nameEn || '—',
            reason: 'No approved period at all',
          })),
          ...(pop.notInPeriod ?? []).map((p: any) => ({
            code: p.code || p.id, name: (m.lang === 'ar' ? p.nameAr : p.nameEn) || p.nameEn || '—',
            reason: `Did not approve ${pop.periodId}`,
          })),
        ],
        note: 'Excluded and listed, never zero-filled. A portfolio total containing a silent '
            + 'zero for a live project understates exposure, which is the failure that matters '
            + 'most in an aggregate.',
      });
    }

    s.push({ kind: 'appendix', title: 'Basis of Preparation',
      text: 'Every figure in this report is aggregated from approved Timeline snapshots. No '
          + 'live module store was read, no engine was invoked and no formula was recomputed: '
          + 'each input was calculated and frozen by the project that owns it when its period '
          + 'was signed off. Portfolio indices are ratios of summed components — Σ EV / Σ PV '
          + 'and Σ EV / Σ AC — rather than averages of project indices, because averaging '
          + 'weighs a four-billion project the same as a four-million one. Monetary aggregates '
          + 'are suppressed wherever the selection spans reporting currencies. Margin and risk '
          + 'figures are derived views over archived signals and are labelled as such.' });

    s.push(sig(['Chief Executive', 'Portfolio Director', 'Finance Director']));

    return {
      meta: meta(ctx, m, 'Portfolio Analytics',
        pop.align === 'asOf' ? `Common period — ${pop.periodId}` : 'Latest approved per project'),
      page: A4L, cover: true, toc: true, sections: s,
    };
  },
});


// ══════════════════════════════════════════════════════════════════════
// PHASE 2 · ADDITIONAL REPORTS + CURRENCY PRESENTATION
//
// Three report bodies the catalogue needed, and one shared helper that
// gives every Timeline report a currency presenter. The presenter arrives
// on the context already built by `reportEngine.ts` from the period's FROZEN
// rates — a definition never converts anything itself, which is what keeps
// eleven reports from developing eleven conversion behaviours.
// ══════════════════════════════════════════════════════════════════════

/** Money in the presented currency. Suppressed rather than guessed. */
function pmoney(ctx: any, v: unknown): string {
  const p = ctx?.presentation;
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  if (!p) return money(v);
  const out = p.convert(Number(v));
  return out === null ? `Not convertible to ${p.target}` : money(out);
}

/** The declaration a converting report prints about itself. */
function currencyBlock(ctx: any, m: BuildMeta): Section | null {
  const p = ctx?.presentation;
  if (!p) return null;
  return { kind: 'info', title: 'Reporting Currency', columns: 3, items: [
    { label: 'Presented In', value: String(p.target || '—'), tone: 'gold' },
    { label: 'Archived In',  value: String(p.archived || '—') },
    { label: 'Conversion',   value: p.converting
      ? `at ${Number(p.rate).toFixed(6)}${p.source === 'cross' ? ` via ${p.pivot}` : ''}`
      : (p.resolved ? 'None — same currency' : 'Not available'),
      tone: p.converting ? 'warn' : p.resolved ? 'ok' : 'risk' },
  ]};
}

// ══ 29 · FINANCIAL REPORT ══════════════════════════════════════════════

registerReport<any>({
  id: 'tl-financial',
  label: 'Financial Report',
  labelAr: 'التقرير المالي',
  scope: 'Timeline',
  page: A4,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'Financial Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    const cb = currencyBlock(ctx, m);
    if (cb) s.push(cb);
    const P = (v: unknown) => pmoney(ctx, v);

    // The financial position: revenue, cost, and what stands between them.
    if (ctx.commercial || ctx.certificates) {
      s.push({ kind: 'kpi', title: 'Revenue Position', columns: 4, items: [
        { label: 'Contract Amount', value: P(ctx.commercial?.currentContract), tone: 'gold' },
        { label: 'Certified',        value: P(ctx.certificates?.certified) },
        { label: 'Paid',             value: P(ctx.certificates?.paid) },
        { label: 'Outstanding',      value: P(ctx.certificates?.outstanding),
          tone: (ctx.certificates?.outstanding ?? 0) > 0 ? 'warn' : 'ok' },
        { label: 'Retention Held',   value: P(ctx.certificates?.totalRetention) },
        { label: 'Gross Certified',  value: P(ctx.certificates?.totalGross) },
        { label: 'Net Certified',    value: P(ctx.certificates?.totalNet) },
        { label: 'Certificates',     value: String(ctx.certificates?.count ?? 0) },
      ]});
    }

    if (ctx.budget) {
      s.push({ kind: 'kpi', title: 'Cost Position', columns: 4, items: [
        { label: 'Budget Planned',  value: P(ctx.budget.totalPlanned) },
        { label: 'Actual Cost',     value: P(ctx.budget.totalActual) },
        { label: 'Forecast Cost',   value: P(ctx.budget.totalForecast) },
        { label: 'Budget Variance', value: P(ctx.budget.variance),
          tone: (ctx.budget.variance ?? 0) < 0 ? 'risk' : 'ok' },
      ]});
      if ((ctx.budget.categories ?? []).length) {
        s.push({ kind: 'table', title: 'Cost by Category',
          columns: [
            { key: 'category', label: 'Category' },
            { key: 'planned',  label: 'Planned' , align: 'right' },
            { key: 'actual',   label: 'Actual'  , align: 'right' },
            { key: 'forecast', label: 'Forecast', align: 'right' },
            { key: 'variance', label: 'Variance', align: 'right' },
          ],
          rows: ctx.budget.categories.map((c: any) => ({
            category: c.category,
            planned: P(c.planned), actual: P(c.actual), forecast: P(c.forecast),
            variance: P((Number(c.planned) || 0) - (Number(c.forecast) || 0)),
          })),
        });
      }
    }

    // Indicative margin, constructed from archived revenue and cost and
    // labelled as constructed. No module computes a margin and Timeline
    // stores none, so presenting this as audited would be a fabrication.
    const cert = Number(ctx.certificates?.certified);
    const cost = Number(ctx.budget?.totalActual);
    const contract = Number(ctx.commercial?.currentContract);
    const eac = Number(ctx.forecast?.eac ?? ctx.evm?.eac);
    if (Number.isFinite(cert) && Number.isFinite(cost)) {
      s.push({ kind: 'kpi', title: 'Indicative Margin', columns: 4, items: [
        { label: 'Earned Margin', value: P(cert - cost),
          tone: cert - cost < 0 ? 'risk' : 'ok',
          note: cert !== 0 ? `${(((cert - cost) / cert) * 100).toFixed(1)}%` : undefined },
        ...(Number.isFinite(contract) && Number.isFinite(eac) ? [{
          label: 'Forecast Margin', value: P(contract - eac),
          tone: (contract - eac < 0 ? 'risk' : 'ok') as any,
          note: contract !== 0 ? `${(((contract - eac) / contract) * 100).toFixed(1)}%` : undefined,
        }] : []),
        { label: 'Certified Revenue', value: P(cert) },
        { label: 'Cost Incurred',     value: P(cost) },
      ]});
      s.push({ kind: 'summary', title: 'How the Margin Was Constructed',
        text: 'Earned margin is certified revenue less actual cost. Forecast margin is current '
            + 'contract less EAC. Neither is an archived figure: no module computes a margin and '
            + 'Timeline stores none, so both are constructed here from archived revenue and cost '
            + 'and must be read as indicative rather than audited.' });
    }

    if (ctx.cash) {
      s.push({ kind: 'kpi', title: 'Cash Position', columns: 4, items: [
        { label: 'Total In',       value: P(ctx.cash.totalIn), tone: 'ok' },
        { label: 'Total Out',      value: P(ctx.cash.totalOut) },
        { label: 'Net Flow',       value: P(ctx.cash.netFlow),
          tone: (ctx.cash.netFlow ?? 0) < 0 ? 'risk' : 'ok' },
        { label: 'Cumulative Net', value: P(ctx.cash.cumulativeNet) },
      ]});
    }

    if (ctx.evm) {
      s.push({ kind: 'info', title: 'Value Position', columns: 4, items: [
        { label: 'BAC', value: P(ctx.evm.bac), tone: 'gold' },
        { label: 'EV',  value: P(ctx.evm.ev) },
        { label: 'AC',  value: P(ctx.evm.ac) },
        { label: 'EAC', value: P(ctx.evm.eac) },
      ]});
    }

    if ((ctx.appliedRates ?? []).length) {
      s.push({ kind: 'table', title: 'Exchange Rates Applied in This Period',
        columns: [
          { key: 'currency',  label: 'Currency' },
          { key: 'rate',      label: 'Rate', align: 'right' },
          { key: 'records',   label: 'Records', align: 'right' },
          { key: 'original',  label: 'Original', align: 'right' },
          { key: 'converted', label: 'Converted', align: 'right' },
        ],
        rows: ctx.appliedRates.map((a: any) => ({
          currency: a.currency,
          rate: Number(a.rate).toFixed(6),
          records: a.count,
          original: `${a.currency} ${money(a.originalTotal)}`,
          converted: P(a.convertedTotal),
        })),
      });
    }

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    if (ctx.currencyNote) {
      s.push({ kind: 'appendix', title: 'Currency Basis', text: String(ctx.currencyNote) });
    }
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Finance Director', 'Commercial Manager', 'Project Director']));

    return {
      meta: meta(ctx, m, 'Financial Report',
        `${ctx.source.periodLabel}${ctx.displayCurrency ? ` — ${ctx.displayCurrency}` : ''}`),
      page: A4, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 30 · VARIATION ORDERS REPORT ═══════════════════════════════════════

registerReport<any>({
  id: 'tl-variations',
  label: 'Variation Orders Report',
  labelAr: 'تقرير أوامر التغيير',
  scope: 'Timeline',
  page: A4,
  build: (ctx, m) => {
    if (!ctx?.ok) return emptyDoc(ctx, m, 'Variation Orders Report');
    const s: Section[] = [sourceInfo(ctx.source, m)];
    const cb = currencyBlock(ctx, m);
    if (cb) s.push(cb);
    const P = (v: unknown) => pmoney(ctx, v);
    const c = ctx.commercial;

    if (c) {
      const original = Number(c.originalContract) || 0;
      const approved = Number(c.approvedChangeOrders) || 0;
      const pending  = Number(c.pendingChangeOrders) || 0;
      s.push({ kind: 'kpi', title: 'Variation Position', columns: 4, items: [
        { label: 'Contract Value', value: P(original) },
        { label: 'Approved VOs',      value: P(approved), tone: 'gold' },
        { label: 'Pending VOs',       value: P(pending), tone: pending > 0 ? 'warn' : 'default' },
        { label: 'Contract Amount',  value: P(c.currentContract), tone: 'gold' },
        { label: 'Contract Growth',   value: original !== 0 ? `${((approved / original) * 100).toFixed(2)}%` : '—',
          tone: original !== 0 && approved / original > 0.1 ? 'warn' : 'default' },
        { label: 'Pending Growth',    value: original !== 0 ? `${((pending / original) * 100).toFixed(2)}%` : '—',
          tone: original !== 0 && pending / original > 0.05 ? 'warn' : 'default' },
        { label: 'Committed Total',   value: P(original + approved) },
        { label: 'Maximum Exposure',  value: P(original + approved + pending),
          note: 'if all pending are approved' },
      ]});

      s.push({ kind: 'summary', title: 'What Moves the Contract',
        text: 'Only an approved change order alters the current contract value. Pending '
            + 'variations are shown separately and are not added into it — they represent '
            + 'exposure, not entitlement. Approved claims likewise sit outside the contract '
            + 'until converted into an approved change order.' });

      if (Number.isFinite(Number(c.approvedClaims)) && Number(c.approvedClaims) !== 0) {
        s.push({ kind: 'info', title: 'Claims Not Yet in the Contract', columns: 3, items: [
          { label: 'Approved Claims', value: P(c.approvedClaims), tone: 'warn' },
          { label: 'In Current Contract', value: 'No' },
          { label: 'Becomes Contract When', value: 'Converted to an approved change order' },
        ]});
      }
    } else {
      s.push({ kind: 'summary', title: 'Variations',
        text: 'This period did not record a commercial section, so no variation position is '
            + 'available for it.' });
    }

    const h: any[] = (ctx.history ?? []) as any[];
    if (h.length > 1) {
      s.push({ kind: 'table', title: 'Variation Movement by Period',
        columns: [
          { key: 'period',   label: 'Period' },
          { key: 'date',     label: 'Data Date' },
          { key: 'original', label: 'Original', align: 'right' },
          { key: 'approved', label: 'Approved VOs', align: 'right' },
          { key: 'current',  label: 'Current', align: 'right' },
          { key: 'growth',   label: 'Growth', align: 'right' },
          { key: 'movement', label: 'Movement', align: 'right' },
        ],
        rows: h.map((r: any, i: number) => {
          const prev = i > 0 ? h[i - 1] : null;
          const mv = prev && r.approvedCOs !== null && prev.approvedCOs !== null
            ? r.approvedCOs - prev.approvedCOs : null;
          const g = r.originalContract ? (r.approvedCOs ?? 0) / r.originalContract : null;
          return {
            period: r.period,
            date: reportDate(r.dataDate, m.lang),
            original: P(r.originalContract),
            approved: P(r.approvedCOs),
            current: P(r.currentContract),
            growth: g === null ? '—' : `${(g * 100).toFixed(2)}%`,
            movement: mv === null || mv === 0 ? '—' : `${mv > 0 ? '+' : ''}${pmoney(ctx, mv)}`,
          };
        }),
        note: 'Movement is the change in approved variation value against the previous approved '
            + 'period. Both figures come from the archive, so a movement here is a real change '
            + 'in what was reported, not a recalculation.',
      });
    }

    const gap = gapNote(ctx.source);
    if (gap) s.push(gap);
    if (ctx.currencyNote) {
      s.push({ kind: 'appendix', title: 'Currency Basis', text: String(ctx.currencyNote) });
    }
    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: TL_BASIS });
    s.push(sig(['Commercial Manager', 'Contracts Manager']));

    return {
      meta: meta(ctx, m, 'Variation Orders Report',
        `${ctx.source.periodLabel}${ctx.displayCurrency ? ` — ${ctx.displayCurrency}` : ''}`),
      page: A4, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 31 · FX EXPOSURE REPORT ════════════════════════════════════════════

registerReport<any>({
  id: 'tl-fx-exposure',
  label: 'FX Exposure Report',
  labelAr: 'تقرير التعرض للعملات',
  scope: 'Timeline',
  page: A4L,
  build: (ctx, m) => {
    const fx = ctx?.fx;
    if (!fx || !fx.exposure) {
      return {
        meta: meta(ctx, m, 'FX Exposure Report', 'No archived data'),
        page: A4L, cover: true,
        sections: [{ kind: 'summary', title: 'No Data',
          text: 'No project has an approved reporting period, so there is no archived currency '
              + 'activity to analyse.' }],
      };
    }

    const s: Section[] = [];
    const e = fx.exposure;
    const rate6 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v).toFixed(6) : '—');
    const pc = (v: unknown, dp = 1) =>
      v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(dp)}%`;

    s.push({ kind: 'info', title: 'Basis', columns: 4, items: [
      { label: 'Source', value: 'Approved Timeline snapshots', tone: 'gold' },
      { label: 'Period', value: fx.periodId || 'Latest approved per project' },
      { label: 'Projects Analysed', value: String(e.totalProjects) },
      { label: 'Projects With FX', value: String(e.exposedProjects),
        tone: e.exposedProjects > 0 ? 'warn' : 'ok' },
      { label: 'Currencies', value: String(e.currencyCount) },
      { label: 'Reporting Currencies', value: (e.reportingCurrencies ?? []).join(', ') || '—',
        tone: e.mixedReporting ? 'warn' : 'default' },
      { label: 'Excluded', value: String((e.excluded ?? []).length),
        tone: (e.excluded ?? []).length ? 'warn' : 'ok' },
      { label: 'Live Register Read', value: 'No', tone: 'ok' },
    ]});

    // 1 · Exposure
    if ((e.rows ?? []).length) {
      s.push({ kind: 'kpi', title: 'Exposure Summary', columns: 4, items: [
        { label: 'Total Foreign Value', value: e.totalConverted === null
          ? 'Suppressed — mixed currency' : money(e.totalConverted), tone: 'gold' },
        { label: 'Largest Currency', value: e.largest ? e.largest.currency : '—' },
        { label: 'Concentration', value: pc(e.concentration, 0),
          tone: (e.concentration ?? 0) > 0.6 ? 'warn' : 'default',
          note: 'largest currency share' },
        { label: 'Exposure Ratio', value: pc(e.exposureRatio),
          note: 'foreign value / contract value' },
      ]});

      s.push({ kind: 'table', title: 'FX Exposure by Currency',
        columns: [
          { key: 'currency',  label: 'Currency' },
          { key: 'original',  label: 'Original', align: 'right' },
          { key: 'converted', label: 'Converted', money: true },
          { key: 'blended',   label: 'Blended Rate', align: 'right' },
          { key: 'range',     label: 'Rate Range', align: 'right' },
          { key: 'spread',    label: 'Spread', align: 'right' },
          { key: 'records',   label: 'Records', align: 'right' },
          { key: 'projects',  label: 'Projects', align: 'right' },
          { key: 'share',     label: 'Share', align: 'right' },
        ],
        rows: e.rows.map((r: any) => ({
          currency: r.currency,
          original: `${r.currency} ${money(r.originalTotal)}`,
          converted: r.convertedTotal,
          blended: rate6(r.blendedRate),
          range: r.minRate === r.maxRate
            ? rate6(r.minRate) : `${rate6(r.minRate)} – ${rate6(r.maxRate)}`,
          spread: pc(r.rateSpread, 2),
          records: r.recordCount,
          projects: r.projectCount,
          share: pc(r.share, 0),
        })),
        note: 'Blended rate is converted value divided by original value — the rate actually '
            + 'achieved across all transactions in that currency, which differs from any single '
            + 'published rate whenever transactions spanned more than one rate.',
      });
    } else {
      s.push({ kind: 'summary', title: 'FX Exposure',
        text: 'No foreign exchange rate was applied in the archived periods. Every amount was '
            + 'captured in the reporting currency, so the portfolio carries no archived '
            + 'transaction exposure.' });
    }

    // 2 · Translation movement
    const tr = fx.translation;
    if (tr && (tr.projects ?? []).length) {
      s.push({ kind: 'kpi', title: 'Translation Movement', columns: 3, items: [
        { label: 'Net Movement', value: tr.net === null
          ? 'Suppressed — mixed currency' : money(tr.net),
          tone: (tr.net ?? 0) < 0 ? 'risk' : 'ok' },
        { label: 'Projects Affected', value: String(tr.projects.length) },
        { label: 'Reporting Currency', value: tr.reportingCurrency || '—' },
      ]});
      s.push({ kind: 'table', title: 'Translation by Project and Currency',
        columns: [
          { key: 'project',  label: 'Project' },
          { key: 'currency', label: 'Currency' },
          { key: 'held',     label: 'Foreign Held', align: 'right' },
          { key: 'fromRate', label: 'From Rate', align: 'right' },
          { key: 'toRate',   label: 'To Rate', align: 'right' },
          { key: 'delta',    label: 'Movement', money: true },
          { key: 'pct',      label: '%', align: 'right' },
        ],
        rows: tr.projects.flatMap((p: any) =>
          p.rows.map((r: any) => ({
            project: p.code,
            currency: r.currency,
            held: `${r.currency} ${money(r.originalAmount)}`,
            fromRate: rate6(r.fromRate),
            toRate: rate6(r.toRate),
            delta: r.translationDelta,
            pct: pc(r.pctDelta, 2),
          }))),
      });
      s.push({ kind: 'appendix', title: 'Translation, Not Realised', text: tr.basis });
    }

    // 3 · Currency distribution
    const d = fx.distribution;
    if (d && (d.slices ?? []).length) {
      s.push({ kind: 'table', title: 'Currency Distribution',
        columns: [
          { key: 'currency', label: 'Currency' },
          { key: 'type',     label: 'Type' },
          { key: 'value',    label: 'Value', money: true },
          { key: 'share',    label: 'Share', align: 'right' },
          { key: 'projects', label: 'Projects', align: 'right' },
        ],
        rows: d.slices.map((x: any) => ({
          currency: x.currency,
          type: x.domestic ? 'Domestic' : 'Foreign',
          value: x.value,
          share: pc(x.share, 1),
          projects: x.projectCount,
        })),
        note: `Foreign share ${pc(d.foreignShare, 1)}. Concentration index `
            + `${d.concentrationIndex === null ? '—' : Number(d.concentrationIndex).toFixed(3)} `
            + '(1.000 = a single currency). The domestic slice is the archived contract value '
            + 'less converted foreign value; showing only foreign currencies would imply the '
            + 'portfolio is entirely foreign.',
      });
    }

    // 4 · Projects by currency
    const bp = fx.byProject;
    if (bp && (bp.rows ?? []).length) {
      s.push({ kind: 'table', title: 'Projects by Contract Currency',
        columns: [
          { key: 'code',      label: 'Project' },
          { key: 'contract',  label: 'Contract Ccy' },
          { key: 'reporting', label: 'Reporting Ccy' },
          { key: 'cross',     label: 'Cross-Ccy', align: 'center' },
          { key: 'period',    label: 'Period' },
          { key: 'value',     label: 'Contract Value', money: true },
          { key: 'txn',       label: 'Transacted In' },
          { key: 'foreign',   label: 'Foreign Share', align: 'right' },
        ],
        rows: bp.rows.map((r: any) => ({
          code: r.code,
          contract: r.contractCurrency || '—',
          reporting: r.reportingCurrency || '—',
          cross: r.crossCurrencyContract ? 'Yes' : '—',
          period: r.period,
          value: r.currentContract ?? '—',
          txn: (r.transactedIn ?? []).join(', ') || '—',
          foreign: pc(r.foreignShare, 1),
        })),
        note: bp.crossCurrencyCount > 0
          ? `${bp.crossCurrencyCount} project(s) are contracted in a currency other than their `
          + 'reporting currency. Their reported figures depend on a rate, so a rate movement '
          + 'changes what they report without anything changing on site.'
          : undefined,
      });
    }

    // 5 & 6 · Subcontracts and certificates
    [['Subcontracts by Currency', fx.bySubcontract],
     ['Certificates by Currency', fx.byCertificate]].forEach(([title, cat]: any) => {
      if (!cat || !(cat.groups ?? []).length) return;
      s.push({ kind: 'table', title,
        columns: [
          { key: 'currency', label: 'Contract Currency' },
          { key: 'value',    label: 'Value', money: true },
          { key: 'projects', label: 'Projects', align: 'right' },
        ],
        rows: cat.groups.map((g: any) => ({
          currency: g.currency,
          value: g.value === null ? '—' : g.value,
          projects: g.projectCount,
        })),
        note: cat.granularity,
      });
    });

    // 7 · Monthly FX trend
    const t = fx.trend;
    if (t && (t.points ?? []).length > 1) {
      s.push({ kind: 'table', title: 'Monthly FX Trend',
        columns: [
          { key: 'period',     label: 'Period' },
          { key: 'projects',   label: 'Projects', align: 'right' },
          { key: 'currencies', label: 'Currencies', align: 'right' },
          { key: 'foreign',    label: 'Foreign Value', money: true },
          { key: 'share',      label: 'Foreign Share', align: 'right' },
          { key: 'delta',      label: 'Movement', money: true },
        ],
        rows: t.points.map((p: any) => ({
          period: p.period,
          projects: p.projectCount,
          currencies: p.currencyCount,
          foreign: p.foreignValue === null ? '—' : p.foreignValue,
          share: pc(p.foreignShare, 1),
          delta: p.delta === null ? '—' : p.delta,
        })),
        note: t.coverageVaries
          ? `Reporting coverage varies between ${t.minProjects} and ${t.maxProjects} projects `
          + 'across these periods. A movement in foreign value may therefore be a project '
          + 'joining rather than exposure changing; the Projects column distinguishes the two.'
          : undefined,
      });
    }

    // 8 · Historical rate trend
    (fx.rateTrends ?? []).forEach((rt: any) => {
      if ((rt.points ?? []).length < 2) return;
      s.push({ kind: 'table', title: `${rt.currency} — Historical Rate Trend`,
        columns: [
          { key: 'period',    label: 'Period' },
          { key: 'rate',      label: 'Rate', align: 'right' },
          { key: 'effective', label: 'Effective' },
          { key: 'version',   label: 'V', align: 'right' },
          { key: 'delta',     label: 'Δ', align: 'right' },
          { key: 'pct',       label: '%', align: 'right' },
          { key: 'cum',       label: 'Cumulative', align: 'right' },
        ],
        rows: rt.points.map((p: any) => ({
          period: p.period,
          rate: rate6(p.rate),
          effective: reportDate(p.effectiveDate, m.lang),
          version: p.version ?? '—',
          delta: p.delta === null ? '—' : `${p.delta > 0 ? '+' : ''}${Number(p.delta).toFixed(6)}`,
          pct: pc(p.pctDelta, 2),
          cum: pc(p.cumulativePct, 2),
        })),
        note: `Range ${rate6(rt.min)} – ${rate6(rt.max)}. Total movement ${pc(rt.totalPct, 2)}. `
            + `Archived volatility ${rt.volatility === null ? '—' : (rt.volatility * 100).toFixed(2) + '%'}. `
            + 'These are the rates each period FROZE, not the live rate history — they differ '
            + 'wherever a rate was corrected after a period closed, and the archived series is '
            + 'the one that explains the reported numbers.',
      });
    });

    if ((e.excluded ?? []).length) {
      s.push({ kind: 'table', title: 'Projects Excluded',
        columns: [
          { key: 'code',   label: 'Code' },
          { key: 'name',   label: 'Project' },
          { key: 'reason', label: 'Reason' },
        ],
        rows: e.excluded.map((p: any) => ({
          code: p.code || p.id, name: (m.lang === 'ar' ? p.nameAr : p.nameEn) || p.nameEn || '—',
          reason: fx.periodId ? `No approved snapshot for ${fx.periodId}` : 'No approved period',
        })),
        note: 'Listed rather than zero-filled. An exposure table containing a silent zero for a '
            + 'live project understates exposure.',
      });
    }

    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: fx.basis });
    s.push(sig(['Finance Director', 'Treasury', 'Commercial Manager']));

    return {
      meta: meta(ctx, m, 'FX Exposure Report',
        fx.periodId ? `Period ${fx.periodId}` : 'Latest approved per project'),
      page: A4L, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 32 · FINANCIAL INTELLIGENCE ════════════════════════════════════════
//
// Phase 3. Every figure is read from approved Timeline snapshots by
// `financialIntelligence.ts`. Derived measures — margin, health scores,
// projections — print with their stated basis attached, because a score
// nobody can check is a number people act on without being able to argue
// with it.

registerReport<any>({
  id: 'tl-financial-intelligence',
  label: 'Financial Intelligence',
  labelAr: 'الذكاء المالي',
  scope: 'Timeline',
  page: A4L,
  build: (ctx, m) => {
    const fi = ctx?.fi;
    const h = fi?.project;
    if (!fi || !h || !h.ok) {
      return {
        meta: meta(ctx, m, 'Financial Intelligence', 'No approved data'),
        page: A4L, cover: true,
        sections: [{ kind: 'summary', title: 'No Data',
          text: h?.reason
            || 'This project has no approved reporting period. Financial intelligence is built '
             + 'from approved Timeline snapshots, so there is nothing to analyse until a period '
             + 'is signed off.' }],
      };
    }

    const s: Section[] = [];
    const pc = (v: unknown, dp = 1) =>
      v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(dp)}%`;
    const sc = (v: unknown) =>
      v === null || v === undefined ? '—' : Number(v).toFixed(0);
    const tone = (v: unknown) =>
      v === null || v === undefined ? 'default'
      : Number(v) >= 75 ? 'ok' : Number(v) >= 55 ? 'gold'
      : Number(v) >= 35 ? 'warn' : 'risk';

    s.push({ kind: 'info', title: 'Basis', columns: 4, items: [
      { label: 'Period', value: String(h.period), tone: 'gold' },
      { label: 'Data Date', value: reportDate(h.dataDate, m.lang) },
      { label: 'Reporting Currency', value: String(h.reportingCurrency || '—') },
      { label: 'Contract Currency', value: String(h.contractCurrency || '—'),
        tone: h.contractCurrency && h.contractCurrency !== h.reportingCurrency ? 'warn' : 'default' },
      { label: 'Periods Available', value: String(h.periodsAvailable),
        tone: h.periodsAvailable < 4 ? 'warn' : 'ok' },
      { label: 'Source', value: 'Approved Timeline snapshots' },
      { label: 'Live Modules Read', value: 'None', tone: 'ok' },
      { label: 'Formulas Recomputed', value: 'None', tone: 'ok' },
    ]});

    // ── Executive KPI scores ──
    s.push({ kind: 'kpi', title: 'Executive Health Scores', columns: 5, items: [
      { label: 'Overall',          value: sc(h.overall),               tone: tone(h.overall) as any,
        note: String(h.overallBand) },
      { label: 'Financial Health', value: sc(h.financial.score),       tone: tone(h.financial.score) as any,
        note: String(h.financial.band) },
      { label: 'Commercial Health',value: sc(h.commercial.score),      tone: tone(h.commercial.score) as any,
        note: String(h.commercial.band) },
      { label: 'Currency Risk',    value: sc(h.currencyRisk.score),    tone: tone(h.currencyRisk.score) as any,
        note: String(h.currencyRisk.band) },
      { label: 'Stability Index',  value: sc(h.stability.score),       tone: tone(h.stability.score) as any,
        note: String(h.stability.band) },
    ]});

    // Signals, so a score can be argued with.
    [['Financial Health', h.financial], ['Commercial Health', h.commercial],
     ['Currency Risk', h.currencyRisk], ['Stability Index', h.stability]]
      .forEach(([title, sco]: any) => {
        if (!sco || !(sco.signals ?? []).length) return;
        s.push({ kind: 'table', title: `${title} — Signals`,
          columns: [
            { key: 'signal', label: 'Signal', width: 22 },
            { key: 'score',  label: 'Score', align: 'right' },
            { key: 'weight', label: 'Weight', align: 'right' },
            { key: 'detail', label: 'Basis', width: 34 },
          ],
          rows: sco.signals.map((g: any) => ({
            signal: g.label,
            score: g.score === null ? 'No data' : Number(g.score).toFixed(0),
            weight: g.weight,
            detail: g.detail,
          })),
          note: sco.basis,
        });
      });

    // ── Contract evolution ──
    const ce = h.contractEvolution;
    if ((ce.points ?? []).length) {
      s.push({ kind: 'kpi', title: 'Contract Value Evolution', columns: 4, items: [
        { label: 'Original',      value: money(ce.originalContract) },
        { label: 'Current',       value: money(ce.currentContract), tone: 'gold' },
        { label: 'Total Growth',  value: money(ce.totalGrowth), note: pc(ce.totalGrowthPct, 2) },
        { label: 'Periods Moved', value: `${ce.movementCount} of ${ce.points.length}` },
      ]});
      s.push({ kind: 'table', title: 'Contract by Period',
        columns: [
          { key: 'period',   label: 'Period' },
          { key: 'original', label: 'Original', money: true },
          { key: 'cos',      label: 'Approved VOs', money: true },
          { key: 'pending',  label: 'Pending', money: true },
          { key: 'current',  label: 'Current', money: true },
          { key: 'movement', label: 'Movement', money: true },
          { key: 'growth',   label: 'Growth', align: 'right' },
          { key: 'baseline', label: 'Baseline', align: 'center' },
        ],
        rows: ce.points.map((p: any) => ({
          period: p.period,
          original: p.originalContract ?? '—',
          cos: p.approvedCOs ?? '—',
          pending: p.pendingCOs ?? '—',
          current: p.currentContract ?? '—',
          movement: p.movement === null || p.movement === 0 ? '—' : p.movement,
          growth: pc(p.growthFromOriginal, 2),
          baseline: p.baselineVersion === null ? '—'
            : `V${p.baselineVersion}${p.rebaselined ? ' *' : ''}`,
        })),
        note: ce.rebaselinedDuring
          ? ce.basis + ' Periods marked * sit on a new baseline version: a movement there may be '
            + 'a re-baseline rather than a commercial change.'
          : ce.basis,
      });
    }

    // ── Budget evolution ──
    const be = h.budgetEvolution;
    if ((be.points ?? []).length) {
      s.push({ kind: 'table', title: 'Budget Evolution',
        columns: [
          { key: 'period',   label: 'Period' },
          { key: 'planned',  label: 'Planned', money: true },
          { key: 'actual',   label: 'Actual', money: true },
          { key: 'spend',    label: 'Period Spend', money: true },
          { key: 'forecast', label: 'Forecast', money: true },
          { key: 'move',     label: 'Fcst Move', money: true },
          { key: 'variance', label: 'Variance', money: true },
          { key: 'burn',     label: 'Burn', align: 'right' },
        ],
        rows: be.points.map((p: any) => ({
          period: p.period,
          planned: p.planned ?? '—', actual: p.actual ?? '—',
          spend: p.periodSpend === null ? '—' : p.periodSpend,
          forecast: p.forecast ?? '—',
          move: p.forecastMovement === null || p.forecastMovement === 0 ? '—' : p.forecastMovement,
          variance: p.variance ?? '—',
          burn: pc(p.burnRate, 0),
        })),
        note: be.basis,
      });
    }

    // ── Variance and margin trends ──
    const cv = h.costVariance;
    if ((cv.points ?? []).length) {
      s.push({ kind: 'kpi', title: 'Cost Variance Trend', columns: 4, items: [
        { label: 'Current CV', value: money(cv.currentCv),
          tone: (cv.currentCv ?? 0) < 0 ? 'risk' : 'ok' },
        { label: 'Current CPI', value: cv.currentCpi === null ? '—' : Number(cv.currentCpi).toFixed(3),
          tone: (cv.currentCpi ?? 1) >= 1 ? 'ok' : 'risk' },
        { label: 'Consecutive Deterioration', value: String(cv.consecutiveDeterioration),
          tone: cv.consecutiveDeterioration > 1 ? 'risk' : 'ok' },
        { label: 'EAC Methods', value: (cv.methods ?? []).join(', ') || '—',
          tone: cv.methodChanged ? 'warn' : 'default' },
      ]});
    }

    const mt = h.margin;
    if ((mt.points ?? []).length) {
      s.push({ kind: 'table', title: 'Margin Trend',
        columns: [
          { key: 'period',    label: 'Period' },
          { key: 'certified', label: 'Certified', money: true },
          { key: 'cost',      label: 'Cost', money: true },
          { key: 'earned',    label: 'Earned Margin', money: true },
          { key: 'earnedPct', label: '%', align: 'right' },
          { key: 'forecast',  label: 'Forecast Margin', money: true },
          { key: 'fcstPct',   label: '%', align: 'right' },
          { key: 'move',      label: 'Movement', money: true },
        ],
        rows: mt.points.map((p: any) => ({
          period: p.period,
          certified: p.certified ?? '—', cost: p.costIncurred ?? '—',
          earned: p.earnedMargin ?? '—', earnedPct: pc(p.earnedMarginPct),
          forecast: p.forecastMargin ?? '—', fcstPct: pc(p.forecastMarginPct),
          move: p.movement === null || p.movement === 0 ? '—' : p.movement,
        })),
        note: mt.basis,
      });
      if (mt.consecutiveErosion > 1) {
        s.push({ kind: 'summary', title: 'Margin Erosion',
          text: `The forecast margin has fallen in ${mt.consecutiveErosion} consecutive approved `
              + 'periods. A single fall is noise; a run of them is a direction, and it is '
              + 'visible here before it reaches the variance.' });
      }
    }

    // ── Cash flow variance ──
    const cf = h.cashVariance;
    if ((cf.points ?? []).length) {
      s.push({ kind: 'table', title: 'Cash Flow Variance Trend',
        columns: [
          { key: 'period',     label: 'Period' },
          { key: 'in',         label: 'In', money: true },
          { key: 'out',        label: 'Out', money: true },
          { key: 'net',        label: 'Net', money: true },
          { key: 'cum',        label: 'Cumulative', money: true },
          { key: 'certified',  label: 'Certified', money: true },
          { key: 'gap',        label: 'Collection Gap', align: 'right' },
          { key: 'conversion', label: 'Conversion', align: 'right' },
        ],
        rows: cf.points.map((p: any) => ({
          period: p.period,
          in: p.totalIn ?? '—', out: p.totalOut ?? '—',
          net: p.netFlow ?? '—', cum: p.cumulativeNet ?? '—',
          certified: p.certified ?? '—',
          gap: pc(p.collectionGap, 0), conversion: pc(p.conversion, 0),
        })),
        note: cf.basis,
      });
    }

    // ── Forecast accuracy ──
    const fa = h.forecastAccuracy;
    if ((fa.rows ?? []).length) {
      s.push({ kind: 'kpi', title: 'Forecast Stability', columns: 4, items: [
        { label: 'Mean Absolute Drift', value: pc(fa.meanAbsDriftPct, 2),
          tone: (fa.meanAbsDriftPct ?? 0) > 0.10 ? 'warn' : 'ok' },
        { label: 'Bias', value: String(fa.bias),
          tone: fa.bias === 'balanced' ? 'ok' : 'warn' },
        { label: 'Volatile Forecasts', value: String(fa.volatileCount),
          tone: fa.volatileCount > 0 ? 'warn' : 'ok' },
        { label: 'Breached', value: String(fa.breachedCount),
          tone: fa.breachedCount > 0 ? 'risk' : 'ok' },
      ]});
      s.push({ kind: 'table', title: 'Forecast Drift by Period',
        columns: [
          { key: 'period',  label: 'Forecast Period' },
          { key: 'horizon', label: 'Horizon', align: 'right' },
          { key: 'then',    label: 'EAC Then', money: true },
          { key: 'now',     label: 'EAC Now', money: true },
          { key: 'drift',   label: 'Drift', money: true },
          { key: 'pct',     label: '%', align: 'right' },
          { key: 'breach',  label: 'Breached', align: 'center' },
        ],
        rows: fa.rows.map((r: any) => ({
          period: r.forecastPeriod, horizon: r.horizon,
          then: r.forecastEac ?? '—', now: r.laterEac ?? '—',
          drift: r.drift === null || r.drift === 0 ? '—' : r.drift,
          pct: pc(r.driftPct, 2),
          breach: r.breached ? 'Yes' : '—',
        })),
      });
      s.push({ kind: 'appendix', title: 'What Forecast Accuracy Means Here', text: fa.limitation });
    }

    // ── Currency impact ──
    const ci = h.currencyImpact;
    if ((ci.scenarios ?? []).length && ci.totalExposure > 0) {
      s.push({ kind: 'kpi', title: 'Forecast Currency Impact', columns: 4, items: [
        { label: 'Total Exposure', value: money(ci.totalExposure), tone: 'gold' },
        { label: 'Share of EAC',   value: pc(ci.exposureShareOfEac) },
        { label: 'Base EAC',       value: money(ci.baseEac) },
        { label: 'Reporting',      value: String(ci.reportingCurrency || '—') },
      ]});
      s.push({ kind: 'table', title: 'Rate Sensitivity',
        columns: [
          { key: 'scenario', label: 'Scenario', width: 32 },
          { key: 'impact',   label: 'Impact', money: true },
          { key: 'onEac',    label: 'On EAC', align: 'right' },
        ],
        rows: ci.scenarios.map((x: any) => ({
          scenario: x.label,
          impact: x.totalImpact,
          onEac: pc(x.impactOnEac, 2),
        })),
        note: ci.basis,
      });
    }

    // ── FX translation ──
    const fxm = h.fxMovement;
    if (fxm?.comparable && (fxm.rows ?? []).length) {
      s.push({ kind: 'table', title: 'FX Translation vs Previous Period',
        columns: [
          { key: 'currency', label: 'Currency' },
          { key: 'held',     label: 'Held', align: 'right' },
          { key: 'from',     label: 'From Rate', align: 'right' },
          { key: 'to',       label: 'To Rate', align: 'right' },
          { key: 'delta',    label: 'Movement', money: true },
          { key: 'pct',      label: '%', align: 'right' },
        ],
        rows: fxm.rows.map((r: any) => ({
          currency: r.currency,
          held: `${r.currency} ${money(r.originalAmount)}`,
          from: Number(r.fromRate).toFixed(6),
          to: Number(r.toRate).toFixed(6),
          delta: r.translationDelta,
          pct: pc(r.pctDelta, 2),
        })),
        note: fxm.basis,
      });
    }

    // ── Predictive ──
    const pr = h.predictive;
    if ((pr.projections ?? []).length) {
      s.push({ kind: 'table', title: 'Predictive Analytics',
        columns: [
          { key: 'measure',    label: 'Measure', width: 20 },
          { key: 'current',    label: 'Current', money: true },
          { key: 'projected',  label: 'Projected', money: true },
          { key: 'delta',      label: 'Delta', money: true },
          { key: 'confidence', label: 'Confidence', status: true },
          { key: 'method',     label: 'Method', width: 34 },
        ],
        rows: pr.projections.map((x: any) => ({
          measure: x.label,
          current: x.current ?? '—',
          projected: x.projected ?? '—',
          delta: x.delta === null || x.delta === 0 ? '—' : x.delta,
          confidence: x.confidence,
          method: x.method,
        })),
      });
      s.push({ kind: 'appendix', title: 'Reading the Projections', text: pr.caution });
    }

    // ── Historical comparisons ──
    const comps = fi.comparisons ?? {};
    Object.entries(comps).forEach(([basis, c]: any) => {
      if (!c?.ok || !(c.metrics ?? []).length) return;
      s.push({ kind: 'table', title: `Comparison — ${c.fromLabel} vs ${c.toLabel}`,
        columns: [
          { key: 'metric', label: 'Metric', width: 20 },
          { key: 'from',   label: c.fromLabel, align: 'right' },
          { key: 'to',     label: c.toLabel, align: 'right' },
          { key: 'delta',  label: 'Delta', align: 'right' },
          { key: 'pct',    label: '%', align: 'right' },
          { key: 'dir',    label: 'Direction', status: true },
        ],
        rows: c.metrics.map((x: any) => {
          const fmt = (v: any) =>
            v === null ? '—'
            : x.kind === 'money' ? money(v)
            : x.kind === 'days' ? days(v)
            : Number(v).toFixed(3);
          return {
            metric: m.lang === 'ar' ? x.labelAr : x.label,
            from: fmt(x.from), to: fmt(x.to),
            delta: x.delta === null || x.delta === 0 ? '—'
              : `${x.delta > 0 ? '+' : ''}${fmt(x.delta)}`,
            pct: pc(x.pctDelta, 2),
            dir: x.delta === null || x.delta === 0 ? 'flat' : x.adverse ? 'adverse' : 'favourable',
          };
        }),
        note: c.note || undefined,
      });
    });

    // ── Portfolio health ──
    const pf = fi.portfolio;
    if (pf && (pf.rows ?? []).length > 1) {
      s.push({ kind: 'kpi', title: 'Portfolio Health', columns: 4, items: [
        { label: 'Mean Overall', value: sc(pf.meanOverall), tone: tone(pf.meanOverall) as any },
        { label: 'Portfolio SPI', value: pf.spi === null ? '—' : Number(pf.spi).toFixed(3),
          tone: (pf.spi ?? 1) >= 1 ? 'ok' : 'risk' },
        { label: 'Portfolio CPI', value: pf.cpi === null ? '—' : Number(pf.cpi).toFixed(3),
          tone: (pf.cpi ?? 1) >= 1 ? 'ok' : 'risk' },
        { label: 'Weakest', value: pf.weakest
          ? `${pf.weakest.code} (${sc(pf.weakest.overall)})` : '—', tone: 'warn' },
      ]});
      s.push({ kind: 'table', title: 'Health by Project',
        columns: [
          { key: 'code',       label: 'Project' },
          { key: 'period',     label: 'Period' },
          { key: 'overall',    label: 'Overall', align: 'right' },
          { key: 'financial',  label: 'Financial', align: 'right' },
          { key: 'commercial', label: 'Commercial', align: 'right' },
          { key: 'currency',   label: 'Ccy Risk', align: 'right' },
          { key: 'stability',  label: 'Stability', align: 'right' },
          { key: 'weakest',    label: 'Weakest' },
          { key: 'band',       label: 'Band', status: true },
        ],
        rows: pf.rows.map((r: any) => ({
          code: r.code, period: r.period,
          overall: sc(r.overall), financial: sc(r.financial),
          commercial: sc(r.commercial), currency: sc(r.currencyRisk),
          stability: sc(r.stability), weakest: r.weakest, band: r.band,
        })),
        note: pf.basis,
      });
    }

    s.push({ kind: 'appendix', title: 'Basis of Preparation', text: fi.basis });
    s.push(sig(['Chief Executive', 'Finance Director', 'Project Director']));

    return {
      meta: meta(ctx, m, 'Financial Intelligence', `${h.code} — ${h.period}`),
      page: A4L, cover: true, toc: true, sections: s,
    };
  },
});

// ══ 20 · UNIFIED MONTHLY REPORT ═══════════════════════════════════════
// One document for management and the owner: EVM position, cash,
// certificates and time — the four questions every monthly meeting asks,
// answered under one cover instead of four separate prints (owner rule).

registerReport<Ctx & { evm?: any; cash?: any; certs?: any; delay?: any }>({
  id: 'monthly-report',
  label: 'Monthly Report (Unified)',
  labelAr: 'التقرير الشهري الموحّد',
  scope: 'Project',
  build: (ctx, m) => {
    const e = (ctx.evm ?? {}) as Record<string, any>;
    const cash = (ctx.cash ?? {}) as Record<string, any>;
    const certs = (ctx.certs ?? {}) as Record<string, any>;
    const delay = (ctx.delay ?? {}) as Record<string, any>;
    const idx = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toFixed(3));
    const sections: Section[] = [];

    // Executive summary assembled from the very numbers below it.
    const summary = L(m,
      'Position ' + String(e.quadrant ?? '—') + ' · SPI ' + idx(e.spi) + ' · CPI ' + idx(e.cpi) +
      '. Cash net ' + money(cash.netFlow) + '. Certificates certified to date ' + money(certs.certified) +
      '. Current delay ' + (delay.currentDelay ?? 0) + ' days against ' + (delay.approvedEOT ?? 0) + ' approved EOT days.',
      'الموقف ' + String(e.quadrant ?? '—') + ' · SPI ' + idx(e.spi) + ' · CPI ' + idx(e.cpi) +
      '. صافي النقدية ' + money(cash.netFlow) + '. إجمالي المستخلصات ' + money(certs.certified) +
      '. التأخير الحالي ' + (delay.currentDelay ?? 0) + ' يوماً مقابل ' + (delay.approvedEOT ?? 0) + ' يوم تمديد معتمد.');
    sections.push({ kind: 'summary', title: L(m, 'Executive Summary', 'الملخص التنفيذي'), text: summary });

    if (e.period !== undefined || e.spi !== undefined) {
      sections.push({ kind: 'kpi', title: L(m, 'Earned Value Position', 'موقف القيمة المكتسبة'), columns: 3, items: [
        { label: L(m, 'Position', 'الموقف'), value: String(e.quadrant ?? '—'), tone: 'gold' },
        { label: 'SPI', value: idx(e.spi) },
        { label: 'CPI', value: idx(e.cpi) },
        { label: L(m, 'Progress (EV ÷ BAC)', 'التقدم (EV ÷ BAC)'), value: percent(e.progressPct) },
        { label: 'EAC', value: money(e.eac), unit: unit(ctx) },
        { label: 'VAC', value: money(e.vac), unit: unit(ctx), tone: (Number(e.vac) || 0) < 0 ? 'risk' : 'ok' },
      ]});
      sections.push({ kind: 'bars', title: L(m, 'Budget Consumption', 'استهلاك الموازنة'), items: [
        { label: 'PV', ratio: Number(e.percentPlanned) || 0, value: percent(e.percentPlanned) },
        { label: 'EV', ratio: Number(e.percentComplete) || 0, value: percent(e.percentComplete), tone: 'gold' },
        { label: 'AC', ratio: Number(e.percentSpent) || 0, value: percent(e.percentSpent),
          tone: (Number(e.percentSpent) || 0) > (Number(e.percentComplete) || 0) ? 'risk' : 'ok' },
      ]});
      sections.push({ kind: 'info', title: L(m, 'Time Forecast', 'التوقع الزمني'), columns: 3, items: [
        { label: L(m, 'Baseline Finish', 'إنجاز الأساس'), value: reportDate(e.baselineFinish, m.lang) },
        { label: L(m, 'Forecast Finish', 'الإنجاز المتوقع'), value: reportDate(e.forecastFinish, m.lang),
          tone: (Number(e.slipDays) || 0) > 0 ? 'risk' : 'ok' },
        { label: L(m, 'Slippage', 'الانزلاق'), value: days(e.slipDays) },
      ]});
    }

    if (Array.isArray(cash.cum) && cash.cum.length) {
      sections.push({ kind: 'kpi', title: L(m, 'Cash Position', 'الموقف النقدي'), columns: 3, items: [
        { label: L(m, 'Cash In', 'نقدية داخل'), value: money(cash.totalIn), unit: unit(ctx), tone: 'ok' },
        { label: L(m, 'Cash Out', 'نقدية خارج'), value: money(cash.totalOut), unit: unit(ctx), tone: 'risk' },
        { label: L(m, 'Net', 'الصافي'), value: money(cash.netFlow), unit: unit(ctx), tone: 'gold' },
      ]});
      sections.push({ kind: 'table', title: L(m, 'Cash — Cumulative by Period', 'النقدية — التراكمي لكل فترة'),
        columns: [
          { key: 'month', label: L(m, 'Month', 'الفترة') },
          { key: 'in', label: L(m, 'Cash In', 'وارد'), money: true },
          { key: 'out', label: L(m, 'Cash Out', 'صادر'), money: true },
          { key: 'variance', label: L(m, 'Cum. Variance', 'الانحراف التراكمي'), money: true },
          { key: 'net', label: L(m, 'Cumulative Net', 'الصافي التراكمي'), money: true },
        ],
        rows: (cash.cum as any[]).map((r: any) => {
          const src = (cash.rows as any[] | undefined)?.find(x => x.month === r.month) ?? {};
          return {
            month: r.month,
            in: Number(src.in) || 0,
            out: Number(src.out) || 0,
            variance: r.variance,
            net: r.cumNet,
          };
        }),
      });
    }

    if (Array.isArray(certs.rows) && certs.rows.length) {
      sections.push({ kind: 'kpi', title: L(m, 'Certificates', 'المستخلصات'), columns: 3, items: [
        { label: L(m, 'Certified to Date', 'معتمد حتى تاريخه'), value: money(certs.certified), unit: unit(ctx) },
        { label: L(m, 'Retention', 'المحتجزات'), value: money(certs.retention), unit: unit(ctx) },
        { label: L(m, 'Net', 'الصافي'), value: money(certs.net), unit: unit(ctx), tone: 'gold' },
      ]});
      sections.push({ kind: 'table', title: L(m, 'Certificate Register', 'سجل المستخلصات'),
        columns: [
          { key: 'no', label: L(m, 'No.', 'م') },
          { key: 'period', label: L(m, 'Period', 'الفترة') },
          { key: 'gross', label: L(m, 'Gross', 'الإجمالي'), money: true },
          { key: 'retention', label: L(m, 'Retention', 'المحتجزات'), money: true },
          { key: 'net', label: L(m, 'Net', 'الصافي'), money: true },
          { key: 'status', label: L(m, 'Status', 'الحالة') },
        ],
        rows: certs.rows,
      });
    }

    sections.push({ kind: 'kpi', title: L(m, 'Time & Delay', 'الزمن والتأخير'), columns: 3, items: [
      { label: L(m, 'Current Delay', 'التأخير الحالي'), value: delay.currentDelay ?? 0, unit: 'DAYS',
        tone: (Number(delay.currentDelay) || 0) > 0 ? 'risk' : 'ok' },
      { label: L(m, 'Approved EOT', 'تمديد معتمد'), value: delay.approvedEOT ?? 0, unit: 'DAYS', tone: 'gold' },
      { label: L(m, 'Delay Register', 'سجل التأخير'), value: String(Array.isArray(delay.rows) ? delay.rows.length : 0) },
    ]});

    sections.push(sig(['Project Manager', 'Commercial Manager', 'Owner Representative']));

    return {
      meta: meta(ctx, m, 'Monthly Report', 'Unified — EVM · Cash · Certificates · Time'),
      page: A4, cover: true, toc: true, sections,
    };
  },
});

// ══ 21 · CLAIM DETAIL SHEET ═══════════════════════════════════════════
// One sheet per claim, for negotiation and litigation: the full record
// of the item — amounts, dates, currency facts and its document link —
// not a one-line row in a summary register (owner rule).

registerReport<Ctx & { item?: any }>({
  id: 'claim-detail',
  label: 'Claim Sheet',
  labelAr: 'ورقة مطالبة',
  scope: 'Row',
  build: (ctx, m) => {
    const it = (ctx.item ?? null) as Record<string, any> | null;
    if (!it) {
      return {
        meta: meta(ctx, m, 'Claim Sheet', ''),
        page: A4,
        sections: [{ kind: 'appendix', title: 'Note',
          text: 'Open this sheet from the claim row in the Claims register.' }],
      };
    }
    const unresolved = (Number(it.claimed) || 0) - (Number(it.settled) || 0);
    return {
      meta: meta(ctx, m, 'Claim Sheet — ' + String(it.no ?? ''), ''),
      page: A4, cover: false,
      sections: [
        { kind: 'info', title: L(m, 'Claim', 'المطالبة'), columns: 4, items: [
          { label: L(m, 'Reference', 'الرقم المرجعي'), value: String(it.no ?? '—') },
          { label: L(m, 'Type', 'النوع'), value: String(it.type ?? '—') },
          { label: L(m, 'Status', 'الحالة'), value: String(it.status ?? '—'),
            tone: it.status === 'approved' ? 'ok' : it.status === 'rejected' ? 'risk' : 'default' },
          { label: L(m, 'Claim Date', 'تاريخ المطالبة'), value: reportDate(it.date, m.lang) },
        ]},
        { kind: 'kpi', title: L(m, 'Amounts', 'المبالغ'), columns: 3, items: [
          { label: L(m, 'Claimed', 'المطلوب'), value: money(it.claimed), unit: unit(ctx) },
          { label: L(m, 'Settled', 'المستقر'), value: money(it.settled), unit: unit(ctx), tone: 'gold' },
          { label: L(m, 'Unresolved', 'غير المستقر'), value: money(unresolved), unit: unit(ctx),
            tone: unresolved > 0 ? 'risk' : 'ok' },
          { label: L(m, 'Time Claimed', 'المدة المطلوبة'), value: days(it.timeDays),
            tone: (Number(it.timeDays) || 0) > 0 ? 'gold' : 'default' },
        ]},
        { kind: 'info', title: L(m, 'Key Dates & Currency', 'التواريخ العملة'), columns: 3, items: [
          { label: L(m, 'EOT Effective Date', 'تاريخ سريان التمديد'), value: reportDate(it.eotApprovedAt, m.lang) },
          { label: L(m, 'Transaction Date', 'تاريخ المعاملة'), value: reportDate(it.transactionDate, m.lang) },
          { label: L(m, 'Rate Effective', 'سريان السعر'), value: reportDate(it.rateEffectiveDate, m.lang) },
          ...(it.currency ? [{ label: L(m, 'Entered Currency', 'عملة الإدخال'), value: String(it.currency) }] : []),
          ...(it.exchangeRate ? [{ label: L(m, 'Rate', 'السعر'), value: String(it.exchangeRate) }] : []),
        ]},
        { kind: "info", title: L(m, "Supporting Document", "المستند الداعم"), columns: 2, items: [
          { label: L(m, 'External Link', 'رابط خارجي'),
            value: it.documentUrl ? String(it.documentUrl) : L(m, 'None on record', 'لا يوجد') },
        ]},
        sig(['Claimant Representative', 'Commercial Manager']),
      ],
    };
  },
});

// ══ 22 · CHANGE ORDER DETAIL SHEET ════════════════════════════════════

registerReport<Ctx & { item?: any }>({
  id: 'co-detail',
  label: 'Change Order Sheet',
  labelAr: 'ورقة أمر تغيير',
  scope: 'Row',
  build: (ctx, m) => {
    const it = (ctx.item ?? null) as Record<string, any> | null;
    if (!it) {
      return {
        meta: meta(ctx, m, 'Change Order Sheet', ''),
        page: A4,
        sections: [{ kind: 'appendix', title: 'Note',
          text: 'Open this sheet from the order row in the Change Orders register.' }],
      };
    }
    return {
      meta: meta(ctx, m, 'Change Order Sheet — ' + String(it.no ?? ''), ''),
      page: A4, cover: false,
      sections: [
        { kind: 'info', title: L(m, 'Change Order', 'أمر التغيير'), columns: 4, items: [
          { label: L(m, 'Reference', 'الرقم المرجعي'), value: String(it.no ?? '—') },
          { label: L(m, 'Status', 'الحالة'), value: String(it.status ?? '—'),
            tone: it.status === 'approved' ? 'ok' : it.status === 'rejected' ? 'risk' : 'default' },
          { label: L(m, 'Order Date', 'تاريخ الأمر'), value: reportDate(it.date, m.lang) },
          { label: L(m, 'EOT Effective Date', 'تاريخ سريان التمديد'), value: reportDate(it.eotApprovedAt, m.lang) },
        ]},
        { kind: 'kpi', title: L(m, 'Value & Time', 'القيمة والمدة'), columns: 2, items: [
          { label: L(m, 'Order Value', 'قيمة الأمر'), value: money(it.value), unit: unit(ctx), tone: 'gold' },
          { label: L(m, 'Time Granted', 'المدة الممنوحة'), value: days(it.time),
            tone: (Number(it.time) || 0) > 0 ? 'gold' : 'default' },
        ]},
        { kind: 'summary', title: L(m, 'Scope', 'النطاق'),
          text: String(it.desc ?? '—') },
        { kind: "info", title: L(m, "Supporting Document", "المستند الداعم"), columns: 2, items: [
          { label: L(m, 'External Link', 'رابط خارجي'),
            value: it.documentUrl ? String(it.documentUrl) : L(m, 'None on record', 'لا يوجد') },
        ]},
        sig(['Project Manager', 'Commercial Manager']),
      ],
    };
  },
});

// ══ 23 · CVR — COST VALUE RECONCILIATION (the margin view) ════════════════
// Exported from the CVR project tab. Every figure arrives in ctx.cvr from
// the module, which derives it from lib/evm.ts — the report never computes.

registerReport<Ctx & { cvr?: any }>({
  id: 'cvr',
  label: 'CVR — Cost Value Reconciliation',
  labelAr: 'تسوية القيمة والتكلفة',
  scope: 'Project',
  build: (ctx, m) => {
    const c = ctx.cvr;
    if (!c) {
      return {
        meta: meta(ctx, m, 'CVR — Cost Value Reconciliation', ''),
        page: A4,
        sections: [{ kind: 'appendix', title: 'Note',
          text: 'Open this report from the CVR tab of the project.' }],
      };
    }
    const pct = (v: any) => v === null || v === undefined ? '—'
      : `${(Number(v) * 100).toFixed(1)}%`;
    const dash = (v: any) => v === null || v === undefined ? '—' : v;
    return {
      meta: meta(ctx, m, 'CVR — Cost Value Reconciliation', ''),
      page: A4, cover: false,
      sections: [
        { kind: 'kpi', title: L(m, 'Profit Position', 'موقف الربح'), columns: 4, items: [
          { label: L(m, 'Planned Margin', 'هامش مخطط'), value: pct(c.plannedMarginPct), tone: 'gold' },
          { label: L(m, 'Planned Profit', 'ربح مخطط'), value: money(c.plannedProfit), unit: unit(ctx), tone: 'gold' },
          { label: L(m, 'Expected Margin', 'هامش متوقع'), value: pct(c.expectedMarginPct),
            tone: Number(c.expectedProfit) >= 0 ? 'ok' : 'risk' },
          { label: L(m, 'Expected Profit', 'ربح متوقع'), value: money(c.expectedProfit), unit: unit(ctx),
            tone: Number(c.expectedProfit) >= 0 ? 'ok' : 'risk' },
        ]},
        { kind: 'info', title: L(m, 'Contract Amount (CA) Anatomy', 'مكونات قيمة العقد (CA)'), columns: 4, items: [
          { label: L(m, 'Contract Value', 'قيمة العقد'),
            value: money(c.contractAmount - c.approvedCos - c.settledClaims), unit: unit(ctx) },
          { label: L(m, 'Approved COs', 'أوامل معتمدة'),
            value: money(c.approvedCos), unit: unit(ctx), tone: 'ok' },
          { label: L(m, 'Settled Claims', 'مطالبات مسوّاة'),
            value: money(c.settledClaims), unit: unit(ctx), tone: 'ok' },
          { label: L(m, 'Unapproved COs (excluded)', 'أوامل غير معتمدة (مستبعدة)'),
            value: money(c.pendingCos), unit: unit(ctx) },
        ]},
        { kind: 'summary', title: L(m, 'Method', 'المنهجية'),
          text: L(m,
            'Only approved change orders and settled claims enter CA, linking themselves the day they are approved; BAC moves by the same amount so the planned margin stays frozen with the baseline. The expected profit is CA − EAC at the official signed forecast method and moves with every approved period. Expected − planned = VAC.',
            'المعتمد فقط من أوامل التغيير والمطالبات المسوّاة يدخل قيمة العقد، ويرتبط تلقائيًا يوم الاعتماد؛ وBAC يتحرك بنفس القيمة فيبقى الهامش المخطط مجمدًا مع خط الأساس. والربح المتوقع = CA − EAC بالطريقة الرسمية الموقّعة، ويتحرك مع كل مدة معتمدة. المتوقع − المخطط = VAC.') },
        { kind: 'table', title: L(m, 'Monthly Reconciliation', 'التسوية الشهرية'),
          columns: [
            { key: 'label', label: L(m, 'Period', 'الفترة'), width: 13 },
            { key: 'pv', label: 'PV', money: true, width: 11 },
            { key: 'pctPlanned', label: L(m, '% Planned', '% مخطط'), width: 9 },
            { key: 'plannedCvr', label: L(m, 'Planned CVR', 'CVR مخطط'), money: true, width: 12 },
            { key: 'ev', label: 'EV', money: true, width: 11 },
            { key: 'pctProgress', label: L(m, '% Earned', '% منجز'), width: 9 },
            { key: 'cvr', label: 'CVR', money: true, width: 12 },
            { key: 'delta', label: 'Δ', money: true, width: 10 },
            { key: 'status', label: L(m, 'Status', 'الحالة'), status: true, width: 9 },
          ],
          rows: (c.rows ?? []).map((r: any) => ({
            label: r.label,
            pv: dash(r.pv),
            pctPlanned: pct(r.pctPlanned),
            plannedCvr: dash(r.plannedCvr),
            ev: dash(r.ev),
            pctProgress: pct(r.pctProgress),
            cvr: dash(r.cvr),
            delta: r.cvr === null || r.cvr === undefined ? '—' : r.cvr - (r.plannedCvr ?? 0),
            status: r.status ?? '—',
          })) },
        { kind: 'summary', title: L(m, 'Equations', 'المعادلات'),
          text: 'Planned CVR = (PV ÷ BAC) × (CA − BAC)   ·   CVR = (EV ÷ BAC) × (CA − BAC)   ·   Expected profit = CA − EAC   ·   At 100% both curves close on CA − BAC' },
        sig(['Project Manager', 'Commercial Manager']),
      ],
    };
  },
});
