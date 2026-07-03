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

  return (
    <div className="emp-modal-section">
      <header className="emp-section-header">
        <div className="emp-section-header__main">
          <h3 className="emp-modal-section-title">المعلومات الأساسية</h3>
          <p className="emp-section-lead">
            الاسم والحالة وإعدادات الظهور في النظام وصفحة الحجز.
          </p>
        </div>
      </header>

      <div className="emp-modal-fields two-cols">
        <div className="dash-field">
          <label className="emp-label">اسم الموظفة</label>
          <input
            className="dash-input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="مثال: حنان"
          />
        </div>

        <div className="dash-field emp-choice-field">
          <label className="emp-label">الحالة</label>
          <div className="emp-choice-group" role="group" aria-label="حالة الموظفة">
            <button
              type="button"
              className={`emp-choice-card ${active ? "is-selected" : ""}`}
              aria-pressed={active}
              onClick={() => onActiveChange(true)}
            >
              <strong>نشطة</strong>
              <span>تظهر وتعمل حسب الإعدادات</span>
            </button>
            <button
              type="button"
              className={`emp-choice-card ${!active ? "is-selected" : ""}`}
              aria-pressed={!active}
              onClick={() => onActiveChange(false)}
            >
              <strong>غير نشطة</strong>
              <span>إيقاف مؤقت من النظام</span>
            </button>
          </div>
        </div>

        <div className="dash-field emp-choice-field">
          <label className="emp-label">يظهر في صفحة "من نحن"؟</label>
          <div className="emp-choice-group" role="group" aria-label="الظهور في صفحة من نحن">
            <button
              type="button"
              className={`emp-choice-card ${showOnAbout ? "is-selected" : ""}`}
              aria-pressed={showOnAbout}
              onClick={() => onShowOnAboutChange(true)}
            >
              <strong>يظهر</strong>
              <span>مناسب للملف العام</span>
            </button>
            <button
              type="button"
              className={`emp-choice-card ${!showOnAbout ? "is-selected" : ""}`}
              aria-pressed={!showOnAbout}
              onClick={() => onShowOnAboutChange(false)}
            >
              <strong>مخفي</strong>
              <span>لا يظهر للعملاء</span>
            </button>
          </div>
        </div>

        <div className="dash-field emp-choice-field">
          <label className="emp-label">تظهر في صفحة "الحجز"؟</label>
          <div className="emp-choice-group" role="group" aria-label="الظهور في صفحة الحجز">
            <button
              type="button"
              className={`emp-choice-card ${showOnBooking ? "is-selected" : ""}`}
              aria-pressed={showOnBooking}
              onClick={() => onShowOnBookingChange(true)}
            >
              <strong>متاحة للحجز</strong>
              <span>تظهر للعميلات</span>
            </button>
            <button
              type="button"
              className={`emp-choice-card ${!showOnBooking ? "is-selected" : ""}`}
              aria-pressed={!showOnBooking}
              onClick={() => onShowOnBookingChange(false)}
            >
              <strong>مخفية</strong>
              <span>لا تظهر في الحجز</span>
            </button>
          </div>
        </div>

        <div className="dash-field">
          <label className="emp-label">الإجازة الأسبوعية الثابتة</label>
          <div className="emp-field-note is-boxed">{String(weeklyOffLabel || "لا توجد إجازة أسبوعية ثابتة.")}</div>
        </div>
      </div>
    </div>
  );
}
