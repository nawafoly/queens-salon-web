// src/pages/Profile.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Profile.css";

import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../services/firebase";

import {
  createOrLoadUserProfile,
  updateUserProfile,
  type UserProfile,
} from "../services/userProfile";

// =======================
// دعم واتساب
// =======================
const SUPPORT_PHONE = "966573235247"; // ✅ بدون +
// نص الرسالة
const SUPPORT_MSG = "مرحباً، أحتاج مساعدة في حسابي في صالون ملكات.";

function getWhatsAppLink(phoneDigits: string, msg: string) {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;
}

// =======================
// خدمات (عرض فقط)
// =======================
const services = [
  { id: "haircut", name: "قص الشعر" },
  { id: "coloring", name: "صبغة الشعر" },
  { id: "styling", name: "تسريحات الشعر" },
  { id: "treatment", name: "معالجات الشعر" },
  { id: "makeup", name: "مكياج" },
  { id: "nails", name: "العناية بالأظافر" },
  { id: "facial", name: "العناية بالبشرة" },
  { id: "waxing", name: "إزالة الشعر" },
];

const getServiceName = (id: string) =>
  services.find((s) => s.id === id)?.name || id;

// =======================
interface BookingData {
  name: string;
  phone: string;
  service: string;
  employee: string;
  date: string;
  time: string;
  status?: string;
}

type ProfileMode = "firebase" | "local";

// تحويل الحالة لكلاسات لطيفة
function statusClass(status?: string) {
  const s = String(status || "").trim();
  if (s === "مؤكد" || s === "confirmed") return "confirmed";
  if (s === "انتظار" || s === "pending") return "pending";
  if (s === "مكتمل" || s === "completed") return "completed";
  if (s === "ملغي" || s === "cancelled") return "ملغي";
  return "";
}

function normalizeKsaPhone(raw: string) {
  const digits = String(raw || "").replace(/\D/g, ""); // شيل أي شيء غير أرقام
  if (!digits) return "";

  // لو يبدأ بـ 9665xxxxxxx => حوله إلى 05xxxxxxxx
  if (digits.startsWith("9665") && digits.length === 12) {
    return "0" + digits.slice(3);
  }

  // لو يبدأ بـ 5xxxxxxxx => حوله إلى 05xxxxxxxx
  if (digits.startsWith("5") && digits.length === 9) {
    return "0" + digits;
  }

  // لو يبدأ بـ 05xxxxxxxx (تمام)
  if (digits.startsWith("05") && digits.length === 10) {
    return digits;
  }

  return digits; // fallback
}


