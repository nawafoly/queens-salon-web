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

        <div className="dash-field">
          <label className="emp-label">الحالة</label>
          <select
            className="dash-select"
            value={active ? "1" : "0"}
            onChange={(e) => onActiveChange(e.target.value === "1")}
          >
            <option value="1">نشطة</option>
            <option value="0">غير نشطة</option>
          </select>
        </div>

        <div className="dash-field">
          <label className="emp-label">يظهر في صفحة "من نحن"؟</label>
          <select
            className="dash-select"
            value={showOnAbout ? "1" : "0"}
            onChange={(e) => onShowOnAboutChange(e.target.value === "1")}
          >
            <option value="1">نعم (يظهر)</option>
            <option value="0">لا (مخفي)</option>
          </select>
        </div>

        <div className="dash-field">
          <label className="emp-label">تظهر في صفحة "الحجز"؟</label>
          <select
            className="dash-select"
            value={showOnBooking ? "1" : "0"}
            onChange={(e) => onShowOnBookingChange(e.target.value === "1")}
          >
            <option value="1">نعم (تظهر)</option>
            <option value="0">لا (مخفية)</option>
          </select>
        </div>

        <div className="dash-field">
          <label className="emp-label">الإجازة الأسبوعية الثابتة</label>
          <div className="emp-field-note is-boxed">{String(weeklyOffLabel || "لا توجد إجازة أسبوعية ثابتة.")}</div>
        </div>
      </div>
    </div>
  );
}
