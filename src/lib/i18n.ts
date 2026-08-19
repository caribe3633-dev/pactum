import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Language = 'en' | 'ar';

// â”€â”€ Translation tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const T = {
  en: {
    // General
    login: 'Log In', logout: 'Log Out', username: 'Username', password: 'Password',
    welcome: 'Welcome back', portal: 'Project Portal', about: 'About',
    admin: 'Admin Console', projects: 'Projects', openProject: 'Open Project',
    addProject: 'Add Project', delete: 'Delete', cancel: 'Cancel', save: 'Save',
    add: 'Add', edit: 'Edit', status: 'Status', actions: 'Actions',
    noData: 'No data available', backToPortal: 'Back to Portal', clickToEdit: 'Click to edit',
    // Portal
    projectCode: 'Project Code', projectName: 'Project Name', projectCountry: 'Project Country', city: 'City',
    contractValue: 'Contract Value', progress: 'Progress', delay: 'Delay', days: 'days',
    // Sidebar tabs
    overview: 'Overview', cashFlow: 'Cash Flow', budget: 'Budget',
    earnedValue: 'Earned Value', delayAnalysis: 'Delay Analysis',
    changeOrders: 'Change Orders', claims: 'Claims', riskRegister: 'Risk Register',
    ownerCertificates: 'Owner Certificates', subcontractors: 'Subcontractors',
    // Overview
    originalContractValue: 'Original Contract Value',
    revisedContractValue: 'Contract Amount',
    totalApprovedCO: 'Total Approved COs',
    totalApprovedClaims: 'Total Approved Claims',
    totalCashReceived: 'Total Cash Received',
    totalCashDisbursed: 'Total Cash Disbursed',
    contractualCompletion: 'Contractual Completion Date',
    approvedCompletion: 'Approved Completion Date',
    actualProgress: 'Actual Progress', currentDelay: 'Current Delay',
    executiveSummary: 'Executive Summary',
    // Cash Flow
    cashFlowProjection: 'Cash Flow Projection', monthlyLedger: 'Monthly Ledger',
    month: 'Month', cashIn: 'Cash In', cashOut: 'Cash Out', net: 'Net', cumulative: 'Cumulative',
    // Budget
    category: 'Category', planned: 'Planned', actual: 'Actual',
    forecast: 'Forecast', variance: 'Variance', budgetAnalysis: 'Budget Analysis',
    // EVM
    spi: 'SPI', cpi: 'CPI', evmAnalysis: 'Earned Value Analysis', simulation: 'Simulation', sCurve: 'S-Curve',
    // Change Orders
    changeOrderLog: 'Change Order Log', totalApprovedCOsValue: 'Total Approved COs',
    underReviewValue: 'Under Review', coNo: 'CO No.', description: 'Description',
    value: 'Value', timeImpact: 'Time Impact', timeImpactDays: 'Time Impact (Days)',
    // Claims
    claimsRegister: 'Claims Register', totalClaimedValue: 'Total Claimed Value',
    totalSettledValue: 'Total Settled Value', claimNo: 'Claim No.',
    claimType: 'Type / Description', valueClaimed: 'Value Claimed',
    valueSettled: 'Value Settled', timeEOT: 'Time (Days) — EOT', timeEOTShort: 'EOT (Days)',
    // Risk
    riskId: 'Risk ID', cause: 'Cause', event: 'Event', effect: 'Effect',
    probability: 'Probability', impact: 'Impact', expectedValue: 'Expected Value',
    owner: 'Owner', response: 'Response', severity: 'Severity',
    totalExposure: 'Total Risk Exposure', riskBudget: 'Risk Budget',
    // Certs
    ipcTitle: 'Interim Payment Certificates (IPC)',
    totalCertifiedValue: 'Total Certified Value', totalRetentionHeld: 'Total Retention Held',
    certNo: 'Cert No.', period: 'Period', certSubmissionDate: 'Submission Date', grossAmount: 'Gross',
    retention: 'Retention', netPayable: 'Net Payable',
    approvalDate: 'Approval Date', paymentDate: 'Payment Date', docs: 'Docs',
    // Subs
    trade: 'Trade Specialty', plannedVsActual: 'Planned vs Actual',
    subCerts: 'Sub Certificates', addSubcontractor: 'Add Subcontractor',
    // Delay
    delayDetails: 'Delay Details', plannedFinish: 'Planned Finish',
    forecastFinish: 'Forecast Finish', eotClaimed: 'EOT Claimed (Days)',
    eotApproved: 'EOT Approved (Days)', criticalDelay: 'Critical Path Delay (Days)',
    // Admin
    role: 'Role', users: 'Users', addUser: 'Add User',
    // Statuses
    submitted: 'Submitted', underReview: 'Under Review', approved: 'Approved',
    rejected: 'Rejected', certified: 'Certified', paid: 'Paid',
    onTrack: 'On Track', delayed: 'Delayed',
    // Nav
    switchToArabic: 'العربية', switchToEnglish: 'English',
    projectNav: 'Project Navigation',
  },
  ar: {
    login: 'تسجيل الدخول', logout: 'تسجيل الخروج', username: 'اسم المستخدم',
    password: 'كلمة المرور', welcome: 'مرحباً بعودتك', portal: 'بوابة المشاريع',
    about: 'نبذة عني', admin: 'لوحة الإدارة', projects: 'المشاريع',
    openProject: 'فتح المشروع', addProject: 'إضافة مشروع', delete: 'حذف',
    cancel: 'إلغاء', save: 'حفظ', add: 'إضافة', edit: 'تعديل',
    status: 'الحالة', actions: 'إجراءات', noData: 'لا توجد بيانات',
    backToPortal: 'العودة للبوابة', clickToEdit: 'انقر للتعديل',
    projectCode: 'رمز المشروع', projectName: 'اسم المشروع', projectCountry: 'بلد المشروع', city: 'المدينة',
    contractValue: 'قيمة العقد', progress: 'الإنجاز', delay: 'التأخير', days: 'يوم',
    overview: 'نظرة عامة', cashFlow: 'التدفق النقدي', budget: 'الموازنة',
    earnedValue: 'القيمة المكتسبة', delayAnalysis: 'تحليل التأخير',
    changeOrders: 'أوامر التغيير', claims: 'المطالبات', riskRegister: 'سجل المخاطر',
    ownerCertificates: 'مستخلصات المالك', subcontractors: 'مقاولو الباطن',
    originalContractValue: 'قيمة العقد الأصلية',
    revisedContractValue: 'إجمالي قيمة العقد',
    totalApprovedCO: 'إجمالي أوامر التغيير المعتمدة',
    totalApprovedClaims: 'إجمالي المطالبات المعتمدة',
    totalCashReceived: 'إجمالي النقد المستلم',
    totalCashDisbursed: 'إجمالي النقد المصروف',
    contractualCompletion: 'تاريخ الإنجاز التعاقدي',
    approvedCompletion: 'تاريخ الإنجاز المعتمد',
    actualProgress: 'نسبة الإنجاز الفعلية', currentDelay: 'التأخير الحالي',
    executiveSummary: 'الملخص التنفيذي',
    cashFlowProjection: 'مخطط التدفق النقدي', monthlyLedger: 'الدفتر الشهري',
    month: 'الشهر', cashIn: 'نقد وارد', cashOut: 'نقد صادر',
    net: 'الصافي', cumulative: 'التراكمي',
    category: 'البند', planned: 'المخطط', actual: 'الفعلي',
    forecast: 'التوقع', variance: 'الفارق', budgetAnalysis: 'تحليل الموازنة',
    spi: 'مؤشر أداء الجدول', cpi: 'مؤشر أداء التكلفة',
    evmAnalysis: 'تحليل القيمة المكتسبة', simulation: 'محاكاة', sCurve: 'المنحنى S',
    changeOrderLog: 'سجل أوامر التغيير',
    totalApprovedCOsValue: 'إجمالي أوامر التغيير المعتمدة',
    underReviewValue: 'قيد المراجعة', coNo: 'رقم الأمر', description: 'الوصف',
    value: 'القيمة', timeImpact: 'التأثير الزمني', timeImpactDays: 'التأثير الزمني (يوم)',
    claimsRegister: 'سجل المطالبات', totalClaimedValue: 'إجمالي المطالب به',
    totalSettledValue: 'إجمالي المسوّى', claimNo: 'رقم المطالبة',
    claimType: 'النوع / الوصف', valueClaimed: 'المبلغ المطالب به',
    valueSettled: 'المبلغ المسوّى',
    timeEOT: 'الوقت (أيام) — تمديد مدة', timeEOTShort: 'تمديد (يوم)',
    riskId: 'رقم الخطر', cause: 'السبب', event: 'الحدث', effect: 'الأثر',
    probability: 'الاحتمالية', impact: 'الأثر المالي', expectedValue: 'القيمة المتوقعة',
    owner: 'المسؤول', response: 'الاستجابة', severity: 'الخطورة',
    totalExposure: 'إجمالي التعرض للمخاطر', riskBudget: 'ميزانية المخاطر',
    ipcTitle: 'مستخلصات المالك (IPC)',
    totalCertifiedValue: 'إجمالي القيمة المعتمدة',
    totalRetentionHeld: 'إجمالي الضمان المحتجز',
    certNo: 'رقم المستخلص', period: 'الفترة', certSubmissionDate: 'تاريخ التقديم', grossAmount: 'الإجمالي',
    retention: 'الضمان', netPayable: 'الصافي المستحق',
    approvalDate: 'تاريخ الاعتماد', paymentDate: 'تاريخ الدفع', docs: 'المرفقات',
    trade: 'التخصص', plannedVsActual: 'المخطط مقابل الفعلي',
    subCerts: 'المستخلصات الفرعية', addSubcontractor: 'إضافة مقاول باطن',
    delayDetails: 'تفاصيل التأخير', plannedFinish: 'تاريخ الإنجاز المخطط',
    forecastFinish: 'تاريخ الإنجاز المتوقع',
    eotClaimed: 'مدة التمديد المطالب بها (يوم)',
    eotApproved: 'مدة التمديد المعتمدة (يوم)',
    criticalDelay: 'التأخير على المسار الحرج (يوم)',
    role: 'الصلاحية', users: 'المستخدمون', addUser: 'إضافة مستخدم',
    submitted: 'مقدم', underReview: 'قيد المراجعة', approved: 'معتمد',
    rejected: 'مرفوض', certified: 'معتمد (مستخلص)', paid: 'مدفوع',
    onTrack: 'في الموعد', delayed: 'متأخر',
    switchToArabic: 'العربية', switchToEnglish: 'English',
    projectNav: 'تنقل المشروع',
  },
};

export type TranslationKey = keyof typeof T['en'];
export type Translations = typeof T['en'];

// â”€â”€ Context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface LangCtx {
  lang: Language;
  setLang: (l: Language) => void;
  t: Translations;
}

const LanguageContext = createContext<LangCtx | null>(null);

function applyLang(lang: Language) {
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  document.documentElement.classList.add('dark');
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    return (localStorage.getItem('pactum-lang') as Language) || 'en';
  });

  useEffect(() => { applyLang(lang); }, [lang]);

  const setLang = (l: Language) => {
    localStorage.setItem('pactum-lang', l);
    applyLang(l);
    setLangState(l);
  };

  return React.createElement(
    LanguageContext.Provider,
    { value: { lang, setLang, t: T[lang] } },
    children
  );
}

// â”€â”€ Hook (reads from context — single source of truth) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    // Fallback outside provider (login page etc.)
    const lang: Language = (localStorage.getItem('pactum-lang') as Language) || 'en';
    return { lang, setLang: (_: Language) => {}, t: T[lang] };
  }
  return ctx;
}
