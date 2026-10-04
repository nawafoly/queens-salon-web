import DashboardNumberInputV2 from "../../DashboardNumberInputV2";
import { useMemo, useState } from "react";
import EmployeeAvatar from "../../../EmployeeAvatar";
import {
  DashboardActionFeedbackV2,
  DashboardDatePickerV2,
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
import { useEmployeeLanguage } from "../../../../pages/dashboardEmployees/employeeLanguage";
import { translateBookingCatalogLabel } from "../../../../helpers/dashboardBookingsLanguage";

export type EmployeeBasicTabLiveV2Props = {
  readOnly: boolean;
  name: string;
  active: boolean;
  showOnAbout: boolean;
  showOnBooking: boolean;
  accountStatus?: string;
  includeInEmployeeManagement: boolean;
  employmentStartDate: string;
  weeklyOffLabel: string;
  onNameChange: (value: string) => void;
  onActiveChange: (value: boolean) => void;
  onShowOnAboutChange: (value: boolean) => void;
  onShowOnBookingChange: (value: boolean) => void;
  onIncludeInEmployeeManagementChange: (value: boolean) => void;
  onEmploymentStartDateChange: (value: string) => void;
};

export function EmployeeBasicTabLiveV2({
  readOnly,
  name,
  active,
  showOnAbout,
  showOnBooking,
    accountStatus,
  includeInEmployeeManagement,
  employmentStartDate,
  weeklyOffLabel,
  onNameChange,
  onActiveChange,
  onShowOnAboutChange,
  onShowOnBookingChange,
  onIncludeInEmployeeManagementChange,
  onEmploymentStartDateChange,
}: EmployeeBasicTabLiveV2Props) {
  const { t, tr } = useEmployeeLanguage();
  const completeness = [name.trim(), weeklyOffLabel.trim()].filter(Boolean).length === 2 ? 100 : 75;
  const [bookingVisibilityError, setBookingVisibilityError] = useState("");

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="البيانات الأساسية"
        description="إدارة اسم الموظفة وحالة الحساب وظهورها في الموقع والحجز من مكوّن V2 مستقل."
        badge={<WorkspaceStatusBadgeV2 tone={completeness === 100 ? "success" : "gold"}>{tr(`اكتمال ${completeness}٪`, `${completeness}% complete`)}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="هوية الموظفة" description="الاسم المعتمد داخل الإدارة وواجهات العميلات.">
          <DashboardFieldV2 id="employee-live-v2-name" label={t("اسم الموظفة")} required>
            <input
              id="employee-live-v2-name"
              className="dsv2-input"
              value={name}
              disabled={readOnly}
              autoComplete="off"
              onChange={(event) => onNameChange(event.target.value)}
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="employee-live-v2-service-start-date" label={t("بداية سنة الخدمة")}>
            <DashboardDatePickerV2
              id="employee-live-v2-service-start-date"
              value={employmentStartDate}
              disabled={readOnly}
              clearable
              onChange={onEmploymentStartDateChange}
            />
          </DashboardFieldV2>

          <div className="dsv2-ew-field-group">
            <span>{t("الحالة")}</span>
            <DashboardSelectV2
              id="employee-live-v2-status"
              value={active ? "active" : "inactive"}
              disabled={readOnly}
              options={[
                { value: "active", label: t("نشطة") },
                { value: "inactive", label: t("غير نشطة") },
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
              onChange={(value) => {
                const status = String(accountStatus || "").toLowerCase();
                if (value && ["inactive","disabled","offboarded","archived","suspended"].includes(status)) {
                  setBookingVisibilityError(t("الحساب غير نشط. فعّل حالة الحساب أولاً ثم أعد تفعيل الظهور في صفحة الحجز."));
                  return;
                }
                setBookingVisibilityError("");
                onShowOnBookingChange(value);
              }}
            />
          </div>

          {bookingVisibilityError ? (
            <DashboardActionFeedbackV2
              compact
              revealOnMount
              tone="danger"
              title={t("تعذر تفعيل الظهور في الحجز")}
              description={bookingVisibilityError}
            />
          ) : null}

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
        <WorkspaceMetricV2 label="الحساب" value={active ? t("نشطة") : t("غير نشطة")} tone={active ? "success" : "danger"} />
        <WorkspaceMetricV2
          label="دليل الموظفات"
          value={includeInEmployeeManagement ? t("ظاهرة") : t("مخفية")}
          tone={includeInEmployeeManagement ? "success" : "gold"}
        />
        <WorkspaceMetricV2 label="من نحن" value={showOnAbout ? t("ظاهرة") : t("مخفية")} tone={showOnAbout ? "success" : "gold"} />
        <WorkspaceMetricV2 label="الحجز" value={showOnBooking ? t("متاحة") : t("متوقفة")} tone={showOnBooking ? "success" : "danger"} />
        <WorkspaceMetricV2 label="الإجازة الأسبوعية" value={weeklyOffLabel || t("غير محددة")} note="تُعدل من جدول الدوام" />
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

export type EmployeeProfilePhotoLiveV2 = {
  id: string;
  fileName: string;
  status: string;
  sizeBytes?: number | null;
  createdAt: string;
  replacedByFileId?: string | null;
  replacesFileId?: string | null;
};

export type EmployeeProfileTabLiveV2Props = {
  readOnly: boolean;
  employeeName: string;
  avatarUrl: string;
  bio: string;
  cvUrl: string;
  rating: string;
  reviewsCount: string;
  profilePhotoBusy: boolean;
  profilePhotos: EmployeeProfilePhotoLiveV2[];
  photoManagementEnabled: boolean;
  resolveAvatarFromAssets: (raw: string) => string;
  onProfilePhotoChange: (file: File) => void | Promise<void>;
  onProfilePhotoRemove: () => void | Promise<void>;
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
  profilePhotoBusy,
  profilePhotos,
  photoManagementEnabled,
  resolveAvatarFromAssets,
  onProfilePhotoChange,
  onProfilePhotoRemove,
  onBioChange,
  onCvUrlChange,
  onRatingChange,
  onReviewsCountChange,
}: EmployeeProfileTabLiveV2Props) {
  const { language, t, tr } = useEmployeeLanguage();
  const resolvedAvatar =
    resolveAvatarFromAssets(String(avatarUrl || "").trim());

  const historicalPhotos = profilePhotos.filter(
    (photo) =>
      String(photo.status || "").toLowerCase() !== "active"
  );

  const photoStatusLabel = (status: string) => {
    const value = String(status || "").toLowerCase();

    if (value === "replaced") return t("مستبدلة");
    if (value === "archived") return t("مؤرشفة");
    if (value === "active") return t("الحالية");

    return value || t("غير معروف");
  };

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الصورة الشخصية والملف العام"
        description="إدارة الصورة الشخصية والسيرة والتقييم وسجل الصور السابقة."
        badge={
          <WorkspaceStatusBadgeV2
            tone={resolvedAvatar ? "success" : "gold"}
          >
            {resolvedAvatar ? t("الصورة جاهزة") : t("بدون صورة")}
          </WorkspaceStatusBadgeV2>
        }
      />

      <div className="dsv2-ew-grid dsv2-ew-grid--profile">
        <WorkspaceCardV2
          title="الصورة الشخصية"
          description="الصورة الحالية المعتمدة في ملف الموظفة."
        >
          <div
            className="dsv2-ew-photo-panel"
            data-state={resolvedAvatar ? "ready" : "missing"}
          >
            {resolvedAvatar ? (
              <EmployeeAvatar
                className="dsv2-ew-photo"
                src={resolvedAvatar}
                name={employeeName || t("موظفة")}
                alt={
                  employeeName
                    ? tr(`صورة ${employeeName}`, `${employeeName} photo`)
                    : t("صورة الموظفة")
                }
                loading="eager"
              />
            ) : (
              <div className="dsv2-ew-photo-placeholder">
                <strong>{t("لا توجد صورة")}</strong>
                <span>
                  {t("ارفعي صورة شخصية من الجهاز.")}
                </span>
              </div>
            )}
          </div>

          {photoManagementEnabled ? (
            <div className="dsv2-ew-gallery">
              <label
                className="dsv2-ew-gallery__add"
                aria-disabled={
                  readOnly || profilePhotoBusy ? "true" : "false"
                }
              >
                {profilePhotoBusy
                  ? t("جاري رفع الصورة...")
                  : resolvedAvatar
                    ? t("تغيير الصورة")
                    : t("رفع صورة")}

                <input
                  type="file"
                  accept="image/*"
                  disabled={readOnly || profilePhotoBusy}
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (file) {
                      void onProfilePhotoChange(file);
                    }

                    event.currentTarget.value = "";
                  }}
                />
              </label>

              {resolvedAvatar ? (
                <button
                  type="button"
                  className="dsv2-ew-gallery__add"
                  disabled={readOnly || profilePhotoBusy}
                  onClick={() => void onProfilePhotoRemove()}
                >
                  {t("حذف الصورة")}
                </button>
              ) : null}
            </div>
          ) : (
            <WorkspaceNoticeV2
              title="إدارة الصورة غير متاحة"
              description="يجب حفظ سجل الموظفة أولًا قبل إدارة الصورة الشخصية."
              tone="neutral"
            />
          )}

          <div className="dsv2-ew-rating-summary">
            <div>
              <span>{t("التقييم")}</span>
              <strong>
                {rating || "—"}
                {rating ? " / 5" : ""}
              </strong>
              <small>{tr(`${reviewsCount || "0"} تقييم`, `${reviewsCount || "0"} reviews`)}</small>
            </div>
          </div>
        </WorkspaceCardV2>

        <WorkspaceCardV2
          title="بيانات الملف العام"
          description="السيرة والتقييمات المرتبطة بملف الموظفة."
        >
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2
              id="employee-live-v2-cv-url"
              label={t("رابط السيرة الذاتية")}
            >
              <input
                id="employee-live-v2-cv-url"
                className="dsv2-input"
                dir="ltr"
                value={cvUrl}
                disabled={readOnly}
                onChange={(event) =>
                  onCvUrlChange(event.target.value)
                }
              />
            </DashboardFieldV2>

            <DashboardFieldV2
              id="employee-live-v2-rating"
              label={t("تقييم العرض")}
            >
              <DashboardNumberInputV2
                id="employee-live-v2-rating"
                className="dsv2-input"
                min="0"
                max="5"
                step="0.1"
                value={rating}
                disabled={readOnly}
                onChange={(event) =>
                  onRatingChange(event.target.value)
                }
              />
            </DashboardFieldV2>

            <DashboardFieldV2
              id="employee-live-v2-reviews"
              label={t("عدد التقييمات")}
            >
              <DashboardNumberInputV2
                id="employee-live-v2-reviews"
                className="dsv2-input"
                min="0"
                step="1"
                value={reviewsCount}
                disabled={readOnly}
                onChange={(event) =>
                  onReviewsCountChange(event.target.value)
                }
              />
            </DashboardFieldV2>
          </div>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2
        title="النبذة التعريفية"
        description="النص الذي يظهر للعميلات عند استعراض الموظفة."
      >
        <DashboardFieldV2
          id="employee-live-v2-bio"
          label={t("النبذة")}
          hint={tr(`${bio.length} حرف`, `${bio.length} characters`)}
        >
          <textarea
            id="employee-live-v2-bio"
            className="dsv2-textarea dsv2-ew-bio"
            rows={6}
            value={bio}
            disabled={readOnly}
            onChange={(event) =>
              onBioChange(event.target.value)
            }
          />
        </DashboardFieldV2>
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="سجل الصور السابقة"
        description="الصور المستبدلة أو المؤرشفة تبقى محفوظة للسجل دون حذفها من R2."
      >
        {historicalPhotos.length ? (
          <div className="dsv2-ew-gallery">
            {historicalPhotos.map((photo) => (
              <div
                key={photo.id}
                className="dsv2-ew-gallery__item"
              >
                <strong>
                  {photo.fileName || t("صورة شخصية")}
                </strong>

                <small>
                  {photoStatusLabel(photo.status)}
                </small>

                <small>
                  {photo.createdAt
                    ? new Date(photo.createdAt).toLocaleString(language === "en" ? "en-GB" : "ar-SA")
                    : t("بدون تاريخ")}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <WorkspaceNoticeV2
            title="لا توجد صور سابقة"
            description="عند تغيير أو حذف الصورة الحالية ستظهر النسخ السابقة هنا."
            tone="neutral"
          />
        )}
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
  const { language, t, tr } = useEmployeeLanguage();
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
    const query = selectedSearch.trim().toLocaleLowerCase(language === "en" ? "en" : "ar");
    return specialties
      .map((id) => serviceById.get(id))
      .filter((service): service is EmployeeServiceOptionLiveV2 => Boolean(service))
      .filter((service) => {
        if (!query) return true;
        const raw = service.label.toLocaleLowerCase("ar");
        const translated = translateBookingCatalogLabel(language, service.label, "service")
          .toLocaleLowerCase(language === "en" ? "en" : "ar");
        return raw.includes(query) || translated.includes(query);
      });
  }, [language, selectedSearch, serviceById, specialties]);

  const selectVisible = () => {
    onSpecialtiesChange(Array.from(new Set([...specialties, ...scopedServices.map((service) => service.id)])));
  };

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الخدمات"
        description="إسناد الخدمات والبحث والتصفية من مكوّن V2 مستقل مرتبط بالقائمة الفعلية."
        badge={<WorkspaceStatusBadgeV2 tone="success">{tr(`${specialties.length} خدمات محددة`, `${specialties.length} selected services`)}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="المتاح" value={serviceOptions.length} />
        <WorkspaceMetricV2 label="المحدد" value={specialties.length} tone="success" />
        <WorkspaceMetricV2 label="نتائج التصفية" value={scopedServices.length} tone="gold" />
        <WorkspaceMetricV2 label="الأقسام" value={sectionOptions.length} />
      </div>

      <WorkspaceCardV2 title="البحث والتصفية" description="قوائم V2 فقط، بدون select أصلي أو EmployeeSelect القديم.">
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
          <DashboardFieldV2 id="employee-live-v2-service-search" label={t("البحث")}>
            <input
              id="employee-live-v2-service-search"
              className="dsv2-input"
              value={search}
              placeholder={t("اسم الخدمة أو القسم")}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-service-section" label={t("القسم")}>
            <DashboardSelectV2
              id="employee-live-v2-service-section"
              value={section}
              options={[
                { value: "all", label: t("كل الأقسام") },
                ...sectionOptions.map((item) => ({
                  value: item.id,
                  label: translateBookingCatalogLabel(language, item.label, "section"),
                })),
              ]}
              onChange={onSectionChange}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-service-scope" label={t("نطاق العرض")}>
            <DashboardSelectV2
              id="employee-live-v2-service-scope"
              value={scope}
              options={[
                { value: "all", label: t("الكل") },
                { value: "selected", label: t("المختارة") },
                { value: "unselected", label: t("غير المختارة") },
              ]}
              onChange={setScope}
            />
          </DashboardFieldV2>
        </div>

        <div className="dsv2-cluster">
          <button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={readOnly || !scopedServices.length} onClick={selectVisible}>{t("تحديد الظاهر")}</button>
          <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly || !specialties.length} onClick={() => onSpecialtiesChange([])}>{t("مسح الكل")}</button>
        </div>
      </WorkspaceCardV2>

      <div className="dsv2-ew-services-layout">
        <WorkspaceCardV2 title="الخدمات المتاحة" description={tr(`${scopedServices.length} نتيجة`, `${scopedServices.length} results`)} className="dsv2-ew-services-catalog">
          {scopedServices.length ? (
            <div className="dsv2-ew-service-cards">
              {scopedServices.slice(0, visibleCount).map((service) => {
                const selected = selectedSet.has(service.id);
                return (
                  <article key={service.id} className="dsv2-ew-service-card" data-selected={selected ? "true" : "false"}>
                    <div className="dsv2-ew-service-card__main">
                      <span className="dsv2-ew-service-card__category">
                        {translateBookingCatalogLabel(
                          language,
                          serviceSectionLabel(service, sectionOptions),
                          "section"
                        )}
                      </span>
                      <strong>{translateBookingCatalogLabel(language, service.label, "service")}</strong>
                      <small>
                        {Number(service.durationMin || 0) > 0 ? `${Number(service.durationMin).toLocaleString(language === "en" ? "en-US" : "ar-SA-u-nu-latn")} ${t("دقيقة")}` : t("مدة غير محددة")}
                        {Number(service.price || 0) > 0 ? ` · ${Number(service.price).toLocaleString(language === "en" ? "en-US" : "ar-SA-u-nu-latn")} SAR` : ""}
                      </small>
                    </div>
                    <button
                      type="button"
                      className={selected ? "dsv2-btn dsv2-btn--success dsv2-btn--sm" : "dsv2-btn dsv2-btn--accent dsv2-btn--sm"}
                      disabled={readOnly}
                      onClick={() => onToggleSpecialty(service.id)}
                    >
                      {selected ? t("محددة") : t("تحديد")}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="dsv2-ew-inline-empty"><strong>{t("لا توجد نتائج")}</strong><span>{t("غيّر البحث أو القسم أو نطاق العرض.")}</span></div>
          )}

          {visibleCount < scopedServices.length ? (
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-ew-load-more" onClick={() => setVisibleCount((current) => current + 24)}>{t("عرض المزيد")}</button>
          ) : null}
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="الخدمات المختارة" description="قائمة مستقلة مضغوطة." className="dsv2-ew-services-selected">
          <DashboardFieldV2 id="employee-live-v2-selected-search" label={t("البحث داخل المختارة")}>
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
                    <strong>{translateBookingCatalogLabel(language, service.label, "service")}</strong>
                    <small>
                      {translateBookingCatalogLabel(
                        language,
                        serviceSectionLabel(service, sectionOptions),
                        "section"
                      )}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="dsv2-ew-icon-btn"
                    disabled={readOnly}
                    aria-label={tr(
                      `إزالة ${service.label}`,
                      `Remove ${translateBookingCatalogLabel(language, service.label, "service")}`
                    )}
                    onClick={() => onToggleSpecialty(service.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="dsv2-ew-inline-empty"><strong>{specialties.length ? t("لا توجد نتيجة مطابقة") : t("لم تُحدد خدمات")}</strong><span>{specialties.length ? t("امسح عبارة البحث لعرض القائمة.") : t("اختاري الخدمات من القائمة المجاورة.")}</span></div>
          )}
        </WorkspaceCardV2>
      </div>
    </div>
  );
}
