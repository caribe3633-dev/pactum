/**
 * Engineering Certification Dataset v1.0 — the declaration.
 * Destination: src/lib/certification/EngineeringCertificationDataset.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 0-B · WHAT THIS FILE IS
 *
 * The permanent engineering certification dataset, expressed as DATA
 * ONLY. It contains no writers, reads no storage and imports nothing
 * from the application — so it can be diffed, reviewed and version-
 * controlled as a specification rather than as behaviour.
 *
 * `EngineeringCertificationSeed.ts` is the only thing that consumes it.
 *
 * WHY EVERY ID IS SPELLED OUT
 *
 *   Idempotency is achieved through DETERMINISTIC IDENTITY, not through
 *   a "have I run before?" flag. A flag can be cleared, or can survive a
 *   partial run and block the repair; a fixed id makes the second run
 *   structurally unable to create a duplicate, because the application's
 *   own `duplicate-id` guards refuse it.
 *
 *   The `ECD-` prefix also makes certification records instantly
 *   distinguishable from a user's real work in a storage dump.
 *
 * WHY THE FX TABLES ARE LITERAL
 *
 *   A generated curve (base * 1.01^n) would drift the moment anyone
 *   touched the generator, and a certification dataset that changes
 *   silently is worthless: the whole point is that the same input
 *   produces the same figures after an architectural change. So all 72
 *   rates are written out.
 *
 * WHY DATES SIT ON PUBLICATION DAYS
 *
 *   Measured during preparation: the FX engine refuses to convert before
 *   the first published rate and will not invent one — correct
 *   behaviour. Every transaction date below therefore falls ON or AFTER
 *   a publication date, so no fixture row is unconvertible.
 * ══════════════════════════════════════════════════════════════════════
 */

export const ECD_VERSION = '1.0';
export const ECD_PREFIX = 'ECD-';

// ── Currencies ─────────────────────────────────────────────────────────

export const ECD_CURRENCIES = ['SAR', 'AED', 'USD', 'EUR'] as const;
export type EcdCurrency = typeof ECD_CURRENCIES[number];

/**
 * The twelve publication dates. Append-only: a re-run republishes the
 * same twelve, and the FX engine's own duplicate guard keeps the history
 * at 72 rather than 144.
 */
export const ECD_RATE_DATES = [
  '2024-01-01', '2024-03-01', '2024-05-01', '2024-07-01',
  '2024-09-01', '2024-11-01', '2025-01-01', '2025-03-01',
  '2025-05-01', '2025-07-01', '2025-09-01', '2025-11-01',
] as const;

/** Rates quoted FROM the company's reporting currency TO each foreign unit. */
export interface EcdRateTable {
  /** The company's own reporting currency — the quote base. */
  base: EcdCurrency;
  /** currency -> one rate per entry in ECD_RATE_DATES, same order. */
  rates: Record<string, number[]>;
}

export const ECD_FX: Record<string, EcdRateTable> = {
  'ECD-C1': {
    base: 'EUR',
    rates: {
      AED: [0.2504, 0.2511, 0.2498, 0.2519, 0.2532, 0.2527,
            0.2540, 0.2548, 0.2536, 0.2551, 0.2563, 0.2559],
      SAR: [0.2453, 0.2460, 0.2447, 0.2468, 0.2481, 0.2476,
            0.2489, 0.2497, 0.2485, 0.2500, 0.2512, 0.2508],
      USD: [0.9201, 0.9230, 0.9188, 0.9255, 0.9302, 0.9284,
            0.9331, 0.9360, 0.9318, 0.9375, 0.9418, 0.9403],
    },
  },
  'ECD-C2': {
    base: 'SAR',
    rates: {
      AED: [1.0204, 1.0208, 1.0201, 1.0212, 1.0219, 1.0216,
            1.0223, 1.0227, 1.0221, 1.0229, 1.0235, 1.0233],
      EUR: [4.0761, 4.0645, 4.0861, 4.0518, 4.0306, 4.0388,
            4.0177, 4.0048, 4.0241, 4.0000, 3.9809, 3.9873],
      USD: [3.7500, 3.7502, 3.7498, 3.7505, 3.7510, 3.7508,
            3.7512, 3.7515, 3.7511, 3.7517, 3.7520, 3.7519],
    },
  },
};

