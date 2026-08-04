import { DashboardSelectV2 } from "../../components/dashboard-v2";
import { useMemo, useState } from "react";

import { toArabicSectionLabel, type ServiceOption } from "./shared";

type ServicePickerView = "all" | "selected";

const SERVICE_RENDER_BATCH = 36;

type ServicesSectionProps = {
  isVisible: boolean;
  srvQ: string;
  srvSection: string;
  sectionOptions: Array<{ id: string; label: string }>;
  serviceOptions: ServiceOption[];
  filteredServicesForPicks: ServiceOption[];
  specialties: string[];
  onSrvQChange: (value: string) => void;
  onSrvSectionChange: (value: string) => void;
  onToggleSpecialty: (serviceId: string) => void;
  onSpecialtiesChange: (value: string[]) => void;
};

function getServiceSectionLabel(service: ServiceOption) {
  const rawSection = String(service.sectionId || "").trim();

  return toArabicSectionLabel(rawSection, rawSection) || "قسم غير محدد";
}

function getServiceDuration(service: ServiceOption) {
  const duration = Number(service.durationMin || 0);
  return duration > 0 ? `${duration.toLocaleString("ar-SA")} دقيقة` : "مدة غير محددة";
}

function getServicePrice(service: ServiceOption) {
  const price = Number(service.price || 0);
  return price > 0 ? `${price.toLocaleString("ar-SA")} ر.س` : "سعر غير محدد";
}

function normalizeSearchValue(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("ar");
}

