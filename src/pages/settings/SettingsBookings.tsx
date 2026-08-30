import { DashboardTimeInputV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import {
  DashboardDatePickerV2,
  DashboardEmptyStateV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import { formatTime12 } from "../../helpers/timeDisplay";
import { readVerifiedUserAccess } from "../../services/authAccess";
import { AppSettingsService } from "../../services/AppSettingsService";
import { auth } from "../../services/firebase";
import "../../styles/dashboard-v2/dashboard-v2.css";

type UiRole =
  | "owner"
  | "admin"
  | "reception"
  | "staff"
  | "pending"
  | "client"
  | "guest";

type DateCalendar = "gregory" | "hijri";
type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
type BookingHourOverrideMode = "hours" | "closed";
type BookingSection = "general" | "hours" | "season" | "exceptions";

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

const APP_SETTINGS_CACHE_KEY = "qs_app_settings_cache_v1";

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

const SLOT_STEP_OPTIONS = [
  { value: "5", label: "5 دقائق" },
  { value: "10", label: "10 دقائق" },
  { value: "15", label: "15 دقيقة" },
  { value: "30", label: "30 دقيقة" },
] as const;

const BUFFER_OPTIONS = [
  { value: "0", label: "بدون بفر" },
  { value: "5", label: "5 دقائق" },
  { value: "10", label: "10 دقائق" },
  { value: "15", label: "15 دقيقة" },
  { value: "20", label: "20 دقيقة" },
  { value: "30", label: "30 دقيقة" },
] as const;

const OVERRIDE_MODE_OPTIONS = [
  { value: "hours", label: "مفتوح بساعات مخصصة" },
  { value: "closed", label: "مغلق بالكامل" },
] as const;

const BOOKING_SECTION_ITEMS: Array<{
  id: BookingSection;
  index: string;
  title: string;
}> = [
  { id: "general", index: "01", title: "عام" },
  { id: "hours", index: "02", title: "مواعيد الدوام" },
  { id: "season", index: "03", title: "وضع الموسم" },
  { id: "exceptions", index: "04", title: "الاستثناءات" },
];

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

function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function safeTimeHHMM(v: any, fallback: string) {
  const s = String(v || "").trim();
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

function normalizeIsoDate(v: any) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function formatDateByCalendar(v: any, calendar: DateCalendar = "gregory") {
  const iso = normalizeIsoDate(v);
  if (!iso) return "-";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const locale = calendar === "hijri" ? "ar-SA-u-ca-islamic-umalqura" : "ar-SA-u-ca-gregory";
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
    // ignore local storage failures
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

function messageIsError(message: string) {
  return message.includes("❌") || message.includes("تعذر") || message.includes("فشل");
}

export default function SettingsBookings() {
  const [uiRole, setUiRole] = useState<UiRole>("guest");
  const [authLoading, setAuthLoading] = useState(true);
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
  const [savedMsg, setSavedMsg] = useState("");
  const [activeBookingSection, setActiveBookingSection] = useState<BookingSection>("general");

  const isOwner = uiRole === "owner";
  const isAdmin = uiRole === "admin";
  const hasAdminPower = isOwner || isAdmin;
  const bookingSettings = settings?.booking || {};

  const bookingHourOverrides = useMemo(() => {
    const raw = Array.isArray(bookingSettings?.bookingHourOverrides)
      ? bookingSettings.bookingHourOverrides
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

  const isEditingOverride = useMemo(
    () =>
      Boolean(String(overrideDraft.id || "").trim()) &&
      bookingHourOverrides.some((x) => String(x.id) === String(overrideDraft.id)),
    [overrideDraft.id, bookingHourOverrides]
  );

  const seasonFill = bookingSettings?.seasonFill || {};
  const seasonFillEnabled = Boolean(seasonFill.enabled);
  const seasonFillFrom = String(seasonFill.from || "");
  const seasonFillTo = String(seasonFill.to || "");

  const slotStepMin = useMemo(() => {
    const v = safeInt(bookingSettings?.slotStepMin, 10);
    return [5, 10, 15, 30].includes(v) ? v : 10;
  }, [bookingSettings?.slotStepMin]);

  const bufferMin = useMemo(() => {
    const v = safeInt(bookingSettings?.bufferMin, 5);
    return [0, 5, 10, 15, 20, 30].includes(v) ? v : 5;
  }, [bookingSettings?.bufferMin]);

  const maniPediToolsFee = useMemo(
    () => Math.max(0, safeInt(bookingSettings?.maniPediToolsFee, 15)),
    [bookingSettings?.maniPediToolsFee]
  );

  const businessHours = useMemo(() => {
    const raw = bookingSettings?.businessHours || {};
    const fallback = defaultBusinessHoursLocal();

    return WEEKDAY_KEYS.reduce((acc, day) => {
      const dayRaw = raw?.[day] || {};
      acc[day] = {
        enabled: typeof dayRaw?.enabled === "boolean" ? dayRaw.enabled : fallback[day].enabled,
        start: safeTimeHHMM(dayRaw?.start, fallback[day].start),
        end: safeTimeHHMM(dayRaw?.end, fallback[day].end),
      };
      return acc;
    }, {} as Record<WeekdayKey, { enabled: boolean; start: string; end: string }>);
  }, [bookingSettings?.businessHours]);

  const openDaysCount = useMemo(
    () => WEEKDAY_KEYS.filter((day) => businessHours[day]?.enabled !== false).length,
    [businessHours]
  );

  const bookingStats = useMemo(
    () => [
      {
        label: "أيام العمل",
        value: `${openDaysCount}/7`,
        hint: "الدوام الأسبوعي المفتوح",
        tone: "dsv2-metric-card--success",
      },
      {
        label: "الاستثناءات",
        value: String(bookingHourOverrides.length),
        hint: "الفترات الخاصة بتاريخ محدد",
        tone: "dsv2-metric-card--gold",
      },
      {
        label: "خطوة الحجز",
        value: `${slotStepMin} د`,
        hint: "دقة فتح المواعيد",
        tone: "dsv2-metric-card--dark",
      },
      {
        label: "التتابع",
        value: bookingSettings?.sequentialBooking ? "مفعّل" : "متوقف",
        hint: "منع الفراغات بين الحجوزات",
        tone: bookingSettings?.sequentialBooking ? "dsv2-metric-card--success" : "dsv2-metric-card--danger",
      },
    ],
    [bookingHourOverrides.length, bookingSettings?.sequentialBooking, openDaysCount, slotStepMin]
  );

  const weekdayOptions = useMemo(
    () => WEEKDAY_KEYS.map((day) => ({ value: day, label: WEEKDAY_LABEL_AR[day] })),
    []
  );

  const setBookingSettings = (patch: any) => {
    if (!hasAdminPower) return;

    setSettings((prev: any) => {
      const next = {
        ...prev,
        booking: { ...(prev?.booking || {}), ...patch },
      };
      saveLocalSettings(next);
      return next;
    });
  };

  const updateBusinessDay = (
    day: WeekdayKey,
    patch: Partial<{ enabled: boolean; start: string; end: string }>
  ) => {
    const next = { ...businessHours };
    next[day] = { ...next[day], ...patch };
    setBookingSettings({ businessHours: next });
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
    if (String(overrideDraft.id) === String(id)) resetOverrideDraft();
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
      reason: String(found.reason || "").trim(),
    });
    setActiveBookingSection("exceptions");
  };

  function getLatestSettingsSnapshot() {
    return loadLocalSettings() || settings || AppSettingsService.getCached?.() || {};
  }

  const saveAll = async () => {
    if (!hasAdminPower) return;

    try {
      const latest = getLatestSettingsSnapshot();
      const latestBooking = latest?.booking || {};
      let latestOverrides = Array.isArray(latestBooking?.bookingHourOverrides)
        ? latestBooking.bookingHourOverrides
        : bookingHourOverrides;

      const draftFromDate = String(overrideDraft.fromDate || "").trim();
      const draftToDate = String(overrideDraft.toDate || "").trim();
      const draftHasAnyValue = Boolean(
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
      const bh = WEEKDAY_KEYS.reduce((acc, day) => {
        const rawDay = bhRaw?.[day] || {};
        const fallbackDay = bhFallback[day];
        const dayStart = safeTimeHHMM(rawDay?.start, fallbackDay.start);
        const dayEnd = safeTimeHHMM(rawDay?.end, fallbackDay.end);
        const dayEnabled = typeof rawDay?.enabled === "boolean" ? rawDay.enabled : fallbackDay.enabled;

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
          slotStepMin,
          bufferMin,
          maniPediToolsFee,
          bookingHourOverrides: latestOverrides,
          businessHours: bh,
          seasonFill: latestBooking?.seasonFill || { enabled: false, from: "", to: "" },
          sequentialBooking: Boolean(latestBooking?.sequentialBooking),
        },
      };

      await AppSettingsService.saveRemote(normalizedSettingsToSave);
      saveLocalSettings(normalizedSettingsToSave);
      setSettings(normalizedSettingsToSave);
      resetOverrideDraft();

      console.log("✅ SAVED booking:", normalizedSettingsToSave.booking);
      setSavedMsg("✅ تم حفظ الإعدادات");
      setTimeout(() => setSavedMsg(""), 1800);
    } catch (e: any) {
      console.error("❌ saveAll error:", e);

      const errMsg = String(e?.message || "");
      const invalidDay = WEEKDAY_KEYS.find((d) => errMsg.includes(`INVALID_BUSINESS_HOURS_${d}`));
      if (invalidDay) {
        setSavedMsg(`❌ اليوم (${WEEKDAY_LABEL_AR[invalidDay]}): البداية والنهاية لا يمكن أن تكونا نفس الوقت`);
        setTimeout(() => setSavedMsg(""), 2600);
        return;
      }

      const msg =
        String(e?.message || e?.code || "").toLowerCase().includes("permission") ||
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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);
      try {
        if (!user) {
          setUiRole("guest");
          return;
        }
        const access = await readVerifiedUserAccess(user.uid);
        if (!access.exists || access.active === false) {
          setUiRole("guest");
          return;
        }
        setUiRole(mapFirestoreRoleToUi(access.role));
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
      .then((remote) => {
        setSettings(remote || {});
        saveLocalSettings(remote || {});
      })
      .catch(() => {
        // fall back to cached/local settings
      });

    const unsub = AppSettingsService.subscribe((remote: any) => {
      setSettings((prev: any) => {
        const prevB = prev?.booking || {};
        const remoteB = remote?.booking || {};
        const merged = {
          ...(prev || {}),
          ...(remote || {}),
          booking: {
            ...prevB,
            ...remoteB,
          },
        };
        saveLocalSettings(merged);
        return merged;
      });
    });

    return () => unsub();
  }, []);

  if (authLoading) {
    return (
      <main className="dsv2-page settings-bookings-v2-page" dir="rtl">
        <section className="dsv2-card dsv2-card--padded settings-bookings-v2-state">
          <DashboardSkeletonV2 width="30%" height={22} />
          <DashboardSkeletonV2 width="62%" height={14} />
          <DashboardSkeletonV2 width="100%" height={132} />
        </section>
      </main>
    );
  }

  if (!hasAdminPower) {
    return (
      <main className="dsv2-page settings-bookings-v2-page" dir="rtl">
        <DashboardEmptyStateV2
          tone="gold"
          title="غير مصرح"
          description="إعدادات الحجوزات الحالية متاحة لحسابات Owner/Admin فقط."
        />
      </main>
    );
  }

  const activeSectionMeta = BOOKING_SECTION_ITEMS.find((item) => item.id === activeBookingSection);
  const savedMsgIsError = messageIsError(savedMsg);

  return (
    <main className="dsv2-page settings-bookings-v2-page" dir="rtl">
      <section className="dsv2-card settings-bookings-v2-hero">
        <div className="settings-bookings-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">إعدادات الحجوزات</span>
          <h1 className="dsv2-page-title">جدولة وتشغيل الحجوزات</h1>
          <p className="dsv2-page-subtitle">
            إدارة إتاحة الحجز، دقة المواعيد، ساعات العمل، وضع الموسم، والاستثناءات من مساحة واحدة.
          </p>
          <div className="settings-bookings-v2-hero__badges">
            <span className={`dsv2-badge ${bookingSettings.maintenanceMode ? "dsv2-badge--danger" : "dsv2-badge--success"}`}>
              {bookingSettings.maintenanceMode ? "الحجز متوقف" : "الحجز متاح"}
            </span>
            <span className="dsv2-badge">{openDaysCount}/7 أيام مفتوحة</span>
          </div>
        </div>
      </section>

      <section className="settings-bookings-v2-metrics" aria-label="ملخص إعدادات الحجوزات">
        {bookingStats.map((item) => (
          <article key={item.label} className={`dsv2-metric-card ${item.tone}`}>
            <p className="dsv2-metric-card__label">{item.label}</p>
            <p className="dsv2-metric-card__value">{item.value}</p>
            <p className="dsv2-metric-card__meta">{item.hint}</p>
          </article>
        ))}
      </section>

      <section className="settings-bookings-v2-tabs" aria-label="أقسام إعدادات الحجوزات">
        {BOOKING_SECTION_ITEMS.map((item) => {
          const active = item.id === activeBookingSection;
          const hint =
            item.id === "general"
              ? bookingSettings.maintenanceMode
                ? "الحجز متوقف مؤقتًا"
                : "الحجز متاح"
              : item.id === "hours"
                ? `${openDaysCount}/7 أيام مفتوحة`
                : item.id === "season"
                  ? bookingSettings?.sequentialBooking
                    ? "التتابع مفعل"
                    : "ضبط الهدر والتتابع"
                  : `${bookingHourOverrides.length} فترة محفوظة`;

          return (
            <button
              key={item.id}
              type="button"
              className={`settings-bookings-v2-tab ${active ? "is-active" : ""}`}
              onClick={() => setActiveBookingSection(item.id)}
              aria-pressed={active}
            >
              <span className="settings-bookings-v2-tab__index">{item.index}</span>
              <span className="settings-bookings-v2-tab__copy">
                <strong>{item.title}</strong>
                <small>{hint}</small>
              </span>
            </button>
          );
        })}
      </section>

      <section className="dsv2-card dsv2-card--padded settings-bookings-v2-panel">
        <header className="settings-bookings-v2-panel__head">
          <div className="settings-bookings-v2-panel__copy">
            <span className="settings-bookings-v2-panel__eyebrow">{activeSectionMeta?.index || "01"}</span>
            <h2>{activeSectionMeta?.title || "إعدادات الحجوزات"}</h2>
            <p>
              {activeBookingSection === "general"
                ? "تحكم سريع في إتاحة الحجز ورسالة الصيانة التي تظهر للعميلات."
                : activeBookingSection === "hours"
                  ? "اضبط دقة المواعيد، الرسوم، وأيام العمل الأسبوعية من مكان واحد."
                  : activeBookingSection === "season"
                    ? "أدوات تقلل الفراغات وتساعد على ترتيب اليوم وقت الضغط والمواسم."
                    : "فترات خاصة بتاريخ محدد لإغلاق يوم أو تغيير ساعات العمل مؤقتًا."}
            </p>
          </div>
          <span className="dsv2-badge dsv2-badge--success">تحكم إداري</span>
        </header>

        <div className="settings-bookings-v2-panel__body">
          {activeBookingSection === "general" ? (
            <div className="settings-bookings-v2-section-stack">
              <button
                type="button"
                className={`settings-bookings-v2-toggle ${bookingSettings.maintenanceMode ? "is-on is-danger" : ""}`}
                aria-pressed={Boolean(bookingSettings.maintenanceMode)}
                onClick={() => setBookingSettings({ maintenanceMode: !bookingSettings.maintenanceMode })}
              >
                <span className="settings-bookings-v2-toggle__mark" aria-hidden="true">
                  {bookingSettings.maintenanceMode ? "✓" : ""}
                </span>
                <span className="settings-bookings-v2-toggle__copy">
                  <strong>وضع الصيانة</strong>
                  <small>إيقاف الحجز مؤقتًا للعميلات مع إبقاء الإدارة متاحة.</small>
                </span>
                <span className="settings-bookings-v2-toggle__status">
                  {bookingSettings.maintenanceMode ? "متوقف" : "مفتوح"}
                </span>
              </button>

              <label className="dsv2-field settings-bookings-v2-field-wide">
                <span className="dsv2-field__label">رسالة الصيانة التي تظهر للعميلات</span>
                <input
                  className="dsv2-input"
                  value={String(bookingSettings.maintenanceMessage || "")}
                  onChange={(event) => setBookingSettings({ maintenanceMessage: event.target.value })}
                  placeholder="مثال: الحجز متوقف مؤقتًا للصيانة، نعود قريبًا"
                />
                <span className="dsv2-field__hint">تُحفظ هذه القيمة داخل AppSettings وتظهر عند إيقاف الحجز.</span>
              </label>
            </div>
          ) : null}

          {activeBookingSection === "hours" ? (
            <div className="settings-bookings-v2-section-stack">
              <div className="settings-bookings-v2-control-grid">
                <label className="dsv2-field settings-bookings-v2-control-card">
                  <span className="dsv2-field__label">خطوة الوقت</span>
                  <DashboardSelectV2
                    value={String(slotStepMin)}
                    options={SLOT_STEP_OPTIONS}
                    onChange={(value) => setBookingSettings({ slotStepMin: Number(value) })}
                  />
                  <span className="dsv2-field__hint">5/10 دقائق لدقة أعلى، و30 دقيقة لجدولة أبسط.</span>
                </label>

                <label className="dsv2-field settings-bookings-v2-control-card">
                  <span className="dsv2-field__label">البفر بعد كل حجز</span>
                  <DashboardSelectV2
                    value={String(bufferMin)}
                    options={BUFFER_OPTIONS}
                    onChange={(value) => setBookingSettings({ bufferMin: Number(value) })}
                  />
                  <span className="dsv2-field__hint">المسافة الزمنية الإضافية بعد نهاية الموعد.</span>
                </label>

                <label className="dsv2-field settings-bookings-v2-control-card">
                  <span className="dsv2-field__label">رسوم أدوات البديكير/المناكير</span>
                  <span className="settings-bookings-v2-money-input">
                    <input dir="ltr" lang="en"
                      type="number"
                      className="dsv2-input"
                      value={String(maniPediToolsFee)}
                      min={0}
                      step={1}
                      onChange={(event) =>
                        setBookingSettings({ maniPediToolsFee: Math.max(0, safeInt(event.target.value, 0)) })
                      }
                    />
                    <span>ريال</span>
                  </span>
                  <span className="dsv2-field__hint">تظهر فقط إذا اختارت العميلة الأدوات من المشغل.</span>
                </label>
              </div>

              <section className="settings-bookings-v2-weekly">
                <header className="settings-bookings-v2-weekly__head">
                  <div>
                    <h3>إدارة الدوام الأسبوعي</h3>
                    <p>اختاري يومًا للمراجعة أو انسخي أوقاته إلى بقية الأسبوع.</p>
                  </div>
                  <div className="settings-bookings-v2-weekly__actions">
                    <DashboardSelectV2
                      value={selectedWeekday}
                      options={weekdayOptions}
                      onChange={(value) => setSelectedWeekday(value as WeekdayKey)}
                    />
                    <button
                      type="button"
                      className="dsv2-btn dsv2-btn--secondary"
                      onClick={copySelectedDayHoursToAll}
                    >
                      نسخ وقت اليوم لبقية الأيام
                    </button>
                  </div>
                </header>

                <div className="settings-bookings-v2-days">
                  {WEEKDAY_KEYS.map((day) => {
                    const dayHours = businessHours[day];
                    const isSelected = day === selectedWeekday;
                    const overnight = dayHours.enabled !== false && dayHours.start > dayHours.end;

                    return (
                      <article
                        key={day}
                        className={`settings-bookings-v2-day ${isSelected ? "is-selected" : ""} ${dayHours.enabled === false ? "is-closed" : ""}`}
                      >
                        <button
                          type="button"
                          className="settings-bookings-v2-day__name"
                          onClick={() => setSelectedWeekday(day)}
                        >
                          {WEEKDAY_LABEL_AR[day]}
                        </button>

                        <button
                          type="button"
                          className={`settings-bookings-v2-day__toggle ${dayHours.enabled !== false ? "is-on" : ""}`}
                          aria-pressed={dayHours.enabled !== false}
                          onClick={() => updateBusinessDay(day, { enabled: dayHours.enabled === false })}
                        >
                          <span aria-hidden="true">{dayHours.enabled !== false ? "✓" : ""}</span>
                          {dayHours.enabled !== false ? "مفتوح" : "مغلق"}
                        </button>

                        <label className="settings-bookings-v2-time-field">
                          <span>من</span>
                          <DashboardTimeInputV2 className="dsv2-input" value={dayHours.start} disabled={dayHours.enabled === false} onChange={(event) => updateBusinessDay(day, { start: event.target.value })} />
                        </label>

                        <label className="settings-bookings-v2-time-field">
                          <span>إلى</span>
                          <DashboardTimeInputV2 className="dsv2-input" value={dayHours.end} disabled={dayHours.enabled === false} onChange={(event) => updateBusinessDay(day, { end: event.target.value })} />
                        </label>

                        <div className="settings-bookings-v2-day__summary">
                          {dayHours.enabled === false
                            ? "اليوم مغلق"
                            : overnight
                              ? `يتجاوز منتصف الليل: ${formatTime12Safe(dayHours.start)} - ${formatTime12Safe(dayHours.end)}`
                              : `${formatTime12Safe(dayHours.start)} - ${formatTime12Safe(dayHours.end)}`}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <div className="settings-bookings-v2-note">
                يتم الحفظ في booking.businessHours مع slotStepMin وbufferMin وmaniPediToolsFee، وصفحة الحجز تقرأها من AppSettings.
              </div>
            </div>
          ) : null}

          {activeBookingSection === "season" ? (
            <div className="settings-bookings-v2-section-stack">
              <div className="settings-bookings-v2-toggle-grid">
                <button
                  type="button"
                  className={`settings-bookings-v2-toggle ${seasonFillEnabled ? "is-on" : ""}`}
                  aria-pressed={seasonFillEnabled}
                  onClick={() =>
                    setBookingSettings({
                      seasonFill: {
                        ...(seasonFill || {}),
                        enabled: !seasonFillEnabled,
                      },
                    })
                  }
                >
                  <span className="settings-bookings-v2-toggle__mark" aria-hidden="true">
                    {seasonFillEnabled ? "✓" : ""}
                  </span>
                  <span className="settings-bookings-v2-toggle__copy">
                    <strong>ترتيب اليوم تلقائيًا</strong>
                    <small>تفعيل ترتيب وقت الحجز خلال فترة الموسم المحددة.</small>
                  </span>
                  <span className="settings-bookings-v2-toggle__status">
                    {seasonFillEnabled ? "مفعّل" : "متوقف"}
                  </span>
                </button>

                <button
                  type="button"
                  className={`settings-bookings-v2-toggle ${bookingSettings?.sequentialBooking ? "is-on" : ""}`}
                  aria-pressed={Boolean(bookingSettings?.sequentialBooking)}
                  onClick={() => setBookingSettings({ sequentialBooking: !bookingSettings?.sequentialBooking })}
                >
                  <span className="settings-bookings-v2-toggle__mark" aria-hidden="true">
                    {bookingSettings?.sequentialBooking ? "✓" : ""}
                  </span>
                  <span className="settings-bookings-v2-toggle__copy">
                    <strong>إجبار الحجز المتتابع</strong>
                    <small>منع الفراغات بين المواعيد داخل نفس اليوم.</small>
                  </span>
                  <span className="settings-bookings-v2-toggle__status">
                    {bookingSettings?.sequentialBooking ? "مفعّل" : "متوقف"}
                  </span>
                </button>
              </div>

              <div className="settings-bookings-v2-date-grid">
                <label className="dsv2-field">
                  <span className="dsv2-field__label">من تاريخ</span>
                  <DashboardDatePickerV2
                    value={seasonFillFrom}
                    disabled={!seasonFillEnabled}
                    onChange={(value) =>
                      setBookingSettings({ seasonFill: { ...(seasonFill || {}), from: value } })
                    }
                  />
                </label>
                <label className="dsv2-field">
                  <span className="dsv2-field__label">إلى تاريخ</span>
                  <DashboardDatePickerV2
                    value={seasonFillTo}
                    disabled={!seasonFillEnabled}
                    onChange={(value) =>
                      setBookingSettings({ seasonFill: { ...(seasonFill || {}), to: value } })
                    }
                  />
                </label>
              </div>

              <div className="settings-bookings-v2-note">
                تُحفظ الفترة داخل booking.seasonFill، بينما تنفيذ ترتيب اليوم يبقى في Booking.tsx وtimeSlots.ts كما هو.
              </div>
            </div>
          ) : null}

          {activeBookingSection === "exceptions" ? (
            <div className="settings-bookings-v2-section-stack">
              <div className="settings-bookings-v2-exception-form">
                <label className="dsv2-field">
                  <span className="dsv2-field__label">من تاريخ</span>
                  <DashboardDatePickerV2
                    value={overrideDraft.fromDate}
                    onChange={(value) => setOverrideDraft((prev) => ({ ...prev, fromDate: value }))}
                  />
                </label>

                <label className="dsv2-field">
                  <span className="dsv2-field__label">إلى تاريخ</span>
                  <DashboardDatePickerV2
                    value={overrideDraft.toDate}
                    onChange={(value) => setOverrideDraft((prev) => ({ ...prev, toDate: value }))}
                  />
                </label>

                <label className="dsv2-field">
                  <span className="dsv2-field__label">وضع الفترة</span>
                  <DashboardSelectV2
                    value={overrideDraft.mode}
                    options={OVERRIDE_MODE_OPTIONS}
                    onChange={(value) =>
                      setOverrideDraft((prev) => ({
                        ...prev,
                        mode: (value === "closed" ? "closed" : "hours") as BookingHourOverrideMode,
                      }))
                    }
                  />
                </label>

                <label className="dsv2-field">
                  <span className="dsv2-field__label">وقت البداية</span>
                  <DashboardTimeInputV2 className="dsv2-input" value={String(overrideDraft.start || "10:00")} disabled={overrideDraft.mode === "closed"} onChange={(event) => setOverrideDraft((prev) => ({ ...prev, start: event.target.value }))} />
                  <span className="dsv2-field__hint">{formatTime12Safe(overrideDraft.start || "10:00")}</span>
                </label>

                <label className="dsv2-field">
                  <span className="dsv2-field__label">وقت النهاية</span>
                  <DashboardTimeInputV2 className="dsv2-input" value={String(overrideDraft.end || "22:00")} disabled={overrideDraft.mode === "closed"} onChange={(event) => setOverrideDraft((prev) => ({ ...prev, end: event.target.value }))} />
                  <span className="dsv2-field__hint">{formatTime12Safe(overrideDraft.end || "22:00")}</span>
                </label>

                <label className="dsv2-field settings-bookings-v2-field-wide">
                  <span className="dsv2-field__label">سبب داخلي (اختياري)</span>
                  <input
                    className="dsv2-input"
                    value={String(overrideDraft.reason || "")}
                    onChange={(event) => setOverrideDraft((prev) => ({ ...prev, reason: event.target.value }))}
                    placeholder="مثال: دوام رمضان / جدول حملة صبغات"
                  />
                </label>
              </div>

              <div className="settings-bookings-v2-weekday-groups">
                <section>
                  <h3>أيام مستهدفة داخل الفترة</h3>
                  <p>اختياري؛ اتركيها فارغة لتطبيق الاستثناء على كل الأيام.</p>
                  <div className="settings-bookings-v2-chips">
                    {WEEKDAY_KEYS.map((day) => {
                      const active = (overrideDraft.includeWeekdays || []).includes(day);
                      return (
                        <button
                          key={`inc_${day}`}
                          type="button"
                          className={`settings-bookings-v2-chip ${active ? "is-active" : ""}`}
                          aria-pressed={active}
                          onClick={() => toggleDraftWeekday("includeWeekdays", day)}
                        >
                          {WEEKDAY_LABEL_AR[day]}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section>
                  <h3>أيام مغلقة داخل الفترة</h3>
                  <p>اختياري؛ تستخدم لإغلاق أيام محددة داخل نفس الفترة.</p>
                  <div className="settings-bookings-v2-chips">
                    {WEEKDAY_KEYS.map((day) => {
                      const active = (overrideDraft.blockedWeekdays || []).includes(day);
                      return (
                        <button
                          key={`blk_${day}`}
                          type="button"
                          className={`settings-bookings-v2-chip settings-bookings-v2-chip--danger ${active ? "is-active" : ""}`}
                          aria-pressed={active}
                          onClick={() => toggleDraftWeekday("blockedWeekdays", day)}
                        >
                          {WEEKDAY_LABEL_AR[day]}
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>

              <div className="settings-bookings-v2-form-actions">
                <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={addBookingHourOverride}>
                  {isEditingOverride ? "حفظ التعديل" : "إضافة استثناء"}
                </button>
                <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={resetOverrideDraft}>
                  {isEditingOverride ? "إلغاء التعديل" : "تنظيف"}
                </button>
              </div>

              <section className="settings-bookings-v2-exceptions-list">
                <header>
                  <div>
                    <h3>الاستثناءات المحفوظة</h3>
                    <p>الأولوية: الإغلاق الخاص بالتاريخ، ثم الاستثناء، ثم الدوام الأسبوعي.</p>
                  </div>
                  <span className="dsv2-badge dsv2-badge--gold">{bookingHourOverrides.length} فترة</span>
                </header>

                {!bookingHourOverrides.length ? (
                  <DashboardEmptyStateV2
                    tone="gold"
                    title="لا توجد استثناءات"
                    description="أضف فترة خاصة إذا احتجت تغيير الدوام أو إغلاق أيام بتاريخ محدد."
                  />
                ) : (
                  <div className="settings-bookings-v2-exception-cards">
                    {bookingHourOverrides.map((item) => (
                      <article key={item.id} className="settings-bookings-v2-exception-card">
                        <div className="settings-bookings-v2-exception-card__copy">
                          <div className="settings-bookings-v2-exception-card__title">
                            <strong>
                              {item.mode === "closed"
                                ? "مغلق بالكامل"
                                : `ساعات: ${formatTime12Safe(item.start || "10:00")} - ${formatTime12Safe(item.end || "22:00")}`}
                            </strong>
                            <span className={`dsv2-badge ${item.mode === "closed" ? "dsv2-badge--danger" : "dsv2-badge--success"}`}>
                              {item.mode === "closed" ? "إغلاق" : "ساعات مخصصة"}
                            </span>
                          </div>
                          <dl className="settings-bookings-v2-exception-card__meta">
                            <div><dt>الميلادي</dt><dd>{formatDateRangeByCalendar(item.fromDate, item.toDate, "gregory")}</dd></div>
                            <div><dt>الهجري</dt><dd>{formatDateRangeByCalendar(item.fromDate, item.toDate, "hijri")}</dd></div>
                            <div>
                              <dt>الأيام المستهدفة</dt>
                              <dd>{(item.includeWeekdays || []).length ? (item.includeWeekdays || []).map((day) => WEEKDAY_LABEL_AR[day]).join("، ") : "الكل"}</dd>
                            </div>
                            <div>
                              <dt>الأيام المغلقة</dt>
                              <dd>{(item.blockedWeekdays || []).length ? (item.blockedWeekdays || []).map((day) => WEEKDAY_LABEL_AR[day]).join("، ") : "لا يوجد"}</dd>
                            </div>
                          </dl>
                          {item.reason ? <p className="settings-bookings-v2-exception-card__reason">السبب: {item.reason}</p> : null}
                        </div>
                        <div className="settings-bookings-v2-exception-card__actions">
                          <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => editBookingHourOverride(item.id)}>
                            تعديل
                          </button>
                          <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => removeBookingHourOverride(item.id)}>
                            حذف
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </section>

      <section className="dsv2-card dsv2-card--padded settings-bookings-v2-savebar">
        <div className="settings-bookings-v2-savebar__copy">
          <strong>حفظ إعدادات الحجوزات</strong>
          <p>احفظ بعد التعديل حتى تنعكس القيم في صفحة الحجز.</p>
          {savedMsg ? (
            <span
              className={`dsv2-badge ${savedMsgIsError ? "dsv2-badge--danger" : "dsv2-badge--success"}`}
              role={savedMsgIsError ? "alert" : "status"}
            >
              {savedMsg}
            </span>
          ) : null}
        </div>
        <button className="dsv2-btn dsv2-btn--primary" onClick={saveAll} type="button">
          حفظ التغييرات
        </button>
      </section>
    </main>
  );
}