// ── Master data ────────────────────────────────────────────────────────

export interface EcdCompany {
  id: string;
  name: string;
  nameAr: string;
  reportingCurrency: EcdCurrency;
  country: string;
  city: string;
  headquarters: string;
  timeZone: string;
}

export const ECD_COMPANIES: EcdCompany[] = [
  {
    id: 'ECD-C1', name: 'Alpha Construction Group', nameAr: 'مجموعة ألفا للإنشاءات',
    reportingCurrency: 'EUR', country: 'AE', city: 'Dubai',
    headquarters: 'Dubai, United Arab Emirates', timeZone: 'Asia/Dubai',
  },
  {
    id: 'ECD-C2', name: 'Saudi Engineering', nameAr: 'الهندسة السعودية',
    reportingCurrency: 'SAR', country: 'SA', city: 'Riyadh',
    headquarters: 'Riyadh, Saudi Arabia', timeZone: 'Asia/Riyadh',
  },
];

export interface EcdSector {
  id: string;
  name: string;
  nameAr: string;
  companyId: string;
  defaultContractCurrency: EcdCurrency;
}

export const ECD_SECTORS: EcdSector[] = [
  { id: 'ECD-S1', name: 'Infrastructure', nameAr: 'البنية التحتية', companyId: 'ECD-C1', defaultContractCurrency: 'AED' },
  { id: 'ECD-S2', name: 'Buildings',      nameAr: 'المباني',        companyId: 'ECD-C1', defaultContractCurrency: 'EUR' },
  { id: 'ECD-S3', name: 'Oil & Gas',      nameAr: 'النفط والغاز',   companyId: 'ECD-C2', defaultContractCurrency: 'USD' },
  { id: 'ECD-S4', name: 'Utilities',      nameAr: 'المرافق',        companyId: 'ECD-C2', defaultContractCurrency: 'SAR' },
];

export type EcdStatus = 'Active' | 'On Hold' | 'Completed' | 'Archived';

export interface EcdProject {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  companyId: string;
  sectorId: string;
  /** The signed contract's currency. */
  contractCurrency: EcdCurrency;
  /** What this project's own totals are expressed in. */
  reportingCurrency: EcdCurrency;
  status: EcdStatus;
  commencementDate: string;
  contractualCompletion: string;
  contractValue: number;
  country: string;
  cityEn: string;
  cityAr: string;
  progress: number;
  delayDays: number;
  /** Which lifecycle case this project exists to cover. */
  lifecycle: 'Active' | 'Completed' | 'Delayed' | 'Healthy' | 'Archived';
  /** Delayed projects carry a two-row delay register; others one row. */
  delayed: boolean;
  /** Completed projects carry five certificates rather than three. */
  completed: boolean;
  /** Base year for generated transaction dates. */
  year: number;
}

/**
 * Five projects covering all five lifecycle states AND both conversion
 * paths — three that must convert (AED->EUR twice, USD->SAR once) and two
 * where contract and reporting currency are identical, which exercises
 * the identity path that a conversion-only dataset would never reach.
 */
