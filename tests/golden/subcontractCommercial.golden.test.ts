/**
 * GOLDEN MASTER — Subcontractor commercial rollup
 * (تجيير المطالبات وأوامر التغيير — معادلات القيمة التعاقدية)
 */
import { describe, it, expect } from 'vitest';
import {
  rollupCommercial,
  currentContractValue,
  normaliseDocUrl,
  EMPTY_COMMERCIAL,
  type SubCommercial,
} from '@/lib/subcontractCommercial';

const sample: SubCommercial = {
  ...EMPTY_COMMERCIAL,
  changeOrders: [
    { id: 'co1', ref: 'CO-001', description: 'Extra foundations', amount: 250_000, status: 'approved' as any, date: '2026-02-10', timeImpactDays: 10 },
    { id: 'co2', ref: 'CO-002', description: 'Finish upgrade', amount: 120_000, status: 'submitted' as any, date: '2026-03-01' },
    { id: 'co3', ref: 'CO-003', description: 'Rejected extra', amount: 999_999, status: 'rejected' as any, date: '2026-03-15' },
  ],
  claims: [
    { id: 'cl1', ref: 'CLM-001', description: 'Weather delay', amount: 80_000, status: 'approved' as any, date: '2026-04-01', timeImpactDays: 15 },
    { id: 'cl2', ref: 'CLM-002', description: 'Pending claim', amount: 40_000, status: 'submitted' as any, date: '2026-05-01' },
  ],
  eots: [],
  delays: [],
  schedule: {},
};

describe('Subcontractor commercial (golden)', () => {
  it('rollupCommercial: تجميع معتمد/معلق/مرفوض + EOT', () => {
    expect(rollupCommercial(sample)).toMatchSnapshot();
  });

  it('rollupCommercial: فارغ تمامًا', () => {
    expect(rollupCommercial(EMPTY_COMMERCIAL)).toMatchSnapshot();
  });

  it('rollupCommercial: أوامر وقت بس من غير فلوس', () => {
    const timeOnly: SubCommercial = {
      ...EMPTY_COMMERCIAL,
      changeOrders: [
        { id: 'co9', ref: 'CO-009', description: 'Time only', amount: 0, status: 'approved' as any, date: '2026-06-01', timeImpactDays: 30 },
      ],
      claims: [],
    };
    expect(rollupCommercial(timeOnly)).toMatchSnapshot();
  });

  it('currentContractValue: الأصل + المعتمد', () => {
    const r = rollupCommercial(sample);
    expect(currentContractValue(1_000_000, r)).toMatchSnapshot();
    expect(currentContractValue(0, rollupCommercial(EMPTY_COMMERCIAL))).toMatchSnapshot();
  });

  it('normaliseDocUrl: تطبيع روابط المستندات', () => {
    expect(normaliseDocUrl('https://sharepoint/doc1')).toMatchSnapshot();
    expect(normaliseDocUrl(undefined)).toMatchSnapshot();
    expect(normaliseDocUrl('  ')).toMatchSnapshot();
  });
});
