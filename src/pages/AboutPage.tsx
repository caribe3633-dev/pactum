import React from 'react';
import { useTranslation } from '../lib/i18n';
import profileAvatar from '../assets/profile-avatar.jpg';

export default function AboutPage() {
  const { lang } = useTranslation();

  const kpis = [
    { value: '16+', labelEn: 'Years of Experience', labelAr: 'سنوات من الخبرة' },
    { value: '200+', labelEn: 'Contracts Managed', labelAr: 'عقد تمت إدارته' },
    { value: '95%', labelEn: 'Claim Success Rate', labelAr: 'نسبة نجاح المطالبات' },
    { value: '3B+', labelEn: 'SAR Managed Portfolio', labelAr: 'ريال حجم المحافظ المدارة' },
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

  const competenciesEn = ['FIDIC Contracts', 'Claims Management', 'Commercial Cost Control', 'Contract Lifecycle Management', 'EVM Analysis', 'Risk Management', 'Subcontractor Management', 'Delay Analysis', 'Schedule Management', 'Variation Orders', 'Interim Payment Certificates', 'Final Account Negotiation'];
  const competenciesAr = ['عقود فيديك', 'إدارة المطالبات', 'التحكم في التكاليف', 'إدارة دورة حياة العقود', 'تحليل القيمة المكتسبة', 'إدارة المخاطر', 'إدارة مقاولي الباطن', 'تحليل التأخيرات', 'إدارة الجدول الزمني', 'أوامر التغيير', 'المستخلصات الدورية', 'تسوية الحساب الختامي'];

  const expertise = lang === 'en' ? expertiseEn : expertiseAr;
  const competencies = lang === 'en' ? competenciesEn : competenciesAr;

  return (
    <div className="pg pg-stack z-10">

      {/* Hero section */}
      <div className="relative flex flex-col lg:flex-row min-h-[60vh]">
        {/* Portrait */}
        <div className="lg:w-[40%] relative overflow-hidden flex-shrink-0 min-h-[50vh] lg:min-h-full">
          <img
            src={profileAvatar}
            alt="Executive Portrait"
            className="absolute inset-0 w-full h-full object-cover object-top grayscale hover:grayscale-0 transition-all duration-700"
            style={{ filter: 'grayscale(0.3) contrast(1.1)' }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#0A0A0B] opacity-80 hidden lg:block" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0B] via-transparent to-transparent opacity-60" />

          {/* Corner ticks on portrait */}
          <div className="absolute top-6 left-6 w-10 h-10 border-t-2 border-l-2 border-primary/60" />
          <div className="absolute bottom-6 right-6 w-10 h-10 border-b-2 border-r-2 border-primary/60" />
        </div>

        {/* Identity panel */}
        <div className="lg:w-[60%] flex flex-col justify-center px-8 py-12 lg:px-16 lg:py-20 relative bg-[#0A0A0B]">
          {/* Gold rule */}
          <div className="flex items-center gap-4 mb-8">
            <div className="h-[1px] w-16 bg-primary/60" />
            <span className="text-(length:--t-label) uppercase tracking-[0.3em] text-primary/60 font-mono">PACTUM — Executive Profile</span>
          </div>

          <h1 className="text-5xl lg:text-6xl font-serif font-bold text-white mb-3 leading-none">
            {lang === 'ar' ? 'المهندس أحمد' : 'Eng. Ahmad'}
          </h1>
          <p className="text-primary text-base uppercase tracking-[0.2em] font-medium mb-2">
            {lang === 'ar' ? 'مدير العقود والشؤون التجارية' : 'Senior Contracts & Commercial Manager'}
          </p>
          <p className="text-muted-foreground text-sm mb-10 font-mono">
            {lang === 'ar' ? 'المملكة العربية السعودية · مصر' : 'Saudi Arabia · Egypt · 16+ Years'}
          </p>

          {/* Summary */}
          <div className="border-s-2 border-primary/40 ps-6 mb-10">
            {lang === 'en' ? (
              <p className="font-serif text-lg text-foreground/80 leading-relaxed">
                Contracts & Commercial Manager with 16+ years of progressive experience in large-scale construction and real estate projects across Saudi Arabia and Egypt. Specialised in full contract lifecycle management, FIDIC contract administration, claims and dispute resolution, and commercial cost control — with a proven track record of managing multi-billion SAR portfolios and delivering significant cost recoveries.
              </p>
            ) : (
              <p className="font-serif text-lg text-foreground/80 leading-relaxed">
                مدير عقود وتجاري بخبرة تزيد على ١٦ عامًا في مشاريع البناء والعقارات الكبرى بالمملكة العربية السعودية ومصر. متخصص في إدارة دورة حياة العقود الكاملة، وإدارة عقود فيديك، وتسوية المطالبات والنزاعات، والتحكم في التكاليف التجارية — مع سجل حافل في إدارة محافظ بمليارات الريالات.
              </p>
            )}
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpis.map((kpi, i) => (
              <div key={i} className="bg-black/50 border border-primary/20 p-4 text-center hover:border-primary/50 transition-colors" style={{ boxShadow: '0 0 20px rgba(212,175,90,0.05)' }}>
                <div className="text-2xl font-mono text-primary mb-1 number-ltr">{kpi.value}</div>
                <div className="text-(length:--t-label) uppercase tracking-wider text-muted-foreground leading-tight">
                  {lang === 'en' ? kpi.labelEn : kpi.labelAr}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Areas of Expertise */}
      <div className="px-8 py-12 lg:px-16">
        <div className="flex items-center gap-6 mb-8">
          <h2 className="font-serif text-2xl text-white whitespace-nowrap">
            {lang === 'en' ? 'Areas of Expertise' : 'مجالات الخبرة'}
          </h2>
          <div className="h-[1px] flex-1 bg-white/5" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {expertise.map((item, i) => (
            <div key={i} className="pactum-card bg-black/20 p-5 hover:bg-black/40 transition-colors">
              <div className="w-5 h-5 border border-primary/40 rotate-45 mb-4 flex-shrink-0" />
              <h3 className="font-serif text-white mb-1.5 text-base">{item.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Core Competencies */}
      <div className="px-8 pb-12 lg:px-16">
        <div className="flex items-center gap-6 mb-6">
          <h2 className="font-serif text-2xl text-white whitespace-nowrap">
            {lang === 'en' ? 'Core Competencies' : 'الكفاءات الأساسية'}
          </h2>
          <div className="h-[1px] flex-1 bg-white/5" />
        </div>
        <div className="flex flex-wrap gap-2">
          {competencies.map((c, i) => (
            <span key={i} className="px-4 py-2 border border-white/10 bg-black/20 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors cursor-default">
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* Professional Summary */}
      <div className="px-8 pb-16 lg:px-16">
        <div className="border border-white/5 p-8 relative overflow-hidden bg-black/10">
          <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'linear-gradient(rgba(212,175,90,1) 1px,transparent 1px),linear-gradient(90deg,rgba(212,175,90,1) 1px,transparent 1px)', backgroundSize: '20px 20px' }} />
          <h3 className="font-serif text-primary text-lg mb-4 relative z-10">
            {lang === 'en' ? 'Professional Summary' : 'الملخص المهني'}
          </h3>
          <div className="space-y-4 relative z-10">
            {lang === 'en' ? (
              <>
                <p className="font-serif text-muted-foreground leading-relaxed">
                  Experienced in leading multidisciplinary commercial teams and coordinating with consultants, legal teams, quantity surveyors, and government stakeholders. Has successfully administered contracts under FIDIC Conditions of Contract (Red Book, Yellow Book) across major infrastructure and building projects throughout KSA and Egypt.
                </p>
                <p className="font-serif text-muted-foreground leading-relaxed">
                  Demonstrated ability to identify, prepare, and negotiate complex contractual claims, resulting in significant financial recoveries. Expertise spans quantification of delay and disruption claims, preparation of expert reports, and representation in dispute resolution proceedings.
                </p>
              </>
            ) : (
              <>
                <p className="font-serif text-muted-foreground leading-relaxed">
                  يمتلك خبرة واسعة في قيادة الفرق التجارية متعددة التخصصات والتنسيق مع الاستشاريين والفرق القانونية ومهندسي الكميات والجهات الحكومية. أدار بنجاح عقوداً وفق شروط عقود فيديك عبر مشاريع البنية التحتية والمباني الكبرى في المملكة العربية السعودية ومصر.
                </p>
                <p className="font-serif text-muted-foreground leading-relaxed">
                  يُثبت قدرة موثوقة على تحديد المطالبات التعاقدية المعقدة وإعدادها والتفاوض عليها، مما أسفر عن استردادات مالية ضخمة. تشمل خبرته تحديد مطالبات التأخير والإعاقة، وإعداد التقارير الخبرة، والتمثيل في إجراءات تسوية النزاعات.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
