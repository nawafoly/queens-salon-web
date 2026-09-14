import { readVerifiedUserAccess } from "../services/authAccess";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "./Modal";

import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  CoreTestimonialsService,
  type CoreTestimonial,
} from "../services/CoreTestimonialsService";

type TestimonialRow = {
  id: string;
  name: string;
  role: string;
  image?: string;
  content: string;
  rating: number;
  createdAt?: any;
  uid?: string | null;
  vip?: boolean;
  approved?: boolean;
  hidden?: boolean;
  adminReply?: string;
};

const OWNER_EMAILS = ["nawafaaa0@gmail.com", "alolayan3@gmail.com"].map((x) =>
  x.toLowerCase()
);

function safeStr(v: any) {
  return String(v ?? "").trim();
}

function readUserProfileV1(): any | null {
  try {
    return JSON.parse(localStorage.getItem("user_profile_v1") || "null");
  } catch {
    return null;
  }
}

const Testimonials: React.FC = () => {
  const auth = useMemo(() => getAuth(), []);

  const [items, setItems] = useState<TestimonialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Form
  const [content, setContent] = useState("");
  const [rating, setRating] = useState<number>(5);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string>("");

  // ✅ Success modal
  const [showSuccess, setShowSuccess] = useState(false);

  // User info
  const [userName, setUserName] = useState("");
  const [userPhoto, setUserPhoto] = useState<string>("");
  const [userVip, setUserVip] = useState(false);
  const [userRoleLabel, setUserRoleLabel] = useState("عميلة");

  // Admin/Owner
  const [isOwner, setIsOwner] = useState(false);

  const renderStars = (r: number) =>
    Array.from({ length: 5 }).map((_, i) => (
      <span
        key={i}
        className={`bs-star ${i < r ? "is-filled" : "is-empty"}`}
        aria-hidden="true"
      >
        ★
      </span>
    ));

  useEffect(() => {
    let seq = 0;
    const unsub = onAuthStateChanged(auth, (u) => {
      const currentSeq = ++seq;
      const p = readUserProfileV1();

      const displayName =
        safeStr(u?.displayName) ||
        safeStr(p?.name) ||
        safeStr(localStorage.getItem("userName")) ||
        "عميلة";

      const photo =
        safeStr(u?.photoURL) ||
        safeStr(p?.photoURL) ||
        safeStr(p?.avatarUrl) ||
        "";

      const vip =
        Boolean(p?.vip) ||
        String(localStorage.getItem("vip") || "").toLowerCase() === "true";

      setUserName(displayName);
      setUserPhoto(photo);
      setUserVip(vip);

      if (!u?.uid) {
        setIsOwner(false);
        return;
      }

      (async () => {
        try {
          const access = await readVerifiedUserAccess(u.uid);

      if (currentSeq === seq) {
        setIsOwner(
          access.exists &&
          access.active !== false &&
          access.role === "owner"
        );
      }
        } catch {
          if (currentSeq === seq) setIsOwner(false);
        }
      })();
    });
    return () => unsub();
  }, [auth]);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u?.uid) {
      setUserRoleLabel("عميلة");
      return;
    }
    setUserRoleLabel("عميلة");
  }, [auth]);

  const refreshTestimonials = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const rows = await CoreTestimonialsService.list(50);
      const list: TestimonialRow[] = rows
        .map((data: CoreTestimonial) => ({
          id: data.id,
          name: safeStr(data.name) || "عميلة",
          role: safeStr(data.role) || "عميلة",
          image: safeStr(data.image) || "",
          content: safeStr(data.content),
          rating: Number(data.rating || 5),
          createdAt: data.createdAt,
          uid: data.uid ?? null,
          vip: Boolean(data.vip),
          approved: Boolean(data.approved),
          hidden: Boolean(data.hidden),
          adminReply: safeStr(data.adminReply || ""),
        }))
        .filter((t) => (isOwner ? true : t.hidden !== true))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      setItems(list);
    } catch (e) {
      console.error(e);
      setItems([]);
      setLoadError("❌ تعذر تحميل التعليقات.");
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  // ✅ Core D1: load on mount + focus/visibility (no fixed-interval polling)
  useEffect(() => {
    void refreshTestimonials();
    const onFocus = () => void refreshTestimonials();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshTestimonials();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshTestimonials]);

  const submit = async () => {
    setFormError("");
    const msg = content.trim();
    const u = auth.currentUser;

    if (!u) {
      setFormError("لازم تسجّل دخول قبل كتابة تعليق.");
      return;
    }
    if (!msg) return;

    setSending(true);
    try {
      const name = userName || "عميلة";
      const role = userVip ? `VIP • ${userRoleLabel}` : userRoleLabel;

      await CoreTestimonialsService.create({
        name,
        role,
        image: userPhoto || "",
        content: msg,
        rating,
        uid: u.uid,
        vip: userVip,
      });

      setContent("");
      setRating(5);
      setShowSuccess(true);
      // refresh list
      const rows = await CoreTestimonialsService.list(50);
      setItems(
        rows.map((data) => ({
          id: data.id,
          name: safeStr(data.name) || "عميلة",
          role: safeStr(data.role) || "عميلة",
          image: safeStr(data.image) || "",
          content: safeStr(data.content),
          rating: Number(data.rating || 5),
          createdAt: data.createdAt,
          uid: data.uid ?? null,
          vip: Boolean(data.vip),
          approved: Boolean(data.approved),
          hidden: Boolean(data.hidden),
          adminReply: safeStr(data.adminReply || ""),
        }))
      );
    } catch (e: any) {
      console.error(e);
      setFormError("تعذر إرسال التعليق. جرّبي مرة ثانية.");
    } finally {
      setSending(false);
    }
  };

  // Admin
  const toggleHidden = async (t: TestimonialRow) => {
    if (!isOwner) return;
    try {
      const updated = await CoreTestimonialsService.patch(t.id, { hidden: !t.hidden });
      setItems((prev) => prev.map((row) => (row.id === t.id ? { ...row, hidden: Boolean(updated.hidden) } : row)));
    } catch (e) {
      console.error(e);
    }
  };

  const remove = async (id: string) => {
    if (!isOwner) return;
    if (!confirm("تبغى تحذف التعليق نهائي؟")) return;
    try {
      await CoreTestimonialsService.remove(id);
      setItems((prev) => prev.filter((row) => row.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  const saveReply = async (id: string, reply: string) => {
    if (!isOwner) return;
    try {
      const updated = await CoreTestimonialsService.patch(id, { adminReply: reply.trim() });
      setItems((prev) =>
        prev.map((row) => (row.id === id ? { ...row, adminReply: safeStr(updated.adminReply || "") } : row))
      );
    } catch (e) {
      console.error(e);
    }
  };

  const ReplyEditor = ({ id, initial }: { id: string; initial: string }) => {
    const [v, setV] = useState(initial || "");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      setV(initial || "");
    }, [initial]);

    return (
      <div className="bs-admin-reply-editor">
        <textarea
          className="bs-field bs-textarea-small bs-textarea-dark"
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="رد خدمة عملاء ملكات..."
          rows={2}
        />
        <button
          type="button"
          className="bs-btn primary sm"
          onClick={async () => {
            setSaving(true);
            try {
              await saveReply(id, v);
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
        >
          {saving ? "جارٍ الحفظ..." : "حفظ الرد"}
        </button>
      </div>
    );
  };

  const scrollTrack = (dir: "left" | "right") => {
    const el = document.getElementById("qs-testimonials-track");
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -420 : 420, behavior: "smooth" });
  };

  return (
    <section className="bs-testimonials">
      <div className="bs-testimonials-head">
        <h2 className="bs-testimonials-title">آراء عميلاتنا</h2>
        <p className="bs-testimonials-subtitle">
          نفخر بخدمتكم ونسعد بمشاركة تجاربكم معنا. آراؤكم هي سر نجاحنا وتطورنا المستمر.
        </p>
      </div>

      <div className="bs-slider-wrap">
        <button
          className="bs-slide-arrow left qs-black"
          onClick={() => scrollTrack("left")}
          aria-label="السابق"
        >
          ›
        </button>
        <button
          className="bs-slide-arrow right qs-black"
          onClick={() => scrollTrack("right")}
          aria-label="التالي"
        >
          ‹
        </button>

        <div className="bs-slider" id="qs-testimonials-track">
          {loading ? (
            <div className="bs-hint">جاري تحميل الآراء...</div>
          ) : loadError ? (
            <div className="bs-hint">{loadError}</div>
          ) : items.length === 0 ? (
            <div className="bs-hint">لا توجد تعليقات حالياً. كوني أول من يشاركنا رأيه!</div>
          ) : (
            items.map((t) => (
              <div
                key={t.id}
                className={`bs-slide-card ${t.hidden ? "is-hidden" : ""}`}
              >
                <div className="bs-quote-mark top">“</div>

                <div className="bs-slide-text bs-slide-text-pad">{t.content}</div>

                <div className="bs-slide-footer">
                  <div className="bs-slide-avatar">
                    {t.image ? <img src={t.image} alt={t.name} /> : t.name.charAt(0)}
                  </div>
                  <div className="bs-slide-info">
                    <div className="bs-slide-name">
                      {t.name}
                      {t.vip && <span className="bs-badge">VIP</span>}
                    </div>
                    <div className="bs-slide-role">{t.role}</div>
                    <div className="bs-slide-stars">{renderStars(t.rating)}</div>
                  </div>
                </div>

                {t.adminReply && (
                  <div className="bs-admin-reply">
                    <div className="bs-admin-reply-title">خدمة عملاء ملكات:</div>
                    <div className="bs-admin-reply-text">{t.adminReply}</div>
                  </div>
                )}

                {isOwner && (
                  <div className="bs-admin-tools">
                    <div className="bs-admin-flags">
                      {t.hidden && <span className="flag hide">مخفي</span>}
                      {!t.hidden && <span className="flag ok">منشور</span>}
                    </div>

                    <div className="bs-admin-controls">
                      <button className="bs-btn sm qs-wine" onClick={() => toggleHidden(t)}>
                        {t.hidden ? "إظهار" : "إخفاء"}
                      </button>
                      <button className="bs-btn danger sm" onClick={() => remove(t.id)}>
                        حذف
                      </button>
                    </div>

                    <ReplyEditor id={t.id} initial={t.adminReply || ""} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        
      </div>
      
      {/* ✅ تلميح السحب */}
      <div className="bs-swipe-hint">
  <span className="hint-arrow"> ‹ </span>
  <span className="hint-text mb-5">    اسحب يمين ويسار لعرض المزيد    </span>
  <span className="hint-arrow"> › </span>
</div>

      <div className="bs-review-box">
        <div className="bs-review-title qs-wine">شاركينا رأيك</div>

        <div className="bs-review-grid">
          <div className="bs-field-group">
            <label>التقييم</label>
            <div className="bs-rating-input">
              {[1, 2, 3, 4, 5].map((num) => (
                <span
                  key={num}
                  className={`bs-star-btn ${rating >= num ? "is-filled" : "is-empty"}`}
                  onClick={() => setRating(num)}
                >
                  ★
                </span>
              ))}
            </div>
          </div>

          <textarea
            className="bs-field bs-textarea bs-textarea-dark"
            placeholder="اكتبي تجربتك هنا..."
            value={content}
            onChange={(e) => {
              setFormError("");
              setContent(e.target.value);
            }}
            rows={4}
          />

          {formError && <div className="bs-form-error">{formError}</div>}

          <div className="bs-review-actions">
            <button className="bs-send-btn" onClick={submit} disabled={sending || !content.trim()}>
              {sending ? "جاري الإرسال..." : "نشر التعليق"}
            </button>
          </div>
        </div>
      </div>

      {showSuccess && (
        <Modal
          open={showSuccess}
          onClose={() => setShowSuccess(false)}
          ariaLabel="تم نشر تعليقك"
          panelClassName="modal-box"
          size="sm"
        >
            <div className="modal-head">
              <button className="modal-close modal-close-wine" onClick={() => setShowSuccess(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="success-icon-wrapper">
                <div className="success-icon-circle">
                  <span className="success-check-mark">✓</span>
                </div>
              </div>

              <h3 className="modal-title-large">تم نشر تعليقك</h3>
              <p className="modal-text-large">
                شكرًا لك 🌸 تم نشر تعليقك بنجاح، ونقدر مشاركتك معنا.
              </p>
            </div>

            <div className="modal-actions">
              <button className="btn-confirm-large" onClick={() => setShowSuccess(false)}>
                حسنًا
              </button>
            </div>
        </Modal>
      )}
    </section>
  );
};

export default Testimonials;
