/**
 * CONTRACT PHASE — الدورة التعاقدية الكاملة بمراحلها وحالاتها الاستثنائية.
 *
 * التصنيف المعتمد (من صاحب العمل): ست مراحل من ما قبل الترسية حتى الإغلاق
 * النهائي، بالإضافة إلى حالتين استثنائيتين (فسخ / تصفية) تخرجان عن المسار.
 *
 * التخزين: `project.contractPhase` على سجل المشروع (اختياري — المشاريع
 * القديمة اللي اتخزنت قبل الكارت بتقرا "لم تُحدد" من غير أي ترقيع بيانات).
 */

export interface ContractPhaseOption {
  /** الرمز المعتمد المخزّن. */
  value: string;
  /** المسمى بالعربية. */
  ar: string;
  /** المسمى بالإنجليزية. */
  en: string;
  /** الوصف المهني والتنفيذي. */
  desc: string;
}

export interface ContractPhaseGroup {
  /** رقم واسم المرحلة. */
  key: string;
  ar: string;
  en: string;
  options: ContractPhaseOption[];
}

export const CONTRACT_PHASE_GROUPS: ContractPhaseGroup[] = [
  {
    key: '01', ar: 'ما قبل الترسية', en: 'Pre-Contract',
    options: [
      { value: 'PRE_AWARD', ar: 'ما قبل الترسية', en: 'Pre-Award',
        desc: 'فترة إعداد المناقصة، تقديم العروض، والمفاوضات الفنية والمالية.' },
      { value: 'AWARDED', ar: 'تم الترسية', en: 'Awarded',
        desc: 'صدور خطاب الترسية (Letter of Award) قبل توقيع العقد الرسمي.' },
    ],
  },
  {
    key: '02', ar: 'التعاقد والتنفيذ', en: 'Execution',
    options: [
      { value: 'SIGNING', ar: 'تحت التوقيع', en: 'Signing',
        desc: 'استكمال المستندات النظامية والتأقيت وخطابات الضمان الابتدائية.' },
      { value: 'ACTIVE', ar: 'نافذ / بدأ التنفيذ', en: 'Active / Commenced',
        desc: 'صدور أمر المباشرة (Notice to Proceed) واستلام الموقع فعلياً.' },
    ],
  },
  {
    key: '03', ar: 'التنفيذ', en: 'Implementation',
    options: [
      { value: 'ON_PROGRESS', ar: 'قيد التنفيذ', en: 'On Progress',
        desc: 'الأعمال جارية وفق الجدول الزمني المعتمد وصرف المستخلصات الجارية.' },
      { value: 'SUSPENDED', ar: 'مُعلق — إيقاف مؤقت', en: 'Suspended',
        desc: 'توقف الأعمال لظروف قهريّة، إدارية، أو ماليّة بقرار رسمي.' },
    ],
  },
  {
    key: '04', ar: 'الإنجاز والاستلام', en: 'Closeout & Handover',
    options: [
      { value: 'PRACTICAL_COMPLETION', ar: 'الإنجاز الفعلي', en: 'Practical Completion',
        desc: 'انتهاء كافة الأعمال الأساسية وصلاحية المبنى للاستخدام.' },
      { value: 'INITIAL_HANDOVER', ar: 'الاستلام الابتدائي', en: 'Initial Handover',
        desc: 'توقيع محضر الاستلام الابتدائي وتشكل لجنة الاستلام.' },
    ],
  },
  {
    key: '05', ar: 'ما بعد الاستلام', en: 'Post-Handover',
    options: [
      { value: 'DNP', ar: 'فترة إشعار العيوب', en: 'Defects Notification Period',
        desc: 'فترة الضمان (عادة سنة) لإصلاح أي عيوب ظهرت.' },
    ],
  },
  {
    key: '06', ar: 'الإنهاء', en: 'Finalization',
    options: [
      { value: 'FINAL_HANDOVER', ar: 'الاستلام النهائي', en: 'Final Handover',
        desc: 'توقيع محضر الاستلام النهائي بعد انتهاء فترة الضمان ومعالجة قائمة الملاحظات (Punch List).' },
      { value: 'CLOSED', ar: 'مغلق / منتهي', en: 'Closed / Finished',
        desc: 'الإغلاق المالي والفني النهائي، تحرير ضمان حسن التنفيذ، وصرف الحساب النهائي.' },
    ],
  },
];

/** حالات خارجة عن مسار الدورة التعاقدية — تُعرض في مجموعة منفصلة. */
export const CONTRACT_PHASE_EXCEPTIONS: ContractPhaseOption[] = [
  { value: 'TERMINATED', ar: 'فسخ العقد', en: 'Terminated',
    desc: 'فسخ العقد قبل إتمامه لخلل بالالتزامات.' },
  { value: 'LIQUIDATED', ar: 'تصفية / حصر الأعمال', en: 'Liquidated',
    desc: 'التصفية أو حصر الأعمال بعد الإلغاء.' },
];

export function isContractPhaseException(value: string): boolean {
  return CONTRACT_PHASE_EXCEPTIONS.some(x => x.value === value);
}

export function contractPhaseOption(value?: string): ContractPhaseOption | null {
  if (!value) return null;
  for (const g of CONTRACT_PHASE_GROUPS) {
    const hit = g.options.find(o => o.value === value);
    if (hit) return hit;
  }
  return CONTRACT_PHASE_EXCEPTIONS.find(o => o.value === value) ?? null;
}

export function contractPhaseGroupOf(value?: string): ContractPhaseGroup | null {
  if (!value) return null;
  return CONTRACT_PHASE_GROUPS.find(g => g.options.some(o => o.value === value)) ?? null;
}
