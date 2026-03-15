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
      <b className="emp-modal-section-title">ملف الموظفة</b>
      <div className="emp-modal-fields">
        <div className="dash-field">
          <label className="emp-label">صورة الموظفة (من ملفات المشروع)</label>
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
          {resolvedAvatar ? (
            <div style={{ marginTop: 10 }}>
              <img
                src={resolvedAvatar}
                alt="معاينة صورة الموظفة"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                  objectFit: "cover",
                  border: "1px solid rgba(13,13,13,0.12)",
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="dash-field">
          <label className="emp-label">نبذة تعريفية</label>
          <textarea
            className="dash-textarea"
            rows={3}
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
  );
}
