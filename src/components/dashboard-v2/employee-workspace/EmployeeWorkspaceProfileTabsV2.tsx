import { useMemo, useState } from "react";
import {
  DashboardFieldV2,
  DashboardSelectV2,
} from "../index";
import type { EmployeeWorkspaceTabProps } from "./types";
import {
  WorkspaceCardV2,
  WorkspaceChoicePillsV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStateShowcaseV2,
  WorkspaceStatusBadgeV2,
  WorkspaceSwitchV2,
  WorkspaceTabHeaderV2,
} from "./EmployeeWorkspacePrimitivesV2";

const SERVICE_CATALOG = [
  { id: "srv-1", name: "قص أطراف الشعر", category: "الشعر", duration: "30 دقيقة", price: "75 ر.س" },
  { id: "srv-2", name: "استشوار قصير", category: "الشعر", duration: "40 دقيقة", price: "85 ر.س" },
  { id: "srv-3", name: "صبغة جذور", category: "الصبغات", duration: "90 دقيقة", price: "220 ر.س" },
  { id: "srv-4", name: "مكياج مناسبات", category: "المكياج", duration: "60 دقيقة", price: "300 ر.س" },
  { id: "srv-5", name: "تنظيف أظافر", category: "الأظافر", duration: "35 دقيقة", price: "70 ر.س" },
  { id: "srv-6", name: "بدكير ومانكير", category: "الأظافر", duration: "70 دقيقة", price: "160 ر.س" },
  { id: "srv-7", name: "تسريحة عروس", category: "التسريحات", duration: "120 دقيقة", price: "650 ر.س" },
  { id: "srv-8", name: "تركيب رموش", category: "الرموش", duration: "55 دقيقة", price: "180 ر.س" },
] as const;

