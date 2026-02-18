// ✅ src/pages/settings/SettingsBookings.tsx

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

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

// ✅ Local cache key (بديل setCached)
const APP_SETTINGS_CACHE_KEY = "qs_app_settings_cache_v1";

type StaffAvailRow = {
  id: string;
  name: string;
  active: boolean;
  showOnBooking?: boolean;
  onLeave?: boolean;
  leaveNote?: string;
  leaveUntil?: string; // YYYY-MM-DD
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function safeTimeHHMM(v: any, fallback: string) {
  const s = String(v || "").trim();

  // نقبل H:MM أو HH:MM
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;

  const hh = Number(m[1]);
  const mm = Number(m[2]);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallback;
  if (hh < 0 || hh > 23) return fallback;
  if (mm < 0 || mm > 59) return fallback;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function loadLocalSettings() {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLocalSettings(settings: any) {
  try {
    localStorage.setItem(APP_SETTINGS_CACHE_KEY, JSON.stringify(settings || {}));
  } catch {
    // ignore
  }
}

function defaultBusinessHoursLocal() {
  return {
    sat: { enabled: true, start: "10:00", end: "22:00" },
    sun: { enabled: true, start: "10:00", end: "22:00" },
    mon: { enabled: true, start: "10:00", end: "22:00" },
    tue: { enabled: true, start: "10:00", end: "22:00" },
    wed: { enabled: true, start: "10:00", end: "22:00" },
    thu: { enabled: true, start: "10:00", end: "22:00" },
    fri: { enabled: false, start: "10:00", end: "22:00" },
  };
}

export default function SettingsBookings() {
  const navigate = useNavigate();

  const [uiRole, setUiRole] = useState<UiRole>("guest");
  const [authLoading, setAuthLoading] = useState(true);

  const isOwner = uiRole === "owner";
  const isAdmin = uiRole === "admin";
  const hasAdminPower = isOwner || isAdmin;

  // ✅ نبدأ من: AppSettingsService.getCached() ثم fallback إلى localStorage
  const [settings, setSettings] = useState<any>(() => {
    const cached = AppSettingsService.getCached?.();
    if (cached) return cached;
    const local = loadLocalSettings();
    if (local) return local;
    return {};
  });

  const bookingSettings = (settings as any)?.booking || {};

  const seasonFill = (bookingSettings as any)?.seasonFill || {};
  const seasonFillEnabled = !!seasonFill.enabled;
  const seasonFillFrom = String(seasonFill.from || "");
  const seasonFillTo = String(seasonFill.to || "");

  const setBookingSettings = (patch: any) => {
    if (!hasAdminPower) return;

    setSettings((prev: any) => {
      const next = {
        ...prev,
        booking: { ...(prev?.booking || {}), ...patch },
      };

      // ✅ كاش محلي فوري
      saveLocalSettings(next);
      // ✅ كاش AppSettingsService لو موجود
      // AppSettingsService.setCached?.(next);

      return next;
    });
  };

  // ✅ Defaults
  const slotStepMin = useMemo(() => {
    const raw = bookingSettings?.slotStepMin;
    const v = safeInt(raw, 10);
    return [5, 10, 15, 30].includes(v) ? v : 10;
  }, [bookingSettings?.slotStepMin]);

  const bufferMin = useMemo(() => {
    const raw = bookingSettings?.bufferMin;
    const v = safeInt(raw, 5);
    return [0, 5, 10, 15, 20, 30].includes(v) ? v : 5;
  }, [bookingSettings?.bufferMin]);



  const businessHours = useMemo(() => {
    return (bookingSettings as any)?.businessHours || defaultBusinessHoursLocal();
  }, [bookingSettings?.businessHours]);

  const openTime = useMemo(() => {
    return safeTimeHHMM(businessHours?.sat?.start, "10:00");
  }, [businessHours?.sat?.start]);

  const closeTime = useMemo(() => {
    return safeTimeHHMM(businessHours?.sat?.end, "22:00");
  }, [businessHours?.sat?.end]);

  const [savedMsg, setSavedMsg] = useState("");

  // ✅ helper: خذ آخر نسخة مؤكدة (state الحالي أولاً ثم cache)
  function getLatestSettingsSnapshot() {
    return settings || loadLocalSettings() || AppSettingsService.getCached?.() || {};
  }

  const saveAll = async () => {
    if (!hasAdminPower) return;

    try {
      // ✅ أهم نقطة: نقرأ آخر نسخة من localStorage (عشان ما نتعلق بتأخير setState)
      const latest = getLatestSettingsSnapshot();
      const latestBooking = (latest as any)?.booking || {};

      const bhRaw = latestBooking?.businessHours || defaultBusinessHoursLocal();

      const oRaw = bhRaw?.sat?.start;
      const cRaw = bhRaw?.sat?.end;

      const oNorm = safeTimeHHMM(oRaw, "10:00");
      const cNorm = safeTimeHHMM(cRaw, "22:00");

      // Allow overnight shifts (e.g. 20:00 -> 02:00). Reject only exact equality.
      if (oNorm === cNorm) {
        setSavedMsg("❌ بداية ونهاية الدوام لا يمكن أن تكونا نفس الوقت");
        setTimeout(() => setSavedMsg(""), 2200);
        return;
      }

      // ✅ طبّع فعليًا داخل businessHours قبل الحفظ
      const bh = { ...(bhRaw || defaultBusinessHoursLocal()) };
      bh.sat = { ...(bh.sat || { enabled: true }), start: oNorm, end: cNorm };


      const normalizedSettingsToSave = {
        ...(latest || {}),
        booking: {
          ...(latestBooking || {}),
          slotStepMin, // من UI (مضمون 5/10/15/30)
          bufferMin,   // ✅ جديد: بفر بعد كل حجز
          businessHours: bh,
          seasonFill: latestBooking?.seasonFill || { enabled: false, from: "", to: "" },
          sequentialBooking: !!latestBooking?.sequentialBooking,
        },
      };



      // ✅ حفظ ريموت
      await AppSettingsService.saveRemote(normalizedSettingsToSave);

      // ✅ حدّث الكاشين فورًا
      // AppSettingsService.setCached?.(normalizedSettingsToSave);
      saveLocalSettings(normalizedSettingsToSave);
      setSettings(normalizedSettingsToSave);

      console.log("✅ SAVED booking:", normalizedSettingsToSave.booking);

      setSavedMsg("✅ تم حفظ الإعدادات");
      setTimeout(() => setSavedMsg(""), 1800);
    } catch (e: any) {
      console.error("❌ saveAll error:", e);

      const msg =
        String(e?.message || e?.code || "")
          .toLowerCase()
          .includes("permission") ||
          String(e?.code || "").toLowerCase().includes("permission")
          ? "❌ فشل الحفظ: الصلاحيات (Rules) تمنع الكتابة"
          : "❌ تعذر حفظ الإعدادات";

      setSavedMsg(msg);
      setTimeout(() => setSavedMsg(""), 2600);
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
      const t = todayISO();
      const until = String(row.leaveUntil || "").trim();
      const leaveExpired = !!until && until < t;

      const effectiveOnLeave = leaveExpired ? false : !!row.onLeave;

      await setDoc(
        doc(db, ...STAFF_PUBLIC_COLLECTION, row.id),
        {
          active: row.active !== false,
          showOnBooking: row.showOnBooking !== false,
          onLeave: effectiveOnLeave,
          leaveNote: String(row.leaveNote || ""),
          leaveUntil: String(row.leaveUntil || ""),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setBookingMsg("✅ تم حفظ حالة الموظفة");
      setTimeout(() => setBookingMsg(""), 1500);

      setStaffAvail((p) =>
        p.map((x) => (x.id === row.id ? { ...x, onLeave: effectiveOnLeave } : x))
      );
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
    // ✅ أولاً: حاول تجيب الريموت
    AppSettingsService.fetchRemote()
      .then((remote) => {
        setSettings(remote || {});
        saveLocalSettings(remote || {});
        // AppSettingsService.setCached?.(remote || {});
      })
      .catch(() => {
        // لو فشل: نعتمد على cached/local
      });

    // ✅ اشتراك التحديثات
    const unsub = AppSettingsService.subscribe((remote: any) => {
      setSettings((prev: any) => {
        const prevB = prev?.booking || {};
        const remoteB = (remote as any)?.booking || {};

        const merged = {
          ...(prev || {}),
          ...(remote || {}),
          booking: {
            ...prevB,
            ...remoteB,
          },
        };

        saveLocalSettings(merged);
        // AppSettingsService.setCached?.(merged);
        return merged;
      });
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

  const tISO = todayISO();

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

            <button
              className="dash-btn"
              type="button"
              onClick={() => navigate("/dashboard/settings/advanced")}
            >
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
              onChange={(e) => setBookingSettings({ maintenanceMessage: e.target.value })}
              placeholder="مثال: الحجز متوقف مؤقتًا للصيانة، نعود قريبًا"
            />
          </div>

          <div className="settings-footnote">* هذه القيم تُحفظ داخل AppSettings.</div>
        </div>

        <div className="settings-card">
          <h3 className="settings-title">مواعيد الدوام في الحجز</h3>

          <div className="settings-list">
            <div
              className="settings-row"
              style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 900 }}>خطوة الوقت (الدقائق)</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  10 دقائق = دقة أعلى، 15 دقيقة = سريع، 30 دقيقة = أبسط
                </div>
              </div>

              <select
                className="form-select dash-select"
                style={{ width: 160 }}
                value={String(slotStepMin)}
                disabled={!hasAdminPower}
                onChange={(e) => setBookingSettings({ slotStepMin: Number(e.target.value) })}
              >
                <option value="5">5 دقائق</option>
                <option value="10">10 دقائق</option>
                <option value="15">15 دقيقة</option>
                <option value="30">30 دقيقة</option>
              </select>
            </div>


            <div
              className="settings-row"
              style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 900 }}>البفر بعد كل حجز (دقائق)</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  نعرض أول وقت حجز متاح من بداية الدوام مباشرة
                </div>
              </div>

              <select
                className="form-select dash-select"
                style={{ width: 160 }}
                value={String(bufferMin)}
                disabled={!hasAdminPower}
                onChange={(e) => setBookingSettings({ bufferMin: Number(e.target.value) })}
              >
                <option value="0">بدون بفر</option>
                <option value="5">5 دقائق</option>
                <option value="10">10 دقائق</option>
                <option value="15">15 دقيقة</option>
                <option value="20">20 دقيقة</option>
                <option value="30">30 دقيقة</option>
              </select>
            </div>


            <div
              className="settings-row"
              style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 900 }}>بداية الدوام</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>صيغة 24 ساعة (HH:MM)</div>
              </div>

              <input
                type="time"
                className="settings-input"
                style={{ width: 160 }}
                value={openTime}
                disabled={!hasAdminPower}
                onChange={(e) => {
                  const v = e.target.value;
                  const bh = bookingSettings?.businessHours || defaultBusinessHoursLocal();

                  const next = { ...bh };
                  next.sat = { ...next.sat, start: v };

                  setBookingSettings({ businessHours: next });
                }}
                placeholder="10:00"
              />
            </div>

            <div
              className="settings-row"
              style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 900 }}>نهاية الدوام</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>صيغة 24 ساعة (HH:MM)</div>
              </div>

              <input
                type="time"
                className="settings-input"
                style={{ width: 160 }}
                value={closeTime}
                disabled={!hasAdminPower}
                onChange={(e) => {
                  const v = e.target.value;
                  const bh = bookingSettings?.businessHours || defaultBusinessHoursLocal();

                  const next = { ...bh };
                  next.sat = { ...next.sat, end: v };

                  setBookingSettings({ businessHours: next });
                }}
                placeholder="22:00"
              />
            </div>
          </div>

          <div className="settings-footnote">
            * يتم الحفظ في AppSettings داخل: booking.businessHours.sat.start / booking.businessHours.sat.end /
            booking.slotStepMin / booking.bufferMin

            <br />
            * ربطها بصفحة الحجز: Booking.tsx يقرأ من AppSettingsService.getCached()
          </div>
        </div>

        <div className="settings-card">
          <h3 className="settings-title">إجازات الموظفات وظهورهن في الحجز</h3>

          <div className="settings-card">
            <h3 className="settings-title">وضع الموسم لوقت الحجز (تقليل الهدر)</h3>

            <div className="settings-list">
              <label className="settings-row">
                <span>تفعيل ترتيب اليوم تلقائيًا خلال الموسم</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={seasonFillEnabled}
                  disabled={!hasAdminPower}
                  onChange={() =>
                    setBookingSettings({
                      seasonFill: {
                        ...(seasonFill || {}),
                        enabled: !seasonFillEnabled,
                      },
                    })
                  }
                />
              </label>
            </div>

            <div className="settings-grid" style={{ marginTop: 10 }}>
              <div className="settings-field">
                <label>من تاريخ</label>
                <input
                  className="settings-input"
                  type="date"
                  value={seasonFillFrom}
                  disabled={!hasAdminPower || !seasonFillEnabled}
                  onChange={(e) =>
                    setBookingSettings({
                      seasonFill: { ...(seasonFill || {}), from: e.target.value },
                    })
                  }
                />
              </div>

              <div className="settings-field">
                <label>إلى تاريخ</label>
                <input
                  className="settings-input"
                  type="date"
                  value={seasonFillTo}
                  disabled={!hasAdminPower || !seasonFillEnabled}
                  onChange={(e) =>
                    setBookingSettings({
                      seasonFill: { ...(seasonFill || {}), to: e.target.value },
                    })
                  }
                />
              </div>
            </div>

            <div className="settings-footnote">
              * يتم الحفظ في AppSettings داخل: <b>booking.seasonFill</b>
              <br />
              * التنفيذ الفعلي لترتيب اليوم بيكون داخل Booking.tsx + timeSlots.ts
            </div>

            <div className="settings-list" style={{ marginTop: 20 }}>
              <label className="settings-row">
                <span>إجبار الحجز المتتابع (منع الفراغات بين المواعيد)</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={!!bookingSettings?.sequentialBooking}
                  disabled={!hasAdminPower}
                  onChange={(e) =>
                    setBookingSettings({
                      sequentialBooking: e.target.checked,
                    })
                  }
                />
              </label>
              <p className="field-hint" style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                عند التفعيل، سيتم إجبار العميلات على الحجز مباشرة بعد آخر موعد محجوز في اليوم لمنع هدر الوقت.
              </p>
            </div>
          </div>

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
              staffAvail.map((s) => {
                const until = String(s.leaveUntil || "").trim();
                const leaveExpired = !!until && until < tISO;
                const effectiveOnLeave = !!s.onLeave && !leaveExpired;

                return (
                  <div
                    key={s.id}
                    className="settings-row"
                    style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
                  >
                    <div style={{ minWidth: 220, display: "grid" }}>
                      <span style={{ fontWeight: 900 }}>
                        {s.name || "بدون اسم"}
                        {leaveExpired && (
                          <span style={{ marginInlineStart: 8, fontSize: 12, opacity: 0.8 }}>
                            (إجازة منتهية)
                          </span>
                        )}
                      </span>
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
                        checked={effectiveOnLeave}
                        disabled={!hasAdminPower}
                        onChange={() =>
                          setStaffAvail((p) =>
                            p.map((x) => (x.id === s.id ? { ...x, onLeave: !effectiveOnLeave } : x))
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
                );
              })
            )}
          </div>

          <div className="settings-footnote">
            * يتم الحفظ في: <b>salons/main/staff_public</b> داخل حقول: <b>showOnBooking/onLeave/leaveUntil/leaveNote</b>
            <br />
            * ملاحظة: إذا <b>leaveUntil</b> فات، الصفحة تعتبر الإجازة منتهية (حتى لو onLeave كان مفعّل).
          </div>
        </div>
      </div>
    </div>
  );
}
