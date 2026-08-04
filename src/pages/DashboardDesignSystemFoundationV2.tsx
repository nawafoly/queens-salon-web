import React, { useState } from "react";
import {
  DashboardConfirmV2,
  DashboardDatePickerV2,
  DashboardDrawerV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardModalV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
  DashboardToastProviderV2,
  useDashboardToastV2,
} from "../components/dashboard-v2";

const palette = [
  { name: "الذهبي", value: "#D9A50B" },
  { name: "الأسود", value: "#05080D" },
  { name: "العنابي", value: "#59041B" },
  { name: "الأخضر", value: "#177348" },
  { name: "رمادي الصفحة", value: "#F2F2F2" },
] as const;

// Dashboard V2 stage 4.3 spacing documentation data
const spacingScale = [
  { token: "space-1", value: "4px", pixels: 4 },
  { token: "space-2", value: "8px", pixels: 8 },
  { token: "space-3", value: "12px", pixels: 12 },
  { token: "space-4", value: "16px", pixels: 16 },
  { token: "space-5", value: "20px", pixels: 20 },
  { token: "space-6", value: "24px", pixels: 24 },
  { token: "space-7", value: "28px", pixels: 28 },
  { token: "space-8", value: "32px", pixels: 32 },
  { token: "space-10", value: "40px", pixels: 40 },
  { token: "space-12", value: "48px", pixels: 48 },
] as const;

const spacingMatrix = [
  { label: "حواف الصفحة", token: "--dsv2-page-padding-inline", desktop: "28px", tablet: "20px", mobile: "12px", use: "المسافة بين المحتوى وحافتي مساحة العمل" },
  { label: "أعلى الصفحة", token: "--dsv2-page-padding-block-start", desktop: "24px", tablet: "20px", mobile: "16px", use: "المسافة قبل رأس الصفحة" },
  { label: "أسفل الصفحة", token: "--dsv2-page-padding-block-end", desktop: "40px", tablet: "32px", mobile: "24px", use: "مساحة نهاية الصفحة بعد آخر قسم" },
  { label: "بين أقسام الصفحة", token: "--dsv2-section-gap", desktop: "24px", tablet: "20px", mobile: "16px", use: "الفاصل الرأسي بين الهيدر والكروت والجداول" },
  { label: "بين الكروت", token: "--dsv2-grid-gap", desktop: "16px", tablet: "16px", mobile: "12px", use: "الفاصل داخل شبكات المؤشرات والمحتوى" },
  { label: "داخل الكرت", token: "--dsv2-card-padding", desktop: "20px", tablet: "20px", mobile: "16px", use: "الحشوة القياسية للكروت والفلاتر" },
  { label: "داخل لوحة كبيرة", token: "--dsv2-panel-padding", desktop: "24px", tablet: "20px", mobile: "16px", use: "النوافذ والأقسام التوثيقية واللوحات المركبة" },
  { label: "رأس الصفحة", token: "--dsv2-page-head-gap", desktop: "20px", tablet: "16px", mobile: "16px", use: "بين عنوان الصفحة والإجراءات" },
  { label: "رأس القسم", token: "--dsv2-section-head-gap", desktop: "16px", tablet: "16px", mobile: "12px", use: "بين عنوان القسم وأدواته" },
  { label: "بين الحقول", token: "--dsv2-field-gap", desktop: "16px", tablet: "16px", mobile: "12px", use: "شبكات النماذج والفلاتر" },
  { label: "بين الأزرار", token: "--dsv2-control-gap", desktop: "12px", tablet: "12px", mobile: "8px", use: "الأزرار والحالات والعناصر الأفقية" },
  { label: "مسافة مدمجة", token: "--dsv2-compact-gap", desktop: "8px", tablet: "8px", mobile: "8px", use: "العنوان والوصف أو الأيقونة والنص" },
] as const;

