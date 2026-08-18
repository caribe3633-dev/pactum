# PACTUM — Enterprise Contract Intelligence 🏗️

منصة إدارة العقود والمشاريع الهندسية والإنشائية على مستوى المؤسسات — ثنائية اللغة (عربي/English) بدعم كامل للاتجاه RTL.

An enterprise construction & contract management platform — bilingual (Arabic/English) with full RTL support.

---

## ⚡ التشغيل | Getting Started

```bash
npm install       # تثبيت المكتبات (مرة واحدة)
npm run dev       # تشغيل نسخة التطوير → http://localhost:4173
```

**بناء نسخة الإنتاج | Production build:**

```bash
npm run build     # يبني في dist/public
npm run preview   # معاينة نسخة الإنتاج
npm run typecheck # فحص الأنواع بدون بناء
```

## 🔑 بيانات الدخول التجريبية | Demo Credentials

| الدور | المستخدم | كلمة السر |
|---|---|---|
| أدمن كامل | `admin` | `123456789` |
| مشاهدة فقط | `viewer` | `viewer123` |

> ⚠️ تسجيل الدخول تجريبي (client-side) والبيانات كلها في localStorage — مناسبة للنموذج، مش أمان إنتاج.

## 🧱 التقنيات | Tech Stack

React 18 · TypeScript · Vite 5 · Tailwind CSS 4 · shadcn/ui (Radix) · wouter · Recharts · i18n مدمج (AR/EN + RTL)

## 📁 الهيكل | Structure

```
src/
├── components/
│   ├── modules/      # موديولات المشروع (Overview, CashFlow, Budget, EVM,
│   │                 #  Delay, Changes, Claims, Risk, Certs, Subs,
│   │                 #  Timeline, Baseline, Reports)
│   ├── reporting/    # أزرار وقوائم التقارير
│   └── ui/           # 48 مكون shadcn/ui
├── features/
│   └── company-management/   # إدارة الشركات (مودرن — feature-scoped)
├── lib/
│   ├── reporting/    # محرك التقارير: تصدير Excel / Word / PowerPoint (OOXML)
│   ├── certification/# بيانات الاعتمادات الهندسية
│   └── *.ts          # منطق الأعمال: EVM، تدفقات، تأخيرات، عملات، بورتفوليو...
├── pages/            # كل الصفحات (Bortfolio ← شركة ← قطاع ← مشروع)
├── mock/             # بيانات أولية (شركات/قطاعات)
└── store.ts + i18n.ts + data.ts
```

## 🗺️ خريطة التنقل | Navigation Map

```
/enterprise-portfolio  ← الصفحة الرئيسية (بورتفوليو المؤسسة)
   ├── /enterprise-portfolio/analytics
   ├── /enterprise-portfolio/intelligence
├── /company/:id              ← شركة → قطاعات
│   ├── /company/:id/analytics
│   ├── /company/:id/subcontractors
│   └── /company/:id/currency
├── /sector/:id               ← قطاع
├── /project/:id              ← لوحة المشروع (14 موديول)
└── /login, /about, /admin, /archive
```

---

*تم تنظيف المشروع من مخلفات الترحيل من Replit: إزالة اعتماديات `catalog:` و`@workspace` والـ plugins الخاصة بـ Replit، وحذف الملفات الميتة، وتحويل الإعدادات لتعمل standalone بـ npm فقط.*

## 🧪 الاختبارات والتحقق | Tests & Verification

```bash
npm test           # 29 اختبار ذهبي (golden master) بحماية المعادلات
npm run verify     # البوابة الكاملة: typecheck + tests + build
```

الاختبارات الذهبية بتسجل المخرجات الحالية للمعادلات الأساسية (EVM، نوافذ التأخير،
التدفقات النقدية، الحسابات التجارية للمقاولين، تنسيق العملات) — أي تعديل مستقبلي
يغيّر رقمًا واحدًا بيوقف الدنيا فورًا. دي شبكة الأمان لأي ريفاكتور قادم.
