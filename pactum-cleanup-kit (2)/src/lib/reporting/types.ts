/**
 * PACTUM Reporting Engine — contracts.
 * Destination: src/lib/reporting/types.ts
 *
 * The renderer knows nothing about construction. A module hands over a
 * ReportDocument — plain data — and the engine paints it. That boundary is
 * what lets Excel or Word be added later without touching a single module.
 *
 * Nothing here reads or writes application state.
 */

// â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type PageSize = 'A4' | 'A3' | 'Letter';
export type PageOrientation = 'portrait' | 'landscape';

export interface PageSetup {
  size: PageSize;
  orientation: PageOrientation;
  /** Millimetres. Printer-safe defaults are applied when omitted. */
  margin?: { top: number; right: number; bottom: number; left: number };
}

// â”€â”€ Identity block, repeated on every report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ReportMeta {
  /** "Delay Analysis", "Payment Certificates" â€¦ */
  title: string;
  subtitle?: string;
  company?: string;
  sector?: string;
  project?: string;
  /** Project or contract code, shown as a monospace chip. */
  reference?: string;
  generatedBy: string;
  /** ISO. Rendered through the platform's single date format. */
  generatedAt: string;
  /** Report template version, not the app version. */
  version: string;
  systemVersion: string;
  /**
   * SPRINT 4 — the currency this report's figures are expressed in.
   *
   * OPTIONAL, and deliberately so. An undeclared currency renders NO
   * currency line rather than the word SAR: a report that does not know
   * its unit must say nothing instead of asserting the wrong thing. A
   * delay-day count and a risk score have no currency at all, and
   * stamping one on them would be a false statement, not a default.
   */
  currency?: string;
  confidentiality?: 'Public' | 'Internal' | 'Confidential' | 'Restricted';
}

// â”€â”€ Sections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type Align = 'start' | 'end' | 'center' | 'right';

export interface Column {
  key: string;
  label: string;
  align?: Align;
  /** Money is right-aligned, tabular and LTR-isolated even in an RTL page. */
  money?: boolean;
  /** Rendered as a status pill. */
  status?: boolean;
  /** Percentage of table width. */
  width?: number;
}

export interface TotalRow {
  label: string;
  /** Keyed by column. Values are pre-computed by the adapter. */
  values: Record<string, string | number>;
  span?: number;
}

export interface KpiItem {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "default" | "gold" | "ok" | "warn" | "risk";
  /** Small line under the figure. */
  note?: string;
}

export interface InfoItem {
  label: string;
  value: string;
  tone?: "default" | "gold" | "ok" | "warn" | "risk";
  unit?: string;
}

export interface TimelineItem {
  label: string;
  date?: string;
  value?: string;
  tone?: "default" | "gold" | "ok" | "warn" | "risk";
  unit?: string;
  note?: string;
}

export interface BarItem {
  label: string;
  /** 0..1 */
  ratio: number;
  value?: string;
  tone?: "default" | "gold" | "ok" | "warn" | "risk";
  unit?: string;
}

export interface RiskCell {
  probability: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  label: string;
}

export interface Signatory {
  role: string;
  name?: string;
  /** Left blank for wet signature when omitted. */
  date?: string;
}

export type Section =
  | { kind: 'summary'; title?: string; text: string }
  | { kind: 'kpi'; title?: string; items: KpiItem[]; columns?: 2 | 3 | 4 | 5 | 6 }
  | { kind: 'info'; title?: string; items: InfoItem[]; columns?: 2 | 3 | 4 }
  | { kind: 'table'; title?: string; columns: Column[]; rows: Record<string, unknown>[];
      total?: TotalRow; note?: string; landscape?: boolean }
  | { kind: 'timeline'; title?: string; items: TimelineItem[] }
  | { kind: 'bars'; title?: string; items: BarItem[] }
  | { kind: 'risk'; title?: string; cells: RiskCell[] }
  | { kind: 'signature'; title?: string; signatories: Signatory[] }
  | { kind: 'appendix'; title?: string; text: string }
  | { kind: 'pagebreak' };

// â”€â”€ Document â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ReportDocument {
  meta: ReportMeta;
  page: PageSetup;
  /** Cover page. Omit for a direct report. */
  cover?: boolean;
  /** Table of contents. The engine derives entries from section titles. */
  toc?: boolean;
  sections: Section[];
}

// â”€â”€ Registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * A module registers one definition. `build` receives whatever context the
 * caller already holds — it must never fetch or recompute.
 */
export interface ReportDefinition<TContext = unknown> {
  id: string;
  /** Shown in the report picker. */
  label: string;
  labelAr?: string;
  /** Grouping in the picker: 'Project', 'Company', 'Portfolio'. */
  scope: string;
  page?: Partial<PageSetup>;
  build: (ctx: TContext, meta: BuildMeta) => ReportDocument;
}

export interface BuildMeta {
  generatedBy: string;
  generatedAt: string;
  systemVersion: string;
  lang: 'en' | 'ar';
}

export type OutputFormat = 'pdf' | 'print' | 'preview' | 'excel' | 'word' | 'pptx';
