type BasicInfoSectionProps = {
  isVisible: boolean;
  name: string;
  active: boolean;
  showOnAbout: boolean;
  showOnBooking: boolean;
  weeklyOffLabel: string;
  onNameChange: (value: string) => void;
  onActiveChange: (value: boolean) => void;
  onShowOnAboutChange: (value: boolean) => void;
  onShowOnBookingChange: (value: boolean) => void;
};

type ChoiceCardProps = {
  selected: boolean;
  title: string;
  description: string;
  tone?: "positive" | "neutral" | "warning";
  onClick: () => void;
};

function ChoiceCard({
  selected,
  title,
  description,
  tone = "neutral",
  onClick,
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      className={`emp-basic-choice ${selected ? "is-selected" : ""} is-${tone}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="emp-basic-choice__indicator" aria-hidden="true" />

      <span className="emp-basic-choice__copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
}

export default function BasicInfoSection({
  isVisible,
  name,
  active,
  showOnAbout,
  showOnBooking,
  weeklyOffLabel,
  onNameChange,
  onActiveChange,
  onShowOnAboutChange,
  onShowOnBookingChange,
}: BasicInfoSectionProps) {
  if (!isVisible) return null;

  const resolvedWeeklyOff =
    String(weeklyOffLabel || "").trim() ||
    "لا توجد إجازة أسبوعية ثابتة.";

  return (
    <section className="emp-modal-section emp-basic-section">
      <header className="emp-section-header emp-basic-header">
        <div className="emp-section-header__main">
          <span className="emp-basic-eyebrow">الملف الوظيفي</span>

          <h3 className="emp-modal-section-title">
            المعلومات الأساسية
          </h3>

          <p className="emp-section-lead">
            إدارة اسم الموظفة وحالتها وظهورها في الموقع وصفحة الحجز.
          </p>
        </div>

        <div
          className="emp-basic-summary"
          aria-label="ملخص حالة الموظفة"
        >
          <span
            className={`emp-basic-summary__item ${
              active ? "is-positive" : "is-muted"
            }`}
          >
            {active ? "نشطة" : "غير نشطة"}
          </span>

          <span
            className={`emp-basic-summary__item ${
              showOnAbout ? "is-positive" : "is-muted"
            }`}
          >
            {showOnAbout ? "ظاهرة في من نحن" : "مخفية من من نحن"}
          </span>

          <span
            className={`emp-basic-summary__item ${
              showOnBooking ? "is-positive" : "is-warning"
            }`}
          >
            {showOnBooking ? "متاحة للحجز" : "مخفية من الحجز"}
          </span>
        </div>
      </header>

      <div className="emp-basic-layout">
        <div className="emp-basic-layout__main">
          <article className="emp-basic-card emp-basic-card--identity">
            <div className="emp-basic-card__head">
              <div>
                <span className="emp-basic-card__number">01</span>
                <h4>هوية الموظفة</h4>
              </div>

              <p>الاسم المعتمد داخل النظام وفي واجهات العميلات.</p>
            </div>

            <div className="dash-field emp-basic-name-field">
              <label className="emp-label" htmlFor="employee-basic-name">
                اسم الموظفة
              </label>

              <input
                id="employee-basic-name"
                className="dash-input"
                value={name}
                onChange={(event) =>
                  onNameChange(event.target.value)
                }
                placeholder="مثال: حنان"
                autoComplete="off"
              />

              <small className="emp-basic-field-help">
                استخدمي الاسم الذي سيظهر في الحجز والملف العام.
              </small>
            </div>
          </article>

          <article className="emp-basic-card emp-basic-card--status">
            <div className="emp-basic-card__head">
              <div>
                <span className="emp-basic-card__number">02</span>
                <h4>حالة الحساب</h4>
              </div>

              <p>
                تحدد إمكانية استخدام الموظفة داخل النظام.
              </p>
            </div>

            <div
              className="emp-basic-choice-grid"
              role="group"
              aria-label="حالة الموظفة"
            >
              <ChoiceCard
                selected={active}
                title="نشطة"
                description="الحساب يعمل حسب إعدادات الدوام والخدمات."
                tone="positive"
                onClick={() => onActiveChange(true)}
              />

              <ChoiceCard
                selected={!active}
                title="غير نشطة"
                description="إيقاف مؤقت للحساب دون حذف بياناته."
                tone="warning"
                onClick={() => onActiveChange(false)}
              />
            </div>
          </article>
        </div>

        <aside className="emp-basic-layout__side">
          <article className="emp-basic-card">
            <div className="emp-basic-card__head">
              <div>
                <span className="emp-basic-card__number">03</span>
                <h4>الظهور في «من نحن»</h4>
              </div>
            </div>

            <div
              className="emp-basic-choice-grid emp-basic-choice-grid--stack"
              role="group"
              aria-label="الظهور في صفحة من نحن"
            >
              <ChoiceCard
                selected={showOnAbout}
                title="تظهر في الصفحة"
                description="تُعرض ضمن فريق الصالون في الموقع العام."
                tone="positive"
                onClick={() => onShowOnAboutChange(true)}
              />

              <ChoiceCard
                selected={!showOnAbout}
                title="مخفية من الصفحة"
                description="تبقى داخل النظام ولا تظهر للعميلات."
                onClick={() => onShowOnAboutChange(false)}
              />
            </div>
          </article>

          <article className="emp-basic-card">
            <div className="emp-basic-card__head">
              <div>
                <span className="emp-basic-card__number">04</span>
                <h4>الظهور في الحجز</h4>
              </div>
            </div>

            <div
              className="emp-basic-choice-grid emp-basic-choice-grid--stack"
              role="group"
              aria-label="الظهور في صفحة الحجز"
            >
              <ChoiceCard
                selected={showOnBooking}
                title="متاحة للحجز"
                description="يمكن للعميلات اختيار الموظفة أثناء الحجز."
                tone="positive"
                onClick={() => onShowOnBookingChange(true)}
              />

              <ChoiceCard
                selected={!showOnBooking}
                title="مخفية من الحجز"
                description="لا تظهر في اختيار الموظفات حاليًا."
                tone="warning"
                onClick={() => onShowOnBookingChange(false)}
              />
            </div>
          </article>

          <article className="emp-basic-card emp-basic-card--weekly">
            <div className="emp-basic-card__head">
              <div>
                <span className="emp-basic-card__number">05</span>
                <h4>الإجازة الأسبوعية</h4>
              </div>
            </div>

            <div className="emp-basic-weekly-off">
              <span>اليوم المسجل حاليًا</span>
              <strong>{resolvedWeeklyOff}</strong>
              <small>
                يتم تعديل الجدول من تبويب «جدول الدوام».
              </small>
            </div>
          </article>
        </aside>
      </div>
    </section>
  );
}