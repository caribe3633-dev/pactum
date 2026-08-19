/**
 * REGRESSION — تصنيف حالة العقد
 * يثبت سلامة التصنيف: أكواد فريدة، الحالات الاستثنائية منفصلة، والقراءة صحيحة.
 */
import { describe, it, expect } from 'vitest';
import {
  CONTRACT_PHASE_GROUPS, CONTRACT_PHASE_EXCEPTIONS,
  contractPhaseOption, contractPhaseGroupOf, isContractPhaseException,
} from '@/lib/contractPhases';

describe('Contract phases taxonomy', () => {
  it('1️⃣ كل الأكواد فريدة (ولا تكرار بين المجموعات والاستثناءات)', () => {
    const all = [
      ...CONTRACT_PHASE_GROUPS.flatMap(g => g.options.map(o => o.value)),
      ...CONTRACT_PHASE_EXCEPTIONS.map(o => o.value),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('2️⃣ كل حالة فيها مسمى عربي وإنجليزي ووصف مهني', () => {
    for (const g of CONTRACT_PHASE_GROUPS) {
      for (const o of g.options) {
        expect(o.ar.length).toBeGreaterThan(0);
        expect(o.en.length).toBeGreaterThan(0);
        expect(o.desc.length).toBeGreaterThan(10);
      }
    }
  });

  it('3️⃣ القراءة بالكود ترجّع الحالة ومجموعتها', () => {
    expect(contractPhaseOption('SUSPENDED')?.ar).toContain('مُعلق');
    expect(contractPhaseGroupOf('SUSPENDED')?.key).toBe('03');
    expect(contractPhaseOption('DNP')?.en).toBe('Defects Notification Period');
    expect(contractPhaseGroupOf('FINAL_HANDOVER')?.key).toBe('06');
  });

  it('4️⃣ الاستثناءات معروفة ومتميزة عن المسار', () => {
    expect(isContractPhaseException('TERMINATED')).toBe(true);
    expect(isContractPhaseException('LIQUIDATED')).toBe(true);
    expect(isContractPhaseException('ON_PROGRESS')).toBe(false);
    expect(contractPhaseGroupOf('TERMINATED')).toBeNull();
  });

  it('5️⃣ كود غير معروف أو فاضي → null بأمان', () => {
    expect(contractPhaseOption(undefined)).toBeNull();
    expect(contractPhaseOption('NOPE')).toBeNull();
  });
});