export default function ServicesSection({
  isVisible,
  srvQ,
  srvSection,
  sectionOptions,
  serviceOptions,
  filteredServicesForPicks,
  specialties,
  onSrvQChange,
  onSrvSectionChange,
  onToggleSpecialty,
  onSpecialtiesChange,
}: ServicesSectionProps) {
  const [pickerView, setPickerView] = useState<ServicePickerView>("all");
  const [renderLimit, setRenderLimit] = useState(SERVICE_RENDER_BATCH);
  const [selectedQuery, setSelectedQuery] = useState("");

  const selectedCount = specialties.length;

  const serviceById = useMemo(
    () => new Map(serviceOptions.map((service) => [service.id, service] as const)),
    [serviceOptions]
  );

  const selectedSet = useMemo(() => new Set(specialties), [specialties]);

  const selectedServices = useMemo(
    () =>
      specialties
        .map((id) => serviceById.get(id))
        .filter((service): service is ServiceOption => Boolean(service)),
    [serviceById, specialties]
  );

  const filteredSelectedServices = useMemo(() => {
    const query = normalizeSearchValue(selectedQuery);
    if (!query) return selectedServices;

    return selectedServices.filter((service) => {
      const haystack = normalizeSearchValue(
        `${service.label} ${getServiceSectionLabel(service)}`
      );
      return haystack.includes(query);
    });
  }, [selectedQuery, selectedServices]);

  const visibleServices = useMemo(
    () =>
      pickerView === "selected"
        ? filteredServicesForPicks.filter((service) => selectedSet.has(service.id))
        : filteredServicesForPicks,
    [filteredServicesForPicks, pickerView, selectedSet]
  );

  const renderedServices = useMemo(
    () => visibleServices.slice(0, renderLimit),
    [renderLimit, visibleServices]
  );

  const hasMoreServices = renderedServices.length < visibleServices.length;

  const selectVisibleServices = () => {
    onSpecialtiesChange(
      Array.from(
        new Set([
          ...specialties,
          ...filteredServicesForPicks.map((service) => service.id),
        ])
      )
    );
  };

  const clearSelectedServices = () => {
    onSpecialtiesChange([]);
    setPickerView("all");
    setSelectedQuery("");
  };

  if (!isVisible) return null;

  return (
    <section className="emp-modal-section emp-services-redesign">
      <header className="emp-svc-hero">
        <div className="emp-svc-hero__copy">
          <span className="emp-svc-eyebrow">إدارة الخدمات</span>
          <h3>خدمات الموظفة</h3>
          <p>
            حددي الخدمات التي تنفذها الموظفة. اضغطي على أي بطاقة لإضافتها أو
            إزالتها من ملفها.
          </p>
        </div>

        <div className="emp-svc-stats" aria-label="ملخص الخدمات">
          <div className="is-primary">
            <strong>{selectedCount.toLocaleString("ar-SA")}</strong>
            <span>خدمة محددة</span>
          </div>
          <div>
            <strong>{serviceOptions.length.toLocaleString("ar-SA")}</strong>
            <span>خدمة متاحة</span>
          </div>
        </div>
      </header>

      <div className="emp-svc-controlbar">
        <label className="emp-svc-field emp-svc-field--search" htmlFor="employee-services-search">
          <span>البحث</span>
          <input
            id="employee-services-search"
            className="dash-input"
            placeholder="اسم الخدمة أو القسم..."
            value={srvQ}
            onChange={(event) => {
              setRenderLimit(SERVICE_RENDER_BATCH);
              onSrvQChange(event.target.value);
            }}
          />
        </label>

        <div className="emp-svc-field emp-svc-field--section">
          <span>القسم</span>
          <DashboardSelectV2
            id="employee-services-section"
            className="emp-svc-section-select"
            value={srvSection}
            placeholder="كل الأقسام"
            options={[
              { value: "all", label: "كل الأقسام" },
              ...sectionOptions.map((section) => ({
                value: section.id,
                label: section.label,
              })),
            ]}
            onChange={(value) => {
              setRenderLimit(SERVICE_RENDER_BATCH);
              onSrvSectionChange(value);
            }}
          />
        </div>

        <div className="emp-svc-view-tabs" role="tablist" aria-label="نوع عرض الخدمات">
          <button
            type="button"
            role="tab"
            aria-selected={pickerView === "all"}
            className={pickerView === "all" ? "is-active" : ""}
            onClick={() => {
              setRenderLimit(SERVICE_RENDER_BATCH);
              setPickerView("all");
            }}
          >
            الكل
            <b>{filteredServicesForPicks.length.toLocaleString("ar-SA")}</b>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pickerView === "selected"}
            className={pickerView === "selected" ? "is-active" : ""}
            onClick={() => {
              setRenderLimit(SERVICE_RENDER_BATCH);
              setPickerView("selected");
            }}
          >
            المختارة
            <b>{selectedCount.toLocaleString("ar-SA")}</b>
          </button>
        </div>

        <div className="emp-svc-control-actions">
          <button
            type="button"
            className="emp-svc-btn emp-svc-btn--primary"
            disabled={!filteredServicesForPicks.length}
            onClick={selectVisibleServices}
          >
            تحديد الظاهر
          </button>
          <button
            type="button"
            className="emp-svc-btn emp-svc-btn--ghost"
            disabled={!selectedCount}
            onClick={clearSelectedServices}
          >
            مسح الكل
          </button>
        </div>
      </div>

      <div className="emp-svc-workspace">
        <div className="emp-svc-catalog">
          <header className="emp-svc-catalog__head">
            <div>
              <h4>{pickerView === "selected" ? "الخدمات المختارة" : "قائمة الخدمات"}</h4>
              <p>تظهر الخدمة المحددة بعلامة واضحة وخلفية عنابية خفيفة.</p>
            </div>
            <span>{visibleServices.length.toLocaleString("ar-SA")} نتيجة</span>
          </header>

          {visibleServices.length === 0 ? (
            <div className="emp-svc-empty">
              <strong>لا توجد خدمات مطابقة</strong>
              <span>غيّري كلمة البحث أو اختاري قسمًا آخر.</span>
            </div>
          ) : (
            <div className="emp-svc-grid" aria-label="قائمة الخدمات">
              {renderedServices.map((service) => {
                const selected = selectedSet.has(service.id);

                return (
                  <button
                    key={service.id}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    className={`emp-svc-card${selected ? " is-selected" : ""}`}
                    title={service.label}
                    onClick={() => onToggleSpecialty(service.id)}
                  >
                    <span className="emp-svc-card__check" aria-hidden="true">
                      {selected ? "✓" : ""}
                    </span>

                    <span className="emp-svc-card__content">
                      <strong dir="auto">{service.label}</strong>
                      <small>{getServiceSectionLabel(service)}</small>
                    </span>

                    <span className="emp-svc-card__meta">
                      <em>{getServiceDuration(service)}</em>
                      <em>{getServicePrice(service)}</em>
                    </span>

                    {selected ? <span className="emp-svc-card__badge">محددة</span> : null}
                  </button>
                );
              })}
            </div>
          )}

          {hasMoreServices ? (
            <button
              type="button"
              className="emp-svc-load-more"
              onClick={() => setRenderLimit((current) => current + SERVICE_RENDER_BATCH)}
            >
              عرض المزيد
              <span>
                {`(${(visibleServices.length - renderedServices.length).toLocaleString("ar-SA")})`}
              </span>
            </button>
          ) : null}
        </div>

        <aside className="emp-svc-selected-panel" aria-label="الخدمات المختارة">
          <header className="emp-svc-selected-panel__head">
            <div>
              <span>ملخص الاختيار</span>
              <h4>الخدمات المختارة</h4>
            </div>
            <b>{selectedCount.toLocaleString("ar-SA")}</b>
          </header>

          {selectedCount > 6 ? (
            <label className="emp-svc-selected-search" htmlFor="employee-selected-services-search">
              <span>بحث داخل المختارة</span>
              <input
                id="employee-selected-services-search"
                value={selectedQuery}
                placeholder="ابحثي عن خدمة..."
                onChange={(event) => setSelectedQuery(event.target.value)}
              />
            </label>
          ) : null}

          {selectedServices.length ? (
            filteredSelectedServices.length ? (
              <div
                className="emp-svc-selected-list"
                tabIndex={0}
                aria-label="قائمة الخدمات المختارة القابلة للتمرير"
              >
                {filteredSelectedServices.map((service) => (
                  <div
                    key={service.id}
                    className="emp-svc-selected-item"
                    title={service.label}
                  >
                    <div>
                      <strong dir="auto">{service.label}</strong>
                      <span>
                        {getServiceDuration(service)} · {getServicePrice(service)}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`إزالة ${service.label}`}
                      title="إزالة الخدمة"
                      onClick={() => onToggleSpecialty(service.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="emp-svc-selected-empty">
                <strong>لا توجد نتيجة</strong>
                <span>لا توجد خدمة مختارة تطابق البحث.</span>
              </div>
            )
          ) : (
            <div className="emp-svc-selected-empty">
              <strong>لم يتم اختيار خدمات</strong>
              <span>اختاري الخدمات من القائمة وستظهر هنا مباشرة.</span>
            </div>
          )}

          {selectedCount ? (
            <button type="button" className="emp-svc-clear-selected" onClick={clearSelectedServices}>
              إزالة جميع الخدمات المختارة
            </button>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
