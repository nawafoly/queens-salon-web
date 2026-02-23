// ✅ src/pages/settings/SettingsBookings.tsx

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
} from "firebase/firestore";

import { auth, db } from "../../services/firebase";
import { AppSettingsService } from "../../services/AppSettingsService";
import { formatTime12 } from "../../helpers/timeDisplay";

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

// ✅ Local cache key (بديل setCached)
const APP_SETTINGS_CACHE_KEY = "qs_app_settings_cache_v1";

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

function formatTime12Safe(v: any, fallback = "-") {
  const raw = String(v || "").trim();
  if (!raw) return fallback;
  return formatTime12(raw, raw);
}

type DateCalendar = "gregory" | "hijri";
function normalizeIsoDate(v: any) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function formatDateByCalendar(v: any, calendar: DateCalendar = "gregory") {
  const iso = normalizeIsoDate(v);
  if (!iso) return "-";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const locale =
    calendar === "hijri" ? "ar-SA-u-ca-islamic-umalqura" : "ar-SA-u-ca-gregory";
  const raw = d.toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const clean = String(raw || "")
    .replace(/\s*(م|هـ|AD|AH)\.?$/iu, "")
    .trim();
  return `\u200E${clean}\u200E`;
}

function formatDateRangeByCalendar(fromDate: any, toDate: any, calendar: DateCalendar = "gregory") {
  const fromIso = normalizeIsoDate(fromDate);
  const toIso = normalizeIsoDate(toDate);
  if (!fromIso && !toIso) return "-";
  if (!fromIso) return formatDateByCalendar(toIso, calendar);
  if (!toIso) return formatDateByCalendar(fromIso, calendar);
  const start = fromIso <= toIso ? fromIso : toIso;
  const end = fromIso <= toIso ? toIso : fromIso;
  return `من ${formatDateByCalendar(start, calendar)} إلى ${formatDateByCalendar(end, calendar)}`;
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

type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
type BookingHourOverrideMode = "hours" | "closed";
type BookingHourOverride = {
  id: string;
  fromDate: string;
  toDate: string;
  mode: BookingHourOverrideMode;
  start?: string;
  end?: string;
  includeWeekdays?: WeekdayKey[];
  blockedWeekdays?: WeekdayKey[];
  reason?: string;
};

const WEEKDAY_KEYS: WeekdayKey[] = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];

