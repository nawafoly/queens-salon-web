// ✅ src/pages/settings/SettingsBookings.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, getDocs, collection, setDoc, serverTimestamp } from "firebase/firestore";

import { auth, db } from "../../services/firebase";
import { AppSettingsService } from "../../services/AppSettingsService";

import "../../styles/DashboardModals.css";
import "../../styles/stylesSettings/DashboardSettings.css";

type UiRole =
  | "owner"
  | "admin"
  | "reception"
  | "staff"
  | "pending"
  | "client"
  | "guest";

function mapFirestoreRoleToUi(roleRaw: string): UiRole {
  const role = String(roleRaw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "reception") return "reception";
  if (role === "staff") return "staff";
  if (role === "pending") return "pending";
  if (role === "client") return "client";
  return "guest";
}

const SALON_ID = "main";
const USERS_COLLECTION = ["salons", SALON_ID, "users"] as const;
const STAFF_PUBLIC_COLLECTION = ["salons", SALON_ID, "staff_public"] as const;

type StaffAvailRow = {
  id: string;
  name: string;
  active: boolean;
  showOnBooking?: boolean;
  onLeave?: boolean;
  leaveNote?: string;
  leaveUntil?: string; // YYYY-MM-DD
};

export default function SettingsBookings() {
  const navigate = useNavigate();

  const [uiRole, setUiRole] = useState<UiRole>("guest");
  const [authLoading, setAuthLoading] = useState(true);

  const isOwner = uiRole === "owner";
  const isAdmin = uiRole === "admin";
  const hasAdminPower = isOwner || isAdmin;

  const [settings, setSettings] = useState<any>(() => AppSettingsService.getCached());
  const bookingSettings = (settings as any)?.bookingSettings || {};

  const setBookingSettings = (patch: any) => {
    if (!hasAdminPower) return;
    setSettings((prev: any) => ({
      ...prev,
      bookingSettings: { ...(prev?.bookingSettings || {}), ...patch },
    }));
  };

  const [savedMsg, setSavedMsg] = useState("");
  const saveAll = async () => {
    if (!hasAdminPower) return;
    try {
      await AppSettingsService.saveRemote(settings);
      setSavedMsg("✅ تم حفظ الإعدادات");
      setTimeout(() => setSavedMsg(""), 1800);
    } catch {
      setSavedMsg("❌ تعذر حفظ الإعدادات");
      setTimeout(() => setSavedMsg(""), 2200);
    }
  };

  // staff availability
  const [bookingMsg, setBookingMsg] = useState<string>("");
  const [staffAvailLoading, setStaffAvailLoading] = useState(false);
  const [staffAvail, setStaffAvail] = useState<StaffAvailRow[]>([]);

  const loadStaffAvailability = async () => {
    try {
      setStaffAvailLoading(true);
      const snap = await getDocs(collection(db, ...STAFF_PUBLIC_COLLECTION));

      const rows: StaffAvailRow[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          name: String(x?.name || ""),
          active: x?.active !== false,
          showOnBooking: x?.showOnBooking !== false,
          onLeave: !!x?.onLeave,
          leaveNote: String(x?.leaveNote || ""),
          leaveUntil: String(x?.leaveUntil || ""),
        };
      });

      rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
      setStaffAvail(rows);
    } catch (e) {
      console.error("loadStaffAvailability error:", e);
      setStaffAvail([]);
      setBookingMsg("❌ تعذر تحميل الموظفات (Rules?)");
    } finally {
      setStaffAvailLoading(false);
    }
  };

  const saveStaffAvailability = async (row: StaffAvailRow) => {
    if (!hasAdminPower) return;

    try {
      await setDoc(
        doc(db, ...STAFF_PUBLIC_COLLECTION, row.id),
        {
          active: row.active !== false,
          showOnBooking: row.showOnBooking !== false,
          onLeave: !!row.onLeave,
          leaveNote: String(row.leaveNote || ""),
          leaveUntil: String(row.leaveUntil || ""),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setBookingMsg("✅ تم حفظ حالة الموظفة");
      setTimeout(() => setBookingMsg(""), 1500);
    } catch (e) {
      console.error("saveStaffAvailability error:", e);
      setBookingMsg("❌ تعذر حفظ حالة الموظفة");
      setTimeout(() => setBookingMsg(""), 2200);
    }
  };

  // auth + role
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);
      try {
        if (!user) {
          setUiRole("guest");
          return;
        }
        const userRef = doc(db, ...USERS_COLLECTION, user.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          setUiRole("guest");
          return;
        }
        setUiRole(mapFirestoreRoleToUi((snap.data() as any)?.role));
      } catch (e) {
        console.error(e);
        setUiRole("guest");
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    AppSettingsService.fetchRemote()
      .then((remote) => setSettings(remote))
      .catch(() => {});

    const unsub = AppSettingsService.subscribe((remote: any) => {
      setSettings(remote);
    });
    return () => unsub();
  }, []);

  const hint = useMemo(() => {
    if (hasAdminPower) return "تقدر تعدّل وتحفظ.";
    return "عرض فقط (تحتاج Owner/Admin للتعديل).";
  }, [hasAdminPower]);

  if (authLoading) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <div className="settings-card">
            <h3 className="settings-title">جاري التحميل…</h3>
          </div>
        </div>
      </div>
    );
  }

  if (!hasAdminPower && uiRole !== "reception" && uiRole !== "staff") {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <h3>غير مصرح</h3>
          <p>هذه الصفحة مخصصة للإدارة.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-section settings-page">
      <div className="settings-wrap">
        <div className="settings-header">
          <div>
            <h1>إعدادات الحجوزات</h1>
            <p className="settings-hint">{hint}</p>
          </div>

          <div className="settings-save">
            {savedMsg && <span className="settings-saved">{savedMsg}</span>}

            <button className="dash-btn" type="button" onClick={() => navigate("/dashboard/settings/advanced")}>
              رجوع
            </button>

            <button
              className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
              onClick={saveAll}
              disabled={!hasAdminPower}
              type="button"
              title={!hasAdminPower ? "تحتاج Owner/Admin" : "حفظ"}
            >
              حفظ
            </button>
          </div>
        </div>

        <div className="settings-card" style={{ marginTop: 0 }}>
          <h3 className="settings-title">إعدادات الحجز العامة</h3>

          <div className="settings-list">
            <label className="settings-row">
              <span>وضع الصيانة (إيقاف الحجز للزبائن)</span>
              <input
                className="settings-check"
                type="checkbox"
                checked={!!bookingSettings.maintenanceMode}
                disabled={!hasAdminPower}
                onChange={() =>
                  setBookingSettings({
                    maintenanceMode: !bookingSettings.maintenanceMode,
                  })
                }
              />
            </label>
          </div>

          <div className="settings-field" style={{ marginTop: 10 }}>
            <label>رسالة الصيانة (تظهر للزبائن)</label>
            <input
              className="settings-input"
              value={String(bookingSettings.maintenanceMessage || "")}
              disabled={!hasAdminPower}
              onChange={(e) =>
                setBookingSettings({ maintenanceMessage: e.target.value })
              }
              placeholder="مثال: الحجز متوقف مؤقتًا للصيانة، نعود قريبًا"
            />
          </div>

          <div className="settings-footnote">
            * هذه القيم تُحفظ داخل AppSettings.
          </div>
        </div>

        <div className="settings-card">
          <h3 className="settings-title">إجازات الموظفات وظهورهن في الحجز</h3>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className={`exp-btn ${staffAvailLoading ? "is-disabled" : ""}`}
              disabled={staffAvailLoading}
              onClick={loadStaffAvailability}
            >
              {staffAvailLoading ? "تحميل..." : "تحميل الموظفات"}
            </button>

            {bookingMsg && (
              <span className="settings-alert success" style={{ marginInlineStart: 6 }}>
                {bookingMsg}
              </span>
            )}
          </div>

          <div className="settings-list" style={{ marginTop: 12 }}>
            {staffAvailLoading ? (
              <div className="settings-note">جاري تحميل الموظفات…</div>
            ) : staffAvail.length === 0 ? (
              <div className="settings-note">اضغط "تحميل الموظفات" لعرض القائمة.</div>
            ) : (
              staffAvail.map((s) => (
                <div
                  key={s.id}
                  className="settings-row"
                  style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
                >
                  <div style={{ minWidth: 220, display: "grid" }}>
                    <span style={{ fontWeight: 900 }}>{s.name || "بدون اسم"}</span>
                    <span style={{ opacity: 0.7, fontSize: 12 }}>{s.id}</span>
                  </div>

                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
                    <input
                      className="settings-check"
                      type="checkbox"
                      checked={s.showOnBooking !== false}
                      disabled={!hasAdminPower}
                      onChange={() =>
                        setStaffAvail((p) =>
                          p.map((x) =>
                            x.id === s.id
                              ? { ...x, showOnBooking: !(x.showOnBooking !== false) }
                              : x
                          )
                        )
                      }
                    />
                    تظهر في الحجز
                  </label>

                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
                    <input
                      className="settings-check"
                      type="checkbox"
                      checked={!!s.onLeave}
                      disabled={!hasAdminPower}
                      onChange={() =>
                        setStaffAvail((p) =>
                          p.map((x) => (x.id === s.id ? { ...x, onLeave: !x.onLeave } : x))
                        )
                      }
                    />
                    في إجازة
                  </label>

                  <input
                    className="settings-input"
                    style={{ width: 160 }}
                    type="date"
                    value={s.leaveUntil || ""}
                    disabled={!hasAdminPower}
                    onChange={(e) =>
                      setStaffAvail((p) =>
                        p.map((x) => (x.id === s.id ? { ...x, leaveUntil: e.target.value } : x))
                      )
                    }
                    title="تاريخ العودة"
                  />

                  <input
                    className="settings-input"
                    style={{ minWidth: 220 }}
                    value={s.leaveNote || ""}
                    disabled={!hasAdminPower}
                    onChange={(e) =>
                      setStaffAvail((p) =>
                        p.map((x) => (x.id === s.id ? { ...x, leaveNote: e.target.value } : x))
                      )
                    }
                    placeholder="ملاحظة للزبائن (اختياري)"
                  />

                  <button
                    type="button"
                    className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
                    disabled={!hasAdminPower}
                    onClick={() => saveStaffAvailability(s)}
                  >
                    حفظ
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="settings-footnote">
            * يتم الحفظ في: <b>salons/main/staff_public</b> داخل حقول:{" "}
            <b>showOnBooking/onLeave/leaveUntil/leaveNote</b>
          </div>
        </div>
      </div>
    </div>
  );
}
