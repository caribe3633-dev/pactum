import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../lib/i18n';
import profileAvatar from '../assets/profile-avatar.jpg';
import PactumLogo from '../components/PactumLogo';
import {
  Phone, Mail, MessageCircle, Calendar, MapPin, Clock,
  ChevronDown, ChevronRight, Shield, FileText, Lightbulb,
  HelpCircle, HeadphonesIcon, BookOpen, Bug, Star, Send,
  CheckCircle2, AlertCircle, Building2, Globe2, Award,
  Lock, Eye, Server, Zap, Cpu
} from 'lucide-react';
import { cn } from '../lib/utils';

// ── Micro-animation hook ──────────────────────────────────────────────
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// ── Animated counter ──────────────────────────────────────────────────
function Counter({ value, suffix = '' }: { value: string; suffix?: string }) {
  const { ref, visible } = useReveal();
  const [display, setDisplay] = useState('0');
  useEffect(() => {
    if (!visible) return;
    const numMatch = value.match(/[\d.]+/);
    if (!numMatch) { setDisplay(value); return; }
    const target = parseFloat(numMatch[0]);
    const isDecimal = value.includes('.');
    const prefix = value.replace(/[\d.]+.*/, '');
    const sfx = value.replace(/^[\d.]+/, '');
    let start = 0;
    const duration = 1400;
    const startTime = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * target;
      setDisplay(prefix + (isDecimal ? current.toFixed(1) : Math.floor(current).toString()) + sfx);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [visible, value]);
  return <span ref={ref}>{display}{suffix}</span>;
}

// ── Gold divider ──────────────────────────────────────────────────────
function GoldDivider() {
  return (
    <div className="flex items-center gap-3 my-8" aria-hidden="true">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/30" />
      <div className="w-1.5 h-1.5 bg-primary/60 rotate-45" />
      <div className="w-1 h-1 bg-primary/30 rotate-45" />
      <div className="w-1.5 h-1.5 bg-primary/60 rotate-45" />
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/30" />
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────
function SectionHeader({ en, ar, lang }: { en: string; ar: string; lang: string }) {
  return (
    <div className="flex items-center gap-4 mb-6">
      <div className="h-px w-8 bg-primary/60 flex-shrink-0" aria-hidden="true" />
      <h2 className="font-serif text-2xl text-white whitespace-nowrap">
        {lang === 'en' ? en : ar}
      </h2>
      <div className="h-px flex-1 bg-white/5" aria-hidden="true" />
    </div>
  );
}

// ── Tab definitions ───────────────────────────────────────────────────
const TABS = [
  { id: 'about',   en: 'About',   ar: 'عن الشركة', icon: Building2 },
  { id: 'contact', en: 'Contact', ar: 'تواصل معنا', icon: Phone },
  { id: 'support', en: 'Support', ar: 'الدعم',      icon: HeadphonesIcon },
  { id: 'faq',     en: 'FAQ',     ar: 'الأسئلة الشائعة', icon: HelpCircle },
  { id: 'legal',   en: 'Trust & Legal', ar: 'الثقة والقانون', icon: Shield },
];

// ── FAQ data ──────────────────────────────────────────────────────────
const FAQ_DATA = [
  {
    q_en: 'What is PACTUM and who is it for?',
    a_en: 'PACTUM is a next-generation enterprise contract intelligence platform purpose-built for owners, contractors, project management consultants, and legal teams managing high-value infrastructure, real estate, and government contracts across Saudi Arabia and the wider GCC region.',
    q_ar: 'ما هو PACTUM ولمن هو مصمم؟',
    a_ar: 'PACTUM منصة ذكاء عقدي من الجيل القادم، مصممة خصيصاً للملاك والمقاولين واستشاريي إدارة المشاريع والفرق القانونية التي تدير عقوداً عالية القيمة في قطاعات البنية التحتية والعقارات والمشاريع الحكومية عبر المملكة العربية السعودية ومنطقة الخليج.',
  },
  {
    q_en: 'Which contract standards does PACTUM support?',
    a_en: 'PACTUM natively supports FIDIC Red, Yellow, and Silver Books, NEC3/NEC4, and Saudi government contract conditions. The platform is extensible to accommodate custom contractual frameworks used by NEOM, PIF, Saudi Aramco, and other sovereign entities.',
    q_ar: 'ما معايير العقود التي يدعمها PACTUM؟',
    a_ar: 'يدعم PACTUM بشكل أصلي عقود FIDIC الأحمر والأصفر والفضي، وعقود NEC3/NEC4، وشروط العقود الحكومية السعودية. المنصة قابلة للتوسع لاستيعاب الأطر التعاقدية المخصصة المستخدمة في NEOM وصندوق الاستثمارات العامة وأرامكو السعودية.',
  },
  {
    q_en: 'How does PACTUM handle data security and privacy?',
    a_en: 'All data is encrypted at rest (AES-256) and in transit (TLS 1.3). PACTUM is compliant with the Saudi Personal Data Protection Law (PDPL), GDPR principles, and ISO 27001 security standards. No client data is ever shared with third parties.',
    q_ar: 'كيف تتعامل PACTUM مع أمن البيانات والخصوصية؟',
    a_ar: 'جميع البيانات مشفرة أثناء التخزين (AES-256) وأثناء النقل (TLS 1.3). يتوافق PACTUM مع نظام حماية البيانات الشخصية السعودي (PDPL) ومبادئ اللائحة الأوروبية (GDPR) ومعايير أمن ISO 27001. لا تُشارك بيانات العملاء مع أي طرف ثالث.',
  },
  {
    q_en: 'Can PACTUM integrate with our existing ERP or project controls software?',
    a_en: 'Yes. PACTUM offers REST API integration with leading ERP platforms (SAP, Oracle, Microsoft Dynamics), Primavera P6, Microsoft Project, and custom data sources. Enterprise integration packages are available with dedicated onboarding support.',
    q_ar: 'هل يمكن لـ PACTUM التكامل مع برامج ERP الحالية لدينا؟',
    a_ar: 'نعم. يوفر PACTUM تكاملاً عبر REST API مع منصات ERP الرائدة (SAP، Oracle، Microsoft Dynamics) وPrimavera P6 وMicrosoft Project ومصادر بيانات مخصصة. تتوفر حزم تكامل المؤسسات مع دعم متخصص للإعداد.',
  },
  {
    q_en: 'What training and support options are available?',
    a_en: 'PACTUM offers on-site training workshops, live remote onboarding sessions, a comprehensive knowledge base, dedicated technical support via WhatsApp and email, and quarterly webinars. Enterprise clients receive a named account manager and priority SLA.',
    q_ar: 'ما خيارات التدريب والدعم المتاحة؟',
    a_ar: 'يقدم PACTUM ورش تدريب ميدانية وجلسات تأهيل مباشرة عن بُعد وقاعدة معرفة شاملة ودعم تقني مخصص عبر واتساب والبريد الإلكتروني وندوات ربع سنوية. يحصل عملاء المؤسسات على مدير حساب مخصص واتفاقية مستوى خدمة ذات أولوية.',
  },
  {
    q_en: 'Is PACTUM available in Arabic?',
    a_en: 'Yes. PACTUM is fully bilingual (Arabic and English) with complete RTL layout support, Arabic-optimized typography using IBM Plex Sans Arabic and Amiri, and localized content across all modules.',
    q_ar: 'هل PACTUM متاح باللغة العربية؟',
    a_ar: 'نعم. PACTUM ثنائي اللغة بالكامل (العربية والإنجليزية) مع دعم كامل لتخطيط RTL وطباعة محسّنة للعربية باستخدام IBM Plex Sans Arabic وAmiri، ومحتوى مترجم عبر جميع الوحدات.',
  },
  {
    q_en: 'How are claims and disputes handled on the platform?',
    a_en: 'PACTUM\'s Claims Intelligence Engine allows teams to log, categorize, value, and track contractual claims from initial identification through negotiation to resolution. The platform generates structured claim reports compliant with FIDIC and NEC dispute adjudication requirements.',
    q_ar: 'كيف تُعالج المطالبات والنزاعات على المنصة؟',
    a_ar: 'يتيح محرك ذكاء المطالبات في PACTUM للفرق تسجيل المطالبات التعاقدية وتصنيفها وتقييمها وتتبعها من التحديد الأولي وحتى التسوية. تُنشئ المنصة تقارير مطالبات منظمة متوافقة مع متطلبات تحكيم النزاعات FIDIC وNEC.',
  },
  {
    q_en: 'What does enterprise pricing look like?',
    a_en: 'PACTUM uses a project-value-based licensing model for enterprise clients. Pricing is structured around active contract portfolio value, number of modules, and concurrent users. Contact us directly for a tailored commercial proposal.',
    q_ar: 'كيف تبدو أسعار المؤسسات؟',
    a_ar: 'يستخدم PACTUM نموذج ترخيص قائم على قيمة المشروع لعملاء المؤسسات. يُهيكل التسعير حول قيمة محفظة العقود النشطة وعدد الوحدات والمستخدمين المتزامنين. تواصل معنا مباشرة للحصول على عرض تجاري مخصص.',
  },
];

// ── Release notes data ────────────────────────────────────────────────
const RELEASES = [
  { version: '3.2.0', date: 'July 2026', badge: 'Latest', badgeAr: 'الأحدث',
    items_en: ['Claims Intelligence Engine v2 — AI-assisted claim valuation', 'Full RTL layout audit and typography refinement across all modules', 'Company section redesign with live support channels', 'Earned Value S-Curve export to PDF and Excel'],
    items_ar: ['محرك ذكاء المطالبات v2 — تقييم المطالبات بمساعدة الذكاء الاصطناعي', 'مراجعة كاملة لتخطيط RTL وتحسين الطباعة عبر جميع الوحدات', 'إعادة تصميم قسم الشركة مع قنوات دعم مباشر', 'تصدير منحنى S للقيمة المكتسبة إلى PDF وExcel'],
  },
  { version: '3.1.0', date: 'May 2026', badge: 'Stable', badgeAr: 'مستقر',
    items_en: ['Sub-contractor performance scoring dashboard', 'Multi-user concurrent editing with conflict resolution', 'FIDIC Silver Book template library', 'Bilingual PDF report generation'],
    items_ar: ['لوحة تسجيل أداء مقاولي الباطن', 'تحرير متزامن متعدد المستخدمين مع حل التعارض', 'مكتبة قوالب FIDIC الفضي', 'توليد تقارير PDF ثنائية اللغة'],
  },
  { version: '3.0.0', date: 'February 2026', badge: 'Major', badgeAr: 'رئيسي',
    items_en: ['Complete platform redesign — obsidian + gold design language', 'EVM module with SPI/CPI forecasting and simulation', 'Risk Register with Monte Carlo exposure analysis', 'Admin Console and granular per-project permissions'],
    items_ar: ['إعادة تصميم كاملة للمنصة — لغة تصميم السواد والذهب', 'وحدة القيمة المكتسبة مع توقع وتحليل SPI/CPI', 'سجل المخاطر مع تحليل التعرض بطريقة مونت كارلو', 'لوحة الإدارة والصلاحيات التفصيلية لكل مشروع'],
  },
];

// ── Main component ────────────────────────────────────────────────────
export default function CompanyPage() {
  const { lang } = useTranslation();
  const [activeTab, setActiveTab] = useState('about');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [contactForm, setContactForm] = useState({
    name: '', company: '', jobTitle: '', country: '', email: '',
    phone: '', projectType: '', subject: '', message: '',
  });
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({
    type: 'suggestion', priority: 'medium', subject: '', description: '', name: '',
  });
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackHistory, setFeedbackHistory] = useState<any[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('pactum-feedback');
    if (stored) setFeedbackHistory(JSON.parse(stored));
  }, []);

  const submitContact = (e: React.FormEvent) => {
    e.preventDefault();
    const entry = { ...contactForm, ts: Date.now() };
    const prev = JSON.parse(localStorage.getItem('pactum-contact-submissions') || '[]');
    localStorage.setItem('pactum-contact-submissions', JSON.stringify([entry, ...prev]));
    setContactSubmitted(true);
  };

  const submitFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    const entry = {
      id: Date.now().toString(),
      ...feedbackForm,
      status: 'submitted',
      ts: Date.now(),
    };
    const prev = JSON.parse(localStorage.getItem('pactum-feedback') || '[]');
    const next = [entry, ...prev];
    localStorage.setItem('pactum-feedback', JSON.stringify(next));
    setFeedbackHistory(next);
    setFeedbackSubmitted(true);
    setTimeout(() => {
      setFeedbackSubmitted(false);
      setFeedbackForm({ type: 'suggestion', priority: 'medium', subject: '', description: '', name: '' });
    }, 3000);
  };

  // KPI data
  const kpis = [
    { value: '16+', labelEn: 'Years of Experience', labelAr: 'سنوات الخبرة' },
    { value: '200+', labelEn: 'Contracts Managed', labelAr: 'عقد مُدار' },
    { value: '95%', labelEn: 'Claim Success Rate', labelAr: 'نسبة نجاح المطالبات' },
    { value: '3B+', labelEn: 'SAR Portfolio Managed', labelAr: 'ريال حجم المحافظ' },
  ];

  const expertiseEn = [
    { title: 'FIDIC Contract Administration', desc: 'NEC3, FIDIC Red, Yellow & Silver Books' },
    { title: 'Claims & Dispute Resolution', desc: 'EOT, Prolongation, Loss of Productivity' },
    { title: 'Commercial Cost Control', desc: 'Budget management, cost forecasting, CVR' },
    { title: 'Contract Lifecycle Management', desc: 'Procurement through final account' },
    { title: 'Earned Value Management', desc: 'SPI, CPI, EAC, EVM analysis & reporting' },
    { title: 'Risk Management', desc: 'Quantitative risk analysis, mitigation strategy' },
  ];
  const expertiseAr = [
    { title: 'إدارة عقود فيديك', desc: 'عقود NEC3، FIDIC الأحمر والأصفر والفضي' },
    { title: 'تسوية المطالبات والنزاعات', desc: 'تمديد الوقت، التطويل، فقدان الإنتاجية' },
    { title: 'التحكم في التكاليف التجارية', desc: 'إدارة الميزانية، توقع التكاليف، CVR' },
    { title: 'إدارة دورة حياة العقود', desc: 'من المشتريات حتى الحساب الختامي' },
    { title: 'تحليل القيمة المكتسبة', desc: 'SPI، CPI، EAC، تحليل EVM وتقاريره' },
    { title: 'إدارة المخاطر', desc: 'التحليل الكمي للمخاطر، استراتيجية التخفيف' },
  ];
  const competenciesEn = [
    'FIDIC Contracts', 'Claims Management', 'Commercial Cost Control',
    'Contract Lifecycle Management', 'EVM Analysis', 'Risk Management',
    'Subcontractor Management', 'Delay Analysis', 'Schedule Management',
    'Variation Orders', 'Interim Payment Certificates', 'Final Account Negotiation',
  ];
  const competenciesAr = [
    'عقود فيديك', 'إدارة المطالبات', 'التحكم في التكاليف',
    'إدارة دورة حياة العقود', 'تحليل القيمة المكتسبة', 'إدارة المخاطر',
    'إدارة مقاولي الباطن', 'تحليل التأخيرات', 'إدارة الجدول الزمني',
    'أوامر التغيير', 'المستخلصات الدورية', 'تسوية الحساب الختامي',
  ];
  const expertise = lang === 'en' ? expertiseEn : expertiseAr;
  const competencies = lang === 'en' ? competenciesEn : competenciesAr;

  const projectTypes = lang === 'en'
    ? ['Infrastructure', 'Real Estate & Development', 'Government / Public Sector', 'Industrial & Energy', 'Healthcare & Education', 'Mixed-Use & Urban', 'Other']
    : ['البنية التحتية', 'العقارات والتطوير', 'القطاع الحكومي', 'الصناعة والطاقة', 'الرعاية الصحية والتعليم', 'متعدد الاستخدامات وحضري', 'أخرى'];

  const feedbackTypes = lang === 'en'
    ? [
        { value: 'suggestion', label: 'Suggestion', icon: Lightbulb },
        { value: 'ui-improvement', label: 'UI Improvement', icon: Star },
        { value: 'bug-report', label: 'Bug Report', icon: Bug },
        { value: 'training-request', label: 'Training Request', icon: BookOpen },
        { value: 'feature-request', label: 'Feature Request', icon: Zap },
      ]
    : [
        { value: 'suggestion', label: 'اقتراح', icon: Lightbulb },
        { value: 'ui-improvement', label: 'تحسين الواجهة', icon: Star },
        { value: 'bug-report', label: 'تقرير خطأ', icon: Bug },
        { value: 'training-request', label: 'طلب تدريب', icon: BookOpen },
        { value: 'feature-request', label: 'طلب ميزة', icon: Zap },
      ];

  const statusColors: Record<string, string> = {
    submitted:   'text-chart-5 border-chart-5/30 bg-chart-5/10',
    'in-review': 'text-primary border-primary/30 bg-primary/10',
    resolved:    'text-chart-4 border-chart-4/30 bg-chart-4/10',
  };
  const statusLabels: Record<string, { en: string; ar: string }> = {
    submitted:   { en: 'Submitted',  ar: 'مقدم' },
    'in-review': { en: 'In Review',  ar: 'قيد المراجعة' },
    resolved:    { en: 'Resolved',   ar: 'تم الحل' },
  };

  const inputCls = 'w-full bg-black/30 border border-white/10 px-4 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-primary/50 transition-colors';

  return (
    <div className="min-h-full w-full" dir={lang === 'ar' ? 'rtl' : 'ltr'}>

      {/* ── Page hero strip ── */}
      <div className="relative overflow-hidden bg-black/20 border-b border-white/5 px-6 md:px-12 py-10">
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{ backgroundImage: 'linear-gradient(rgba(179,138,61,1) 1px,transparent 1px),linear-gradient(90deg,rgba(179,138,61,1) 1px,transparent 1px)', backgroundSize: '32px 32px' }}
          aria-hidden="true"
        />
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" aria-hidden="true" />

        <div className="relative z-10 w-full">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-10 bg-primary/60" aria-hidden="true" />
            <span className="text-(length:--t-label) uppercase tracking-[0.3em] text-primary/60 font-mono">PACTUM</span>
          </div>
          <h1 className="font-serif text-3xl md:text-5xl text-white mb-2">
            {lang === 'en' ? 'Company' : 'الشركة'}
          </h1>
          <p className="text-sm text-white/40 max-w-xl" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
            {lang === 'en'
              ? 'Enterprise contract intelligence — built for Saudi Arabia\'s most demanding projects.'
              : 'ذكاء عقدي للمؤسسات — مصمم لأكثر مشاريع المملكة العربية السعودية صرامةً.'}
          </p>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="sticky top-0 z-30 bg-[#0A0A0B]/95 backdrop-blur border-b border-white/[0.06]" role="tablist" aria-label={lang === 'ar' ? 'أقسام الشركة' : 'Company sections'}>
        <div className="w-full px-6 xl:px-8 2xl:px-10 flex overflow-x-auto gap-0 scrollbar-hide">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                aria-controls={`panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 md:px-5 py-3.5 text-xs font-medium uppercase tracking-wider whitespace-nowrap transition-all border-b-2 flex-shrink-0',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-white/35 hover:text-white/70 hover:bg-white/[0.03]'
                )}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                {lang === 'en' ? tab.en : tab.ar}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab panels ── */}
      <div className="w-full px-6 xl:px-8 2xl:px-10 pb-24">

        {/* ════════ ABOUT / FOUNDER ════════ */}
        {activeTab === 'about' && (
          <div id="panel-about" role="tabpanel" aria-labelledby="tab-about">
            {/* Hero layout */}
            <div className="relative flex flex-col lg:flex-row min-h-[58vh] -mx-4 md:-mx-8 lg:-mx-12 mb-0">
              {/* Portrait */}
              <div className="lg:w-[38%] relative overflow-hidden flex-shrink-0 min-h-[52vw] lg:min-h-full">
                <img
                  src={profileAvatar}
                  alt={lang === 'en' ? 'Mohammed Mohsen — Founder & CEO of PACTUM' : 'محمد محسن — مؤسس والرئيس التنفيذي لشركة PACTUM'}
                  className="absolute inset-0 w-full h-full object-cover object-top transition-all duration-700"
                  style={{ filter: 'grayscale(0.2) contrast(1.08)' }}
                  loading="eager"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#0A0A0B] opacity-80 hidden lg:block" aria-hidden="true" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0B] via-transparent to-transparent opacity-70" aria-hidden="true" />
                <div className="absolute top-6 start-6 w-10 h-10 border-t-2 border-s-2 border-primary/50" aria-hidden="true" />
                <div className="absolute bottom-6 end-6 w-10 h-10 border-b-2 border-e-2 border-primary/50" aria-hidden="true" />
              </div>

              {/* Identity */}
              <div className="lg:w-[62%] flex flex-col justify-center px-6 py-10 lg:px-14 lg:py-20 bg-[#0A0A0B]">
                <div className="flex items-center gap-4 mb-6">
                  <div className="h-px w-12 bg-primary/60" aria-hidden="true" />
                  <span className="text-(length:--t-label) uppercase tracking-[0.3em] text-primary/60 font-mono">
                    {lang === 'en' ? 'Founder & CEO' : 'المؤسس والرئيس التنفيذي'}
                  </span>
                </div>

                <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-white mb-3 leading-tight">
                  {lang === 'en' ? 'Mohammed\nMohsen' : 'محمد محسن'}
                </h2>
                <p className="text-primary/80 text-sm uppercase tracking-[0.2em] mb-6 font-mono">
                  PACTUM{lang === 'en' ? ' — Enterprise Contract Intelligence' : ' — ذكاء عقدي للمؤسسات'}
                </p>

                <p className="text-white/50 text-sm leading-relaxed mb-8 max-w-md" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                  {lang === 'en'
                    ? 'With over 16 years of experience across Saudi Arabia and Egypt, Mohammed Mohsen has administered multi-billion riyal infrastructure portfolios under FIDIC, NEC3, and Saudi government contract conditions — founding PACTUM to bring precision intelligence to the region\'s most demanding commercial environments.'
                    : 'بخبرة تمتد لأكثر من 16 عاماً في المملكة العربية السعودية ومصر، أدار محمد محسن محافظ بنية تحتية بمليارات الريالات وفق شروط FIDIC وNEC3 والعقود الحكومية السعودية — فأسس PACTUM لإحضار الدقة الاستخباراتية إلى أشد بيئات المنطقة تطلباً تجارياً.'}
                </p>

                {/* KPI counters */}
                <div className="grid grid-cols-2 gap-px bg-white/5 border border-white/5" role="list" aria-label={lang === 'ar' ? 'مؤشرات الأداء' : 'Key metrics'}>
                  {kpis.map((kpi, i) => (
                    <div key={i} className="bg-[#0A0A0B] px-5 py-4 text-center" role="listitem">
                      <div className="font-serif text-3xl text-primary mb-1 tabular-nums" aria-label={`${kpi.value} ${lang === 'en' ? kpi.labelEn : kpi.labelAr}`}>
                        <Counter value={kpi.value} />
                      </div>
                      <div className="text-(length:--t-label) uppercase tracking-wider text-white/45" aria-hidden="true">
                        {lang === 'en' ? kpi.labelEn : kpi.labelAr}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Body sections */}
            <div className="pt-12 space-y-12">

              <Reveal>
                <SectionHeader en="Areas of Expertise" ar="مجالات الخبرة" lang={lang} />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.04]" role="list">
                  {expertise.map((item, i) => (
                    <Reveal key={i} delay={i * 60}>
                      <div
                        className="bg-[#0A0A0B] p-5 border border-white/[0.04] hover:border-primary/20 transition-colors group"
                        role="listitem"
                      >
                        <div className="w-1.5 h-1.5 bg-primary/60 rotate-45 mb-3 group-hover:bg-primary transition-colors" aria-hidden="true" />
                        <h3 className="font-serif text-white text-base mb-1 leading-snug">{item.title}</h3>
                        <p className="text-(length:--t-body) text-white/35" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>{item.desc}</p>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </Reveal>

              <GoldDivider />

              <Reveal>
                <SectionHeader en="Core Competencies" ar="الكفاءات الأساسية" lang={lang} />
                <div className="flex flex-wrap gap-2" role="list" aria-label={lang === 'ar' ? 'الكفاءات الأساسية' : 'Core competencies'}>
                  {competencies.map((c, i) => (
                    <Reveal key={i} delay={i * 30}>
                      <span
                        role="listitem"
                        className="px-4 py-2 border border-white/10 bg-black/20 text-xs text-white/50 hover:border-primary/40 hover:text-primary/80 transition-colors cursor-default select-none"
                        style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}
                      >
                        {c}
                      </span>
                    </Reveal>
                  ))}
                </div>
              </Reveal>

              <GoldDivider />

              <Reveal>
                <SectionHeader en="Professional Summary" ar="الملخص المهني" lang={lang} />
                <div className="relative overflow-hidden border border-white/[0.06] p-8 bg-black/10">
                  <div
                    className="absolute inset-0 opacity-[0.025]"
                    style={{ backgroundImage: 'linear-gradient(rgba(179,138,61,1) 1px,transparent 1px),linear-gradient(90deg,rgba(179,138,61,1) 1px,transparent 1px)', backgroundSize: '20px 20px' }}
                    aria-hidden="true"
                  />
                  <div className="relative z-10 space-y-4">
                    {lang === 'en' ? (
                      <>
                        <p className="font-serif text-white/60 leading-relaxed text-sm">
                          Experienced in leading multidisciplinary commercial teams and coordinating with consultants, legal teams, quantity surveyors, and government stakeholders. Has successfully administered contracts under FIDIC Conditions of Contract (Red Book, Yellow Book) across major infrastructure and building projects throughout KSA and Egypt.
                        </p>
                        <p className="font-serif text-white/60 leading-relaxed text-sm">
                          Demonstrated ability to identify, prepare, and negotiate complex contractual claims — resulting in significant financial recoveries. Expertise spans quantification of delay and disruption claims, preparation of expert reports, and representation in dispute resolution proceedings.
                        </p>
                        <p className="font-serif text-white/60 leading-relaxed text-sm">
                          Founded PACTUM to deliver enterprise-grade contract intelligence to Saudi Arabia, the GCC, and international markets — empowering project owners, contractors, and advisors with precision tools built for FIDIC-governed, high-value contracts.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-white/60 leading-relaxed text-sm" style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
                          يمتلك خبرة واسعة في قيادة الفرق التجارية متعددة التخصصات والتنسيق مع الاستشاريين والفرق القانونية ومهندسي الكميات والجهات الحكومية. أدار بنجاح عقوداً وفق شروط عقود فيديك عبر مشاريع البنية التحتية والمباني الكبرى في المملكة العربية السعودية ومصر.
                        </p>
                        <p className="text-white/60 leading-relaxed text-sm" style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
                          يُثبت قدرة موثوقة على تحديد المطالبات التعاقدية المعقدة وإعدادها والتفاوض عليها مما أسفر عن استردادات مالية كبيرة. تشمل خبرته تحديد مطالبات التأخير والإعاقة وإعداد التقارير الخبرة والتمثيل في إجراءات تسوية النزاعات.
                        </p>
                        <p className="text-white/60 leading-relaxed text-sm" style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
                          أسّس PACTUM لتقديم ذكاء عقدي بمستوى المؤسسات للمملكة العربية السعودية ودول الخليج والأسواق الدولية — مزوداً أصحاب المشاريع والمقاولين والمستشارين بأدوات دقيقة مصممة للعقود عالية القيمة الخاضعة لأحكام FIDIC.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </Reveal>

              {/* Trust markers */}
              <Reveal>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
                  {[
                    { icon: Building2, en: 'Government Trusted', ar: 'موثوق حكومياً' },
                    { icon: Globe2, en: 'KSA & GCC', ar: 'السعودية والخليج' },
                    { icon: Award, en: 'FIDIC Certified', ar: 'معتمد FIDIC' },
                    { icon: Shield, en: 'ISO 27001', ar: 'ISO 27001' },
                  ].map((m, i) => (
                    <Reveal key={i} delay={i * 80}>
                      <div className="flex flex-col items-center gap-2 py-5 border border-white/[0.06] bg-black/10 hover:border-primary/20 transition-colors">
                        <m.icon className="w-5 h-5 text-primary/60" aria-hidden="true" />
                        <span className="text-(length:--t-label) uppercase tracking-wider text-white/40 text-center" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                          {lang === 'en' ? m.en : m.ar}
                        </span>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        )}

        {/* ════════ CONTACT ════════ */}
        {activeTab === 'contact' && (
          <div id="panel-contact" role="tabpanel" aria-labelledby="tab-contact" className="pt-10 space-y-12">

            {/* Executive contact card */}
            <Reveal>
              <SectionHeader en="Executive Contact" ar="التواصل التنفيذي" lang={lang} />
              <div className="relative overflow-hidden border border-white/[0.08] bg-black/20">
                <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'linear-gradient(rgba(179,138,61,1) 1px,transparent 1px),linear-gradient(90deg,rgba(179,138,61,1) 1px,transparent 1px)', backgroundSize: '24px 24px' }} aria-hidden="true" />
                <div className="relative z-10 flex flex-col md:flex-row gap-0">
                  {/* Identity column */}
                  <div className="md:w-72 lg:w-80 p-8 border-b md:border-b-0 md:border-e border-white/[0.06] flex flex-col gap-4">
                    <div className="w-16 h-16 bg-primary/[0.06] border border-primary/20 flex items-center justify-center">
                      <PactumLogo variant="icon" size={38} />
                    </div>
                    <div>
                      <h3 className="font-serif text-xl text-white mb-0.5">
                        {lang === 'en' ? 'Mohammed Mohsen' : 'محمد محسن'}
                      </h3>
                      <p className="text-xs text-primary/70 uppercase tracking-wider">
                        {lang === 'en' ? 'Founder & Chief Executive Officer' : 'المؤسس والرئيس التنفيذي'}
                      </p>
                      <p className="text-xs text-white/30 mt-1 font-mono">PACTUM Enterprise</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/30">
                      <MapPin className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" aria-hidden="true" />
                      <span style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                        {lang === 'en' ? 'Kingdom of Saudi Arabia' : 'المملكة العربية السعودية'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/30">
                      <Clock className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" aria-hidden="true" />
                      <span style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                        {lang === 'en' ? 'Sun–Thu, 09:00–18:00 AST' : 'الأحد–الخميس، 09:00–18:00 توقيت السعودية'}
                      </span>
                    </div>
                  </div>

                  {/* Contact details + actions */}
                  <div className="flex-1 p-8 flex flex-col gap-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {[
                        { icon: Phone,         label_en: 'Phone',   label_ar: 'الهاتف',             val: '+966 50 583 0523', href: 'tel:+966505830523' },
                        { icon: MessageCircle, label_en: 'WhatsApp',label_ar: 'واتساب',             val: '+966 50 583 0523', href: 'https://wa.me/966505830523' },
                        { icon: Mail,          label_en: 'Email',   label_ar: 'البريد الإلكتروني', val: 'eng_m.mohsen3633@hotmail.com', href: 'mailto:eng_m.mohsen3633@hotmail.com' },
                        { icon: Globe2,        label_en: 'Platform',label_ar: 'المنصة',            val: 'PACTUM Enterprise', href: '#' },
                      ].map((c, i) => (
                        <a
                          key={i}
                          href={c.href}
                          target={c.href.startsWith('http') ? '_blank' : undefined}
                          rel={c.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                          className="flex items-start gap-3 p-4 border border-white/[0.06] bg-black/20 hover:border-primary/30 hover:bg-primary/[0.04] transition-all group"
                          aria-label={`${lang === 'en' ? c.label_en : c.label_ar}: ${c.val}`}
                        >
                          <c.icon className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0 group-hover:text-primary transition-colors" aria-hidden="true" />
                          <div>
                            <div className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-0.5">
                              {lang === 'en' ? c.label_en : c.label_ar}
                            </div>
                            <div className="text-sm text-white/70 font-mono text-xs break-all">{c.val}</div>
                          </div>
                        </a>
                      ))}
                    </div>

                    {/* CTA buttons */}
                    <div className="flex flex-wrap gap-3 pt-2">
                      <a
                        href="tel:+966505830523"
                        className="flex items-center gap-2 px-5 py-2.5 bg-primary text-black text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-colors"
                        aria-label={lang === 'en' ? 'Call Now' : 'اتصل الآن'}
                      >
                        <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                        {lang === 'en' ? 'Call Now' : 'اتصل الآن'}
                      </a>
                      <a
                        href="https://wa.me/966505830523"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-5 py-2.5 border border-primary/40 text-primary text-xs font-bold uppercase tracking-widest hover:bg-primary/10 transition-colors"
                        aria-label={lang === 'en' ? 'WhatsApp' : 'واتساب'}
                      >
                        <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        WhatsApp
                      </a>
                      <a
                        href="mailto:eng_m.mohsen3633@hotmail.com"
                        className="flex items-center gap-2 px-5 py-2.5 border border-white/10 text-white/60 text-xs font-bold uppercase tracking-widest hover:border-primary/30 hover:text-primary/80 transition-colors"
                        aria-label={lang === 'en' ? 'Send Email' : 'إرسال بريد إلكتروني'}
                      >
                        <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                        {lang === 'en' ? 'Email' : 'البريد'}
                      </a>
                      <button
                        onClick={() => setActiveTab('contact')}
                        className="flex items-center gap-2 px-5 py-2.5 border border-white/10 text-white/60 text-xs font-bold uppercase tracking-widest hover:border-primary/30 hover:text-primary/80 transition-colors"
                        aria-label={lang === 'en' ? 'Schedule a Demo' : 'جدولة عرض توضيحي'}
                      >
                        <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                        {lang === 'en' ? 'Schedule Demo' : 'جدولة عرض'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>

            <GoldDivider />

            {/* Professional contact form */}
            <Reveal>
              <SectionHeader en="Professional Inquiry" ar="استفسار مهني" lang={lang} />
              {contactSubmitted ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4 border border-primary/20 bg-primary/[0.04]">
                  <CheckCircle2 className="w-10 h-10 text-primary" aria-hidden="true" />
                  <h3 className="font-serif text-2xl text-white">{lang === 'en' ? 'Inquiry Received' : 'تم استلام الاستفسار'}</h3>
                  <p className="text-sm text-white/40 text-center max-w-sm" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                    {lang === 'en'
                      ? 'Your message has been recorded. We respond to all enterprise inquiries within one business day.'
                      : 'تم تسجيل رسالتك. نرد على جميع استفسارات المؤسسات خلال يوم عمل واحد.'}
                  </p>
                  <button
                    onClick={() => setContactSubmitted(false)}
                    className="mt-2 text-xs uppercase tracking-widest text-primary/60 hover:text-primary transition-colors"
                  >
                    {lang === 'en' ? 'Submit another inquiry' : 'إرسال استفسار آخر'}
                  </button>
                </div>
              ) : (
                <form onSubmit={submitContact} className="border border-white/[0.06] bg-black/10 p-6 md:p-8" noValidate>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    {[
                      { name: 'name',     en: 'Full Name *',             ar: 'الاسم الكامل *',              type: 'text',  required: true },
                      { name: 'company',  en: 'Company / Organization *', ar: 'الشركة / المنظمة *',           type: 'text',  required: true },
                      { name: 'jobTitle', en: 'Job Title',               ar: 'المسمى الوظيفي',              type: 'text',  required: false },
                      { name: 'country',  en: 'Country',                 ar: 'الدولة',                      type: 'text',  required: false },
                      { name: 'email',    en: 'Email Address *',         ar: 'البريد الإلكتروني *',          type: 'email', required: true },
                      { name: 'phone',    en: 'Phone / WhatsApp',        ar: 'الهاتف / واتساب',             type: 'tel',   required: false },
                    ].map((field) => (
                      <div key={field.name}>
                        <label htmlFor={`contact-${field.name}`} className="block text-(length:--t-label) uppercase tracking-wider text-white/45 mb-1.5">
                          {lang === 'en' ? field.en : field.ar}
                        </label>
                        <input
                          id={`contact-${field.name}`}
                          type={field.type}
                          required={field.required}
                          className={inputCls}
                          placeholder={lang === 'en' ? field.en.replace(' *', '') : field.ar.replace(' *', '')}
                          value={(contactForm as any)[field.name]}
                          onChange={e => setContactForm({ ...contactForm, [field.name]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label htmlFor="contact-projectType" className="block text-(length:--t-label) uppercase tracking-wider text-white/45 mb-1.5">
                        {lang === 'en' ? 'Project Type' : 'نوع المشروع'}
                      </label>
                      <select
                        id="contact-projectType"
                        className={cn(inputCls, 'cursor-pointer')}
                        value={contactForm.projectType}
                        onChange={e => setContactForm({ ...contactForm, projectType: e.target.value })}
                      >
                        <option value="" disabled>{lang === 'en' ? 'Select...' : 'اختر...'}</option>
                        {projectTypes.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="contact-subject" className="block text-(length:--t-label) uppercase tracking-wider text-white/45 mb-1.5">
                        {lang === 'en' ? 'Subject *' : 'الموضوع *'}
                      </label>
                      <input
                        id="contact-subject"
                        type="text"
                        required
                        className={inputCls}
                        placeholder={lang === 'en' ? 'Inquiry subject' : 'موضوع الاستفسار'}
                        value={contactForm.subject}
                        onChange={e => setContactForm({ ...contactForm, subject: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="mb-6">
                    <label htmlFor="contact-message" className="block text-(length:--t-label) uppercase tracking-wider text-white/45 mb-1.5">
                      {lang === 'en' ? 'Message *' : 'الرسالة *'}
                    </label>
                    <textarea
                      id="contact-message"
                      required
                      rows={5}
                      className={cn(inputCls, 'resize-none')}
                      placeholder={lang === 'en' ? 'Describe your project and requirements...' : 'اوصف مشروعك ومتطلباتك...'}
                      value={contactForm.message}
                      onChange={e => setContactForm({ ...contactForm, message: e.target.value })}
                    />
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <p className="text-(length:--t-body) text-white/25" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                      {lang === 'en' ? 'All inquiries are treated with strict confidentiality.' : 'تُعامَل جميع الاستفسارات بسرية تامة.'}
                    </p>
                    <button
                      type="submit"
                      className="flex items-center gap-2 px-8 py-3 bg-primary text-black text-xs font-bold uppercase tracking-widest hover:bg-primary/90 active:scale-[0.98] transition-all"
                    >
                      <Send className="w-3.5 h-3.5" aria-hidden="true" />
                      {lang === 'en' ? 'Send Inquiry' : 'إرسال الاستفسار'}
                    </button>
                  </div>
                </form>
              )}
            </Reveal>
          </div>
        )}

        {/* ════════ SUPPORT ════════ */}
        {activeTab === 'support' && (
          <div id="panel-support" role="tabpanel" aria-labelledby="tab-support" className="pt-10 space-y-12">

            <Reveal>
              <SectionHeader en="Support Center" ar="مركز الدعم" lang={lang} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { icon: BookOpen,       en_title: 'Knowledge Base',      ar_title: 'قاعدة المعرفة',       en_desc: 'Browse articles, how-to guides, and best-practice documentation.',       ar_desc: 'تصفح المقالات وأدلة الاستخدام وتوثيق أفضل الممارسات.' },
                  { icon: FileText,       en_title: 'Documentation',       ar_title: 'التوثيق',              en_desc: 'Full API reference, module guides, and integration documentation.',        ar_desc: 'مرجع API الكامل وأدلة الوحدات وتوثيق التكامل.' },
                  { icon: HeadphonesIcon, en_title: 'Technical Support',   ar_title: 'الدعم التقني',         en_desc: 'Connect with our technical team via WhatsApp or email — available Sun–Thu.', ar_desc: 'تواصل مع فريقنا التقني عبر واتساب أو البريد — متاح الأحد إلى الخميس.' },
                  { icon: Award,          en_title: 'Training',            ar_title: 'التدريب',             en_desc: 'On-site workshops, live remote sessions, and self-paced video learning.',   ar_desc: 'ورش عمل ميدانية وجلسات مباشرة عن بُعد وتعلم بالفيديو ذاتي الوتيرة.' },
                  { icon: Bug,            en_title: 'Bug Reports',         ar_title: 'تقارير الأخطاء',       en_desc: 'Report a defect or unexpected behavior with full reproduction steps.',       ar_desc: 'أبلغ عن خلل أو سلوك غير متوقع مع خطوات إعادة الإنتاج الكاملة.' },
                  { icon: Zap,            en_title: 'Feature Requests',    ar_title: 'طلبات الميزات',        en_desc: 'Propose new capabilities — priority requests are reviewed quarterly.',       ar_desc: 'اقترح قدرات جديدة — تُراجع طلبات الأولوية كل ربع سنة.' },
                ].map((card, i) => (
                  <Reveal key={i} delay={i * 60}>
                    <div
                      className="p-6 border border-white/[0.06] bg-black/10 hover:border-primary/25 hover:bg-primary/[0.03] transition-all group cursor-default h-full"
                      role="article"
                    >
                      <card.icon className="w-5 h-5 text-primary/60 mb-4 group-hover:text-primary transition-colors" aria-hidden="true" />
                      <h3 className="font-serif text-white text-base mb-2">{lang === 'en' ? card.en_title : card.ar_title}</h3>
                      <p className="text-xs text-white/35 leading-relaxed" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                        {lang === 'en' ? card.en_desc : card.ar_desc}
                      </p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </Reveal>

            <GoldDivider />

            {/* Suggestions & Feedback */}
            <Reveal>
              <SectionHeader en="Suggestions & Feedback" ar="الاقتراحات والملاحظات" lang={lang} />

              {feedbackSubmitted ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4 border border-primary/20 bg-primary/[0.04]">
                  <CheckCircle2 className="w-10 h-10 text-primary" aria-hidden="true" />
                  <p className="font-serif text-xl text-white">{lang === 'en' ? 'Thank you!' : 'شكراً لك!'}</p>
                  <p className="text-sm text-white/40" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                    {lang === 'en' ? 'Your feedback has been recorded.' : 'تم تسجيل ملاحظاتك.'}
                  </p>
                </div>
              ) : (
                <form onSubmit={submitFeedback} className="border border-white/[0.06] bg-black/10 p-6 md:p-8" noValidate>
                  {/* Type selector */}
                  <div className="mb-6">
                    <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-3" id="feedback-type-label">
                      {lang === 'en' ? 'Feedback Type' : 'نوع الملاحظة'}
                    </p>
                    <div className="flex flex-wrap gap-2" role="group" aria-labelledby="feedback-type-label">
                      {feedbackTypes.map((ft) => {
                        const Icon = ft.icon;
                        const active = feedbackForm.type === ft.value;
                        return (
                          <button
                            key={ft.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setFeedbackForm({ ...feedbackForm, type: ft.value })}
                            className={cn(
                              'flex items-center gap-2 px-4 py-2 text-xs border transition-all',
                              active
                                ? 'border-primary/60 bg-primary/10 text-primary'
                                : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
                            )}
                          >
                            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                            {ft.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label htmlFor="feedback-name" className="block text-(length:--t-label) uppercase tracking-wider text-white/45 mb-1.5">
                        {lang === 'en' ? 'Your Name' : 'اسمك'}
                      </label>
                      <input
                        id="feedback-name"
                        type="text"
                        className={inputCls}
                        placeholder={lang === 'en' ? 'Optional' : 'اختياري'}
                        value={feedbackForm.name}
                        onChange={e => setFeedbackForm({ ...feedbackForm, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor="feedback-priority" className="block text-(length:--t-label) uppercase tracking-wider text-white/45 mb-1.5">
                        {lang === 'en' ? 'Priority' : 'الأولوية'}
                      </label>
                      <select
                        id="feedback-priority"
                        className={cn(inputCls, 'cursor-pointer')}
                        value={feedbackForm.priority}
                        onChange={e => setFeedbackForm({ ...feedbackForm, priority: e.target.value })}
                      >
                        <option value="low">{lang === 'en' ? 'Low' : 'منخفضة'}</option>
                        <option value="medium">{lang === 'en' ? 'Medium' : 'متوسطة'}</option>
                        <option value="high">{lang === 'en' ? 'High' : 'عالية'}</option>
                        <option value="critical">{lang === 'en' ? 'Critical' : 'حرجة'}</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-4">
                    <label htmlFor="feedback-subject" className="block text-(length:--t-label) uppercase tracking-wider text-white/45 mb-1.5">
                      {lang === 'en' ? 'Subject *' : 'الموضوع *'}
                    </label>
                    <input
                      id="feedback-subject"
                      type="text"
                      required
                      className={inputCls}
                      placeholder={lang === 'en' ? 'Brief title for your feedback' : 'عنوان موجز لملاحظتك'}
                      value={feedbackForm.subject}
                      onChange={e => setFeedbackForm({ ...feedbackForm, subject: e.target.value })}
                    />
                  </div>

                  <div className="mb-6">
                    <label htmlFor="feedback-description" className="block text-(length:--t-label) uppercase tracking-wider text-white/45 mb-1.5">
                      {lang === 'en' ? 'Description *' : 'الوصف *'}
                    </label>
                    <textarea
                      id="feedback-description"
                      required
                      rows={4}
                      className={cn(inputCls, 'resize-none')}
                      placeholder={lang === 'en' ? 'Describe your suggestion, issue, or request in detail...' : 'اوصف اقتراحك أو مشكلتك أو طلبك بالتفصيل...'}
                      value={feedbackForm.description}
                      onChange={e => setFeedbackForm({ ...feedbackForm, description: e.target.value })}
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="flex items-center gap-2 px-8 py-3 bg-primary text-black text-xs font-bold uppercase tracking-widest hover:bg-primary/90 active:scale-[0.98] transition-all"
                    >
                      <Send className="w-3.5 h-3.5" aria-hidden="true" />
                      {lang === 'en' ? 'Submit Feedback' : 'إرسال الملاحظة'}
                    </button>
                  </div>
                </form>
              )}

              {/* Feedback history */}
              {feedbackHistory.length > 0 && (
                <div className="mt-8">
                  <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                    {lang === 'en' ? 'Your Submissions' : 'طلباتك المقدمة'}
                  </p>
                  <div className="space-y-2" role="list" aria-label={lang === 'ar' ? 'سجل الملاحظات' : 'Feedback history'}>
                    {feedbackHistory.slice(0, 10).map((fb: any) => (
                      <div key={fb.id} className="flex items-center gap-4 px-4 py-3 border border-white/[0.05] bg-black/10" role="listitem">
                        <span className={cn('text-(length:--t-micro) px-2 py-0.5 border', statusColors[fb.status] ?? 'text-white/40 border-white/10')}>
                          {lang === 'en' ? (statusLabels[fb.status]?.en ?? fb.status) : (statusLabels[fb.status]?.ar ?? fb.status)}
                        </span>
                        <span className="text-sm text-white/60 flex-1 truncate">{fb.subject}</span>
                        <span className="text-(length:--t-data) text-white/45 font-mono whitespace-nowrap">
                          {new Date(fb.ts).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Reveal>
          </div>
        )}

        {/* ════════ FAQ ════════ */}
        {activeTab === 'faq' && (
          <div id="panel-faq" role="tabpanel" aria-labelledby="tab-faq" className="pt-10">
            <Reveal>
              <SectionHeader en="Frequently Asked Questions" ar="الأسئلة الشائعة" lang={lang} />
              <div className="space-y-2" role="list">
                {FAQ_DATA.map((item, i) => {
                  const isOpen = expandedFaq === i;
                  return (
                    <Reveal key={i} delay={i * 40}>
                      <div
                        className="border border-white/[0.06] bg-black/10 hover:border-white/10 transition-colors"
                        role="listitem"
                      >
                        <button
                          id={`faq-btn-${i}`}
                          aria-expanded={isOpen}
                          aria-controls={`faq-panel-${i}`}
                          onClick={() => setExpandedFaq(isOpen ? null : i)}
                          className="w-full flex items-center justify-between gap-4 px-6 py-4 text-start"
                        >
                          <span className="font-serif text-white/80 text-base leading-snug" style={{ fontFamily: lang === 'ar' ? "'Amiri', serif" : undefined }}>
                            {lang === 'en' ? item.q_en : item.q_ar}
                          </span>
                          <span className={cn('flex-shrink-0 text-primary/60 transition-transform duration-300', isOpen && 'rotate-180')} aria-hidden="true">
                            <ChevronDown className="w-4 h-4" />
                          </span>
                        </button>
                        <div
                          id={`faq-panel-${i}`}
                          role="region"
                          aria-labelledby={`faq-btn-${i}`}
                          style={{
                            maxHeight: isOpen ? '600px' : '0',
                            overflow: 'hidden',
                            transition: 'max-height 0.35s ease',
                          }}
                        >
                          <div className="px-6 pb-5 border-t border-white/[0.05]">
                            <p className="text-sm text-white/45 leading-relaxed mt-4" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                              {lang === 'en' ? item.a_en : item.a_ar}
                            </p>
                          </div>
                        </div>
                      </div>
                    </Reveal>
                  );
                })}
              </div>
            </Reveal>

            <Reveal delay={200}>
              <div className="mt-12 p-8 border border-primary/20 bg-primary/[0.04] text-center">
                <HelpCircle className="w-8 h-8 text-primary/60 mx-auto mb-3" aria-hidden="true" />
                <h3 className="font-serif text-white text-lg mb-2">
                  {lang === 'en' ? 'Still have questions?' : 'لا تزال لديك أسئلة؟'}
                </h3>
                <p className="text-sm text-white/40 mb-5" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                  {lang === 'en'
                    ? 'Our team is available Sunday through Thursday, 09:00–18:00 AST.'
                    : 'فريقنا متاح من الأحد إلى الخميس، من 09:00 إلى 18:00 توقيت السعودية.'}
                </p>
                <button
                  onClick={() => setActiveTab('contact')}
                  className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-black text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                  {lang === 'en' ? 'Contact Us' : 'تواصل معنا'}
                </button>
              </div>
            </Reveal>
          </div>
        )}

        {/* ════════ TRUST & LEGAL ════════ */}
        {activeTab === 'legal' && (
          <div id="panel-legal" role="tabpanel" aria-labelledby="tab-legal" className="pt-10 space-y-14">

            {/* Trust Center */}
            <Reveal>
              <SectionHeader en="Trust Center" ar="مركز الثقة" lang={lang} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { icon: Lock,   en_t: 'Data Encryption',    ar_t: 'تشفير البيانات',     en_d: 'AES-256 at rest, TLS 1.3 in transit. End-to-end protection for all contract data.', ar_d: 'AES-256 أثناء التخزين، TLS 1.3 أثناء النقل. حماية شاملة لجميع بيانات العقود.' },
                  { icon: Eye,    en_t: 'Privacy Compliance', ar_t: 'الامتثال للخصوصية', en_d: 'Saudi PDPL, GDPR-aligned principles. No client data shared with third parties. Ever.', ar_d: 'نظام PDPL السعودي، مبادئ متوافقة مع GDPR. لا تُشارك بيانات العملاء مع أطراف ثالثة.' },
                  { icon: Shield, en_t: 'ISO 27001',           ar_t: 'ISO 27001',           en_d: 'Information security management aligned with ISO/IEC 27001 international standards.', ar_d: 'إدارة أمن المعلومات وفق معايير ISO/IEC 27001 الدولية.' },
                  { icon: Server, en_t: 'Data Residency',      ar_t: 'مكان تخزين البيانات', en_d: 'Enterprise clients may elect KSA-only data residency for sovereign compliance.',       ar_d: 'يمكن لعملاء المؤسسات اختيار إقامة البيانات في السعودية فقط للامتثال السيادي.' },
                  { icon: Cpu,    en_t: 'AI Transparency',     ar_t: 'شفافية الذكاء الاصطناعي', en_d: 'All AI-assisted outputs are clearly labelled. Human review is always required for contractual decisions.', ar_d: 'تُوسم جميع المخرجات المدعومة بالذكاء الاصطناعي بوضوح. المراجعة البشرية مطلوبة دائماً للقرارات التعاقدية.' },
                  { icon: Globe2, en_t: 'Uptime Commitment',   ar_t: 'الاتفاقية التشغيلية', en_d: '99.9% monthly uptime SLA for enterprise accounts. Scheduled maintenance outside business hours.', ar_d: 'اتفاقية وقت تشغيل 99.9% شهرياً لحسابات المؤسسات. الصيانة المجدولة خارج ساعات العمل.' },
                ].map((card, i) => (
                  <Reveal key={i} delay={i * 60}>
                    <div className="p-6 border border-white/[0.06] bg-black/10 hover:border-primary/20 transition-all group h-full">
                      <card.icon className="w-5 h-5 text-primary/60 mb-4 group-hover:text-primary transition-colors" aria-hidden="true" />
                      <h3 className="font-serif text-white text-sm mb-2">{lang === 'en' ? card.en_t : card.ar_t}</h3>
                      <p className="text-xs text-white/35 leading-relaxed" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                        {lang === 'en' ? card.en_d : card.ar_d}
                      </p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </Reveal>

            <GoldDivider />

            {/* Release Notes */}
            <Reveal>
              <SectionHeader en="Release Notes" ar="ملاحظات الإصدار" lang={lang} />
              <div className="space-y-4" role="list">
                {RELEASES.map((r, i) => (
                  <Reveal key={i} delay={i * 80}>
                    <div className="border border-white/[0.06] bg-black/10 p-6" role="listitem">
                      <div className="flex flex-wrap items-center gap-3 mb-4">
                        <span className="font-mono text-white text-sm font-semibold">v{r.version}</span>
                        <span className={cn(
                          'text-(length:--t-second) px-2 py-0.5 border uppercase tracking-wider',
                          r.badge === 'Latest' ? 'border-primary/40 text-primary bg-primary/10'
                          : r.badge === 'Major' ? 'border-chart-5/40 text-chart-5 bg-chart-5/10'
                          : 'border-white/15 text-white/40'
                        )}>
                          {lang === 'en' ? r.badge : r.badgeAr}
                        </span>
                        <span className="text-xs text-white/25 font-mono ms-auto">{r.date}</span>
                      </div>
                      <ul className="space-y-1.5" role="list" aria-label={`${lang === 'en' ? 'Changes in' : 'التغييرات في'} v${r.version}`}>
                        {(lang === 'en' ? r.items_en : r.items_ar).map((item, j) => (
                          <li key={j} className="flex items-start gap-3 text-xs text-white/45" role="listitem" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                            <ChevronRight className="w-3.5 h-3.5 text-primary/50 mt-0.5 flex-shrink-0" aria-hidden="true" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Reveal>
                ))}
              </div>
            </Reveal>

            <GoldDivider />

            {/* Intellectual Property */}
            <Reveal>
              <SectionHeader en="Intellectual Property" ar="الملكية الفكرية" lang={lang} />
              <div className="relative overflow-hidden border border-primary/15 bg-black/20 p-8">
                <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'linear-gradient(rgba(179,138,61,1) 1px,transparent 1px),linear-gradient(90deg,rgba(179,138,61,1) 1px,transparent 1px)', backgroundSize: '20px 20px' }} aria-hidden="true" />
                <div className="relative z-10 space-y-6">
                  <div className="flex items-center gap-4 mb-6">
                    <div
                      className="w-14 h-14 border border-primary/30 bg-primary/[0.04] flex items-center justify-center flex-shrink-0"
                      aria-hidden="true"
                    >
                      <PactumLogo variant="icon" size={40} /></div>
                    <div>
                      <p className="font-serif text-primary text-xl tracking-widest">PACTUM®</p>
                      <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mt-0.5">
                        {lang === 'en' ? 'Enterprise Contract Intelligence Platform' : 'منصة ذكاء العقود للمؤسسات'}
                      </p>
                    </div>
                  </div>

                  {lang === 'en' ? (
                    <div className="space-y-3 text-sm text-white/50 leading-relaxed">
                      <p>
                        <strong className="text-white/70">PACTUM®</strong> is proprietary software. All architecture, UI/UX design, workflows, reports, algorithms, branding, and intellectual property belong exclusively to <strong className="text-white/70">Mohammed Mohsen</strong> and PACTUM Enterprise Contract Intelligence Platform.
                      </p>
                      <p>
                        The PACTUM name, document crest symbol, gold-obsidian design language, and all associated product identities are registered trademarks or trade dress protected under applicable Saudi and international law.
                      </p>
                      <p>
                        Unauthorized reproduction, distribution, reverse-engineering, or derivative use of any PACTUM intellectual property is strictly prohibited and will be pursued to the full extent of the law.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm text-white/50 leading-relaxed" style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
                      <p>
                        <strong className="text-white/70">PACTUM®</strong> برنامج مملوك. جميع الهياكل المعمارية وتصميم UI/UX وسير العمل والتقارير والخوارزميات والعلامة التجارية والملكية الفكرية تعود حصراً لـ<strong className="text-white/70"> محمد محسن</strong> ومنصة PACTUM لذكاء العقود للمؤسسات.
                      </p>
                      <p>
                        اسم PACTUM وشعار وثيقة الدقة ولغة التصميم الذهبي والأسود وجميع هويات المنتج المرتبطة بها هي علامات تجارية مسجلة أو هوية تجارية محمية وفق القانون السعودي والدولي المعمول به.
                      </p>
                      <p>
                        يُحظر تماماً إعادة إنتاج أو توزيع أو هندسة عكسية أو الاستخدام المشتق لأي ملكية فكرية تابعة لـ PACTUM، وسيُتابَع بكل ما يكفله القانون.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Reveal>

            {/* Footer / Legal Notice */}
            <Reveal>
              <div className="border-t border-white/[0.06] pt-10">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 border border-primary/30 bg-primary/[0.04] flex items-center justify-center flex-shrink-0" aria-hidden="true">
                      <PactumLogo variant="icon" size={20} />
                    </div>
                    <div>
                      <p className="font-serif text-white text-sm tracking-widest">PACTUM®</p>
                      <p className="text-(length:--t-label) text-white/45 uppercase tracking-wider">Contract Intelligence</p>
                    </div>
                  </div>
                  <div className="text-end">
                    <p className="text-(length:--t-data) text-white/25 font-mono">© 2026 PACTUM. {lang === 'en' ? 'All Rights Reserved.' : 'جميع الحقوق محفوظة.'}</p>
                    <p className="text-(length:--t-second) text-white/45 mt-0.5" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
                      {lang === 'en'
                        ? 'Founded by Mohammed Mohsen · Kingdom of Saudi Arabia'
                        : 'تأسست بواسطة محمد محسن · المملكة العربية السعودية'}
                    </p>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  {[
                    { en: 'Privacy Policy',     ar: 'سياسة الخصوصية' },
                    { en: 'Terms of Use',       ar: 'شروط الاستخدام' },
                    { en: 'Cookie Policy',      ar: 'سياسة الكوكيز' },
                    { en: 'Responsible Disclosure', ar: 'الإفصاح المسؤول' },
                  ].map((l, i) => (
                    <button
                      key={i}
                      className="text-(length:--t-label) text-white/20 hover:text-primary/60 transition-colors py-2 uppercase tracking-wider"
                      style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}
                      aria-label={lang === 'en' ? l.en : l.ar}
                    >
                      {lang === 'en' ? l.en : l.ar}
                    </button>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        )}
      </div>
    </div>
  );
}