const WEEKDAY_LABEL_AR: Record<WeekdayKey, string> = {
  sat: "السبت",
  sun: "الأحد",
  mon: "الإثنين",
  tue: "الثلاثاء",
  wed: "الأربعاء",
  thu: "الخميس",
  fri: "الجمعة",
};

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
  const [selectedWeekday, setSelectedWeekday] = useState<WeekdayKey>(() => {
    const jsToWeekday: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return jsToWeekday[new Date().getDay()] || "sat";
  });

  const bookingSettings = (settings as any)?.booking || {};
  const bookingHourOverrides = useMemo(() => {
    const raw = Array.isArray((bookingSettings as any)?.bookingHourOverrides)
      ? (bookingSettings as any).bookingHourOverrides
      : [];
    return raw
      .map((x: any, idx: number) => ({
        id: String(x?.id || `ovr_${idx}`),
        fromDate: String(x?.fromDate || "").trim(),
        toDate: String(x?.toDate || "").trim(),
        mode: String(x?.mode || "hours").trim() === "closed" ? "closed" : "hours",
        start: String(x?.start || "10:00").trim(),
        end: String(x?.end || "22:00").trim(),
        includeWeekdays: Array.isArray(x?.includeWeekdays)
          ? x.includeWeekdays.filter((d: any) => WEEKDAY_KEYS.includes(d))
          : [],
        blockedWeekdays: Array.isArray(x?.blockedWeekdays)
          ? x.blockedWeekdays.filter((d: any) => WEEKDAY_KEYS.includes(d))
          : [],
        reason: String(x?.reason || "").trim(),
      }))
      .filter((x: any) => x.fromDate && x.toDate) as BookingHourOverride[];
  }, [bookingSettings]);

  const [overrideDraft, setOverrideDraft] = useState<BookingHourOverride>({
    id: "",
    fromDate: "",
    toDate: "",
    mode: "hours",
    start: "10:00",
    end: "22:00",
    includeWeekdays: [],
    blockedWeekdays: [],
    reason: "",
  });
  const isEditingOverride = useMemo(
    () =>
      !!String(overrideDraft.id || "").trim() &&
      bookingHourOverrides.some((x) => String(x.id) === String(overrideDraft.id)),
    [overrideDraft.id, bookingHourOverrides]
  );

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
  const maniPediToolsFee = useMemo(() => {
    const raw = bookingSettings?.maniPediToolsFee;
    return Math.max(0, safeInt(raw, 15));
  }, [bookingSettings?.maniPediToolsFee]);



  const businessHours = useMemo(() => {
    const raw = (bookingSettings as any)?.businessHours || {};
    const fallback = defaultBusinessHoursLocal();

    return WEEKDAY_KEYS.reduce((acc, day) => {
      const dayRaw = raw?.[day] || {};
      acc[day] = {
        enabled:
          typeof dayRaw?.enabled === "boolean" ? dayRaw.enabled : fallback[day].enabled,
        start: safeTimeHHMM(dayRaw?.start, fallback[day].start),
        end: safeTimeHHMM(dayRaw?.end, fallback[day].end),
      };
      return acc;
    }, {} as Record<WeekdayKey, { enabled: boolean; start: string; end: string }>);
  }, [bookingSettings?.businessHours]);

  const updateBusinessDay = (
    day: WeekdayKey,
    patch: Partial<{ enabled: boolean; start: string; end: string }>
  ) => {
    const next = { ...businessHours };
    next[day] = { ...next[day], ...patch };
    setBookingSettings({ businessHours: next });
  };

  const [savedMsg, setSavedMsg] = useState("");

  const openDatePickerInput = (el: HTMLInputElement | null) => {
    if (!el || el.disabled || el.readOnly) return;
    try {
      (el as any).showPicker?.();
    } catch {
      // ignore browser limitations
    }
    el.focus();
  };

  const openDatePickerFromContainer = (container: HTMLElement | null) => {
    if (!container) return;
    const input = container.querySelector('input[type="date"]') as HTMLInputElement | null;
    openDatePickerInput(input);
  };

  const resetOverrideDraft = () => {
    setOverrideDraft({
      id: "",
      fromDate: "",
      toDate: "",
      mode: "hours",
      start: "10:00",
      end: "22:00",
      includeWeekdays: [],
      blockedWeekdays: [],
      reason: "",
    });
  };

  const toggleDraftWeekday = (key: "includeWeekdays" | "blockedWeekdays", day: WeekdayKey) => {
    setOverrideDraft((prev) => {
      const cur = Array.isArray(prev[key]) ? [...(prev[key] as WeekdayKey[])] : [];
      const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day];
      return { ...prev, [key]: next };
    });
  };

  const addBookingHourOverride = () => {
    if (!hasAdminPower) return;
    const fromDate = String(overrideDraft.fromDate || "").trim();
    const toDate = String(overrideDraft.toDate || "").trim();
    if (!fromDate || !toDate) {
      setSavedMsg("❌ حددي من/إلى تاريخ للاستثناء");
      setTimeout(() => setSavedMsg(""), 2200);
      return;
    }
    if (fromDate > toDate) {
      setSavedMsg("❌ تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية");
      setTimeout(() => setSavedMsg(""), 2200);
      return;
    }
    if (overrideDraft.mode === "hours" && String(overrideDraft.start || "") === String(overrideDraft.end || "")) {
      setSavedMsg("❌ وقت البداية والنهاية لا يمكن أن يكونا متطابقين");
      setTimeout(() => setSavedMsg(""), 2200);
      return;
    }

    const draftId = String(overrideDraft.id || "").trim();
    const entry: BookingHourOverride = {
      id: draftId || `ovr_${Date.now()}`,
      fromDate,
      toDate,
      mode: overrideDraft.mode === "closed" ? "closed" : "hours",
      start: overrideDraft.mode === "hours" ? String(overrideDraft.start || "10:00") : undefined,
      end: overrideDraft.mode === "hours" ? String(overrideDraft.end || "22:00") : undefined,
      includeWeekdays: (overrideDraft.includeWeekdays || []).filter((d) => WEEKDAY_KEYS.includes(d)),
      blockedWeekdays: (overrideDraft.blockedWeekdays || []).filter((d) => WEEKDAY_KEYS.includes(d)),
      reason: String(overrideDraft.reason || "").trim(),
    };
    const next = isEditingOverride
      ? bookingHourOverrides.map((x) => (String(x.id) === String(entry.id) ? entry : x))
      : [...bookingHourOverrides, entry];
    setBookingSettings({ bookingHourOverrides: next });
    resetOverrideDraft();
  };

  const removeBookingHourOverride = (id: string) => {
    if (!hasAdminPower) return;
    const next = bookingHourOverrides.filter((x) => String(x.id) !== String(id));
    setBookingSettings({ bookingHourOverrides: next });
    if (String(overrideDraft.id) === String(id)) {
      resetOverrideDraft();
    }
  };

  const editBookingHourOverride = (id: string) => {
    if (!hasAdminPower) return;
    const found = bookingHourOverrides.find((x) => String(x.id) === String(id));
    if (!found) return;
    setOverrideDraft({
      id: String(found.id || ""),
      fromDate: String(found.fromDate || ""),
      toDate: String(found.toDate || ""),
      mode: found.mode === "closed" ? "closed" : "hours",
      start: String(found.start || "10:00"),
      end: String(found.end || "22:00"),
      includeWeekdays: Array.isArray(found.includeWeekdays)
        ? found.includeWeekdays.filter((d) => WEEKDAY_KEYS.includes(d))
        : [],
      blockedWeekdays: Array.isArray(found.blockedWeekdays)
        ? found.blockedWeekdays.filter((d) => WEEKDAY_KEYS.includes(d))
        : [],
      reason: String(found.reason || ""),
    });
  };

  // ✅ helper: خذ آخر نسخة مؤكدة (state الحالي أولاً ثم cache)
  function getLatestSettingsSnapshot() {
    // Prefer local cache first because setState is async and may lag behind latest edits.
    return loadLocalSettings() || settings || AppSettingsService.getCached?.() || {};
  }

  const saveAll = async () => {
    if (!hasAdminPower) return;

    try {
      // ✅ أهم نقطة: نقرأ آخر نسخة من localStorage (عشان ما نتعلق بتأخير setState)
      const latest = getLatestSettingsSnapshot();
      const latestBooking = (latest as any)?.booking || {};
      let latestOverrides = Array.isArray(latestBooking?.bookingHourOverrides)
        ? latestBooking.bookingHourOverrides
        : bookingHourOverrides;

      // UX safety: if admin filled override draft but forgot "إضافة استثناء", include it on save.
      const draftFromDate = String(overrideDraft.fromDate || "").trim();
      const draftToDate = String(overrideDraft.toDate || "").trim();
      const draftHasAnyValue = !!(
        draftFromDate ||
        draftToDate ||
        String(overrideDraft.reason || "").trim() ||
        (overrideDraft.includeWeekdays || []).length ||
        (overrideDraft.blockedWeekdays || []).length ||
        (overrideDraft.mode === "hours" &&
          (String(overrideDraft.start || "10:00").trim() !== "10:00" ||
            String(overrideDraft.end || "22:00").trim() !== "22:00"))
      );

      if (draftHasAnyValue) {
        if (!draftFromDate || !draftToDate) {
          setSavedMsg("❌ حددي من/إلى تاريخ للاستثناء أو اضغطي تنظيف");
          setTimeout(() => setSavedMsg(""), 2600);
          return;
        }
        if (draftFromDate > draftToDate) {
          setSavedMsg("❌ تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية");
          setTimeout(() => setSavedMsg(""), 2600);
          return;
        }
        if (
          overrideDraft.mode === "hours" &&
          String(overrideDraft.start || "") === String(overrideDraft.end || "")
        ) {
          setSavedMsg("❌ وقت البداية والنهاية لا يمكن أن يكونا متطابقين");
          setTimeout(() => setSavedMsg(""), 2600);
          return;
        }

        const draftId = String(overrideDraft.id || "").trim();
        const draftEntry: BookingHourOverride = {
          id: draftId || `ovr_${Date.now()}`,
          fromDate: draftFromDate,
          toDate: draftToDate,
          mode: overrideDraft.mode === "closed" ? "closed" : "hours",
          start: overrideDraft.mode === "hours" ? String(overrideDraft.start || "10:00") : undefined,
          end: overrideDraft.mode === "hours" ? String(overrideDraft.end || "22:00") : undefined,
          includeWeekdays: (overrideDraft.includeWeekdays || []).filter((d) => WEEKDAY_KEYS.includes(d)),
          blockedWeekdays: (overrideDraft.blockedWeekdays || []).filter((d) => WEEKDAY_KEYS.includes(d)),
          reason: String(overrideDraft.reason || "").trim(),
        };
        const isEditOnSave = latestOverrides.some((x: any) => String(x?.id || "") === draftId);
        latestOverrides = isEditOnSave
          ? latestOverrides.map((x: any) =>
              String(x?.id || "") === String(draftEntry.id) ? draftEntry : x
            )
          : [...latestOverrides, draftEntry];
      }

      const bhRaw = latestBooking?.businessHours || defaultBusinessHoursLocal();
      const bhFallback = defaultBusinessHoursLocal();

      // ✅ طبّع businessHours لكل أيام الأسبوع بدل يوم واحد فقط
      const bh = WEEKDAY_KEYS.reduce((acc, day) => {
        const rawDay = bhRaw?.[day] || {};
        const fallbackDay = bhFallback[day];

        const dayStart = safeTimeHHMM(rawDay?.start, fallbackDay.start);
        const dayEnd = safeTimeHHMM(rawDay?.end, fallbackDay.end);
        const dayEnabled =
          typeof rawDay?.enabled === "boolean" ? rawDay.enabled : fallbackDay.enabled;

        // Allow overnight shifts (e.g. 20:00 -> 02:00). Reject only exact equality on enabled days.
        if (dayEnabled && dayStart === dayEnd) {
          throw new Error(`INVALID_BUSINESS_HOURS_${day}`);
        }

        acc[day] = { enabled: dayEnabled, start: dayStart, end: dayEnd };
        return acc;
      }, {} as Record<WeekdayKey, { enabled: boolean; start: string; end: string }>);


      const normalizedSettingsToSave = {
        ...(latest || {}),
        booking: {
          ...(latestBooking || {}),
          slotStepMin, // من UI (مضمون 5/10/15/30)
          bufferMin,   // ✅ جديد: بفر بعد كل حجز
          maniPediToolsFee, // ✅ رسوم أدوات المشغل لخدمات البديكير/المناكير
          bookingHourOverrides: latestOverrides,
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
      resetOverrideDraft();

      console.log("✅ SAVED booking:", normalizedSettingsToSave.booking);

      setSavedMsg("✅ تم حفظ الإعدادات");
      setTimeout(() => setSavedMsg(""), 1800);
    } catch (e: any) {
      console.error("❌ saveAll error:", e);

      const errMsg = String(e?.message || "");
      const invalidDay = WEEKDAY_KEYS.find((d) =>
        errMsg.includes(`INVALID_BUSINESS_HOURS_${d}`)
      );
      if (invalidDay) {
        setSavedMsg(`❌ اليوم (${WEEKDAY_LABEL_AR[invalidDay]}): البداية والنهاية لا يمكن أن تكونا نفس الوقت`);
        setTimeout(() => setSavedMsg(""), 2600);
        return;
      }

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

  const copySelectedDayHoursToAll = () => {
    if (!hasAdminPower) return;

    const source = businessHours[selectedWeekday];
    const next = WEEKDAY_KEYS.reduce((acc, day) => {
      acc[day] = {
        ...businessHours[day],
        start: source.start,
        end: source.end,
      };
      return acc;
    }, {} as Record<WeekdayKey, { enabled: boolean; start: string; end: string }>);

    setBookingSettings({ businessHours: next });
    setSavedMsg(`✅ تم نسخ وقت ${WEEKDAY_LABEL_AR[selectedWeekday]} إلى بقية الأيام`);
    setTimeout(() => setSavedMsg(""), 1800);
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
    return "تحتاج صلاحية Owner/Admin.";
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

  if (!hasAdminPower) {
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
                  <div style={{ fontWeight: 900 }}>رسوم أدوات المشغل (البديكير/المناكير)</div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    تظهر فقط إذا اختارت العميلة "الأدوات من المشغل" ضمن هذا القسم
                  </div>
                </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  className="settings-input"
                  style={{ width: 160 }}
                  value={String(maniPediToolsFee)}
                  min={0}
                  step={1}
                  disabled={!hasAdminPower}
                  onChange={(e) =>
                    setBookingSettings({
                      maniPediToolsFee: Math.max(0, safeInt(e.target.value, 0)),
                    })
                  }
                />
                <span style={{ opacity: 0.8 }}>ريال</span>
              </div>
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
                <div style={{ fontWeight: 900 }}>إدارة الدوام الأسبوعي</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  عدّلي الأيام كلها من نفس المكان بدل يوم واحد فقط
                </div>
              </div>

              <select
                className="form-select dash-select"
                style={{ width: 200 }}
                value={selectedWeekday}
                disabled={!hasAdminPower}
                onChange={(e) => setSelectedWeekday(e.target.value as WeekdayKey)}
              >
                {WEEKDAY_KEYS.map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_LABEL_AR[d]}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className={`dash-btn ${!hasAdminPower ? "is-disabled" : ""}`}
                disabled={!hasAdminPower}
                onClick={copySelectedDayHoursToAll}
                title={`نسخ ساعات ${WEEKDAY_LABEL_AR[selectedWeekday]} لباقي الأيام`}
              >
                نسخ وقت اليوم المختار لباقي الأيام
              </button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {WEEKDAY_KEYS.map((day) => {
                const dayHours = businessHours[day];
                const isSelected = day === selectedWeekday;

                return (
                  <div
                    key={day}
                    className="settings-row"
                    style={{
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                      border: isSelected ? "1px solid rgba(64,1,13,.25)" : undefined,
                      background: isSelected ? "rgba(64,1,13,.03)" : undefined,
                    }}
                  >
                    <button
                      type="button"
                      className="dash-btn"
                      onClick={() => setSelectedWeekday(day)}
                      style={{
                        minWidth: 110,
                        borderColor: isSelected ? "rgba(64,1,13,.35)" : undefined,
                        color: isSelected ? "#40010D" : undefined,
                        fontWeight: isSelected ? 900 : undefined,
                      }}
                    >
                      {WEEKDAY_LABEL_AR[day]}
                    </button>

                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
                      <input
                        className="settings-check"
                        type="checkbox"
                        checked={dayHours.enabled !== false}
                        disabled={!hasAdminPower}
                        onChange={(e) => updateBusinessDay(day, { enabled: e.target.checked })}
                      />
                      مفتوح
                    </label>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, opacity: 0.75 }}>من</span>
                      <input
                        type="time"
                        className="settings-input"
                        style={{ width: 140 }}
                        value={dayHours.start}
                        disabled={!hasAdminPower || dayHours.enabled === false}
                        onChange={(e) => updateBusinessDay(day, { start: e.target.value })}
                        placeholder="10:00"
                      />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, opacity: 0.75 }}>إلى</span>
                      <input
                        type="time"
                        className="settings-input"
                        style={{ width: 140 }}
                        value={dayHours.end}
                        disabled={!hasAdminPower || dayHours.enabled === false}
                        onChange={(e) => updateBusinessDay(day, { end: e.target.value })}
                        placeholder="22:00"
                      />
                    </div>

                    <span style={{ fontSize: 12, opacity: 0.75 }}>
                      {dayHours.enabled === false
                        ? "اليوم مغلق"
                        : dayHours.start <= dayHours.end
                          ? `دوام عادي: ${formatTime12Safe(dayHours.start)} - ${formatTime12Safe(dayHours.end)}`
                          : `دوام يتجاوز منتصف الليل: ${formatTime12Safe(dayHours.start)} - ${formatTime12Safe(dayHours.end)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="settings-footnote">
            * يتم الحفظ في AppSettings داخل: booking.businessHours.[day].start / booking.businessHours.[day].end /
            booking.businessHours.[day].enabled / booking.slotStepMin / booking.bufferMin / booking.maniPediToolsFee

            <br />
            * ربطها بصفحة الحجز: Booking.tsx يقرأ من AppSettingsService.getCached()
          </div>
        </div>

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
                <div
                  className="settings-date-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => openDatePickerFromContainer(e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openDatePickerFromContainer(e.currentTarget);
                    }
                  }}
                >
                  <input
                    className="settings-input settings-date-input"
                    type="date"
                    value={seasonFillFrom}
                    disabled={!hasAdminPower || !seasonFillEnabled}
                    onClick={(e) => openDatePickerInput(e.currentTarget)}
                    onFocus={(e) => openDatePickerInput(e.currentTarget)}
                    onChange={(e) =>
                      setBookingSettings({
                        seasonFill: { ...(seasonFill || {}), from: e.target.value },
                      })
                    }
                  />
                </div>
              </div>

              <div className="settings-field">
                <label>إلى تاريخ</label>
                <div
                  className="settings-date-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => openDatePickerFromContainer(e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openDatePickerFromContainer(e.currentTarget);
                    }
                  }}
                >
                  <input
                    className="settings-input settings-date-input"
                    type="date"
                    value={seasonFillTo}
                    disabled={!hasAdminPower || !seasonFillEnabled}
                    onClick={(e) => openDatePickerInput(e.currentTarget)}
                    onFocus={(e) => openDatePickerInput(e.currentTarget)}
                    onChange={(e) =>
                      setBookingSettings({
                        seasonFill: { ...(seasonFill || {}), to: e.target.value },
                      })
                    }
                  />
                </div>
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

        <div className="settings-card">
          <h3 className="settings-title">استثناءات الدوام (فترات بتاريخ محدد)</h3>
          <div className="settings-grid" style={{ marginTop: 10 }}>
            <div className="settings-field">
              <label>من تاريخ</label>
              <div
                className="settings-date-clickable"
                role="button"
                tabIndex={0}
                onClick={(e) => openDatePickerFromContainer(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDatePickerFromContainer(e.currentTarget);
                  }
                }}
              >
                <input
                  className="settings-input settings-date-input"
                  type="date"
                  value={overrideDraft.fromDate}
                  disabled={!hasAdminPower}
                  onClick={(e) => openDatePickerInput(e.currentTarget)}
                  onFocus={(e) => openDatePickerInput(e.currentTarget)}
                  onChange={(e) => setOverrideDraft((p) => ({ ...p, fromDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="settings-field">
              <label>إلى تاريخ</label>
              <div
                className="settings-date-clickable"
                role="button"
                tabIndex={0}
                onClick={(e) => openDatePickerFromContainer(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDatePickerFromContainer(e.currentTarget);
                  }
                }}
              >
                <input
                  className="settings-input settings-date-input"
                  type="date"
                  value={overrideDraft.toDate}
                  disabled={!hasAdminPower}
                  onClick={(e) => openDatePickerInput(e.currentTarget)}
                  onFocus={(e) => openDatePickerInput(e.currentTarget)}
                  onChange={(e) => setOverrideDraft((p) => ({ ...p, toDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="settings-field">
              <label>وضع الفترة</label>
              <select
                className="form-select dash-select"
                value={overrideDraft.mode}
                disabled={!hasAdminPower}
                onChange={(e) =>
                  setOverrideDraft((p) => ({
                    ...p,
                    mode: (e.target.value === "closed" ? "closed" : "hours") as BookingHourOverrideMode,
                  }))
                }
              >
                <option value="hours">مفتوح بساعات مخصصة</option>
                <option value="closed">مغلق بالكامل</option>
              </select>
            </div>
            <div className="settings-field">
              <label>وقت البداية</label>
              <input
                className="settings-input"
                type="time"
                value={String(overrideDraft.start || "10:00")}
                disabled={!hasAdminPower || overrideDraft.mode === "closed"}
                onChange={(e) => setOverrideDraft((p) => ({ ...p, start: e.target.value }))}
              />
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                {formatTime12Safe(overrideDraft.start || "10:00")}
              </div>
            </div>
            <div className="settings-field">
              <label>وقت النهاية</label>
              <input
                className="settings-input"
                type="time"
                value={String(overrideDraft.end || "22:00")}
                disabled={!hasAdminPower || overrideDraft.mode === "closed"}
                onChange={(e) => setOverrideDraft((p) => ({ ...p, end: e.target.value }))}
              />
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                {formatTime12Safe(overrideDraft.end || "22:00")}
              </div>
            </div>
            <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
              <label>أيام مستهدفة داخل الفترة (اختياري)</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {WEEKDAY_KEYS.map((d) => {
                  const active = (overrideDraft.includeWeekdays || []).includes(d);
                  return (
                    <button
                      key={`inc_${d}`}
                      type="button"
                      className={`btn btn-sm ${active ? "btn-dark" : "btn-outline-dark"}`}
                      disabled={!hasAdminPower}
                      onClick={() => toggleDraftWeekday("includeWeekdays", d)}
                    >
                      {WEEKDAY_LABEL_AR[d]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
              <label>أيام مغلقة داخل الفترة (اختياري)</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {WEEKDAY_KEYS.map((d) => {
                  const active = (overrideDraft.blockedWeekdays || []).includes(d);
                  return (
                    <button
                      key={`blk_${d}`}
                      type="button"
                      className={`btn btn-sm ${active ? "btn-danger" : "btn-outline-danger"}`}
                      disabled={!hasAdminPower}
                      onClick={() => toggleDraftWeekday("blockedWeekdays", d)}
                    >
                      {WEEKDAY_LABEL_AR[d]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
              <label>سبب داخلي (اختياري)</label>
              <input
                className="settings-input"
                value={String(overrideDraft.reason || "")}
                disabled={!hasAdminPower}
                onChange={(e) => setOverrideDraft((p) => ({ ...p, reason: e.target.value }))}
                placeholder="مثال: دوام رمضان / جدول حملة صبغات"
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`dash-btn ${!hasAdminPower ? "is-disabled" : ""}`}
              disabled={!hasAdminPower}
              onClick={addBookingHourOverride}
            >
              {isEditingOverride ? "حفظ التعديل" : "إضافة استثناء"}
            </button>
            <button
              type="button"
              className="dash-btn"
              disabled={!hasAdminPower}
              onClick={resetOverrideDraft}
            >
              {isEditingOverride ? "إلغاء التعديل" : "تنظيف"}
            </button>
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {!bookingHourOverrides.length ? (
              <div className="settings-footnote">لا توجد استثناءات مضافة.</div>
            ) : (
              bookingHourOverrides.map((x) => (
                <div key={x.id} className="settings-row" style={{ alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 900 }}>
                      {x.mode === "closed"
                        ? "مغلق بالكامل"
                        : `ساعات: ${formatTime12Safe(x.start || "10:00")} - ${formatTime12Safe(x.end || "22:00")}`}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.92, marginTop: 4, display: "grid", gap: 2 }}>
                      <div>
                        الميلادي: {formatDateRangeByCalendar(x.fromDate, x.toDate, "gregory")}
                      </div>
                      <div>
                        الهجري: {formatDateRangeByCalendar(x.fromDate, x.toDate, "hijri")}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                      الأيام المستهدفة: {(x.includeWeekdays || []).length
                        ? (x.includeWeekdays || []).map((d) => WEEKDAY_LABEL_AR[d]).join("، ")
                        : "الكل"}
                      {" | "}
                      الأيام المغلقة: {(x.blockedWeekdays || []).length
                        ? (x.blockedWeekdays || []).map((d) => WEEKDAY_LABEL_AR[d]).join("، ")
                        : "لا يوجد"}
                    </div>
                    {x.reason ? (
                      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                        السبب: {x.reason}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline-dark btn-sm"
                    disabled={!hasAdminPower}
                    onClick={() => editBookingHourOverride(x.id)}
                  >
                    تعديل
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    disabled={!hasAdminPower}
                    onClick={() => removeBookingHourOverride(x.id)}
                  >
                    حذف
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="settings-footnote" style={{ marginTop: 10 }}>
            * الأولوية: الإغلاقات الخاصة بالتاريخ ثم الاستثناءات ثم الدوام الأسبوعي.
            <br />
            * خارج فترة الاستثناء لا يتغير الدوام الأسبوعي العادي.
          </div>
        </div>
        </div>
      </div>
  );
}
