import EmployeeSelect from "../../components/EmployeeSelect";
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

function getServiceSectionLabel(service: ServiceOption) {
  const rawSection = String(service.sectionId || "").trim();

  return (
    toArabicSectionLabel(rawSection, rawSection) ||
    "قسم غير محدد"
  );
}

function formatServiceFacts(service: ServiceOption) {
  const facts: string[] = [];
  const duration = Number(service.durationMin || 0);
  const price = Number(service.price || 0);

  if (duration > 0) {
    facts.push(`${duration} دقيقة`);
  }

  if (price > 0) {
    facts.push(`${price.toLocaleString("ar-SA")} ر.س`);
  }

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
  const [pickerView, setPickerView] =
    useState<ServicePickerView>("all");

  const [renderLimit, setRenderLimit] =
    useState(SERVICE_RENDER_BATCH);

  const selectedCount = specialties.length;

  const serviceById = useMemo(
    () =>
      new Map(
        serviceOptions.map(
          (service) => [service.id, service] as const
        )
      ),
    [serviceOptions]
  );

  const selectedSet = useMemo(
    () => new Set(specialties),
    [specialties]
  );

  const selectedServices = useMemo(
    () =>
      specialties
        .map((id) => serviceById.get(id))
        .filter(
          (service): service is ServiceOption =>
            Boolean(service)
        ),
    [serviceById, specialties]
  );

  const visibleServices = useMemo(
    () =>
      pickerView === "selected"
        ? filteredServicesForPicks.filter((service) =>
            selectedSet.has(service.id)
          )
        : filteredServicesForPicks,
    [
      filteredServicesForPicks,
      pickerView,
      selectedSet,
    ]
  );

  useEffect(() => {
    setRenderLimit(SERVICE_RENDER_BATCH);
  }, [pickerView, srvQ, srvSection]);

  const renderedServices = useMemo(
    () => visibleServices.slice(0, renderLimit),
    [renderLimit, visibleServices]
  );

  const hasMoreServices =
    renderedServices.length < visibleServices.length;

  const selectVisibleServices = () => {
    onSpecialtiesChange(
      Array.from(
        new Set([
          ...specialties,
          ...filteredServicesForPicks.map(
            (service) => service.id
          ),
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
    <section className="emp-modal-section emp-services-section">
      <header className="emp-section-header emp-services-header">
        <div className="emp-section-header__main">
          <span className="emp-services-eyebrow">
            Service Assignment
          </span>

          <h3 className="emp-modal-section-title">
            خدمات الموظفة
          </h3>

          <p className="emp-section-lead">
            حددي الخدمات التي تتقنها الموظفة. الخدمات
            المحددة فقط يمكن ربطها بالحجز وملف الموظفة.
          </p>
        </div>

        <div className="emp-services-header__summary">
          <span className="is-selected">
            {selectedCount} خدمة محددة
          </span>

          <span>
            {visibleServices.length} نتيجة ظاهرة
          </span>
        </div>
      </header>

      <div className="emp-services-toolbar">
        <div className="emp-services-search">
          <label
            className="emp-label"
            htmlFor="employee-services-search"
          >
            البحث في الخدمات
          </label>

          <input
            id="employee-services-search"
            className="dash-input"
            placeholder="اكتبي اسم الخدمة أو القسم..."
            value={srvQ}
            onChange={(event) =>
              onSrvQChange(event.target.value)
            }
          />
        </div>

        <div className="emp-services-section-filter">
          <label
            className="emp-label"
            htmlFor="employee-services-section"
          >
            القسم
          </label>

                    <EmployeeSelect
            id="employee-services-section"
            value={srvSection}
            ariaLabel="قسم الخدمات"
            placeholder="كل الأقسام"
            options={[
              {
                value: "all",
                label: "كل الأقسام",
              },
              ...sectionOptions.map((section) => ({
                value: section.id,
                label: section.label,
              })),
            ]}
            onChange={onSrvSectionChange}
          />
        </div>

        <div
          className="emp-services-view-switch"
          role="tablist"
          aria-label="نوع عرض الخدمات"
        >
          <button
            type="button"
            role="tab"
            aria-selected={pickerView === "all"}
            className={
              pickerView === "all" ? "is-active" : ""
            }
            onClick={() => setPickerView("all")}
          >
            <span>كل الخدمات</span>
            <strong>
              {filteredServicesForPicks.length}
            </strong>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={pickerView === "selected"}
            className={
              pickerView === "selected"
                ? "is-active"
                : ""
            }
            onClick={() => setPickerView("selected")}
          >
            <span>المختارة</span>
            <strong>{selectedCount}</strong>
          </button>
        </div>
      </div>

      <div className="emp-services-bulkbar">
        <div>
          <strong>
            {pickerView === "selected"
              ? "الخدمات المحددة"
              : "نتائج البحث الحالية"}
          </strong>

          <span>
            يمكنك تحديد نتائج البحث الحالية أو إزالة جميع
            الاختيارات.
          </span>
        </div>

        <div className="emp-services-bulkbar__actions">
          <button
            type="button"
            className="exp-btn primary"
            disabled={!filteredServicesForPicks.length}
            onClick={selectVisibleServices}
          >
            تحديد النتائج
          </button>

          <button
            type="button"
            className="exp-btn ghost"
            disabled={!selectedCount}
            onClick={clearSelectedServices}
          >
            مسح الاختيار
          </button>
        </div>
      </div>

      <div className="emp-services-workspace">
        <div className="emp-services-catalog">
          <div className="emp-services-catalog__head">
            <div>
              <strong>
                {pickerView === "selected"
                  ? "الخدمات المختارة"
                  : "قائمة الخدمات"}
              </strong>

              <span>
                اضغطي على البطاقة لتحديد الخدمة أو إزالتها.
              </span>
            </div>

            <span className="emp-services-result-count">
              {visibleServices.length} نتيجة
            </span>
          </div>

          {visibleServices.length === 0 ? (
            <div className="emp-services-empty">
              <strong>لا توجد خدمات مطابقة</strong>

              <span>
                غيّري كلمة البحث أو اختاري قسمًا آخر.
              </span>
            </div>
          ) : (
            <div
              className="emp-services-grid"
              aria-label="قائمة الخدمات"
            >
              {renderedServices.map((service) => {
                const selected =
                  selectedSet.has(service.id);

                const sectionLabel =
                  getServiceSectionLabel(service);

                const facts =
                  formatServiceFacts(service);

                return (
                  <button
                    key={service.id}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    className={`emp-service-card ${
                      selected ? "is-selected" : ""
                    }`}
                    onClick={() =>
                      onToggleSpecialty(service.id)
                    }
                  >
                    <span
                      className="emp-service-card__check"
                      aria-hidden="true"
                    />

                    <span className="emp-service-card__body">
                      <strong dir="auto">
                        {service.label}
                      </strong>

                      <small>{sectionLabel}</small>
                    </span>

                    <span className="emp-service-card__facts">
                      {facts.length ? (
                        facts.map((fact) => (
                          <em key={fact}>{fact}</em>
                        ))
                      ) : (
                        <em>بدون مدة أو سعر محدد</em>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {hasMoreServices ? (
            <button
              type="button"
              className="exp-btn ghost emp-services-load-more"
              onClick={() =>
                setRenderLimit(
                  (current) =>
                    current + SERVICE_RENDER_BATCH
                )
              }
            >
              عرض المزيد
              <span>
                (
                {visibleServices.length -
                  renderedServices.length}
                )
              </span>
            </button>
          ) : null}
        </div>

        <aside className="emp-services-selected-panel">
          <div className="emp-services-selected-panel__head">
            <div>
              <span>ملخص الاختيار</span>
              <strong>خدمات الموظفة</strong>
            </div>

            <b>{selectedCount}</b>
          </div>

          {selectedServices.length ? (
            <div className="emp-services-selected-list">
              {selectedServices.map((service) => {
                const facts =
                  formatServiceFacts(service);

                const subtitle = facts.length
                  ? facts.join(" • ")
                  : getServiceSectionLabel(service);

                return (
                  <div
                    key={service.id}
                    className="emp-services-selected-item"
                  >
                    <div>
                      <strong dir="auto">
                        {service.label}
                      </strong>

                      <span>{subtitle}</span>
                    </div>

                    <button
                      type="button"
                      aria-label={`إزالة ${service.label}`}
                      onClick={() =>
                        onToggleSpecialty(service.id)
                      }
                    >
                      إزالة
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="emp-services-selected-empty">
              <strong>لم يتم اختيار خدمات</strong>

              <span>
                اختاري خدمة من القائمة وستظهر هنا قبل الحفظ.
              </span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}