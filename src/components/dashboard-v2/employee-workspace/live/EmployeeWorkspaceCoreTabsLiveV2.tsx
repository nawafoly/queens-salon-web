import { useMemo, useState } from "react";
import EmployeeAvatar from "../../../EmployeeAvatar";
import {
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../index";
import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceSwitchV2,
  WorkspaceTabHeaderV2,
} from "../EmployeeWorkspacePrimitivesV2";

export type EmployeeBasicTabLiveV2Props = {
  readOnly: boolean;
  name: string;
  active: boolean;
  showOnAbout: boolean;
  showOnBooking: boolean;
  includeInEmployeeManagement: boolean;
  weeklyOffLabel: string;
  onNameChange: (value: string) => void;
  onActiveChange: (value: boolean) => void;
  onShowOnAboutChange: (value: boolean) => void;
  onShowOnBookingChange: (value: boolean) => void;
  onIncludeInEmployeeManagementChange: (value: boolean) => void;
};

export function EmployeeBasicTabLiveV2({
  readOnly,
  name,
  active,
  showOnAbout,
  showOnBooking,
  includeInEmployeeManagement,
  weeklyOffLabel,
  onNameChange,
  onActiveChange,
  onShowOnAboutChange,
  onShowOnBookingChange,
  onIncludeInEmployeeManagementChange,
}: EmployeeBasicTabLiveV2Props) {
  const completeness = [name.trim(), weeklyOffLabel.trim()].filter(Boolean).length === 2 ? 100 : 75;

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="البيانات الأساسية"
        description="إدارة اسم الموظفة وحالة الحساب وظهورها في الموقع والحجز من مكوّن V2 مستقل."
        badge={<WorkspaceStatusBadgeV2 tone={completeness === 100 ? "success" : "gold"}>اكتمال {completeness}٪</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="هوية الموظفة" description="الاسم المعتمد داخل الإدارة وواجهات العميلات.">
          <DashboardFieldV2 id="employee-live-v2-name" label="اسم الموظفة" required>
            <input
              id="employee-live-v2-name"
              className="dsv2-input"
              value={name}
              disabled={readOnly}
              autoComplete="off"
              onChange={(event) => onNameChange(event.target.value)}
            />
          </DashboardFieldV2>

          <div className="dsv2-ew-field-group">
            <span>حالة الحساب</span>
            <DashboardSelectV2
              id="employee-live-v2-status"
              value={active ? "active" : "inactive"}
              disabled={readOnly}
              options={[
                { value: "active", label: "نشطة" },
                { value: "inactive", label: "غير نشطة" },
              ]}
              onChange={(value) => onActiveChange(value === "active")}
            />
          </div>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="الظهور العام" description="تحديد مواضع ظهور الموظفة أمام العميلات.">
          <div className="dsv2-ew-switch-list">
            <WorkspaceSwitchV2
              checked={includeInEmployeeManagement}
              disabled={readOnly}
              label="إظهار في دليل الموظفات"
              description="إخفاؤها من الدليل لا يحذف الملف ولا يؤثر على الحضور أو الرواتب."
              onChange={onIncludeInEmployeeManagementChange}
            />            <WorkspaceSwitchV2
              checked={showOnAbout}
              disabled={readOnly}
              label="الظهور في صفحة من نحن"
              description="عرض الصورة والنبذة ضمن فريق الصالون."
              onChange={onShowOnAboutChange}
            />
            <WorkspaceSwitchV2
              checked={showOnBooking}
              disabled={readOnly}
              label="الظهور في صفحة الحجز"
              description="إتاحة اختيار الموظفة للخدمات المسندة."
              onChange={onShowOnBookingChange}
            />
          </div>

          {!showOnBooking ? (
            <WorkspaceNoticeV2
              title="الحجز المباشر متوقف"
              description="الحجوزات السابقة محفوظة، لكن الموظفة لن تظهر في الحجوزات الجديدة."
              tone="gold"
            />
          ) : null}
        </WorkspaceCardV2>
      </div>

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="الحساب" value={active ? "نشطة" : "غير نشطة"} tone={active ? "success" : "danger"} />
        <WorkspaceMetricV2
          label="دليل الموظفات"
          value={includeInEmployeeManagement ? "ظاهرة" : "مخفية"}
          tone={includeInEmployeeManagement ? "success" : "gold"}
        />
        <WorkspaceMetricV2 label="من نحن" value={showOnAbout ? "ظاهرة" : "مخفية"} tone={showOnAbout ? "success" : "gold"} />
        <WorkspaceMetricV2 label="الحجز" value={showOnBooking ? "متاحة" : "متوقفة"} tone={showOnBooking ? "success" : "danger"} />
        <WorkspaceMetricV2 label="الإجازة الأسبوعية" value={weeklyOffLabel || "غير محددة"} note="تُعدل من جدول الدوام" />
      </div>

      {readOnly ? (
        <WorkspaceNoticeV2
          title="وضع العرض فقط"
          description="صلاحيتك تسمح بمراجعة البيانات دون تعديلها."
          tone="neutral"
        />
      ) : null}
    </div>
  );
}

