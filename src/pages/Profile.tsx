// src/pages/Profile.tsx
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import "../styles/Profile.css";

import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../services/firebase";

import {
  createOrLoadUserProfile,
  updateUserProfile,
  type UserProfile,
} from "../services/userProfile";

// =======================
// بيانات تجريبية (Fallback)
// =======================
const DEMO_POINTS = 80;
const DEMO_MAX_POINTS = 100;
const DEMO_QR_VALUE = "client-2024-0001";
const DEMO_RATING = 4.2;
const DEMO_REVIEWS = [
  "خدمة ممتازة وتعامل راقي 🌸",
  "الصراحة أحلى مشغل في الرياض.",
  "موظفات محترمات والشغل نظيف 👌",
];

// دعم واتساب
const SUPPORT_PHONE = "+966573235247";
const SUPPORT_MSG = "مرحباً، أحتاج مساعدة في حسابي في صالون ملكات.";

function getWhatsAppLink(phone: string, msg: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
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

const Profile: React.FC = () => {
  const navigate = useNavigate();

  const [profileMode, setProfileMode] = useState<ProfileMode>("local");
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [profileDoc, setProfileDoc] = useState<UserProfile | null>(null);

  // ✅ قراءة بروفايل مخزن (أولوية للعرض)
  const cachedProfile = (() => {
    try {
      return JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    } catch {
      return null;
    }
  })();

  // قديم (لو عندك ناس مسجلين باللوكال)
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");

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
  // ✅ حماية الصفحة حسب نظامك (authToken)
  // =======================
  useEffect(() => {
    const token = localStorage.getItem("authToken");
    if (!token) {
      navigate("/login");
    }
  }, [navigate]);

  // =======================
  // Firebase / Local mode
  // =======================
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      // ✅ لو ما فيه مستخدم Firebase، لا تطرد أحد
      // خلك local mode لكن اعرض cachedProfile إن وجد
      if (!user) {
        setProfileMode("local");
        setFirebaseUid(null);
        setProfileDoc(null);

        const cached = (() => {
          try {
            return JSON.parse(localStorage.getItem("user_profile_v1") || "null");
          } catch {
            return null;
          }
        })();

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

        return;
      }

      try {
        setProfileMode("firebase");
        setFirebaseUid(user.uid);

        const p = await createOrLoadUserProfile(user);
        // ✅ خزن الاسم لاستخدامه في كل الموقع
        if (p?.name) {
          localStorage.setItem("userName", String(p.name));
          window.dispatchEvent(new Event("authChanged"));
        }

        setProfileDoc(p);

        setUserData((prev) => ({
          ...prev,
          name: p.name || prev.name,
          phone: p.phone || prev.phone,
          email: p.email || prev.email,
          city: p.city || prev.city,
          birthdate: p.birthdate || prev.birthdate,
        }));

        localStorage.setItem("user_profile_v1", JSON.stringify(p));
        // ✅ عشان Navbar يتحدث فورًا
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
    setBookings(allBookings.filter((b) => b.phone === userData.phone).reverse());
  }, [userData.phone]);

  const [nextBooking, setNextBooking] = useState<BookingData | null>(null);

  useEffect(() => {
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

    setNextBooking(next || null);
  }, [bookings]);

  // =======================
  // عضوية / نقاط
  // =======================
  const membershipPercent =
    typeof profileDoc?.membershipPercent === "number"
      ? profileDoc.membershipPercent
      : DEMO_POINTS;

  const membershipId =
    profileDoc?.membershipId ||
    (profileMode === "firebase" && firebaseUid
      ? `client-${new Date().getFullYear()}-${firebaseUid.slice(0, 6)}`
      : DEMO_QR_VALUE);

  const progress = Math.min(
    Math.round((membershipPercent / DEMO_MAX_POINTS) * 100),
    100
  );

  // =======================
  // Avatar
  // =======================
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = ev.target?.result as string;
      setUserData((prev) => ({ ...prev, avatar: img }));
      localStorage.setItem("userAvatar", img);
    };
    reader.readAsDataURL(file);
  };

  // =======================
  // ✅ Modal تعديل البيانات
  // =======================
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState({ ...userData });

  useEffect(() => {
    setEditData({ ...userData });
  }, [userData]);

  const handleSaveEdit = async () => {
    try {
      // ✅ Firebase mode
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
        window.dispatchEvent(new Event("authChanged"));

        setShowEditModal(false);
        return;
      }

      // ✅ localStorage mode
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
    // لو فيه Firebase session
    try {
      await signOut(auth);
    } catch {
      // ignore
    }

    // ❌ لا تستخدم localStorage.clear() لأنه يمسح كل النظام
    localStorage.removeItem("authToken");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userName");
    localStorage.removeItem("currentUser");
    localStorage.removeItem("auth_user");
    localStorage.removeItem("userUid");
    localStorage.removeItem("showWelcome");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("user_profile_v1");
    // نخلي حجوزات/بيانات النظام الأخرى بدون مسح كامل

    window.dispatchEvent(new Event("authChanged"));
    window.location.href = "/login";
  };

  // =======================
  // Render
  // =======================
  return (
    <div className="profile-page py-5" style={{ minHeight: "100vh" }}>
      <div className="container" style={{ maxWidth: 820 }}>
        {nextBooking && (
          <div className="alert alert-info text-center mb-4">
            لديك حجز قريب: {getServiceName(nextBooking.service)} بتاريخ{" "}
            {nextBooking.date} الساعة {nextBooking.time}
          </div>
        )}

        <div className="profile-card shadow p-4 text-center bg-white">
          <div style={{ width: 100, height: 100, margin: "auto" }}>
            {userData.avatar ? (
              <img
                src={userData.avatar}
                alt="avatar"
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "50%",
                  objectFit: "cover",
                }}
              />
            ) : (
              <span style={{ fontSize: 70 }}>👩‍🦰</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleAvatarChange}
            />
          </div>

          <h3 className="mt-3">{userData.name}</h3>
          <div>{userData.phone}</div>

          <div className="my-3">
            <div>نسبة العضوية: {progress}%</div>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <QRCodeCanvas value={membershipId} size={100} />

          <div className="mt-3 d-flex gap-2 justify-content-center flex-wrap">
            <button
              className="btn btn-outline-primary"
              onClick={() => setShowEditModal(true)}
            >
              ✏️ تعديل البيانات
            </button>

            <button className="btn btn-outline-dark" onClick={handleLogout}>
              🚪 تسجيل الخروج
            </button>

            <a
              className="btn btn-success"
              href={getWhatsAppLink(SUPPORT_PHONE, SUPPORT_MSG)}
              target="_blank"
              rel="noreferrer"
            >
              💬 دعم واتساب
            </a>
          </div>
        </div>

        {/* ✅ Edit Modal */}
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

        {/* (اختياري) بيانات تجريبية - لو تبي تعرضها لاحقًا */}
        <div style={{ display: "none" }}>
          {DEMO_RATING}
          {DEMO_REVIEWS.join(",")}
        </div>
      </div>
    </div>
  );
};

export default Profile;
