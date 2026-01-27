import React, { useEffect, useMemo, useState } from "react";
import "../styles/Testimonials.css";

import { getAuth } from "firebase/auth";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  limit,
  where,
  getDocs,
} from "firebase/firestore";
import { db } from "../services/firebase";

type TestimonialRow = {
  id: string;
  name: string;
  role: string; // عميلة دائمة / عميلة جديدة / VIP ...
  image?: string;
  content: string;
  rating: number;
  createdAt?: any;
  uid?: string | null;
  vip?: boolean;
};

const SALON_ID = "main";
const TESTIMONIALS_COL = ["salons", SALON_ID, "testimonials"] as const;
const BOOKINGS_COL = ["salons", SALON_ID, "bookings"] as const;

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

  // form
  const [content, setContent] = useState("");
  const [rating, setRating] = useState<number>(5);
  const [sending, setSending] = useState(false);

  // derived user info
  const [userName, setUserName] = useState("");
  const [userPhoto, setUserPhoto] = useState<string>("");
  const [userVip, setUserVip] = useState(false);
  const [userRoleLabel, setUserRoleLabel] = useState("عميلة");

  // ⭐ نجوم
  const renderStars = (r: number) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <span
        key={i}
        className={`bs-star ${i < r ? "is-filled" : "is-empty"}`}
        aria-hidden="true"
      >
        ★
      </span>
    ));
  };

  // ✅ اسحب بيانات المستخدم (لو مسجل)
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
  }, [auth]);

  // ✅ احسب “دائمة/جديدة” من عدد الحجوزات (لو عندنا uid)
  useEffect(() => {
    const u = auth.currentUser;
    if (!u?.uid) {
      setUserRoleLabel("عميلة");
      return;
    }

    (async () => {
      try {
        // نحسب عدد حجوزاتها من bookings (غير مكلف لأنه limit 20 + count من النتائج)
        // إذا عندك field clientUid في booking فهو الأفضل.
        const qy = query(
          collection(db, ...BOOKINGS_COL),
          where("clientUid", "==", u.uid),
          orderBy("createdAt", "desc"),
          limit(20)
        );
        const snap = await getDocs(qy);
        const count = snap.size;

        if (count >= 2) setUserRoleLabel("عميلة دائمة");
        else if (count === 1) setUserRoleLabel("عميلة منتظمة");
        else setUserRoleLabel("عميلة جديدة");
      } catch {
        // لو ما عندك clientUid في bookings، ما نكسر الصفحة
        setUserRoleLabel("عميلة");
      }
    })();
  }, [auth]);

  // ✅ ريل تايم: اعرض التعليقات فوق
  useEffect(() => {
    const qy = query(
      collection(db, ...TESTIMONIALS_COL),
      orderBy("createdAt", "desc"),
      limit(30)
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: TestimonialRow[] = snap.docs.map((d) => {
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
          };
        });

        setItems(list);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // ✅ إرسال تعليق
  const submit = async () => {
    const msg = content.trim();
    if (!msg) return;

    setSending(true);
    try {
      const u = auth.currentUser;

      const name = userName || "عميلة";
      const role = userVip ? `VIP • ${userRoleLabel}` : userRoleLabel;

      await addDoc(collection(db, ...TESTIMONIALS_COL), {
        name,
        role,
        image: userPhoto || "",
        content: msg,
        rating,
        uid: u?.uid || null,
        vip: userVip,
        createdAt: serverTimestamp(),
      });

      setContent("");
      setRating(5);
    } catch (e) {
      console.error(e);
      alert("تعذر إرسال التعليق. جرّبي مرة ثانية.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="bs-testimonials" aria-label="آراء عميلاتنا">
      <div className="container">
        <div className="bs-testimonials-head">
          <h2 className="bs-testimonials-title">آراء عميلاتنا</h2>
        </div>

        {/* ✅ القائمة */}
        <div className="bs-testimonials-list">
          {loading && <div className="bs-hint">جاري تحميل الآراء...</div>}

          {!loading && items.length === 0 && (
            <div className="bs-hint">كوني أول من يكتب تعليق 🌸</div>
          )}

          {items.map((t) => (
            <div key={t.id} className="bs-testimonial-item">
              <div className="bs-avatar-wrap" aria-hidden="true">
                {t.image ? (
                  <img
                    src={t.image}
                    alt={t.name}
                    className="bs-testimonial-avatar"
                    loading="lazy"
                  />
                ) : (
                  <div className="bs-avatar-fallback">
                    {safeStr(t.name).slice(0, 1) || "Q"}
                  </div>
                )}
              </div>

              <div className="bs-testimonial-body">
                <div className="bs-testimonial-top">
                  <h4 className="bs-testimonial-name">
                    {t.name}{" "}
                    {t.vip ? <span className="bs-badge">VIP</span> : null}
                  </h4>

                  <div
                    className="bs-testimonial-rating"
                    aria-label={`تقييم ${t.rating} من 5`}
                  >
                    {renderStars(t.rating)}
                  </div>
                </div>

                <p className="bs-testimonial-text">{t.content}</p>

                <div className="bs-testimonial-meta">{t.role}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ✅ صندوق التعليق */}
        <div className="bs-review-box">
          <div className="bs-review-head">
            <div className="bs-review-title">اكتبي تعليقك</div>
            <div className="bs-review-user">
              <span className="bs-review-name">{userName || "عميلة"}</span>
              {userVip ? <span className="bs-badge">VIP</span> : null}
              <span className="bs-review-role">{userRoleLabel}</span>
            </div>
          </div>

          <div className="bs-review-row">
            <label className="bs-label">التقييم</label>
            <select
              className="bs-select"
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
            >
              <option value={5}>5 نجوم</option>
              <option value={4}>4 نجوم</option>
              <option value={3}>3 نجوم</option>
              <option value={2}>نجمتين</option>
              <option value={1}>نجمة</option>
            </select>
          </div>

          <textarea
            className="bs-textarea"
            placeholder="اكتبي تجربتك باختصار..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
          />

          <button
            className="bs-send-btn"
            onClick={submit}
            disabled={sending || !content.trim()}
          >
            {sending ? "جاري الإرسال..." : "نشر التعليق"}
          </button>

          <div className="bs-mini-note">
            ملاحظة: تسجيل الـ IP يحتاج Cloud Function. إذا تبغاه نسويه بعد ما نخلص ملفات الواجهة.
          </div>
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
