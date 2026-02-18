// âœ… src/pages/settings/SettingsBookings.tsx

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

// âœ… Local cache key (ط¨ط¯ظٹظ„ setCached)
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

  // ظ†ظ‚ط¨ظ„ H:MM ط£ظˆ HH:MM
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

  // âœ… ظ†ط¨ط¯ط£ ظ…ظ†: AppSettingsService.getCached() ط«ظ… fallback ط¥ظ„ظ‰ localStorage
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

      // âœ… ظƒط§ط´ ظ…ط­ظ„ظٹ ظپظˆط±ظٹ
      saveLocalSettings(next);
      // âœ… ظƒط§ط´ AppSettingsService ظ„ظˆ ظ…ظˆط¬ظˆط¯
      // AppSettingsService.setCached?.(next);

      return next;
    });
  };

  // âœ… Defaults
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

  // âœ… helper: ط®ط° ط¢ط®ط± ظ†ط³ط®ط© ظ…ط¤ظƒط¯ط© (localStorage ط£ظˆظ„ط§ظ‹)
  function getLatestSettingsSnapshot() {
    return loadLocalSettings() || AppSettingsService.getCached?.() || settings || {};
  }

  const saveAll = async () => {
    if (!hasAdminPower) return;

    try {
      // âœ… ط£ظ‡ظ… ظ†ظ‚ط·ط©: ظ†ظ‚ط±ط£ ط¢ط®ط± ظ†ط³ط®ط© ظ…ظ† localStorage (ط¹ط´ط§ظ† ظ…ط§ ظ†طھط¹ظ„ظ‚ ط¨طھط£ط®ظٹط± setState)
      const latest = getLatestSettingsSnapshot();
      const latestBooking = (latest as any)?.booking || {};

      const bhRaw = latestBooking?.businessHours || defaultBusinessHoursLocal();

      const oRaw = bhRaw?.sat?.start;
      const cRaw = bhRaw?.sat?.end;

      const oNorm = safeTimeHHMM(oRaw, "10:00");
      const cNorm = safeTimeHHMM(cRaw, "22:00");

      if (oNorm === cNorm) {
        setSavedMsg("❌ بداية ونهاية الدوام لا يمكن تكون نفس الوقت");
        setTimeout(() => setSavedMsg(""), 2200);
        return;
      }

      // âœ… ط·ط¨ظ‘ط¹ ظپط¹ظ„ظٹظ‹ط§ ط¯ط§ط®ظ„ businessHours ظ‚ط¨ظ„ ط§ظ„ط­ظپط¸
      const bh = { ...(bhRaw || defaultBusinessHoursLocal()) };
      bh.sat = { ...(bh.sat || { enabled: true }), start: oNorm, end: cNorm };


      const normalizedSettingsToSave = {
        ...(latest || {}),
        booking: {
          ...(latestBooking || {}),
          slotStepMin, // ظ…ظ† UI (ظ…ط¶ظ…ظˆظ† 5/10/15/30)
          bufferMin,   // âœ… ط¬ط¯ظٹط¯: ط¨ظپط± ط¨ط¹ط¯ ظƒظ„ ط­ط¬ط²
          businessHours: bh,
          seasonFill: latestBooking?.seasonFill || { enabled: false, from: "", to: "" },
          sequentialBooking: !!latestBooking?.sequentialBooking,
        },
      };



      // âœ… ط­ظپط¸ ط±ظٹظ…ظˆطھ
      await AppSettingsService.saveRemote(normalizedSettingsToSave);

      // âœ… ط­ط¯ظ‘ط« ط§ظ„ظƒط§ط´ظٹظ† ظپظˆط±ظ‹ط§
      // AppSettingsService.setCached?.(normalizedSettingsToSave);
      saveLocalSettings(normalizedSettingsToSave);
      setSettings(normalizedSettingsToSave);

      console.log("âœ… SAVED booking:", normalizedSettingsToSave.booking);

      setSavedMsg("âœ… طھظ… ط­ظپط¸ ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ");
      setTimeout(() => setSavedMsg(""), 1800);
    } catch (e: any) {
      console.error("â‌Œ saveAll error:", e);

      const msg =
        String(e?.message || e?.code || "")
          .toLowerCase()
          .includes("permission") ||
          String(e?.code || "").toLowerCase().includes("permission")
          ? "â‌Œ ظپط´ظ„ ط§ظ„ط­ظپط¸: ط§ظ„طµظ„ط§ط­ظٹط§طھ (Rules) طھظ…ظ†ط¹ ط§ظ„ظƒطھط§ط¨ط©"
          : "â‌Œ طھط¹ط°ط± ط­ظپط¸ ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ";

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
      setBookingMsg("â‌Œ طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ظ…ظˆط¸ظپط§طھ (Rules?)");
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

      setBookingMsg("âœ… طھظ… ط­ظپط¸ ط­ط§ظ„ط© ط§ظ„ظ…ظˆط¸ظپط©");
      setTimeout(() => setBookingMsg(""), 1500);

      setStaffAvail((p) =>
        p.map((x) => (x.id === row.id ? { ...x, onLeave: effectiveOnLeave } : x))
      );
    } catch (e) {
      console.error("saveStaffAvailability error:", e);
      setBookingMsg("â‌Œ طھط¹ط°ط± ط­ظپط¸ ط­ط§ظ„ط© ط§ظ„ظ…ظˆط¸ظپط©");
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
    // âœ… ط£ظˆظ„ط§ظ‹: ط­ط§ظˆظ„ طھط¬ظٹط¨ ط§ظ„ط±ظٹظ…ظˆطھ
    AppSettingsService.fetchRemote()
      .then((remote) => {
        setSettings(remote || {});
        saveLocalSettings(remote || {});
        // AppSettingsService.setCached?.(remote || {});
      })
      .catch(() => {
        // ظ„ظˆ ظپط´ظ„: ظ†ط¹طھظ…ط¯ ط¹ظ„ظ‰ cached/local
      });

    // âœ… ط§ط´طھط±ط§ظƒ ط§ظ„طھط­ط¯ظٹط«ط§طھ
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
    if (hasAdminPower) return "طھظ‚ط¯ط± طھط¹ط¯ظ‘ظ„ ظˆطھط­ظپط¸.";
    return "ط¹ط±ط¶ ظپظ‚ط· (طھط­طھط§ط¬ Owner/Admin ظ„ظ„طھط¹ط¯ظٹظ„).";
  }, [hasAdminPower]);

  if (authLoading) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <div className="settings-card">
            <h3 className="settings-title">ط¬ط§ط±ظٹ ط§ظ„طھط­ظ…ظٹظ„â€¦</h3>
          </div>
        </div>
      </div>
    );
  }

  if (!hasAdminPower && uiRole !== "reception" && uiRole !== "staff") {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <h3>ط؛ظٹط± ظ…طµط±ط­</h3>
          <p>ظ‡ط°ظ‡ ط§ظ„طµظپط­ط© ظ…ط®طµطµط© ظ„ظ„ط¥ط¯ط§ط±ط©.</p>
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
            <h1>ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط­ط¬ظˆط²ط§طھ</h1>
            <p className="settings-hint">{hint}</p>
          </div>

          <div className="settings-save">
            {savedMsg && <span className="settings-saved">{savedMsg}</span>}

            <button
              className="dash-btn"
              type="button"
              onClick={() => navigate("/dashboard/settings/advanced")}
            >
              ط±ط¬ظˆط¹
            </button>

            <button
              className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
              onClick={saveAll}
              disabled={!hasAdminPower}
              type="button"
              title={!hasAdminPower ? "طھط­طھط§ط¬ Owner/Admin" : "ط­ظپط¸"}
            >
              ط­ظپط¸
            </button>
          </div>
        </div>

        <div className="settings-card" style={{ marginTop: 0 }}>
          <h3 className="settings-title">ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط­ط¬ط² ط§ظ„ط¹ط§ظ…ط©</h3>

          <div className="settings-list">
            <label className="settings-row">
              <span>ظˆط¶ط¹ ط§ظ„طµظٹط§ظ†ط© (ط¥ظٹظ‚ط§ظپ ط§ظ„ط­ط¬ط² ظ„ظ„ط²ط¨ط§ط¦ظ†)</span>
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
            <label>ط±ط³ط§ظ„ط© ط§ظ„طµظٹط§ظ†ط© (طھط¸ظ‡ط± ظ„ظ„ط²ط¨ط§ط¦ظ†)</label>
            <input
              className="settings-input"
              value={String(bookingSettings.maintenanceMessage || "")}
              disabled={!hasAdminPower}
              onChange={(e) => setBookingSettings({ maintenanceMessage: e.target.value })}
              placeholder="ظ…ط«ط§ظ„: ط§ظ„ط­ط¬ط² ظ…طھظˆظ‚ظپ ظ…ط¤ظ‚طھظ‹ط§ ظ„ظ„طµظٹط§ظ†ط©طŒ ظ†ط¹ظˆط¯ ظ‚ط±ظٹط¨ظ‹ط§"
            />
          </div>

          <div className="settings-footnote">* ظ‡ط°ظ‡ ط§ظ„ظ‚ظٹظ… طھظڈط­ظپط¸ ط¯ط§ط®ظ„ AppSettings.</div>
        </div>

        <div className="settings-card">
          <h3 className="settings-title">ظ…ظˆط§ط¹ظٹط¯ ط§ظ„ط¯ظˆط§ظ… ظپظٹ ط§ظ„ط­ط¬ط²</h3>

          <div className="settings-list">
            <div
              className="settings-row"
              style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 900 }}>ط®ط·ظˆط© ط§ظ„ظˆظ‚طھ (ط§ظ„ط¯ظ‚ط§ط¦ظ‚)</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  10 ط¯ظ‚ط§ط¦ظ‚ = ط¯ظ‚ط© ط£ط¹ظ„ظ‰طŒ 15 ط¯ظ‚ظٹظ‚ط© = ط³ط±ظٹط¹طŒ 30 ط¯ظ‚ظٹظ‚ط© = ط£ط¨ط³ط·
                </div>
              </div>

              <select
                className="form-select dash-select"
                style={{ width: 160 }}
                value={String(slotStepMin)}
                disabled={!hasAdminPower}
                onChange={(e) => setBookingSettings({ slotStepMin: Number(e.target.value) })}
              >
                <option value="5">5 ط¯ظ‚ط§ط¦ظ‚</option>
                <option value="10">10 ط¯ظ‚ط§ط¦ظ‚</option>
                <option value="15">15 ط¯ظ‚ظٹظ‚ط©</option>
                <option value="30">30 ط¯ظ‚ظٹظ‚ط©</option>
              </select>
            </div>


            <div
              className="settings-row"
              style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 900 }}>ط§ظ„ط¨ظپط± ط¨ط¹ط¯ ظƒظ„ ط­ط¬ط² (ط¯ظ‚ط§ط¦ظ‚)</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  ظ†ط¹ط±ط¶ ط£ظˆظ„ ظˆظ‚طھ ط­ط¬ط² ظ…طھط§ط­ ظ…ظ† ط¨ط¯ط§ظٹط© ط§ظ„ط¯ظˆط§ظ… ظ…ط¨ط§ط´ط±ط©
                </div>
              </div>

              <select
                className="form-select dash-select"
                style={{ width: 160 }}
                value={String(bufferMin)}
                disabled={!hasAdminPower}
                onChange={(e) => setBookingSettings({ bufferMin: Number(e.target.value) })}
              >
                <option value="0">ط¨ط¯ظˆظ† ط¨ظپط±</option>
                <option value="5">5 ط¯ظ‚ط§ط¦ظ‚</option>
                <option value="10">10 ط¯ظ‚ط§ط¦ظ‚</option>
                <option value="15">15 ط¯ظ‚ظٹظ‚ط©</option>
                <option value="20">20 ط¯ظ‚ظٹظ‚ط©</option>
                <option value="30">30 ط¯ظ‚ظٹظ‚ط©</option>
              </select>
            </div>


            <div
              className="settings-row"
              style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 900 }}>ط¨ط¯ط§ظٹط© ط§ظ„ط¯ظˆط§ظ…</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>طµظٹط؛ط© 24 ط³ط§ط¹ط© (HH:MM)</div>
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
                <div style={{ fontWeight: 900 }}>ظ†ظ‡ط§ظٹط© ط§ظ„ط¯ظˆط§ظ…</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>طµظٹط؛ط© 24 ط³ط§ط¹ط© (HH:MM)</div>
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
            * ظٹطھظ… ط§ظ„ط­ظپط¸ ظپظٹ AppSettings ط¯ط§ط®ظ„: booking.businessHours.sat.start / booking.businessHours.sat.end /
            booking.slotStepMin / booking.bufferMin

            <br />
            * ط±ط¨ط·ظ‡ط§ ط¨طµظپط­ط© ط§ظ„ط­ط¬ط²: Booking.tsx ظٹظ‚ط±ط£ ظ…ظ† AppSettingsService.getCached()
          </div>
        </div>

        <div className="settings-card">
          <h3 className="settings-title">ط¥ط¬ط§ط²ط§طھ ط§ظ„ظ…ظˆط¸ظپط§طھ ظˆط¸ظ‡ظˆط±ظ‡ظ† ظپظٹ ط§ظ„ط­ط¬ط²</h3>

          <div className="settings-card">
            <h3 className="settings-title">ظˆط¶ط¹ ط§ظ„ظ…ظˆط³ظ… ظ„ظˆظ‚طھ ط§ظ„ط­ط¬ط² (طھظ‚ظ„ظٹظ„ ط§ظ„ظ‡ط¯ط±)</h3>

            <div className="settings-list">
              <label className="settings-row">
                <span>طھظپط¹ظٹظ„ طھط±طھظٹط¨ ط§ظ„ظٹظˆظ… طھظ„ظ‚ط§ط¦ظٹظ‹ط§ ط®ظ„ط§ظ„ ط§ظ„ظ…ظˆط³ظ…</span>
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
                <label>ظ…ظ† طھط§ط±ظٹط®</label>
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
                <label>ط¥ظ„ظ‰ طھط§ط±ظٹط®</label>
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
              * ظٹطھظ… ط§ظ„ط­ظپط¸ ظپظٹ AppSettings ط¯ط§ط®ظ„: <b>booking.seasonFill</b>
              <br />
              * ط§ظ„طھظ†ظپظٹط° ط§ظ„ظپط¹ظ„ظٹ ظ„طھط±طھظٹط¨ ط§ظ„ظٹظˆظ… ط¨ظٹظƒظˆظ† ط¯ط§ط®ظ„ Booking.tsx + timeSlots.ts
            </div>

            <div className="settings-list" style={{ marginTop: 20 }}>
              <label className="settings-row">
                <span>ط¥ط¬ط¨ط§ط± ط§ظ„ط­ط¬ط² ط§ظ„ظ…طھطھط§ط¨ط¹ (ظ…ظ†ط¹ ط§ظ„ظپط±ط§ط؛ط§طھ ط¨ظٹظ† ط§ظ„ظ…ظˆط§ط¹ظٹط¯)</span>
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
                ط¹ظ†ط¯ ط§ظ„طھظپط¹ظٹظ„طŒ ط³ظٹطھظ… ط¥ط¬ط¨ط§ط± ط§ظ„ط¹ظ…ظٹظ„ط§طھ ط¹ظ„ظ‰ ط§ظ„ط­ط¬ط² ظ…ط¨ط§ط´ط±ط© ط¨ط¹ط¯ ط¢ط®ط± ظ…ظˆط¹ط¯ ظ…ط­ط¬ظˆط² ظپظٹ ط§ظ„ظٹظˆظ… ظ„ظ…ظ†ط¹ ظ‡ط¯ط± ط§ظ„ظˆظ‚طھ.
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
              {staffAvailLoading ? "طھط­ظ…ظٹظ„..." : "طھط­ظ…ظٹظ„ ط§ظ„ظ…ظˆط¸ظپط§طھ"}
            </button>

            {bookingMsg && (
              <span className="settings-alert success" style={{ marginInlineStart: 6 }}>
                {bookingMsg}
              </span>
            )}
          </div>

          <div className="settings-list" style={{ marginTop: 12 }}>
            {staffAvailLoading ? (
              <div className="settings-note">ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ط§ظ„ظ…ظˆط¸ظپط§طھâ€¦</div>
            ) : staffAvail.length === 0 ? (
              <div className="settings-note">ط§ط¶ط؛ط· "طھط­ظ…ظٹظ„ ط§ظ„ظ…ظˆط¸ظپط§طھ" ظ„ط¹ط±ط¶ ط§ظ„ظ‚ط§ط¦ظ…ط©.</div>
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
                        {s.name || "ط¨ط¯ظˆظ† ط§ط³ظ…"}
                        {leaveExpired && (
                          <span style={{ marginInlineStart: 8, fontSize: 12, opacity: 0.8 }}>
                            (ط¥ط¬ط§ط²ط© ظ…ظ†طھظ‡ظٹط©)
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
                      طھط¸ظ‡ط± ظپظٹ ط§ظ„ط­ط¬ط²
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
                      ظپظٹ ط¥ط¬ط§ط²ط©
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
                      title="طھط§ط±ظٹط® ط§ظ„ط¹ظˆط¯ط©"
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
                      placeholder="ظ…ظ„ط§ط­ط¸ط© ظ„ظ„ط²ط¨ط§ط¦ظ† (ط§ط®طھظٹط§ط±ظٹ)"
                    />

                    <button
                      type="button"
                      className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
                      disabled={!hasAdminPower}
                      onClick={() => saveStaffAvailability(s)}
                    >
                      ط­ظپط¸
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="settings-footnote">
            * ظٹطھظ… ط§ظ„ط­ظپط¸ ظپظٹ: <b>salons/main/staff_public</b> ط¯ط§ط®ظ„ ط­ظ‚ظˆظ„: <b>showOnBooking/onLeave/leaveUntil/leaveNote</b>
            <br />
            * ظ…ظ„ط§ط­ط¸ط©: ط¥ط°ط§ <b>leaveUntil</b> ظپط§طھطŒ ط§ظ„طµظپط­ط© طھط¹طھط¨ط± ط§ظ„ط¥ط¬ط§ط²ط© ظ…ظ†طھظ‡ظٹط© (ط­طھظ‰ ظ„ظˆ onLeave ظƒط§ظ† ظ…ظپط¹ظ‘ظ„).
          </div>
        </div>
      </div>
    </div>
  );
}