export type EmployeeProfileTabLiveV2Props = {
  readOnly: boolean;
  employeeName: string;
  avatarUrl: string;
  bio: string;
  cvUrl: string;
  rating: string;
  reviewsCount: string;
  staffImageOptions: Array<{ label: string; value: string }>;
  resolveAvatarFromAssets: (raw: string) => string;
  onAvatarUrlChange: (value: string) => void;
  onBioChange: (value: string) => void;
  onCvUrlChange: (value: string) => void;
  onRatingChange: (value: string) => void;
  onReviewsCountChange: (value: string) => void;
};

export function EmployeeProfileTabLiveV2({
  readOnly,
  employeeName,
  avatarUrl,
  bio,
  cvUrl,
  rating,
  reviewsCount,
  staffImageOptions,
  resolveAvatarFromAssets,
  onAvatarUrlChange,
  onBioChange,
  onCvUrlChange,
  onRatingChange,
  onReviewsCountChange,
}: EmployeeProfileTabLiveV2Props) {
  const resolvedAvatar = resolveAvatarFromAssets(String(avatarUrl || "").trim());
  const [imageSearch, setImageSearch] = useState("");

  const visibleImages = useMemo(() => {
    const query = imageSearch.trim().toLocaleLowerCase("ar");
    if (!query) return staffImageOptions;
    return staffImageOptions.filter((item) => item.label.toLocaleLowerCase("ar").includes(query));
  }, [imageSearch, staffImageOptions]);

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الملف والصورة"
        description="إدارة الصورة والنبذة والتقييم والسيرة الذاتية من واجهة V2 مرتبطة بالقيم الفعلية."
        badge={<WorkspaceStatusBadgeV2 tone={resolvedAvatar ? "success" : "gold"}>{resolvedAvatar ? "الصورة جاهزة" : "بدون صورة"}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-grid dsv2-ew-grid--profile">
        <WorkspaceCardV2 title="معاينة الملف" description="الصورة الحالية المستخدمة في الحجز وصفحة من نحن.">
          <div className="dsv2-ew-photo-panel" data-state={resolvedAvatar ? "ready" : "missing"}>
            {resolvedAvatar ? (
              <EmployeeAvatar
                className="dsv2-ew-photo"
                src={resolvedAvatar}
                name={employeeName || "موظفة"}
                alt={employeeName ? `صورة ${employeeName}` : "صورة الموظفة"}
                loading="eager"
              />
            ) : (
              <div className="dsv2-ew-photo-placeholder">
                <strong>لا توجد صورة</strong>
                <span>اختاري صورة جاهزة أو أضيفي رابطًا مباشرًا.</span>
              </div>
            )}
          </div>

          <div className="dsv2-ew-rating-summary">
            <div>
              <span>التقييم</span>
              <strong>{rating || "—"}{rating ? " / 5" : ""}</strong>
              <small>{reviewsCount || "0"} تقييم</small>
            </div>
          </div>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="بيانات الوسائط" description="روابط الصورة والسيرة والتقييم الظاهر للعميلات.">
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="employee-live-v2-avatar-url" label="رابط الصورة">
              <input
                id="employee-live-v2-avatar-url"
                className="dsv2-input"
                dir="ltr"
                value={avatarUrl}
                disabled={readOnly}
                onChange={(event) => onAvatarUrlChange(event.target.value)}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-cv-url" label="رابط السيرة الذاتية">
              <input
                id="employee-live-v2-cv-url"
                className="dsv2-input"
                dir="ltr"
                value={cvUrl}
                disabled={readOnly}
                onChange={(event) => onCvUrlChange(event.target.value)}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-rating" label="تقييم العرض">
              <input lang="en"
                id="employee-live-v2-rating"
                className="dsv2-input"
                type="number"
                min="0"
                max="5"
                step="0.1"
                dir="ltr"
                value={rating}
                disabled={readOnly}
                onChange={(event) => onRatingChange(event.target.value)}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-reviews" label="عدد التقييمات">
              <input lang="en"
                id="employee-live-v2-reviews"
                className="dsv2-input"
                type="number"
                min="0"
                step="1"
                dir="ltr"
                value={reviewsCount}
                disabled={readOnly}
                onChange={(event) => onReviewsCountChange(event.target.value)}
              />
            </DashboardFieldV2>
          </div>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2 title="النبذة التعريفية" description="النص الذي يظهر للعميلات عند استعراض الموظفة.">
        <DashboardFieldV2 id="employee-live-v2-bio" label="النبذة" hint={`${bio.length} حرف`}>
          <textarea
            id="employee-live-v2-bio"
            className="dsv2-textarea dsv2-ew-bio"
            rows={6}
            value={bio}
            disabled={readOnly}
            onChange={(event) => onBioChange(event.target.value)}
          />
        </DashboardFieldV2>
      </WorkspaceCardV2>

      <WorkspaceCardV2 title="معرض الصور" description="اختيار صورة من الأصول الحالية دون استخدام CSS القديم.">
        <DashboardFieldV2 id="employee-live-v2-image-search" label="البحث داخل الصور">
          <input
            id="employee-live-v2-image-search"
            className="dsv2-input"
            value={imageSearch}
            placeholder="اسم الصورة"
            onChange={(event) => setImageSearch(event.target.value)}
          />
        </DashboardFieldV2>

        <div className="dsv2-ew-gallery">
          <button
            type="button"
            className="dsv2-ew-gallery__add"
            disabled={readOnly}
            onClick={() => onAvatarUrlChange("")}
          >
            إزالة الصورة
          </button>
          {visibleImages.map((image) => {
            const src = resolveAvatarFromAssets(image.value);
            const selected = Boolean(src && resolvedAvatar && src === resolvedAvatar);
            return (
              <button
                key={image.value}
                type="button"
                className="dsv2-ew-gallery__item"
                data-selected={selected ? "true" : "false"}
                disabled={readOnly}
                onClick={() => onAvatarUrlChange(image.value)}
              >
                {src ? <img src={src} alt={image.label} /> : <span>لا توجد معاينة</span>}
                <strong>{image.label}</strong>
                <small>{selected ? "الصورة الحالية" : "اختيار"}</small>
              </button>
            );
          })}
        </div>
      </WorkspaceCardV2>
    </div>
  );
}

