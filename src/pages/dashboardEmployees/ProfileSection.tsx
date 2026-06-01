type ProfileSectionProps = {
  isVisible: boolean;
  avatarUrl: string;
  bio: string;
  cvUrl: string;
  staffImageOptions: Array<{ label: string; value: string }>;
  resolveAvatarFromAssets: (raw: string) => string;
  onAvatarUrlChange: (value: string) => void;
  onBioChange: (value: string) => void;
  onCvUrlChange: (value: string) => void;
};

export default function ProfileSection({
  isVisible,
  avatarUrl,
  bio,
  cvUrl,
  staffImageOptions,
  resolveAvatarFromAssets,
  onAvatarUrlChange,
  onBioChange,
  onCvUrlChange,
}: ProfileSectionProps) {
  if (!isVisible) return null;

  const resolvedAvatar = resolveAvatarFromAssets(avatarUrl);

  return (
    <div className="emp-modal-section">
      <header className="emp-section-header">
        <div className="emp-section-header__main">
          <h3 className="emp-modal-section-title">ملف الموظفة</h3>
          <p className="emp-section-lead">
            الملف الظاهر للعميل والإدارة. الصورة والنبذة والسيرة الذاتية تقدّم الموظفة بشكل أوضح.
          </p>
        </div>
      </header>

      <div className="emp-profile-layout">
        <aside className="emp-profile-photo-card">
          {resolvedAvatar ? (
            <img src={resolvedAvatar} alt="معاينة صورة الموظفة" className="emp-profile-photo-preview" />
          ) : (
            <div className="emp-profile-photo-placeholder">بدون صورة</div>
          )}
          <div className="dash-field emp-profile-photo-field">
            <label className="emp-label">الصورة</label>
            <select
              className="dash-select"
              value={resolvedAvatar}
              onChange={(e) => onAvatarUrlChange(e.target.value)}
            >
              <option value="">بدون صورة</option>
              {staffImageOptions.map((img) => (
                <option key={img.value} value={img.value}>
                  {img.label}
                </option>
              ))}
            </select>
          </div>
        </aside>

        <div className="emp-profile-fields">
          <div className="dash-field">
            <label className="emp-label">نبذة تعريفية</label>
            <textarea
              className="dash-textarea"
              rows={4}
              value={bio}
              onChange={(e) => onBioChange(e.target.value)}
              placeholder="مثال: خبيرة شعر وصبغات بخبرة 8 سنوات..."
            />
          </div>

          <div className="dash-field">
            <label className="emp-label">رابط السيرة الذاتية PDF (اختياري)</label>
            <input
              className="dash-input"
              value={cvUrl}
              onChange={(e) => onCvUrlChange(e.target.value)}
              placeholder="https://.../cv.pdf"
              dir="ltr"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
