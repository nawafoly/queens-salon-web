type ProfileSectionProps = {
  isVisible: boolean;
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

import EmployeeAvatar from "../../components/EmployeeAvatar";

export default function ProfileSection({
  isVisible,
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
}: ProfileSectionProps) {
  if (!isVisible) return null;

  const normalizedAvatar = String(avatarUrl || "").trim();
  const resolvedAvatar = resolveAvatarFromAssets(normalizedAvatar);
  const normalizedRating = String(rating || "").trim();
  const normalizedReviews = String(reviewsCount || "").trim();

  const isSelectedImage = (value: string) => {
    const normalizedValue = String(value || "").trim();

    if (!normalizedValue) {
      return !normalizedAvatar;
    }

    if (normalizedAvatar === normalizedValue) {
      return true;
    }

    return (
      Boolean(resolvedAvatar) &&
      resolveAvatarFromAssets(normalizedValue) === resolvedAvatar
    );
  };

  return (
    <section className="emp-modal-section emp-profile-section">
      <header className="emp-section-header emp-profile-header">
        <div className="emp-section-header__main">
          <span className="emp-profile-eyebrow">الملف العام</span>

          <h3 className="emp-modal-section-title">الملف والصورة</h3>

          <p className="emp-section-lead">
            تحكّمي في صورة الموظفة، النبذة التعريفية والتقييمات التي تظهر
            للعميلات داخل الموقع والتطبيق.
          </p>
        </div>

        <div className="emp-profile-header__summary">
          <span className={resolvedAvatar ? "is-ready" : "is-empty"}>
            {resolvedAvatar ? "الصورة جاهزة" : "بدون صورة"}
          </span>

          <span className={bio.trim() ? "is-ready" : "is-empty"}>
            {bio.trim() ? "النبذة مكتملة" : "النبذة فارغة"}
          </span>
        </div>
      </header>

      <div className="emp-profile-workspace">
        <aside className="emp-profile-sidebar">
          <article className="emp-profile-preview-card">
            <div className="emp-profile-card__head">
              <div>
                <span className="emp-profile-card-number">01</span>
                <h4>معاينة الملف</h4>
              </div>

              <small>الصورة الحالية</small>
            </div>

            <div
              className={`emp-profile-preview ${
                resolvedAvatar ? "has-image" : "is-empty"
              }`}
            >
              {resolvedAvatar ? (
                <EmployeeAvatar
                  src={resolvedAvatar}
                  name="موظفة"
                  alt="معاينة صورة الموظفة"
                  loading="eager"
                />
              ) : (
                <div className="emp-profile-preview__placeholder">
                  <strong>بدون صورة</strong>
                  <span>
                    اختاري صورة من المعرض أو أضيفي رابطًا مباشرًا للصورة.
                  </span>
                </div>
              )}
            </div>

            <div className="emp-profile-preview-meta">
              <span>تقييم العرض</span>
              <strong>
                {normalizedRating || "—"}
                {normalizedRating ? " / 5" : ""}
              </strong>
            </div>

            <div className="emp-profile-preview-meta">
              <span>عدد التقييمات</span>
              <strong>{normalizedReviews || "0"}</strong>
            </div>
          </article>

          <article className="emp-profile-card emp-profile-card--url">
            <div className="emp-profile-card__head">
              <div>
                <span className="emp-profile-card-number">02</span>
                <h4>رابط الصورة</h4>
              </div>
            </div>

            <div className="dash-field">
              <label
                className="emp-label"
                htmlFor="employee-profile-avatar-url"
              >
                رابط مباشر للصورة
              </label>

              <input
                id="employee-profile-avatar-url"
                className="dash-input"
                value={avatarUrl}
                onChange={(event) =>
                  onAvatarUrlChange(event.target.value)
                }
                placeholder="https://.../staff.jpg"
                dir="ltr"
                inputMode="url"
                autoComplete="off"
              />

              <small className="emp-profile-field-help">
                يمكن استخدام رابط خارجي أو اختيار صورة جاهزة من المعرض.
              </small>
            </div>
          </article>
        </aside>

        <div className="emp-profile-main">
          <article className="emp-profile-card emp-profile-card--gallery">
            <div className="emp-profile-card__head">
              <div>
                <span className="emp-profile-card-number">03</span>
                <h4>معرض الصور</h4>
              </div>

              <p>اختاري صورة جاهزة للموظفة.</p>
            </div>

            <div
              className="emp-profile-gallery"
              role="group"
              aria-label="اختيار صورة الموظفة"
            >
              <button
                type="button"
                className={`emp-profile-image-option emp-profile-image-option--empty ${
                  isSelectedImage("") ? "is-selected" : ""
                }`}
                aria-pressed={isSelectedImage("")}
                onClick={() => onAvatarUrlChange("")}
              >
                <span className="emp-profile-image-option__empty">
                  بدون صورة
                </span>

                <strong>إزالة الصورة</strong>
              </button>

              {staffImageOptions.map((image) => {
                const resolvedImage =
                  resolveAvatarFromAssets(image.value);
                const selected = isSelectedImage(image.value);

                return (
                  <button
                    key={image.value}
                    type="button"
                    className={`emp-profile-image-option ${
                      selected ? "is-selected" : ""
                    }`}
                    aria-pressed={selected}
                    onClick={() =>
                      onAvatarUrlChange(image.value)
                    }
                    title={image.label}
                  >
                    <span className="emp-profile-image-option__preview">
                      {resolvedImage ? (
                        <img
                          src={resolvedImage}
                          alt={image.label}
                        />
                      ) : (
                        <span>لا توجد معاينة</span>
                      )}
                    </span>

                    <strong>{image.label}</strong>
                  </button>
                );
              })}
            </div>
          </article>

          <article className="emp-profile-card emp-profile-card--details">
            <div className="emp-profile-card__head">
              <div>
                <span className="emp-profile-card-number">04</span>
                <h4>بيانات الملف العام</h4>
              </div>

              <p>
                النبذة والتقييم الظاهر للعميلات.
              </p>
            </div>

            <div className="emp-profile-rating-grid">
              <div className="dash-field">
                <label
                  className="emp-label"
                  htmlFor="employee-profile-rating"
                >
                  تقييم العرض
                </label>

                <input
                  id="employee-profile-rating"
                  className="dash-input"
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={rating}
                  onChange={(event) =>
                    onRatingChange(event.target.value)
                  }
                  placeholder="4.9"
                  dir="ltr"
                  inputMode="decimal"
                />

                <small className="emp-profile-field-help">
                  قيمة من 0 إلى 5.
                </small>
              </div>

              <div className="dash-field">
                <label
                  className="emp-label"
                  htmlFor="employee-profile-reviews"
                >
                  عدد التقييمات
                </label>

                <input
                  id="employee-profile-reviews"
                  className="dash-input"
                  type="number"
                  min="0"
                  step="1"
                  value={reviewsCount}
                  onChange={(event) =>
                    onReviewsCountChange(event.target.value)
                  }
                  placeholder="127"
                  dir="ltr"
                  inputMode="numeric"
                />

                <small className="emp-profile-field-help">
                  العدد الظاهر بجانب التقييم.
                </small>
              </div>
            </div>

            <div className="dash-field emp-profile-bio-field">
              <div className="emp-profile-label-row">
                <label
                  className="emp-label"
                  htmlFor="employee-profile-bio"
                >
                  نبذة تعريفية
                </label>

                <small>{bio.length} حرف</small>
              </div>

              <textarea
                id="employee-profile-bio"
                className="dash-textarea"
                rows={6}
                value={bio}
                onChange={(event) =>
                  onBioChange(event.target.value)
                }
                placeholder="مثال: خبيرة شعر وصبغات بخبرة 8 سنوات..."
              />
            </div>
          </article>

          <article className="emp-profile-card emp-profile-card--documents">
            <div className="emp-profile-card__head">
              <div>
                <span className="emp-profile-card-number">05</span>
                <h4>السيرة الذاتية</h4>
              </div>

              <p>رابط اختياري لملف PDF.</p>
            </div>

            <div className="dash-field">
              <label
                className="emp-label"
                htmlFor="employee-profile-cv"
              >
                رابط السيرة الذاتية
              </label>

              <input
                id="employee-profile-cv"
                className="dash-input"
                value={cvUrl}
                onChange={(event) =>
                  onCvUrlChange(event.target.value)
                }
                placeholder="https://.../cv.pdf"
                dir="ltr"
                inputMode="url"
                autoComplete="off"
              />

              <small className="emp-profile-field-help">
                يجب أن يكون الرابط مباشرًا ويمكن فتحه من المتصفح.
              </small>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
