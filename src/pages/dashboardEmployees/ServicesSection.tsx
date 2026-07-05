import { useEffect, useMemo, useState } from "react";

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

function formatServiceFacts(service: ServiceOption) {
  const facts: string[] = [];
  const duration = Number(service.durationMin || 0);
  const price = Number(service.price || 0);

  if (duration > 0) facts.push(`${duration} دقيقة`);
  if (price > 0) facts.push(`${price.toLocaleString("ar-SA")} ر.س`);
  return facts;
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

  const visibleServices = useMemo(
    () =>
      pickerView === "selected"
        ? filteredServicesForPicks.filter((service) => selectedSet.has(service.id))
        : filteredServicesForPicks,
    [filteredServicesForPicks, pickerView, selectedSet]
  );


  useEffect(() => {
    setRenderLimit(SERVICE_RENDER_BATCH);
  }, [pickerView, srvQ, srvSection]);

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
  };

  if (!isVisible) return null;

  return (
    <div className="emp-modal-section">
      <header className="emp-section-header">
        <div className="emp-section-header__main">
          <h3 className="emp-modal-section-title">الخدمات</h3>
          <p className="emp-section-lead">
            اختاري الخدمات التي تتقنها الموظفة. هذا يحدد ما يظهر لها في الحجز وبطاقة الملف.
          </p>
        </div>
        <div className="emp-section-header__aside">
          <span className="emp-badge accent">{selectedCount} خدمة محددة</span>
        </div>
      </header>

      <div className="emp-service-picker">
        <div className="emp-service-picker__toolbar">
          <input
            className="dash-input"
            placeholder="ابحث باسم الخدمة أو القسم..."
            value={srvQ}
            onChange={(e) => onSrvQChange(e.target.value)}
          />
          <select className="dash-select" value={srvSection} onChange={(e) => onSrvSectionChange(e.target.value)}>
            <option value="all">كل الأقسام</option>
            {sectionOptions.map((section) => (
              <option key={section.id} value={section.id}>
                {section.label}
              </option>
            ))}
          </select>
          <div className="emp-service-picker__views">
            <button
              type="button"
              className={`exp-btn ${pickerView === "all" ? "primary" : "ghost"}`}
              onClick={() => setPickerView("all")}
            >
              كل الخدمات
            </button>
            <button
              type="button"
              className={`exp-btn ${pickerView === "selected" ? "primary" : "ghost"}`}
              onClick={() => setPickerView("selected")}
            >
              المختارة ({selectedCount})
            </button>
          </div>
        </div>

        <div className="emp-service-picker__quickbar">
          <div>
            <strong>{selectedCount}</strong>
            <span>خدمة مفعلة للموظفة</span>
            <span>{visibleServices.length} نتيجة ظاهرة</span>
          </div>
          <div>
            <button
              type="button"
              className={`dash-btn ${!filteredServicesForPicks.length ? "is-disabled" : ""}`}
              disabled={!filteredServicesForPicks.length}
              onClick={selectVisibleServices}
            >
              تحديد نتائج البحث
            </button>
            <button
              type="button"
              className={`dash-btn ${!selectedCount ? "is-disabled" : ""}`}
              disabled={!selectedCount}
              onClick={clearSelectedServices}
            >
              مسح الاختيار
            </button>
          </div>
        </div>

        <div className="emp-service-picker__body">
          <div className="emp-service-list" aria-label="قائمة الخدمات">
            {visibleServices.length === 0 ? (
              <div className="emp-service-empty">لا توجد خدمات مطابقة للبحث أو القسم المحدد.</div>
            ) : (
              renderedServices.map((service) => {
                const selected = selectedSet.has(service.id);
                const sectionLabel = toArabicSectionLabel(
                  String(service.sectionId || ""),
                  String(service.sectionId || "")
                );
                const facts = formatServiceFacts(service);

                return (
                  <label
                    key={service.id}
                    className={`emp-service-item ${selected ? "is-selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleSpecialty(service.id)}
                    />
                    <span className="emp-service-item__copy">
                      <strong>{service.label}</strong>
                      <small>{sectionLabel}</small>
                    </span>
                    <span className="emp-service-item__meta">
                      {service.categoryId ? <em>{service.categoryId}</em> : null}
                      {facts.map((fact) => (
                        <em key={fact}>{fact}</em>
                      ))}
                    </span>
                  </label>
                );
              })
            )}
            {hasMoreServices ? (
              <button
                type="button"
                className="exp-btn ghost emp-service-load-more"
                onClick={() => setRenderLimit((current) => current + SERVICE_RENDER_BATCH)}
              >
                عرض المزيد ({visibleServices.length - renderedServices.length})
              </button>
            ) : null}
          </div>

          <aside className="emp-service-selected">
            <div className="emp-service-selected__head">
              <b>خدمات الموظفة</b>
              <span>{selectedServices.length} محددة</span>
            </div>
            {selectedServices.length ? (
              <div className="emp-service-selected__list">
                {selectedServices.map((service) => {
                  const facts = formatServiceFacts(service);
                  return (
                    <div key={service.id} className="emp-service-selected__item">
                      <div>
                        <b>{service.label}</b>
                        <span>
                          {facts.length ? facts.join(" · ") : toArabicSectionLabel(String(service.sectionId || ""), String(service.sectionId || ""))}
                        </span>
                      </div>
                      <button type="button" className="dash-btn" onClick={() => onToggleSpecialty(service.id)}>
                        إزالة
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="emp-service-empty emp-service-empty--dark">
                اختاري خدمة من القائمة وستظهر هنا لتراجعيها قبل الحفظ.
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