const previewRows = [
  {
    id: "REV-0812",
    source: "حجز صالون",
    description: "خدمات شعر ومكياج",
    amount: "1,250 ر.س",
    status: "مكتمل",
    statusClass: "dsv2-badge--success",
  },
  {
    id: "REV-0811",
    source: "إضافة يدوية",
    description: "دفعة نقدية",
    amount: "500 ر.س",
    status: "قيد المراجعة",
    statusClass: "dsv2-badge--gold",
  },
  {
    id: "REV-0810",
    source: "تعديل مالي",
    description: "استرجاع جزئي",
    amount: "-120 ر.س",
    status: "مسترجع",
    statusClass: "dsv2-badge--danger",
  },
] as const;

function DashboardDesignSystemV2Preview() {
  const [activeOverlay, setActiveOverlay] = useState<
    "modal" | "confirm" | "drawer" | null
  >(null);
  const { pushToast } = useDashboardToastV2();

  return (
    <main className="dsv2-page dsv2-preview" aria-labelledby="dsv2-preview-title">
      <section className="dsv2-preview__hero">
        <span className="dsv2-preview__eyebrow">مرحلة اعتماد الأساس</span>
        <div className="dsv2-page-head">
          <div>
            <h1 id="dsv2-preview-title" className="dsv2-page-title">
              نظام لوحة مَلِكات V2
            </h1>
            <p className="dsv2-page-subtitle">
              صفحة مستقلة لمراجعة الألوان والكروت والأزرار والحقول والجداول قبل نقل أي صفحة تشغيلية.
            </p>
          </div>
          <div className="dsv2-cluster">
            <span className="dsv2-badge dsv2-badge--success">معزول عن النظام القديم</span>
            <span className="dsv2-badge dsv2-badge--gold">Foundation 1.0</span>
          </div>
        </div>
      </section>

      <section className="dsv2-card dsv2-card--padded">
        <div className="dsv2-section-head">
          <div>
            <h2 className="dsv2-section-title">لوحة الألوان المعتمدة</h2>
            <p className="dsv2-section-caption">
              لكل لون وظيفة ثابتة داخل لوحة الإدارة، وليس استخدامًا زخرفيًا عشوائيًا.
            </p>
          </div>
        </div>

        <div className="dsv2-preview__palette">
          {palette.map((color) => (
            <article className="dsv2-color-swatch" key={color.value}>
              <div
                className="dsv2-color-swatch__color"
                style={{ "--dsv2-swatch-color": color.value } as React.CSSProperties}
              />
              <div className="dsv2-color-swatch__meta">
                <strong>{color.name}</strong>
                <code>{color.value}</code>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="dsv2-card dsv2-card--padded dsv2-spacing-doc" id="dsv2-spacing-system">
        <div className="dsv2-section-head">
          <div>
            <h2 className="dsv2-section-title">نظام المسافات المعتمد</h2>
            <p className="dsv2-section-caption">
              مرجع إلزامي لكل صفحات Dashboard V2. المسافات الخارجية والداخلية تأتي من متغيرات مركزية، لا من أرقام متفرقة داخل ملفات الصفحات.
            </p>
          </div>
          <div className="dsv2-cluster">
            <span className="dsv2-badge dsv2-badge--gold">4px Grid</span>
            <span className="dsv2-badge dsv2-badge--success">Responsive</span>
            <span className="dsv2-badge">Core Token</span>
          </div>
        </div>

        <div className="dsv2-spacing-doc__viewport-grid">
          <article className="dsv2-spacing-viewport">
            <strong>سطح المكتب</strong>
            <span>حواف 28px · أعلى 24px · بين الأقسام 24px · داخل الكرت 20px</span>
            <code>≥ 1200px</code>
          </article>
          <article className="dsv2-spacing-viewport">
            <strong>التابلت واللابتوب</strong>
            <span>حواف 20px · أعلى 20px · بين الأقسام 20px · داخل الكرت 20px</span>
            <code>768px — 1199px</code>
          </article>
          <article className="dsv2-spacing-viewport">
            <strong>الجوال</strong>
            <span>حواف 12px · أعلى 16px · بين الأقسام 16px · داخل الكرت 16px</span>
            <code>≤ 767px</code>
          </article>
        </div>

        <div className="dsv2-spacing-doc__content-grid">
          <article className="dsv2-spacing-scale">
            <h3>المقياس الأساسي</h3>
            <div className="dsv2-spacing-scale__list">
              {spacingScale.map((space) => (
                <div className="dsv2-spacing-scale__item" key={space.token}>
                  <code>{space.token}</code>
                  <span
                    className="dsv2-spacing-scale__bar"
                    style={{ "--dsv2-spacing-px": space.pixels + "px" } as React.CSSProperties}
                    aria-hidden="true"
                  />
                  <span>{space.value}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="dsv2-spacing-anatomy">
            <h3>تشريح مساحة الصفحة</h3>
            <div className="dsv2-spacing-anatomy__frame">
              <span className="dsv2-spacing-anatomy__label dsv2-spacing-anatomy__label--inline">28px حواف</span>
              <span className="dsv2-spacing-anatomy__label dsv2-spacing-anatomy__label--top">24px أعلى</span>
              <div className="dsv2-spacing-anatomy__mock-head" aria-label="رأس الصفحة" />
              <div className="dsv2-spacing-anatomy__mock-section" aria-label="شبكة كروت">
                <span className="dsv2-spacing-anatomy__mock-card" />
                <span className="dsv2-spacing-anatomy__mock-card" />
                <span className="dsv2-spacing-anatomy__mock-card" />
              </div>
            </div>
          </article>
        </div>

        <div className="dsv2-spacing-doc__table-wrap">
          <table className="dsv2-spacing-doc__table">
            <thead>
              <tr>
                <th>المسافة</th>
                <th>المتغير المركزي</th>
                <th>سطح المكتب</th>
                <th>التابلت</th>
                <th>الجوال</th>
                <th>الاستخدام</th>
              </tr>
            </thead>
            <tbody>
              {spacingMatrix.map((row) => (
                <tr key={row.token}>
                  <td><strong>{row.label}</strong></td>
                  <td><code>{row.token}</code></td>
                  <td>{row.desktop}</td>
                  <td>{row.tablet}</td>
                  <td>{row.mobile}</td>
                  <td>{row.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="dsv2-spacing-rules">
          <h3>قواعد إلزامية للصفحات القادمة</h3>
          <ul>
            <li>كل صفحة V2 تستخدم <code>dsv2-page</code> فقط؛ الحواف تأتي تلقائيًا من النظام.</li>
            <li>ممنوع كتابة <code>padding-inline</code> أو <code>margin-inline</code> خاص بالصفحة إلا لاستثناء موثّق.</li>
            <li>شبكات الكروت تستخدم <code>--dsv2-grid-gap</code>، والكروت تستخدم <code>--dsv2-card-padding</code>.</li>
            <li>الفاصل بين أقسام الصفحة يستخدم <code>--dsv2-section-gap</code>، وليس قيمًا عشوائية.</li>
            <li>أي قيمة جديدة يجب أن تكون من مقياس 4px وتُضاف كمتغير مركزي قبل استخدامها.</li>
          </ul>
        </aside>
      </section>

      <section className="dsv2-stack">
        <div>
          <h2 className="dsv2-section-title">كروت المؤشرات المالية</h2>
          <p className="dsv2-section-caption">
            تصميم موحّد بشريط حالة جانبي ودائرة زخرفية خفيفة مستوحاة من المرجع المرفق.
          </p>
        </div>

        <div className="dsv2-grid--metrics">
          <article className="dsv2-metric-card dsv2-metric-card--gold">
            <p className="dsv2-metric-card__label">إجمالي الإيرادات</p>
            <p className="dsv2-metric-card__value">67,345 ر.س</p>
            <p className="dsv2-metric-card__meta">الإجمالي حسب الفترة المحددة</p>
          </article>

          <article className="dsv2-metric-card dsv2-metric-card--success">
            <p className="dsv2-metric-card__label">صافي الربح</p>
            <p className="dsv2-metric-card__value">37,570 ر.س</p>
            <p className="dsv2-metric-card__meta">بعد خصم المصروفات</p>
          </article>

          <article className="dsv2-metric-card dsv2-metric-card--danger">
            <p className="dsv2-metric-card__label">الخسائر والتعديلات</p>
            <p className="dsv2-metric-card__value">-11,800 ر.س</p>
            <p className="dsv2-metric-card__meta">حركة مالية سالبة</p>
          </article>

          <article className="dsv2-metric-card dsv2-metric-card--dark">
            <p className="dsv2-metric-card__label">الرصيد التشغيلي</p>
            <p className="dsv2-metric-card__value">19,030 ر.س</p>
            <p className="dsv2-metric-card__meta">المتاح حاليًا</p>
          </article>
        </div>
      </section>

      <section className="dsv2-grid">
        <article className="dsv2-card dsv2-card--padded dsv2-span-6">
          <div className="dsv2-section-head">
            <div>
              <h2 className="dsv2-section-title">الأزرار والحالات</h2>
              <p className="dsv2-section-caption">أربعة أنواع ثابتة تغطي أغلب استخدامات النظام.</p>
            </div>
          </div>

          <div className="dsv2-stack">
            <div className="dsv2-cluster">
              <button type="button" className="dsv2-btn dsv2-btn--primary">
                إجراء رئيسي
              </button>
              <button type="button" className="dsv2-btn dsv2-btn--accent">
                إجراء ذهبي
              </button>
              <button type="button" className="dsv2-btn dsv2-btn--secondary">
                إجراء ثانوي
              </button>
            </div>

            <div className="dsv2-cluster">
              <button type="button" className="dsv2-btn dsv2-btn--success dsv2-btn--sm">
                اعتماد
              </button>
              <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm">
                إلغاء
              </button>
              <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled>
                غير متاح
              </button>
            </div>

            <hr className="dsv2-divider" />

            <div className="dsv2-cluster">
              <span className="dsv2-badge dsv2-badge--success">مكتمل</span>
              <span className="dsv2-badge dsv2-badge--gold">قيد المراجعة</span>
              <span className="dsv2-badge dsv2-badge--danger">ملغي</span>
              <span className="dsv2-badge">مسودة</span>
            </div>
          </div>
        </article>

        <article className="dsv2-card dsv2-card--padded dsv2-span-6">
          <div className="dsv2-section-head">
            <div>
              <h2 className="dsv2-section-title">الحقول والفلاتر</h2>
              <p className="dsv2-section-caption">حقول نصية وقائمة وتقويم ميلادي موحّد لا يعتمد على واجهة Windows الأصلية.</p>
            </div>
          </div>

          <div className="dsv2-preview__form-grid">
            <DashboardFieldV2 id="dsv2-preview-operation" label="اسم العملية">
              <input
                id="dsv2-preview-operation"
                className="dsv2-input"
                placeholder="اكتب اسم العملية"
              />
            </DashboardFieldV2>

            <DashboardFieldV2 id="dsv2-preview-movement" label="نوع الحركة">
              <DashboardSelectV2
                id="dsv2-preview-movement"
                defaultValue="income"
                options={[
                  { value: "income", label: "إيراد" },
                  { value: "expense", label: "مصروف" },
                  { value: "refund", label: "استرجاع" },
                  { value: "disabled", label: "خيار غير متاح", disabled: true },
                ]}
              />
            </DashboardFieldV2>

            <DashboardFieldV2 id="dsv2-preview-date-from" label="من تاريخ">
              <DashboardDatePickerV2
                id="dsv2-preview-date-from"
                defaultValue="2026-08-01"
                min="2025-01-01"
                max="2027-12-31"
              />
            </DashboardFieldV2>

            <DashboardFieldV2 id="dsv2-preview-date-to" label="إلى تاريخ">
              <DashboardDatePickerV2
                id="dsv2-preview-date-to"
                defaultValue="2026-08-31"
                min="2025-01-01"
                max="2027-12-31"
              />
            </DashboardFieldV2>
          </div>
        </article>
      </section>

      <section className="dsv2-card dsv2-card--padded">
        <div className="dsv2-section-head">
          <div>
            <h2 className="dsv2-section-title">النوافذ المنبثقة واللوحات الجانبية</h2>
            <p className="dsv2-section-caption">
              نظام موحّد للإضافة والتعديل والتأكيد وعرض التفاصيل، مع منع تمرير الخلفية ودعم Esc والجوال.
            </p>
          </div>
          <div className="dsv2-cluster">
            <span className="dsv2-badge dsv2-badge--success">RTL</span>
            <span className="dsv2-badge dsv2-badge--gold">Focus Trap</span>
            <span className="dsv2-badge">Portal</span>
          </div>
        </div>

        <div className="dsv2-preview__overlay-grid">
          <article className="dsv2-preview__overlay-card">
            <span className="dsv2-preview__overlay-icon dsv2-preview__overlay-icon--gold" aria-hidden="true">
              +
            </span>
            <div>
              <h3>نافذة إضافة وتعديل</h3>
              <p>رأس وتذييل ثابتان، محتوى قابل للتمرير، وخمسة أحجام جاهزة.</p>
            </div>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--accent dsv2-btn--sm"
              onClick={() => setActiveOverlay("modal")}
            >
              فتح النافذة
            </button>
          </article>

          <article className="dsv2-preview__overlay-card">
            <span className="dsv2-preview__overlay-icon dsv2-preview__overlay-icon--danger" aria-hidden="true">
              !
            </span>
            <div>
              <h3>تأكيد إجراء حساس</h3>
              <p>رسالة واضحة للحذف والإلغاء والاعتماد مع حالة انتظار آمنة.</p>
            </div>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
              onClick={() => setActiveOverlay("confirm")}
            >
              فتح التأكيد
            </button>
          </article>

          <article className="dsv2-preview__overlay-card">
            <span className="dsv2-preview__overlay-icon dsv2-preview__overlay-icon--success" aria-hidden="true">
              ≡
            </span>
            <div>
              <h3>لوحة تفاصيل جانبية</h3>
              <p>مناسبة لملف العميل أو الحجز أو الموظفة بدون مغادرة الجدول.</p>
            </div>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--success dsv2-btn--sm"
              onClick={() => setActiveOverlay("drawer")}
            >
              فتح التفاصيل
            </button>
          </article>
        </div>
      </section>

      <section className="dsv2-card dsv2-card--padded">
        <div className="dsv2-section-head">
          <div>
            <h2 className="dsv2-section-title">الإشعارات وحالات النظام</h2>
            <p className="dsv2-section-caption">
              رسائل موحّدة للنجاح والخطأ والتنبيه، مع حالات تحميل وفراغ وتعذر استرجاع البيانات.
            </p>
          </div>
          <div className="dsv2-cluster">
            <span className="dsv2-badge dsv2-badge--success">Accessible</span>
            <span className="dsv2-badge dsv2-badge--gold">Auto dismiss</span>
            <span className="dsv2-badge">Reduced motion</span>
          </div>
        </div>

        <div className="dsv2-preview__toast-actions">
          <button
            type="button"
            className="dsv2-btn dsv2-btn--success dsv2-btn--sm"
            onClick={() =>
              pushToast({
                tone: "success",
                title: "تم حفظ الحركة المالية",
                description: "أضيفت الحركة إلى السجل وحدثت المؤشرات بنجاح.",
              })
            }
          >
            إشعار نجاح
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
            onClick={() =>
              pushToast({
                tone: "danger",
                title: "تعذر حفظ التغييرات",
                description: "تحقق من الاتصال ثم أعد المحاولة.",
                action: {
                  label: "إعادة المحاولة",
                  onClick: () => undefined,
                },
              })
            }
          >
            إشعار خطأ
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--accent dsv2-btn--sm"
            onClick={() =>
              pushToast({
                tone: "warning",
                title: "الحركة تحتاج مراجعة",
                description: "المبلغ أكبر من متوسط الحركات اليومية.",
              })
            }
          >
            إشعار تنبيه
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
            onClick={() =>
              pushToast({
                tone: "info",
                title: "تم تحديث البيانات",
                description: "آخر مزامنة: اليوم 01:38 م.",
              })
            }
          >
            إشعار معلومات
          </button>
        </div>

        <div className="dsv2-preview__state-grid">
          <article className="dsv2-preview__loading-state" aria-label="نموذج حالة التحميل">
            <div className="dsv2-preview__loading-head">
              <DashboardSkeletonV2 variant="circle" />
              <div className="dsv2-preview__loading-copy">
                <DashboardSkeletonV2 variant="title" width="72%" />
                <DashboardSkeletonV2 lines={2} />
              </div>
            </div>
            <DashboardSkeletonV2 variant="block" height={92} />
            <div className="dsv2-preview__loading-actions">
              <DashboardSkeletonV2 variant="button" />
              <DashboardSkeletonV2 variant="button" width={86} />
            </div>
            <span className="dsv2-sr-only">جارٍ تحميل البيانات</span>
          </article>

          <DashboardEmptyStateV2
            title="لا توجد حركات في هذه الفترة"
            description="غيّر نطاق التاريخ أو أضف حركة مالية جديدة لبدء عرض البيانات."
            tone="gold"
            action={
              <button
                type="button"
                className="dsv2-btn dsv2-btn--accent dsv2-btn--sm"
                onClick={() => setActiveOverlay("modal")}
              >
                إضافة حركة
              </button>
            }
          />

          <DashboardErrorStateV2
            title="تعذر تحميل البيانات"
            description="لم يستجب خادم التقارير. البيانات الحالية لم تتغير."
            details="ERR-REPORTS-503"
            action={
              <button
                type="button"
                className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                onClick={() =>
                  pushToast({
                    tone: "info",
                    title: "جارٍ إعادة المحاولة",
                    description: "سيتم تحديث القسم عند وصول الاستجابة.",
                  })
                }
              >
                إعادة المحاولة
              </button>
            }
          />
        </div>
      </section>

      <section className="dsv2-table-card">
        <div className="dsv2-card--padded">
          <div className="dsv2-section-head">
            <div>
              <h2 className="dsv2-section-title">نموذج جدول موحّد</h2>
              <p className="dsv2-section-caption">مرجع لاحق لجداول الإيرادات والمصروفات والتقارير.</p>
            </div>
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm">
              تصدير Excel
            </button>
          </div>
        </div>

        <div className="dsv2-table-scroll">
          <table className="dsv2-table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>المصدر</th>
                <th>الوصف</th>
                <th>المبلغ</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.id}>
                  <td className="dsv2-table__primary">{row.id}</td>
                  <td>{row.source}</td>
                  <td>
                    <span className="dsv2-table__primary">{row.description}</span>
                    <span className="dsv2-table__secondary">03 أغسطس 2026</span>
                  </td>
                  <td>{row.amount}</td>
                  <td>
                    <span className={`dsv2-badge ${row.statusClass}`}>{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <DashboardModalV2
        open={activeOverlay === "modal"}
        onClose={() => setActiveOverlay(null)}
        title="إضافة حركة مالية"
        description="سجّل البيانات الأساسية للحركة. الحقول والقوائم تستخدم مكوّنات Dashboard V2 نفسها."
        eyebrow="نموذج تشغيلي"
        size="md"
        tone="gold"
        footer={
          <>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              data-dsv2-autofocus="true"
              onClick={() => setActiveOverlay(null)}
            >
              حفظ الحركة
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={() => setActiveOverlay(null)}
            >
              إلغاء
            </button>
          </>
        }
      >
        <div className="dsv2-preview__modal-form">
          <DashboardFieldV2 id="dsv2-modal-description" label="وصف الحركة" required>
            <input
              id="dsv2-modal-description"
              className="dsv2-input"
              placeholder="مثال: دفعة خدمات يومية"
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="dsv2-modal-type" label="نوع الحركة" required>
            <DashboardSelectV2
              id="dsv2-modal-type"
              defaultValue="income"
              options={[
                { value: "income", label: "إيراد" },
                { value: "expense", label: "مصروف" },
                { value: "refund", label: "استرجاع" },
              ]}
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="dsv2-modal-amount" label="المبلغ" required>
            <input
              id="dsv2-modal-amount"
              className="dsv2-input"
              inputMode="decimal"
              placeholder="0.00 ر.س"
              dir="ltr"
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="dsv2-modal-date" label="تاريخ الحركة" required>
            <DashboardDatePickerV2
              id="dsv2-modal-date"
              defaultValue="2026-08-03"
              min="2025-01-01"
              max="2027-12-31"
            />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="dsv2-modal-notes"
            label="ملاحظات"
            hint="اختياري — تظهر الملاحظة في سجل الحركة فقط."
            className="dsv2-preview__modal-form-wide"
          >
            <textarea
              id="dsv2-modal-notes"
              className="dsv2-textarea"
              placeholder="أضف أي تفاصيل لازمة للمراجعة..."
            />
          </DashboardFieldV2>
        </div>
      </DashboardModalV2>

      <DashboardConfirmV2
        open={activeOverlay === "confirm"}
        onClose={() => setActiveOverlay(null)}
        onConfirm={() => setActiveOverlay(null)}
        title="حذف الحركة المالية؟"
        description="لن تظهر هذه الحركة في التقارير بعد الحذف، ولا يمكن التراجع عن العملية من هذه الشاشة."
        tone="danger"
        confirmLabel="نعم، احذف الحركة"
        cancelLabel="تراجع"
      >
        <strong>REV-0810 — استرجاع جزئي بقيمة 120 ر.س</strong>
      </DashboardConfirmV2>

      <DashboardDrawerV2
        open={activeOverlay === "drawer"}
        onClose={() => setActiveOverlay(null)}
        title="تفاصيل الحركة المالية"
        description="عرض سريع للتفاصيل وسجل الحالة بدون مغادرة الصفحة الحالية."
        eyebrow="REV-0812"
        size="md"
        side="end"
        tone="success"
        footer={
          <>
            <button type="button" className="dsv2-btn dsv2-btn--primary">
              تعديل الحركة
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={() => setActiveOverlay(null)}
            >
              إغلاق
            </button>
          </>
        }
      >
        <div className="dsv2-preview__drawer-content">
          <article className="dsv2-preview__drawer-amount">
            <span>المبلغ المسجل</span>
            <strong>1,250 ر.س</strong>
            <small>إيراد مكتمل</small>
          </article>

          <dl className="dsv2-preview__details-list">
            <div>
              <dt>المصدر</dt>
              <dd>حجز صالون</dd>
            </div>
            <div>
              <dt>الوصف</dt>
              <dd>خدمات شعر ومكياج</dd>
            </div>
            <div>
              <dt>التاريخ</dt>
              <dd>03 أغسطس 2026</dd>
            </div>
            <div>
              <dt>طريقة الدفع</dt>
              <dd>مدى</dd>
            </div>
            <div>
              <dt>الحالة</dt>
              <dd><span className="dsv2-badge dsv2-badge--success">مكتمل</span></dd>
            </div>
          </dl>

          <div className="dsv2-preview__drawer-note">
            <strong>ملاحظة المراجعة</strong>
            <p>تمت مطابقة المبلغ مع الحجز وإغلاق الحركة ضمن إيرادات اليوم.</p>
          </div>
        </div>
      </DashboardDrawerV2>
    </main>
  );
}

export default function DashboardDesignSystemV2() {
  return (
    <DashboardToastProviderV2 position="top-start">
      <DashboardDesignSystemV2Preview />
    </DashboardToastProviderV2>
  );
}