export function BasicTabV2({ readOnly, markDirty, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [status, setStatus] = useState("active");
  const [aboutVisible, setAboutVisible] = useState(true);
  const [bookingVisible, setBookingVisible] = useState(true);
  const [weeklyLeave, setWeeklyLeave] = useState("friday");

  const change = (callback: () => void) => {
    callback();
    markDirty();
  };

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="البيانات الأساسية"
        description="إدارة هوية الموظفة وحالة الحساب وظهورها العام مع ملخص واضح للتنبيهات والصلاحيات."
        badge={<WorkspaceStatusBadgeV2 tone="success">البيانات مكتملة 92٪</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="هوية الموظفة" description="الاسم المعتمد داخل الإدارة وصفحات العميل.">
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="dsv2-ew-employee-name" label="اسم الموظفة" required>
              <input
                id="dsv2-ew-employee-name"
                className="dsv2-input"
                defaultValue="وسام عداوي"
                disabled={readOnly}
                onChange={markDirty}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-account-status" label="حالة الحساب" required>
              <DashboardSelectV2
                id="dsv2-ew-account-status"
                value={status}
                disabled={readOnly}
                options={[
                  { value: "active", label: "نشطة" },
                  { value: "inactive", label: "غير نشطة" },
                ]}
                onChange={(value) => change(() => setStatus(value))}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-weekly-leave" label="الإجازة الأسبوعية">
              <DashboardSelectV2
                id="dsv2-ew-weekly-leave"
                value={weeklyLeave}
                disabled={readOnly}
                options={[
                  { value: "sunday", label: "الأحد" },
                  { value: "monday", label: "الإثنين" },
                  { value: "tuesday", label: "الثلاثاء" },
                  { value: "wednesday", label: "الأربعاء" },
                  { value: "thursday", label: "الخميس" },
                  { value: "friday", label: "الجمعة" },
                  { value: "saturday", label: "السبت" },
                ]}
                onChange={(value) => change(() => setWeeklyLeave(value))}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-job-title" label="المسمى الوظيفي">
              <input
                id="dsv2-ew-job-title"
                className="dsv2-input"
                defaultValue="أخصائية شعر"
                disabled={readOnly}
                onChange={markDirty}
              />
            </DashboardFieldV2>
          </div>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="الظهور العام" description="التحكم في مواضع ظهور الموظفة أمام العميلات.">
          <div className="dsv2-ew-switch-list">
            <WorkspaceSwitchV2
              checked={aboutVisible}
              disabled={readOnly}
              label="الظهور في صفحة من نحن"
              description="إظهار الصورة والنبذة ضمن فريق العمل."
              onChange={(checked) => change(() => setAboutVisible(checked))}
            />
            <WorkspaceSwitchV2
              checked={bookingVisible}
              disabled={readOnly}
              label="الظهور في صفحة الحجز"
              description="إتاحة اختيار الموظفة عند حجز الخدمات المسندة."
              onChange={(checked) => change(() => setBookingVisible(checked))}
            />
          </div>
          {!bookingVisible ? (
            <WorkspaceNoticeV2
              title="الحجز المباشر متوقف"
              description="تبقى الحجوزات السابقة محفوظة، لكن الموظفة لن تظهر في الحجوزات الجديدة."
              tone="gold"
            />
          ) : null}
        </WorkspaceCardV2>
      </div>

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="حالة الحساب" value={status === "active" ? "نشطة" : "غير نشطة"} tone={status === "active" ? "success" : "danger"} />
        <WorkspaceMetricV2 label="الظهور العام" value={aboutVisible ? "ظاهر" : "مخفي"} note="صفحة من نحن" tone="gold" />
        <WorkspaceMetricV2 label="الحجز" value={bookingVisible ? "متاح" : "متوقف"} note="حسب الخدمات المسندة" tone={bookingVisible ? "success" : "danger"} />
        <WorkspaceMetricV2 label="الإجازة الأسبوعية" value="الجمعة" note="يمكن تخصيصها من جدول الدوام" />
      </div>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="التنبيهات والتحقق" description="فحوصات تمنع نشر ملف ناقص أو متعارض.">
          <ul className="dsv2-ew-checklist">
            <li data-state="success"><span>✓</span><div><strong>الحساب مرتبط بملف موظفة</strong><small>المعرف التشغيلي متطابق مع حساب الدخول.</small></div></li>
            <li data-state="success"><span>✓</span><div><strong>جدول الدوام متوفر</strong><small>ستة أيام عمل ويوم إجازة أسبوعية.</small></div></li>
            <li data-state="warning"><span>!</span><div><strong>السيرة الذاتية غير مضافة</strong><small>لا يمنع الحفظ، لكنه يخفض اكتمال الملف العام.</small></div></li>
            <li data-state="danger"><span>×</span><div><strong>رقم الهوية لم يُتحقق منه</strong><small>مطلوب قبل اعتماد أول مسير راتب.</small></div></li>
          </ul>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="إجراءات الحساب" description="إجراءات حساسة مع نافذة تأكيد موحدة.">
          <div className="dsv2-ew-action-list">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              disabled={readOnly}
              onClick={() => requestConfirm({
                title: "تعطيل حساب الموظفة؟",
                description: "سيتوقف تسجيل الدخول والظهور في الحجز مع بقاء السجلات محفوظة.",
                confirmLabel: "تعطيل الحساب",
                tone: "danger",
                detail: <strong>وسام عداوي — أخصائية شعر</strong>,
              })}
            >
              تعطيل الحساب
            </button>
            <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={readOnly}>إعادة إرسال دعوة الدخول</button>
          </div>
          {readOnly ? (
            <WorkspaceNoticeV2 title="وضع العرض فقط" description="صلاحيتك تسمح بمراجعة البيانات دون تعديلها أو تنفيذ إجراءات الحساب." tone="neutral" />
          ) : null}
        </WorkspaceCardV2>
      </div>
    </div>
  );
}

export function ProfileTabV2({ readOnly, markDirty, openDialog, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [bio, setBio] = useState("أخصائية شعر بخبرة في القص والصبغات والتسريحات اليومية، تهتم بتقديم تجربة هادئة ونتيجة مناسبة لكل عميلة.");
  const [imageState, setImageState] = useState<"ready" | "missing" | "failed">("ready");

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الملف والصورة"
        description="معاينة الصورة والنبذة والتقييم ومعرض الوسائط، مع حالات واضحة للغياب وفشل التحميل."
        badge={<WorkspaceStatusBadgeV2 tone="gold">4.8 من 5</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-grid dsv2-ew-grid--profile">
        <WorkspaceCardV2 title="الصورة الرئيسية" description="الصورة المستخدمة في الحجز وصفحة من نحن.">
          <div className="dsv2-ew-photo-panel" data-state={imageState}>
            {imageState === "ready" ? (
              <div className="dsv2-ew-photo dsv2-ew-photo--mock" role="img" aria-label="معاينة صورة الموظفة">و</div>
            ) : imageState === "missing" ? (
              <div className="dsv2-ew-photo-placeholder"><strong>لا توجد صورة</strong><span>اختاري صورة واضحة بخلفية مناسبة.</span></div>
            ) : (
              <div className="dsv2-ew-photo-placeholder dsv2-ew-photo-placeholder--error"><strong>فشل تحميل الصورة</strong><span>تعذر الوصول للرابط الحالي.</span></div>
            )}
            <div className="dsv2-ew-photo-actions">
              <button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={readOnly} onClick={() => openDialog("image")}>اختيار صورة</button>
              <button
                type="button"
                className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                disabled={readOnly || imageState === "missing"}
                onClick={() => requestConfirm({
                  title: "إزالة الصورة الرئيسية؟",
                  description: "سيظهر بديل الصورة حتى يتم اختيار صورة جديدة.",
                  confirmLabel: "إزالة الصورة",
                  tone: "danger",
                  onConfirm: () => { setImageState("missing"); markDirty(); },
                })}
              >إزالة</button>
            </div>
            <WorkspaceChoicePillsV2
              value={imageState}
              disabled={readOnly}
              options={[
                { value: "ready", label: "صورة موجودة" },
                { value: "missing", label: "بدون صورة" },
                { value: "failed", label: "فشل التحميل" },
              ]}
              onChange={(value) => setImageState(value as typeof imageState)}
            />
          </div>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="بيانات الصورة والملف" description="روابط قابلة للمراجعة دون استخدام حقول متصفح غير موحدة.">
          <div className="dsv2-ew-form-grid">
            <DashboardFieldV2 id="dsv2-ew-image-url" label="رابط الصورة" hint="يُفضل رابط آمن من مساحة ملفات مَلِكات.">
              <input id="dsv2-ew-image-url" className="dsv2-input" dir="ltr" defaultValue="https://assets.malikat.sa/staff/wesam.jpg" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-cv-url" label="رابط السيرة الذاتية">
              <input id="dsv2-ew-cv-url" className="dsv2-input" dir="ltr" placeholder="https://" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
          </div>
          <div className="dsv2-ew-rating-summary">
            <div><span>التقييم</span><strong>4.8 / 5</strong><small>من 126 تقييمًا</small></div>
            <div className="dsv2-ew-stars" aria-label="أربع نجوم وثمانية أعشار من خمس">★ ★ ★ ★ ★</div>
          </div>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2 title="النبذة التعريفية" description="نص عربي مختصر يظهر للعميلات عند استعراض الموظفة.">
        <DashboardFieldV2 id="dsv2-ew-profile-bio" label="النبذة" hint={`${bio.length} من 280 حرفًا`}>
          <textarea
            id="dsv2-ew-profile-bio"
            className="dsv2-textarea dsv2-ew-bio"
            value={bio}
            maxLength={280}
            disabled={readOnly}
            onChange={(event) => { setBio(event.target.value); markDirty(); }}
          />
        </DashboardFieldV2>
      </WorkspaceCardV2>

      <WorkspaceCardV2 title="معرض الصور" description="صور إضافية للأعمال والنتائج المعتمدة.">
        <div className="dsv2-ew-gallery">
          {["تسريحة ناعمة", "صبغة بنية", "قص طبقات", "تسريحة مناسبة"].map((label, index) => (
            <button key={label} type="button" className="dsv2-ew-gallery__item" disabled={readOnly} onClick={() => openDialog("image")}>
              <span>{index + 1}</span><strong>{label}</strong><small>صورة معتمدة</small>
            </button>
          ))}
          <button type="button" className="dsv2-ew-gallery__add" disabled={readOnly} onClick={() => openDialog("image")}>+ إضافة صورة</button>
        </div>
      </WorkspaceCardV2>

      <WorkspaceStateShowcaseV2 compact />
    </div>
  );
}

export function ServicesTabV2({ readOnly, markDirty, openDrawer, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [search, setSearch] = useState("");
  const [selectedSearch, setSelectedSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [scope, setScope] = useState("all");
  const [visibleCount, setVisibleCount] = useState(6);
  const [selected, setSelected] = useState<string[]>(["srv-1", "srv-2", "srv-3", "srv-7"]);

  const filtered = useMemo(() => SERVICE_CATALOG.filter((service) => {
    const matchesSearch = service.name.includes(search) || service.category.includes(search);
    const matchesCategory = category === "all" || service.category === category;
    const matchesScope = scope === "all" || (scope === "selected" ? selected.includes(service.id) : !selected.includes(service.id));
    return matchesSearch && matchesCategory && matchesScope;
  }), [category, scope, search, selected]);

  const chosen = useMemo(() => SERVICE_CATALOG.filter((service) => selected.includes(service.id) && service.name.includes(selectedSearch)), [selected, selectedSearch]);

  const toggle = (id: string) => {
    if (readOnly) return;
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    markDirty();
  };

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الخدمات"
        description="مساحة متوازنة لإسناد الخدمات ومراجعة المحدد دون فراغات كبيرة أو خروج المحتوى من الكروت."
        badge={<WorkspaceStatusBadgeV2 tone="success">{selected.length} خدمات محددة</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="المتاح" value={SERVICE_CATALOG.length} note="خدمات قابلة للإسناد" />
        <WorkspaceMetricV2 label="المحدد" value={selected.length} tone="success" />
        <WorkspaceMetricV2 label="الظاهر حاليًا" value={Math.min(visibleCount, filtered.length)} tone="gold" />
        <WorkspaceMetricV2 label="الأقسام" value={new Set(SERVICE_CATALOG.map((service) => service.category)).size} />
      </div>

      <WorkspaceCardV2 title="البحث والتصفية" description="كل القوائم تستخدم DashboardSelectV2 المخصص.">
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
          <DashboardFieldV2 id="dsv2-ew-service-search" label="البحث">
            <input id="dsv2-ew-service-search" className="dsv2-input" value={search} placeholder="اسم الخدمة أو القسم" onChange={(event) => setSearch(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-service-category" label="القسم">
            <DashboardSelectV2
              id="dsv2-ew-service-category"
              value={category}
              options={[
                { value: "all", label: "كل الأقسام" },
                { value: "الشعر", label: "الشعر" },
                { value: "الصبغات", label: "الصبغات" },
                { value: "المكياج", label: "المكياج" },
                { value: "الأظافر", label: "الأظافر" },
                { value: "التسريحات", label: "التسريحات" },
                { value: "الرموش", label: "الرموش" },
              ]}
              onChange={setCategory}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-service-scope" label="نطاق العرض">
            <DashboardSelectV2
              id="dsv2-ew-service-scope"
              value={scope}
              options={[
                { value: "all", label: "الكل" },
                { value: "selected", label: "المختارة" },
                { value: "unselected", label: "غير المختارة" },
              ]}
              onChange={setScope}
            />
          </DashboardFieldV2>
        </div>
        <div className="dsv2-cluster">
          <button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={readOnly || !filtered.length} onClick={() => { setSelected((current) => Array.from(new Set([...current, ...filtered.map((service) => service.id)]))); markDirty(); }}>تحديد الظاهر</button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
            disabled={readOnly || !selected.length}
            onClick={() => requestConfirm({
              title: "مسح جميع الخدمات؟",
              description: "ستُزال كل الخدمات المسندة من الموظفة بعد التأكيد.",
              confirmLabel: "مسح الكل",
              tone: "danger",
              onConfirm: () => { setSelected([]); markDirty(); },
            })}
          >مسح الكل</button>
        </div>
      </WorkspaceCardV2>

      <div className="dsv2-ew-services-layout">
        <WorkspaceCardV2 title="الخدمات المتاحة" description={`${filtered.length} نتيجة مطابقة`} className="dsv2-ew-services-catalog">
          {filtered.length ? (
            <div className="dsv2-ew-service-cards">
              {filtered.slice(0, visibleCount).map((service) => {
                const isSelected = selected.includes(service.id);
                return (
                  <article key={service.id} className="dsv2-ew-service-card" data-selected={isSelected ? "true" : "false"}>
                    <div className="dsv2-ew-service-card__main">
                      <span className="dsv2-ew-service-card__category">{service.category}</span>
                      <strong>{service.name}</strong>
                      <small>{service.duration} · {service.price}</small>
                    </div>
                    <div className="dsv2-ew-service-card__actions">
                      <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => openDrawer("service")}>التفاصيل</button>
                      <button type="button" className={isSelected ? "dsv2-btn dsv2-btn--success dsv2-btn--sm" : "dsv2-btn dsv2-btn--accent dsv2-btn--sm"} disabled={readOnly} onClick={() => toggle(service.id)}>{isSelected ? "محددة" : "تحديد"}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="dsv2-ew-inline-empty"><strong>لا توجد نتائج</strong><span>غيّر البحث أو القسم أو نطاق العرض.</span></div>
          )}
          {visibleCount < filtered.length ? <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-ew-load-more" onClick={() => setVisibleCount((count) => count + 4)}>عرض المزيد</button> : null}
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="الخدمات المختارة" description="قائمة مستقلة مضغوطة بلا مساحة فارغة زائدة." className="dsv2-ew-services-selected">
          <DashboardFieldV2 id="dsv2-ew-selected-service-search" label="البحث داخل المختارة">
            <input id="dsv2-ew-selected-service-search" className="dsv2-input" value={selectedSearch} placeholder="ابحث في الخدمات المحددة" onChange={(event) => setSelectedSearch(event.target.value)} />
          </DashboardFieldV2>
          {chosen.length ? (
            <div className="dsv2-ew-selected-list">
              {chosen.map((service) => (
                <div key={service.id} className="dsv2-ew-selected-item">
                  <div><strong>{service.name}</strong><small>{service.category} · {service.duration}</small></div>
                  <button type="button" className="dsv2-ew-icon-btn" aria-label={`إزالة ${service.name}`} disabled={readOnly} onClick={() => toggle(service.id)}>×</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="dsv2-ew-inline-empty"><strong>{selected.length ? "لا توجد نتيجة مطابقة" : "لم تُحدد خدمات"}</strong><span>{selected.length ? "امسح عبارة البحث لعرض القائمة." : "اختاري الخدمات من القائمة المجاورة."}</span></div>
          )}
        </WorkspaceCardV2>
      </div>

      <WorkspaceStateShowcaseV2 compact />
    </div>
  );
}