export const ECD_PROJECTS: EcdProject[] = [
  {
    id: 'ECD-P1', code: 'MLA-2024-01', nameEn: 'Metro Line A', nameAr: 'مترو الخط أ',
    companyId: 'ECD-C1', sectorId: 'ECD-S1',
    contractCurrency: 'AED', reportingCurrency: 'EUR',
    status: 'Active', commencementDate: '2024-02-01', contractualCompletion: '2027-01-31',
    contractValue: 420_000_000, country: 'AE', cityEn: 'Dubai', cityAr: 'دبي',
    progress: 0.41, delayDays: 96, lifecycle: 'Delayed', delayed: true, completed: false, year: 2024,
  },
  {
    id: 'ECD-P2', code: 'BRX-2024-02', nameEn: 'Bridge Expansion', nameAr: 'توسعة الجسر',
    companyId: 'ECD-C1', sectorId: 'ECD-S1',
    contractCurrency: 'AED', reportingCurrency: 'EUR',
    status: 'Active', commencementDate: '2024-04-01', contractualCompletion: '2026-09-30',
    contractValue: 180_000_000, country: 'AE', cityEn: 'Abu Dhabi', cityAr: 'أبوظبي',
    progress: 0.58, delayDays: 0, lifecycle: 'Healthy', delayed: false, completed: false, year: 2024,
  },
  {
    id: 'ECD-P3', code: 'CTM-2024-03', nameEn: 'City Mall', nameAr: 'مول المدينة',
    companyId: 'ECD-C1', sectorId: 'ECD-S2',
    contractCurrency: 'EUR', reportingCurrency: 'EUR',
    status: 'Completed', commencementDate: '2023-06-01', contractualCompletion: '2025-11-30',
    contractValue: 95_000_000, country: 'AE', cityEn: 'Dubai', cityAr: 'دبي',
    progress: 1, delayDays: 14, lifecycle: 'Completed', delayed: false, completed: true, year: 2023,
  },
  {
    id: 'ECD-P4', code: 'RFU-2024-04', nameEn: 'Refinery Upgrade', nameAr: 'تطوير المصفاة',
    companyId: 'ECD-C2', sectorId: 'ECD-S3',
    contractCurrency: 'USD', reportingCurrency: 'SAR',
    status: 'Active', commencementDate: '2024-01-15', contractualCompletion: '2026-12-31',
    contractValue: 260_000_000, country: 'SA', cityEn: 'Jubail', cityAr: 'الجبيل',
    progress: 0.47, delayDays: 23, lifecycle: 'Active', delayed: true, completed: false, year: 2024,
  },
  {
    id: 'ECD-P5', code: 'WTN-2024-05', nameEn: 'Water Network', nameAr: 'شبكة المياه',
    companyId: 'ECD-C2', sectorId: 'ECD-S4',
    contractCurrency: 'SAR', reportingCurrency: 'SAR',
    status: 'Archived', commencementDate: '2023-09-01', contractualCompletion: '2026-03-31',
    contractValue: 140_000_000, country: 'SA', cityEn: 'Riyadh', cityAr: 'الرياض',
    progress: 0.72, delayDays: 5, lifecycle: 'Archived', delayed: false, completed: false, year: 2023,
  },
];

// ── Transaction shapes ─────────────────────────────────────────────────
//
// Expressed as FRACTIONS of the contract value, so a reviewer can see the
// commercial logic rather than five sets of unexplained absolute numbers.

/** Five-element cost breakdown structure, weights summing to 1.00. */
export const ECD_CBS: { category: string; weight: number; spent: number }[] = [
  { category: 'Preliminaries & General',   weight: 0.08, spent: 0.62 },
  { category: 'Substructure & Earthworks', weight: 0.17, spent: 0.55 },
  { category: 'Structural Works',          weight: 0.32, spent: 0.30 },
  { category: 'MEP Installations',         weight: 0.24, spent: 0.14 },
  { category: 'Finishes & Handover',       weight: 0.19, spent: 0.04 },
];

/**
 * Change orders. Deliberately MIXED status: two approved, one under
 * review, one rejected.
 *
 * This is the dataset's most important design decision. "Only approved
 * change orders affect the revised contract value" is only a testable
 * claim if non-approved orders EXIST. A dataset of four approved orders
 * would pass that check while proving nothing.
 */
