import React, { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import "../styles/Testimonials.css";

import { getAuth } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../services/firebase";

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

const SALON_ID = "main";
const TESTIMONIALS_COL = ["salons", SALON_ID, "testimonials"] as const;

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
    const u = auth.currentUser;
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

    (async () => {
      try {
        if (!u?.uid) {
          setIsOwner(false);
          return;
        }

        const email = String(u.email || "").toLowerCase();
        if (email && OWNER_EMAILS.includes(email)) {
          setIsOwner(true);
          return;
        }

        const userRef = doc(db, "salons", SALON_ID, "users", u.uid);
        const snap = await getDoc(userRef);
        const role = String((snap.data() as any)?.role || "").toLowerCase();
        setIsOwner(role === "owner");
      } catch {
        setIsOwner(false);
      }
    })();
  }, [auth]);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u?.uid) {
      setUserRoleLabel("عميلة");
      return;
    }
    setUserRoleLabel("عميلة");
  }, [auth]);

  // ✅ Listener
  useEffect(() => {
    setLoading(true);
    setLoadError("");

    const colRef = collection(db, ...TESTIMONIALS_COL);

    // ✅ الآن: ما فيه approved إطلاقاً
    // ✅ نخليها مثل ما كانت: owner يشوف الكل، العميل يشوف كل شيء غير مخفي
    const qy = query(colRef, orderBy("createdAt", "desc"), limit(50));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: TestimonialRow[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
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
            };
          })
          // ✅ فلترة hidden للعملاء فقط
          .filter((t) => (isOwner ? true : t.hidden !== true));

        setItems(list);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setItems([]);
        setLoading(false);

        const msg = String((e as any)?.message || e);
        setLoadError(
          msg.includes("index")
            ? "⚠️ يحتاج Index في Firestore للاستعلام."
            : msg.includes("Missing or insufficient permissions")
              ? "⚠️ الصلاحيات تمنع قراءة التعليقات (Rules)."
              : "❌ تعذر تحميل التعليقات."
        );
      }
    );

    return () => unsub();
  }, [isOwner]);

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

      await addDoc(collection(db, ...TESTIMONIALS_COL), {
        name,
        role,
        image: userPhoto || "",
        content: msg,
        rating,
        uid: u.uid,
        vip: userVip,

        // ✅ نشر مباشر
        approved: true, // اختياري (تقدر تشيله لاحقاً)
        hidden: false,

        adminReply: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setContent("");
      setRating(5);
      setShowSuccess(true);
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
      await updateDoc(doc(db, ...TESTIMONIALS_COL, t.id), {
        hidden: !t.hidden,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const remove = async (id: string) => {
    if (!isOwner) return;
    if (!confirm("تبغى تحذف التعليق نهائي؟")) return;
    try {
      await deleteDoc(doc(db, ...TESTIMONIALS_COL, id));
    } catch (e) {
      console.error(e);
    }
  };

  const saveReply = async (id: string, reply: string) => {
    if (!isOwner) return;
    try {
      await updateDoc(doc(db, ...TESTIMONIALS_COL, id), {
        adminReply: reply.trim(),
        updatedAt: serverTimestamp(),
      });
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
          placeholder="رد الإدارة..."
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
                    <div className="bs-admin-reply-title">رد الإدارة:</div>
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
