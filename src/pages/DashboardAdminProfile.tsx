import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import { auth, db } from "../services/firebase";
import { readStoredAuthSession } from "../services/localAuthSession";

import "../styles/DashboardModals.css";
import "../styles/stylesSettings/DashboardSettings.css";

type UiRole = "owner" | "admin" | "hr" | "reception" | "staff" | "pending" | "client" | "guest";

type AdminProfileDoc = {
  displayName: string;
  phone: string;
  email: string;
  photoURL: string;
  role: UiRole;
};

const SALON_ID = "main";
const USERS_COLLECTION = ["salons", SALON_ID, "users"] as const;

function normalizeRole(raw: unknown): UiRole {
  const role = String(raw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "hr") return "hr";
  if (role === "reception") return "reception";
  if (role === "staff") return "staff";
  if (role === "pending") return "pending";
  if (role === "client") return "client";
  return "guest";
}

const DashboardAdminProfile: React.FC = () => {
  const [authLoading, setAuthLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [uid, setUid] = useState("");
  const [docExists, setDocExists] = useState(false);

  const [profile, setProfile] = useState<AdminProfileDoc>({
    displayName: "",
    phone: "",
    email: "",
    photoURL: "",
    role: "guest",
  });

  const hasAdminPower = useMemo(() => {
    return profile.role === "owner" || profile.role === "admin";
  }, [profile.role]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);
      setMsg("");

      try {
        if (!user) {
          const localSession = readStoredAuthSession();
          if (localSession?.uid && localSession?.role) {
            setUid(localSession.uid);
            setDocExists(true);
            setProfile({
              displayName: localSession.displayName || "",
              phone: localSession.phone || "",
              email: localSession.email || "",
              photoURL: "",
              role: localSession.role as UiRole,
            });
          } else {
            setUid("");
            setDocExists(false);
            setProfile({
              displayName: "",
              phone: "",
              email: "",
              photoURL: "",
              role: "guest",
            });
          }
          return;
        }

        setUid(user.uid);
        const ref = doc(db, ...USERS_COLLECTION, user.uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setDocExists(false);
          setProfile({
            displayName: user.displayName || "",
            phone: "",
            email: user.email || "",
            photoURL: user.photoURL || "",
            role: "guest",
          });
          setMsg("لم يتم العثور على ملف المستخدم الإداري في المسار المعتمد.");
          return;
        }

        const data = snap.data() as any;
        const role = normalizeRole(data?.role);

        setDocExists(true);
        setProfile({
          displayName: String(data?.displayName || data?.name || user.displayName || ""),
          phone: String(data?.phone || ""),
          email: String(data?.email || user.email || ""),
          photoURL: String(data?.photoURL || ""),
          role,
        });
      } catch (e) {
        console.error("Admin profile load error:", e);
        setMsg("تعذر تحميل الملف الشخصي.");
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const handleSave = async () => {
    if (!uid || !docExists || !hasAdminPower) return;

    const displayName = String(profile.displayName || "").trim();
    const phone = String(profile.phone || "").trim();
    const photoURL = String(profile.photoURL || "").trim();

    if (!displayName) {
      setMsg("الاسم مطلوب.");
      return;
    }

    try {
      setSaving(true);
      setMsg("");

      const ref = doc(db, ...USERS_COLLECTION, uid);
      await updateDoc(ref, {
        displayName,
        name: displayName,
        phone,
        photoURL,
        updatedAt: serverTimestamp(),
      });

      try {
        const cached = JSON.parse(localStorage.getItem("user_profile_v1") || "null") || {};
        const merged = { ...cached, uid, name: displayName, displayName, phone, email: profile.email, photoURL };
        localStorage.setItem("user_profile_v1", JSON.stringify(merged));
        localStorage.setItem("userName", displayName);
        localStorage.setItem("userPhone", phone);

        const authUserCached = JSON.parse(localStorage.getItem("auth_user") || "null") || {};
        localStorage.setItem(
          "auth_user",
          JSON.stringify({
            ...authUserCached,
            uid,
            email: profile.email,
            role: profile.role,
            displayName,
          })
        );
        window.dispatchEvent(new Event("authChanged"));
      } catch {
      }

      setMsg("تم حفظ الملف الشخصي بنجاح.");
    } catch (e) {
      console.error("Admin profile save error:", e);
      setMsg("تعذر حفظ الملف الشخصي.");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <div className="settings-card">
            <h3 className="settings-title">جاري تحميل الملف الشخصي...</h3>
          </div>
        </div>
      </div>
    );
  }

  if (!hasAdminPower) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <div className="settings-card">
            <h3 className="settings-title">غير مصرح</h3>
            <p style={{ margin: 0, opacity: 0.8 }}>
              هذه الصفحة مخصصة لحسابات Owner / Admin فقط.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-section settings-page">
      <div className="settings-wrap">
        <div className="settings-header">
          <div>
            <h1>الملف الشخصي</h1>
            <p className="settings-hint">
              بيانات حساب الإدارة محفوظة في المسار: salons/{SALON_ID}/users/{uid}
            </p>
          </div>

          <div className="settings-save">
            {!!msg && (
              <span className={`settings-alert ${docExists ? "success" : "error"}`}>{msg}</span>
            )}
            <button
              className="exp-btn primary"
              type="button"
              onClick={handleSave}
              disabled={saving || !docExists}
              title={!docExists ? "المستند غير موجود" : "حفظ"}
            >
              {saving ? "جاري الحفظ..." : "حفظ"}
            </button>
          </div>
        </div>

        <div className="settings-card">
          <h3 className="settings-title">بيانات الحساب</h3>

          <div className="settings-grid">
            <div className="settings-field">
              <label>الاسم</label>
              <input
                className="settings-input"
                value={profile.displayName}
                onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
                disabled={!docExists || saving}
              />
            </div>

            <div className="settings-field">
              <label>رقم الجوال</label>
              <input
                className="settings-input"
                value={profile.phone}
                onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                disabled={!docExists || saving}
              />
            </div>

            <div className="settings-field">
              <label>البريد الإلكتروني</label>
              <input className="settings-input" value={profile.email} disabled />
            </div>

            <div className="settings-field">
              <label>الصورة (اختياري)</label>
              <input
                className="settings-input"
                value={profile.photoURL}
                onChange={(e) => setProfile((p) => ({ ...p, photoURL: e.target.value }))}
                disabled={!docExists || saving}
              />
            </div>

            <div className="settings-field">
              <label>الدور</label>
              <input className="settings-input" value={profile.role} disabled />
            </div>
          </div>

          {!docExists && (
            <div className="settings-note">
              * لم يتم الحفظ لأن مستند المستخدم غير موجود. الحفظ هنا يستخدم updateDoc فقط بدون إنشاء مستند.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardAdminProfile;
