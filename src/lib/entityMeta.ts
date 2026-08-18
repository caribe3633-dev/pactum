/**
 * Editable entity metadata — localStorage overlay.
 *
 * Same philosophy as ProjectCard's `pactum-project-meta-${id}`:
 * mock files are never modified; extra presentation data lives here
 * and can later be swapped for a database without touching any UI.
 *
 * Keys:
 *   pactum-company-meta-${id}
 *   pactum-sector-meta-${id}
 */

// â”€â”€ Company â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface CompanyMeta {
  logo?: string;          // base64 data URL
  descriptionEn?: string;
  descriptionAr?: string;
  owner?: string;
  country?: string;       // overrides mock country
  city?: string;          // overrides mock city
}

const COMPANY_KEY = (id: string) => `pactum-company-meta-${id}`;

export function getCompanyMeta(id: string): CompanyMeta {
  try {
    return JSON.parse(localStorage.getItem(COMPANY_KEY(id)) || '{}') as CompanyMeta;
  } catch {
    return {};
  }
}

export function saveCompanyMeta(id: string, meta: CompanyMeta): void {
  try {
    localStorage.setItem(COMPANY_KEY(id), JSON.stringify(meta));
  } catch {
    /* quota exceeded — ignore */
  }
}

// â”€â”€ Sector â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface SectorMeta {
  image?: string;         // base64 data URL
  descriptionEn?: string;
  descriptionAr?: string;
}

const SECTOR_KEY = (id: string) => `pactum-sector-meta-${id}`;

export function getSectorMeta(id: string): SectorMeta {
  try {
    return JSON.parse(localStorage.getItem(SECTOR_KEY(id)) || '{}') as SectorMeta;
  } catch {
    return {};
  }
}

export function saveSectorMeta(id: string, meta: SectorMeta): void {
  try {
    localStorage.setItem(SECTOR_KEY(id), JSON.stringify(meta));
  } catch {
    /* quota exceeded — ignore */
  }
}

// â”€â”€ Shared image reader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function readImageFile(file: File | undefined, onDone: (dataUrl: string) => void): void {
  if (!file || !file.type.match(/^image\/(jpeg|png|webp|svg\+xml)$/)) return;
  const reader = new FileReader();
  reader.onload = (e) => onDone((e.target?.result as string) ?? '');
  reader.readAsDataURL(file);
}

// â”€â”€ Risk aggregation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type RiskLevel = 'Critical' | 'High' | 'Medium' | 'Low';

const RISK_ORDER: Record<RiskLevel, number> = {
  Critical: 3,
  High: 2,
  Medium: 1,
  Low: 0,
};

export const RISK_STYLES: Record<RiskLevel, string> = {
  Critical: 'text-chart-3 border-chart-3/40 bg-chart-3/10',
  High: 'text-chart-3 border-chart-3/40 bg-chart-3/10',
  Medium: 'text-chart-5 border-chart-5/40 bg-chart-5/10',
  Low: 'text-chart-4 border-chart-4/40 bg-chart-4/10',
};

/**
 * Risk for a single project.
 * Critical  -> delay >= 30 days
 * High/Med  -> risk register exposure vs 1% of contract value
 */
export function getProjectRisk(project: any): RiskLevel {
  if ((project?.delayDays ?? 0) >= 30) return 'Critical';

  let risks: any[] = [];
  try {
    risks = JSON.parse(localStorage.getItem(`pactum-risk-${project.id}`) || '[]');
  } catch {
    risks = [];
  }

  const threshold = (project?.contractValue ?? 0) * 0.01;
  const exposure = (r: any) => (r.prob || 0) * (r.impact || 0);

  if (risks.some(r => exposure(r) > threshold)) return 'High';
  if (risks.some(r => exposure(r) > threshold * 0.2 && exposure(r) <= threshold)) return 'Medium';
  return 'Low';
}

/** Highest risk across a set of projects. */
export function getAggregateRisk(projects: any[]): RiskLevel {
  if (!projects || projects.length === 0) return 'Low';
  return projects.reduce<RiskLevel>((worst, p) => {
    const level = getProjectRisk(p);
    return RISK_ORDER[level] > RISK_ORDER[worst] ? level : worst;
  }, 'Low');
}

export function riskLabel(level: RiskLevel, lang: 'en' | 'ar'): string {
  if (lang !== 'ar') return level.toUpperCase();
  return { Critical: 'حرج', High: 'مرتفع', Medium: 'متوسط', Low: 'منخفض' }[level];
}