const Profile: React.FC = () => {
  const navigate = useNavigate();

  const [profileMode, setProfileMode] = useState<ProfileMode>("local");
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [profileDoc, setProfileDoc] = useState<UserProfile | null>(null);

  // ✅ حماية صفحة البروفايل (حسب authToken مثل نظامك الحالي)
  useEffect(() => {
    const token = localStorage.getItem("authToken");
    if (!token) navigate("/login");
  }, [navigate]);

  // ✅ قراءة بروفايل مخزن (أولوية للعرض)
  const cachedProfile = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    } catch {
      return null;
    }
  }, []);

  // قديم (لو فيه عميلات باللوكال)
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("currentUser") || "null");
    } catch {
      return null;
    }
  }, []);

  const [userData, setUserData] = useState({
    name:
      cachedProfile?.name ||
      currentUser?.name ||
      localStorage.getItem("userName") ||
      "",
    phone: cachedProfile?.phone || currentUser?.phone || "",
    email:
      cachedProfile?.email ||
      currentUser?.email ||
      localStorage.getItem("userEmail") ||
      "",
    city: cachedProfile?.city || currentUser?.city || "",
    birthdate: cachedProfile?.birthdate || currentUser?.birthdate || "",
    avatar: localStorage.getItem("userAvatar") || "",
  });

  // =======================
  // Firebase / Local mode
  // =======================
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      // لا يوجد Firebase user => Local
      if (!user) {
        setProfileMode("local");
        setFirebaseUid(null);
        setProfileDoc(null);

        // لو فيه cache نعرضه
        try {
          const cached = JSON.parse(
            localStorage.getItem("user_profile_v1") || "null"
          );
          if (cached) {
            setUserData((prev) => ({
              ...prev,
              name: cached.name || prev.name,
              phone: cached.phone || prev.phone,
              email: cached.email || prev.email,
              city: cached.city || prev.city,
              birthdate: cached.birthdate || prev.birthdate,
            }));
          }
        } catch {}

        return;
      }

      try {
        setProfileMode("firebase");
        setFirebaseUid(user.uid);

        const p = await createOrLoadUserProfile(user);

        setProfileDoc(p);
        setUserData((prev) => ({
          ...prev,
          name: p.name || prev.name,
          phone: p.phone || prev.phone,
          email: p.email || prev.email,
          city: p.city || prev.city,
          birthdate: p.birthdate || prev.birthdate,
        }));

        // تحديث كاش عام للموقع
        localStorage.setItem("user_profile_v1", JSON.stringify(p));
        if (p?.name) localStorage.setItem("userName", String(p.name));
        if (p?.email) localStorage.setItem("userEmail", String(p.email));
        if (p?.phone) localStorage.setItem("userPhone", String(p.phone));
        window.dispatchEvent(new Event("authChanged"));
      } catch (e) {
        console.error("Profile load error:", e);
        setProfileMode("local");
      }
    });

    return () => unsub();
  }, []);

  // =======================
  // الحجوزات
  // =======================
  const [bookings, setBookings] = useState<BookingData[]>([]);

  useEffect(() => {
    const allBookings: BookingData[] = JSON.parse(
      localStorage.getItem("allBookings") || "[]"
    );
  
    const myPhone = normalizeKsaPhone(userData.phone);
  
    setBookings(
      allBookings
        .filter((b) => normalizeKsaPhone(b.phone) === myPhone)
        .reverse()
    );
  }, [userData.phone]);
  

  const nextBooking = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const tomorrowStr = new Date(today.getTime() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const next = bookings.find(
      (b) =>
        (b.date === todayStr || b.date === tomorrowStr) &&
        b.status !== "ملغي" &&
        b.status !== "مكتمل"
    );

    return next || null;
  }, [bookings]);

  // =======================
  // عضوية / رقم عضوية (بدون QR)
  // =======================
  const membershipPercent =
    typeof profileDoc?.membershipPercent === "number"
      ? profileDoc.membershipPercent
      : 0;

  const membershipId =
    profileDoc?.membershipId ||
    (profileMode === "firebase" && firebaseUid
      ? `client-${new Date().getFullYear()}-${firebaseUid.slice(0, 6)}`
      : "client-0000");

  const progress = Math.min(Math.max(Number(membershipPercent) || 0, 0), 100);

  const copyMembershipId = async () => {
    try {
      await navigator.clipboard.writeText(String(membershipId));
      alert("تم نسخ رقم العضوية ✅");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = String(membershipId);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      alert("تم نسخ رقم العضوية ✅");
    }
  };

  // =======================
  // Avatar
  // =======================
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // (اختياري) لو تبي تحد 2MB زي تفضيلك
    // if (file.size > 2 * 1024 * 1024) { alert("الصورة لازم أقل من 2MB"); return; }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = ev.target?.result as string;
      setUserData((prev) => ({ ...prev, avatar: img }));
      localStorage.setItem("userAvatar", img);
    };
    reader.readAsDataURL(file);
  };

  // =======================
  // Modal تعديل البيانات
  // =======================
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState({ ...userData });

  useEffect(() => setEditData({ ...userData }), [userData]);

  const handleSaveEdit = async () => {
    try {
      // Firebase mode
      if (profileMode === "firebase" && firebaseUid) {
        await updateUserProfile(firebaseUid, {
          name: editData.name,
          phone: editData.phone,
          email: editData.email,
          city: editData.city,
          birthdate: editData.birthdate,
        } as any);

        setUserData(editData);

        const merged = {
          ...(profileDoc || {}),
          uid: firebaseUid,
          name: editData.name,
          phone: editData.phone,
          email: editData.email,
          city: editData.city,
          birthdate: editData.birthdate,
        };

        localStorage.setItem("user_profile_v1", JSON.stringify(merged));
        localStorage.setItem("userName", editData.name);
        localStorage.setItem("userEmail", editData.email);
        localStorage.setItem("userPhone", editData.phone);
        window.dispatchEvent(new Event("authChanged"));

        setShowEditModal(false);
        return;
      }

      // localStorage mode
      let clients = JSON.parse(localStorage.getItem("clients") || "[]");
      clients = clients.map((u: any) =>
        u.phone === userData.phone ? { ...u, ...editData } : u
      );
      localStorage.setItem("clients", JSON.stringify(clients));
      localStorage.setItem(
        "currentUser",
        JSON.stringify({ ...(currentUser || {}), ...editData })
      );
      localStorage.setItem("userName", editData.name);
      localStorage.setItem("userEmail", editData.email);
      localStorage.setItem("userPhone", editData.phone);
      window.dispatchEvent(new Event("authChanged"));

      setUserData(editData);
      setShowEditModal(false);
    } catch (e) {
      console.error("Save profile error:", e);
      alert("صار خطأ أثناء حفظ البيانات. حاول مرة ثانية.");
    }
  };

  // =======================
  // تسجيل الخروج
  // =======================
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {}

    localStorage.removeItem("authToken");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userName");
    localStorage.removeItem("currentUser");
    localStorage.removeItem("auth_user");
    localStorage.removeItem("userUid");
    localStorage.removeItem("showWelcome");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userPhone");
    localStorage.removeItem("user_profile_v1");
    localStorage.removeItem("userAvatar");

    window.dispatchEvent(new Event("authChanged"));
    window.location.href = "/login";
  };

  return (
    <div className="profile-page">
      <div className="container" style={{ maxWidth: 820 }}>
        {nextBooking && (
          <div className="profile-next-alert">
            لديك حجز قريب: {getServiceName(nextBooking.service)} بتاريخ{" "}
            {nextBooking.date} الساعة {nextBooking.time}
          </div>
        )}

        {/* ===== Card ===== */}
        <div className="profile-card">
          {/* Avatar */}
          <div className="profile-avatar">
            {userData.avatar ? (
              <img src={userData.avatar} alt="avatar" />
            ) : (
              <span>👩‍🦰</span>
            )}

            <button
              type="button"
              className="avatar-upload-btn"
              title="تغيير الصورة"
              onClick={() => fileInputRef.current?.click()}
            >
              ✚
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleAvatarChange}
            />
          </div>

          <h2>{userData.name || "عميلة"}</h2>
          <div className="profile-details">
            {userData.phone ? <div>{userData.phone}</div> : null}
            {userData.email ? <div>{userData.email}</div> : null}
          </div>

          {/* Membership */}
          <div className="profile-progress">
            <div
              className="profile-progress-bar"
              style={{ width: `${progress}%` }}
            />
            <div className="profile-points-label">نسبة العضوية: {progress}%</div>
          </div>

          {/* Membership ID + Copy */}
          <div className="profile-id-row" title="رقم العضوية">
            <span>{membershipId}</span>
            <span
              className="profile-id-copy"
              role="button"
              tabIndex={0}
              onClick={copyMembershipId}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") copyMembershipId();
              }}
              title="نسخ رقم العضوية"
            >
              📋
            </span>
          </div>

          {/* Actions */}
          <div className="profile-actions">
            <button
              className="btn btn-outline-primary"
              type="button"
              onClick={() => setShowEditModal(true)}
            >
              ✏️ تعديل البيانات
            </button>

            <a
              className="profile-support-btn"
              href={getWhatsAppLink(SUPPORT_PHONE, SUPPORT_MSG)}
              target="_blank"
              rel="noreferrer"
            >
              💬 دعم واتساب
            </a>

            <button className="btn btn-outline-danger" onClick={handleLogout}>
              🚪 تسجيل الخروج
            </button>
          </div>
        </div>

        {/* ===== Bookings ===== */}
        <div className="profile-bookings">
          <h3>حجوزاتي</h3>

          {bookings.length === 0 ? (
            <div style={{ textAlign: "center", color: "#7e695c" }}>
              لا يوجد حجوزات مرتبطة بهذا الرقم حالياً.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>الخدمة</th>
                    <th>الموظفة</th>
                    <th>التاريخ</th>
                    <th>الوقت</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b, idx) => (
                    <tr key={idx}>
                      <td>{getServiceName(b.service)}</td>
                      <td>{b.employee || "-"}</td>
                      <td>{b.date}</td>
                      <td>{b.time}</td>
                      <td>
                        <span className={`status-badge ${statusClass(b.status)}`}>
                          {b.status || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ===== Edit Modal ===== */}
        {showEditModal && (
          <div
            className="profile-modal-overlay"
            onClick={() => setShowEditModal(false)}
          >
            <div
              className="profile-modal-dialog"
              onClick={(e) => e.stopPropagation()}
            >
              <h5 style={{ marginBottom: 12 }}>تعديل بيانات العميلة</h5>

              <div className="mb-2">
                <label>الاسم</label>
                <input
                  className="form-control"
                  value={editData.name}
                  onChange={(e) =>
                    setEditData({ ...editData, name: e.target.value })
                  }
                />
              </div>

              <div className="mb-2">
                <label>الجوال</label>
                <input
                  className="form-control"
                  value={editData.phone}
                  onChange={(e) =>
                    setEditData({ ...editData, phone: e.target.value })
                  }
                />
              </div>

              <div className="mb-2">
                <label>البريد</label>
                <input
                  className="form-control"
                  value={editData.email}
                  onChange={(e) =>
                    setEditData({ ...editData, email: e.target.value })
                  }
                />
              </div>

              <div className="mb-2">
                <label>المدينة</label>
                <input
                  className="form-control"
                  value={editData.city}
                  onChange={(e) =>
                    setEditData({ ...editData, city: e.target.value })
                  }
                />
              </div>

              <div className="mb-3">
                <label>تاريخ الميلاد</label>
                <input
                  type="date"
                  className="form-control"
                  value={editData.birthdate}
                  onChange={(e) =>
                    setEditData({ ...editData, birthdate: e.target.value })
                  }
                />
              </div>

              <div className="d-flex gap-2">
                <button className="btn btn-success btn-sm" onClick={handleSaveEdit}>
                  حفظ
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowEditModal(false)}
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Profile;