export const ECD_CHANGE_ORDERS = [
  { no: 'CO-001', desc: 'Additional scope — owner instruction', fraction: 0.042, month: 4,  day: 18, eotDays: 45, status: 'approved' },
  { no: 'CO-002', desc: 'Specification upgrade',                fraction: 0.018, month: 7,  day: 2,  eotDays: 15, status: 'approved' },
  { no: 'CO-003', desc: 'Design revision — under evaluation',   fraction: 0.026, month: 9,  day: 11, eotDays: 0,  status: 'under review' },
  { no: 'CO-004', desc: 'Rejected betterment request',          fraction: 0.011, month: 10, day: 5,  eotDays: 0,  status: 'rejected' },
] as const;

/** Claims: one settled, one still open. Same falsifiability rule. */
export const ECD_CLAIMS = [
  { no: 'CLM-001', type: 'Prolongation', claimedFraction: 0.030, settledFraction: 0.012, month: 5, day: 20, timeDays: 30, status: 'approved' },
  { no: 'CLM-002', type: 'Disruption',   claimedFraction: 0.019, settledFraction: 0,     month: 8, day: 14, timeDays: 0,  status: 'under review' },
] as const;

/** Interim payment certificate: 9% of contract, 5% retention. */
export const ECD_CERT = { grossFraction: 0.09, retentionRate: 0.05 } as const;

/** Six monthly cash periods. */
export const ECD_CASH = { inFraction: 0.055, outFraction: 0.047, periods: 6 } as const;

/**
 * Risk register — identical three rows per project, by design.
 *
 * CORRECTED. The first version wrote `prob: 4, impact: 4` intending a
 * 1-5 probability/impact matrix. The module does not work that way:
 * `RiskModule` stores `prob` as a PERCENTAGE (it divides the input by
 * 100) and `impact` as a money amount, so `4, 4` was read as 4% x 4 and
 * produced an exposure of 0.16 instead of a real figure.
 *
 * `prob` is now a percentage and `impact` a monetary consequence in the
 * project's contract currency, which is what the screen actually asks
 * for. Exposure = prob x impact is then a genuine expected value.
 */
export const ECD_RISKS = [
  { id: 'RSK-001', cause: 'Volatile steel pricing', event: 'Material cost escalation',
    effect: 'Budget overrun on structural package', prob: 40, impactFraction: 0.018,
    status: 'Open', category: 'Commercial', owner: 'Commercial Manager', linkedClaimNos: [] as string[] },
  { id: 'RSK-002', cause: 'Single-source MEP supplier', event: 'Delivery delay',
    effect: 'Critical path slippage', prob: 30, impactFraction: 0.025,
    status: 'Mitigating', category: 'Supply Chain', owner: 'Project Director', linkedClaimNos: ['CLM-002'] },
  { id: 'RSK-003', cause: 'FX exposure on imported plant', event: 'Adverse rate movement',
    effect: 'Reported cost increase', prob: 30, impactFraction: 0.012,
    status: 'Open', category: 'Financial', owner: 'Finance Lead', linkedClaimNos: [] as string[] },
] as const;

/** Two approved reporting periods per project. */
export const ECD_PERIODS = [
  { periodId: '2025-06', periodLabel: 'June 2025',     dataDate: '2025-06-30' },
  { periodId: '2025-12', periodLabel: 'December 2025', dataDate: '2025-12-31' },
] as const;

/** Expected totals, for the seed's own self-check. */
export const ECD_EXPECTED = {
  companies: 2,
  sectors: 4,
  projects: 5,
  currencies: 4,
  fxRates: 72,
  fxDates: 12,
  snapshots: 10,
  /** 5 families (contract, budget, cashflow, schedule, forecast) x 5 projects. */
  baselines: 25,
  changeOrders: 20,
  claims: 10,
  certificates: 17,   // 4 projects x 3 + City Mall x 5
  cashRows: 30,
  budgetRows: 25,
  riskRows: 15,
  delayRows: 7,       // 2 delayed x 2 + 3 others x 1
} as const;