export type EmployeeServiceOptionLiveV2 = {
  id: string;
  label: string;
  sectionId?: string;
  durationMin?: number;
  price?: number;
};

export type EmployeeServicesTabLiveV2Props = {
  readOnly: boolean;
  search: string;
  section: string;
  sectionOptions: Array<{ id: string; label: string }>;
  serviceOptions: EmployeeServiceOptionLiveV2[];
  filteredServices: EmployeeServiceOptionLiveV2[];
  specialties: string[];
  onSearchChange: (value: string) => void;
  onSectionChange: (value: string) => void;
  onToggleSpecialty: (serviceId: string) => void;
  onSpecialtiesChange: (value: string[]) => void;
};

function serviceSectionLabel(
  service: EmployeeServiceOptionLiveV2,
  sectionOptions: Array<{ id: string; label: string }>,
) {
  return sectionOptions.find((section) => section.id === service.sectionId)?.label || service.sectionId || "قسم غير محدد";
}

export function EmployeeServicesTabLiveV2({
  readOnly,
  search,
  section,
  sectionOptions,
  serviceOptions,
  filteredServices,
  specialties,
  onSearchChange,
  onSectionChange,
  onToggleSpecialty,
  onSpecialtiesChange,
}: EmployeeServicesTabLiveV2Props) {
  const [scope, setScope] = useState("all");
  const [selectedSearch, setSelectedSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);
  const selectedSet = useMemo(() => new Set(specialties), [specialties]);
  const serviceById = useMemo(() => new Map(serviceOptions.map((service) => [service.id, service] as const)), [serviceOptions]);

  const scopedServices = useMemo(() => {
    if (scope === "selected") return filteredServices.filter((service) => selectedSet.has(service.id));
    if (scope === "unselected") return filteredServices.filter((service) => !selectedSet.has(service.id));
    return filteredServices;
  }, [filteredServices, scope, selectedSet]);

  const selectedServices = useMemo(() => {
    const query = selectedSearch.trim().toLocaleLowerCase("ar");
    return specialties
      .map((id) => serviceById.get(id))
      .filter((service): service is EmployeeServiceOptionLiveV2 => Boolean(service))
      .filter((service) => !query || service.label.toLocaleLowerCase("ar").includes(query));
  }, [selectedSearch, serviceById, specialties]);

  const selectVisible = () => {
    onSpecialtiesChange(Array.from(new Set([...specialties, ...scopedServices.map((service) => service.id)])));
  };

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الخدمات"
        description="إسناد الخدمات والبحث والتصفية من مكوّن V2 مستقل مرتبط بالقائمة الفعلية."
        badge={<WorkspaceStatusBadgeV2 tone="success">{specialties.length} خدمات محددة</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="المتاح" value={serviceOptions.length} />
        <WorkspaceMetricV2 label="المحدد" value={specialties.length} tone="success" />
        <WorkspaceMetricV2 label="نتائج التصفية" value={scopedServices.length} tone="gold" />
        <WorkspaceMetricV2 label="الأقسام" value={sectionOptions.length} />
      </div>

      <WorkspaceCardV2 title="البحث والتصفية" description="قوائم V2 فقط، بدون select أصلي أو EmployeeSelect القديم.">
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
          <DashboardFieldV2 id="employee-live-v2-service-search" label="البحث">
            <input
              id="employee-live-v2-service-search"
              className="dsv2-input"
              value={search}
              placeholder="اسم الخدمة أو القسم"
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-service-section" label="القسم">
            <DashboardSelectV2
              id="employee-live-v2-service-section"
              value={section}
              options={[
                { value: "all", label: "كل الأقسام" },
                ...sectionOptions.map((item) => ({ value: item.id, label: item.label })),
              ]}
              onChange={onSectionChange}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-service-scope" label="نطاق العرض">
            <DashboardSelectV2
              id="employee-live-v2-service-scope"
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
          <button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={readOnly || !scopedServices.length} onClick={selectVisible}>تحديد الظاهر</button>
          <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly || !specialties.length} onClick={() => onSpecialtiesChange([])}>مسح الكل</button>
        </div>
      </WorkspaceCardV2>

      <div className="dsv2-ew-services-layout">
        <WorkspaceCardV2 title="الخدمات المتاحة" description={`${scopedServices.length} نتيجة`} className="dsv2-ew-services-catalog">
          {scopedServices.length ? (
            <div className="dsv2-ew-service-cards">
              {scopedServices.slice(0, visibleCount).map((service) => {
                const selected = selectedSet.has(service.id);
                return (
                  <article key={service.id} className="dsv2-ew-service-card" data-selected={selected ? "true" : "false"}>
                    <div className="dsv2-ew-service-card__main">
                      <span className="dsv2-ew-service-card__category">{serviceSectionLabel(service, sectionOptions)}</span>
                      <strong>{service.label}</strong>
                      <small>
                        {Number(service.durationMin || 0) > 0 ? `${Number(service.durationMin).toLocaleString("ar-SA-u-nu-latn")} دقيقة` : "مدة غير محددة"}
                        {Number(service.price || 0) > 0 ? ` · ${Number(service.price).toLocaleString("ar-SA-u-nu-latn")} ر.س` : ""}
                      </small>
                    </div>
                    <button
                      type="button"
                      className={selected ? "dsv2-btn dsv2-btn--success dsv2-btn--sm" : "dsv2-btn dsv2-btn--accent dsv2-btn--sm"}
                      disabled={readOnly}
                      onClick={() => onToggleSpecialty(service.id)}
                    >
                      {selected ? "محددة" : "تحديد"}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="dsv2-ew-inline-empty"><strong>لا توجد نتائج</strong><span>غيّر البحث أو القسم أو نطاق العرض.</span></div>
          )}

          {visibleCount < scopedServices.length ? (
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-ew-load-more" onClick={() => setVisibleCount((current) => current + 24)}>عرض المزيد</button>
          ) : null}
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="الخدمات المختارة" description="قائمة مستقلة مضغوطة." className="dsv2-ew-services-selected">
          <DashboardFieldV2 id="employee-live-v2-selected-search" label="البحث داخل المختارة">
            <input
              id="employee-live-v2-selected-search"
              className="dsv2-input"
              value={selectedSearch}
              onChange={(event) => setSelectedSearch(event.target.value)}
            />
          </DashboardFieldV2>

          {selectedServices.length ? (
            <div className="dsv2-ew-selected-list">
              {selectedServices.map((service) => (
                <div key={service.id} className="dsv2-ew-selected-item">
                  <div>
                    <strong>{service.label}</strong>
                    <small>{serviceSectionLabel(service, sectionOptions)}</small>
                  </div>
                  <button type="button" className="dsv2-ew-icon-btn" disabled={readOnly} aria-label={`إزالة ${service.label}`} onClick={() => onToggleSpecialty(service.id)}>×</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="dsv2-ew-inline-empty"><strong>{specialties.length ? "لا توجد نتيجة مطابقة" : "لم تُحدد خدمات"}</strong><span>{specialties.length ? "امسح عبارة البحث لعرض القائمة." : "اختاري الخدمات من القائمة المجاورة."}</span></div>
          )}
        </WorkspaceCardV2>
      </div>
    </div>
  );
}
