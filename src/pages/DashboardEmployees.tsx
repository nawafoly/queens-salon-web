// src/pages/DashboardEmployees.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  writeBatch,
} from "firebase/firestore";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faRotateRight,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import {
  applyStaffLeaveEntryWithBalanceAdjustment,
  canManageLeaveBalanceRole,
  deleteStaffLeaveEntryWithBalanceAdjustment,
  normalizeLeaveEntryType,
} from "../services/firestoreLeaveBalance";
import { writeAuditLog } from "../services/logService";
import { AppSettingsService } from "../services/AppSettingsService";
import { isRemovedFromStaffRecord } from "../services/staffAccountLinkService";
import "../styles/DashboardEmployees.css";
import BasicInfoSection from "./dashboardEmployees/BasicInfoSection";
import BookingSettingsSection from "./dashboardEmployees/BookingSettingsSection";
import EmployeeDetailShell from "./dashboardEmployees/EmployeeDetailShell";
import EmployeeEditorModal from "./dashboardEmployees/EmployeeEditorModal";
import EmployeeListPanel from "./dashboardEmployees/EmployeeListPanel";
import EmployeeStatsSection from "./dashboardEmployees/EmployeeStatsSection";
import ProfileSection from "./dashboardEmployees/ProfileSection";
import ScheduleSummarySection from "./dashboardEmployees/ScheduleSummarySection";
import ServicesSection from "./dashboardEmployees/ServicesSection";

// ✅ Bookings stats (Owner only)
import {
  listAllBookings,
  type BookingDocWithId,
  type BookingStatus,
} from "../services/firestoreBookings";
import {
  computeStaffPayrollForMonth,
  normalizePayrollConfig,
  PAYROLL_CLOSE_DAY,
  payrollCycleKeyFromDate,
  type StaffPayrollMethod,
  type StaffOvertimeHoursBasis,
} from "../helpers/staffPayroll";

import {
  DEFAULT_CLOSE_TIME,
  DEFAULT_OPEN_TIME,
  REVENUE_STATUSES,
  SALON_ID,
  STAFF_IMAGE_OPTIONS,
  WEEKDAY_OPTIONS,
  addDaysIso,
  bookingAmountOf,
  buildHijriMonthDays,
  buildWorkingHourOverrideGroups,
  canonicalizeSpecialties,
  countIsoDateRangeDays,
  createDefaultWorkingHours,
  currentMonthKey,
  durationHours,
  findHijriMonthStartIso,
  fmtIsoDate,
  fmtIsoDateHijri,
  fmtMoneySar,
  formatHijriInputFromIso,
  formatArabicInteger,
  formatDailyHourBucketsLabel,
  formatIsoDateRange,
  formatIsoDateRangeByCalendar,
  formatIsoDateRangeDual,
  formatWindow,
  getAuthUser,
  hijriPartsFromIso,
  hijriWeekdayColumnFromIso,
  intersectTimeWindows,
  isAdministrativeStaffRecord,
  isTimeInsideWindow,
  isoFromHijriDateParts,
  minutesToHHMM,
  monthKey,
  normalizeArabicName,
  normalizeExceptionalLeaveDates,
  normalizeExceptionalLeaveWeekdays,
  normalizeLeaveUntil,
  normalizeSpecialties,
  normalizeTimeHHMM,
  normalizeWeekdayKey,
  normalizeWorkingHourOverrides,
  normalizeWorkingHours,
  parseHijriDateInput,
  parsePositiveInt,
  pickAvatarUrl,
  readBookingHourOverrides,
  resolveAvatarFromAssets,
  safeKey,
  safeNonNegativeNumber,
  servicesCol,
  shiftHijriMonthStartIso,
  staffPublicCol,
  staffPublicDoc,
  toComparableTimestamp,
  toFirestoreErrorMessage,
  toHijriMonthYearLabel,
  todayIso,
  toMinutes,
  usersCol,
  weekdayFromIso,
  type AuthUser,
  type BookingHourOverride,
  type BookingHourOverrideMode,
  type DateCalendar,
  type EmployeeModalTab,
  type EmployeeMode,
  type EmployeeSplitTab,
  type HijriDateParts,
  type LeaveEntry,
  type ServiceOption,
  type StaffBookingStats,
  type StaffPublicDoc,
  type StaffPublicUi,
  type StaffWorkingDay,
  type StaffWorkingHourOverride,
  type StaffWorkingHourOverrideGroup,
  type SummarySourceGroup,
  type WeekdayKey,
  type WorkingHourOverrideApplyMethod,
  type WorkingHourOverrideMode,
  type WorkingHourOverrideQuickMode,
} from "./dashboardEmployees/shared";
export default function DashboardEmployees() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getAuthUser());
  const canAccessEmployeesDashboard =
    authUser?.role === "owner" ||
    authUser?.role === "admin" ||
    authUser?.role === "reception" ||
    authUser?.role === "hr";
  const canManage =
    authUser?.role === "owner" ||
    authUser?.role === "admin" ||
    authUser?.role === "reception";
  const canManageLeaveBalance = canManageLeaveBalanceRole(authUser?.role);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState<StaffPublicUi[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const busy = loading || saving;

  const [statsLoading, setStatsLoading] = useState(false);
  const modalHourOverrideHijriPickerRef = useRef<HTMLDivElement>(null);
  const [bookingStats, setBookingStats] =
    useState<Record<string, StaffBookingStats>>({});
  const [leaveAdjustDays, setLeaveAdjustDays] = useState("1");
  const [leaveAdjustDate, setLeaveAdjustDate] = useState<string>(todayIso());
  const [leaveAdjustNote, setLeaveAdjustNote] = useState("");
  const [leaveEntitlementDate, setLeaveEntitlementDate] = useState("");

  const [qText, setQText] = useState("");
  const [onlyActive, setOnlyActive] =
    useState<"all" | "active" | "inactive">("all");

  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<EmployeeModalTab>("basic");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EmployeeSplitTab>("basic");
  const [mode, setMode] = useState<EmployeeMode>("view");
  const [activeStatsSubTab, setActiveStatsSubTab] = useState<"payroll" | "stats">("payroll");

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [cvUrl, setCvUrl] = useState("");

  const [active, setActive] = useState(true);

  // ✅ جديد
  const [showOnAbout, setShowOnAbout] = useState(true);
  const [showOnBooking, setShowOnBooking] = useState(true);
  const [modalOnLeave, setModalOnLeave] = useState(false);
  const [modalLeaveUntil, setModalLeaveUntil] = useState("");
  const [modalLeaveNote, setModalLeaveNote] = useState("");
  const [employmentEndDate, setEmploymentEndDate] = useState("");
  const [modalExceptionalLeaveWeekdays, setModalExceptionalLeaveWeekdays] = useState<WeekdayKey[]>([]);
  const [modalLeaveWeekdayDraft, setModalLeaveWeekdayDraft] = useState<WeekdayKey | "">("");
  const [modalUseCustomWorkingHours, setModalUseCustomWorkingHours] = useState(false);
  const [modalCustomWorkingHours, setModalCustomWorkingHours] =
    useState<Record<WeekdayKey, StaffWorkingDay>>(createDefaultWorkingHours());
  const [modalCustomHourOverrides, setModalCustomHourOverrides] = useState<StaffWorkingHourOverride[]>([]);
  const [modalHourOverrideFromDate, setModalHourOverrideFromDate] = useState("");
  const [modalHourOverrideToDate, setModalHourOverrideToDate] = useState("");
  const [modalHourOverrideCalendar, setModalHourOverrideCalendar] = useState<DateCalendar>("gregory");
  const [modalHourOverrideFromDateHijri, setModalHourOverrideFromDateHijri] = useState("");
  const [modalHourOverrideToDateHijri, setModalHourOverrideToDateHijri] = useState("");
  const [modalHourOverrideHijriPickerOpen, setModalHourOverrideHijriPickerOpen] = useState(false);
  const [modalHourOverrideHijriPickerTarget, setModalHourOverrideHijriPickerTarget] =
    useState<"from" | "to">("from");
  const [modalHourOverrideHijriViewMonthISO, setModalHourOverrideHijriViewMonthISO] = useState<string>(
    () => findHijriMonthStartIso(todayIso())
  );
  const [modalHourOverrideStart, setModalHourOverrideStart] = useState("10:00");
  const [modalHourOverrideEnd, setModalHourOverrideEnd] = useState("22:00");
  const [modalHourOverrideEnabled, setModalHourOverrideEnabled] = useState(true);
  const [modalHourOverrideMode, setModalHourOverrideMode] = useState<WorkingHourOverrideMode>("single");
  const [modalHourOverrideQuickMode, setModalHourOverrideQuickMode] =
    useState<WorkingHourOverrideQuickMode>("manual");
  const [modalHourOverrideApplyMethod, setModalHourOverrideApplyMethod] =
    useState<WorkingHourOverrideApplyMethod>("replace");
  const [modalHourOverrideNote, setModalHourOverrideNote] = useState("");
  const [modalHourOverrideApplyWeekdays, setModalHourOverrideApplyWeekdays] = useState<WeekdayKey[]>([]);
  const [modalHourOverrideOverwriteExisting, setModalHourOverrideOverwriteExisting] = useState(true);
  const [modalHourOverrideUpdateExistingOnly, setModalHourOverrideUpdateExistingOnly] = useState(false);
  const [modalHourOverrideEditingDate, setModalHourOverrideEditingDate] = useState("");
  const [modalHourOverrideEditingGroupId, setModalHourOverrideEditingGroupId] = useState("");
  const [monthlySalary, setMonthlySalary] = useState("0");
  const [overtimeMethod, setOvertimeMethod] = useState<StaffPayrollMethod>("hours_from_salary");
  const [overtimeDaysPerMonth, setOvertimeDaysPerMonth] = useState("30");
  const [overtimeBaseHoursPerDay, setOvertimeBaseHoursPerDay] = useState("8");
  const [overtimeSeasonBaseHoursPerDay, setOvertimeSeasonBaseHoursPerDay] = useState("6");
  const [overtimeHoursBasis, setOvertimeHoursBasis] = useState<StaffOvertimeHoursBasis>("regular");
  const [overtimePercent, setOvertimePercent] = useState("25");
  const [overtimeInvoicePercent, setOvertimeInvoicePercent] = useState("0");

  const [specialties, setSpecialties] = useState<string[]>([]);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const serviceOptionsRef = useRef<ServiceOption[]>([]);

  const [srvQ, setSrvQ] = useState("");
  const [srvSection, setSrvSection] = useState<string>("all");
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});
  const modalHourOverrideHijriMonthTitle = useMemo(
    () => toHijriMonthYearLabel(modalHourOverrideHijriViewMonthISO),
    [modalHourOverrideHijriViewMonthISO]
  );
  const modalHourOverrideHijriMonthDays = useMemo(
    () => buildHijriMonthDays(modalHourOverrideHijriViewMonthISO),
    [modalHourOverrideHijriViewMonthISO]
  );
  const modalHourOverrideHijriWeekOffset = useMemo(() => {
    if (!modalHourOverrideHijriMonthDays.length) return 0;
    return hijriWeekdayColumnFromIso(modalHourOverrideHijriMonthDays[0].iso);
  }, [modalHourOverrideHijriMonthDays]);

  useEffect(() => {
    serviceOptionsRef.current = serviceOptions;
  }, [serviceOptions]);

  useEffect(() => {
    const syncAuthUser = () => setAuthUser(getAuthUser());
    syncAuthUser();
    window.addEventListener("storage", syncAuthUser);
    window.addEventListener("focus", syncAuthUser);
    return () => {
      window.removeEventListener("storage", syncAuthUser);
      window.removeEventListener("focus", syncAuthUser);
    };
  }, []);

  const ensureCanManage = useCallback(() => {
    if (canManage) return true;
    setErrorMsg("ليست لديك صلاحية لإدارة الموظفات.");
    return false;
  }, [canManage]);
  const ensureCanManageLeaveBalance = useCallback(() => {
    if (canManageLeaveBalance) return true;
    setErrorMsg("ليست لديك صلاحية لإدارة رصيد الإجازات.");
    return false;
  }, [canManageLeaveBalance]);
  const resolveStaffWeeklyOffDays = useCallback((staffLike: any): WeekdayKey[] => {
    const sources = [
      staffLike?.exceptionalLeaveWeekdays,
      staffLike?.weeklyOffDays,
      staffLike?.weeklyOffDay,
      staffLike?.fixedWeeklyDayOff,
      staffLike?.weeklyHoliday,
      staffLike?.dayOff,
    ];
    const values = sources.flatMap((value) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]));
    return normalizeExceptionalLeaveWeekdays(values);
  }, []);

  const resetForm = () => {
    setEditId(null);
    setModalTab("basic");
    setName("");
    setBio("");
    setAvatarUrl("");
    setCvUrl("");
    setActive(true);

    // ✅ جديد
    setShowOnAbout(true);
    setShowOnBooking(true);
    setModalOnLeave(false);
    setModalLeaveUntil("");
    setModalLeaveNote("");
    setEmploymentEndDate("");
    setModalExceptionalLeaveWeekdays([]);
    setModalLeaveWeekdayDraft("");
    setModalUseCustomWorkingHours(false);
    setModalCustomWorkingHours(createDefaultWorkingHours());
    setModalCustomHourOverrides([]);
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideCalendar("gregory");
    setModalHourOverrideFromDateHijri("");
    setModalHourOverrideToDateHijri("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideApplyWeekdays([]);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideUpdateExistingOnly(false);
    setModalHourOverrideEditingDate("");
    setModalHourOverrideEditingGroupId("");
    setMonthlySalary("0");
    setOvertimeMethod("hours_from_salary");
    setOvertimeDaysPerMonth("30");
    setOvertimeBaseHoursPerDay("8");
    setOvertimeSeasonBaseHoursPerDay("6");
    setOvertimeHoursBasis("regular");
    setOvertimePercent("25");
    setOvertimeInvoicePercent("0");

    setSpecialties([]);
    setLeaveAdjustDays("1");
    setLeaveAdjustDate(todayIso());
    setLeaveAdjustNote("");
    setLeaveEntitlementDate("");
  };

  const openEdit = (x: StaffPublicUi) => {
    setSelectedEmployeeId(x.id);
    setActiveTab("basic");
    setActiveStatsSubTab("payroll");
    setMode("view");
    setEditId(x.id);
    setModalTab("basic");
    setName(x.name ?? "");
    setBio(x.bio ?? "");
    setAvatarUrl(resolveAvatarFromAssets(pickAvatarUrl(x as any)));
    setCvUrl((x as any).cvUrl ?? "");
    setActive(!!x.active);
    setShowOnBooking((x as any).showOnBooking !== false);
    const initialLeaveUntil = normalizeLeaveUntil((x as any).leaveUntil);
    const initialLeaveExpired = !!initialLeaveUntil && initialLeaveUntil < todayIso();
    setModalOnLeave(!!(x as any).onLeave && !initialLeaveExpired);
    setModalLeaveUntil(initialLeaveUntil);
    setModalLeaveNote(String((x as any).leaveNote || ""));
    setEmploymentEndDate(normalizeLeaveUntil((x as any).employmentEndDate));
    setModalExceptionalLeaveWeekdays(resolveStaffWeeklyOffDays(x));
    setModalLeaveWeekdayDraft("");
    setModalUseCustomWorkingHours(!!(x as any).useCustomWorkingHours);
    setModalCustomWorkingHours(normalizeWorkingHours((x as any).customWorkingHours));
    setModalCustomHourOverrides(
      normalizeWorkingHourOverrides((x as any).customWorkingHourOverrides)
    );
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideCalendar("gregory");
    setModalHourOverrideFromDateHijri("");
    setModalHourOverrideToDateHijri("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideApplyWeekdays([]);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideUpdateExistingOnly(false);
    setModalHourOverrideEditingDate("");
    setModalHourOverrideEditingGroupId("");
    const payrollCfg = normalizePayrollConfig(x as any);
    setMonthlySalary(String(payrollCfg.monthlySalary || 0));
    setOvertimeMethod(payrollCfg.method);
    setOvertimeDaysPerMonth(String(payrollCfg.daysPerMonth || 30));
    setOvertimeBaseHoursPerDay(String(payrollCfg.baseHoursPerDay || 8));
    setOvertimeSeasonBaseHoursPerDay(String(payrollCfg.seasonBaseHoursPerDay || 6));
    setOvertimeHoursBasis(payrollCfg.hoursBasis || "regular");
    setOvertimePercent(String(payrollCfg.overtimePercent || 0));
    setOvertimeInvoicePercent(String(payrollCfg.invoicePercent || 0));

    // ✅ جديد
    setShowOnAbout((x as any).showOnAbout !== false);

    setSpecialties(canonicalizeSpecialties(x.specialties, serviceOptions));
    setLeaveAdjustDays("1");
    setLeaveAdjustDate(todayIso());
    setLeaveAdjustNote("");
    setLeaveEntitlementDate(String((x as any).leaveEntitlementDate || ""));
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    resetForm();
  };

  const loadServiceOptions = useCallback(async (): Promise<ServiceOption[]> => {
    try {
      const qSrv = query(servicesCol(), orderBy("name", "asc"));
      const snap = await getDocs(qSrv);

      const opts: ServiceOption[] = snap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            label: String(x?.name || d.id),
            sectionId: String(x?.sectionId || ""),
            categoryId: String(x?.categoryId || ""),
            active: x?.active !== false,
          };
        })
        .filter((s) => s.label.trim())
        .filter((s) => s.active !== false);

      setServiceOptions(opts);
      return opts;
    } catch (e) {
      setServiceOptions([]);
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر تحميل الخدمات."));
      return [];
    }
  }, []);

  const load = useCallback(
    async (optionsOverride?: ServiceOption[]) => {
      setLoading(true);
      setErrorMsg("");
      try {
        const linkedUserRoleByUid = new Map<string, string>();
        try {
          const userSnap = await getDocs(usersCol());
          userSnap.docs.forEach((u) => {
            const x = u.data() as any;
            const uid = String(u.id || "").trim();
            const role = String(x?.role || "").trim();
            if (uid && role) linkedUserRoleByUid.set(uid, role);
          });
        } catch {
          // skip optional role enrichment
        }

        const serviceLookup = optionsOverride ?? serviceOptionsRef.current;
        const snap = await getDocs(staffPublicCol());
        const deduped = new Map<string, StaffPublicUi>();

        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (isRemovedFromStaffRecord(data)) {
            return;
          }
          if (isAdministrativeStaffRecord(d.id, data, linkedUserRoleByUid)) {
            return;
          }
          const payrollCfg = normalizePayrollConfig(data);
          const row: StaffPublicUi = {
            id: d.id,
            name: data?.name ?? "",
            active: data?.active !== false,
            showOnAbout: data?.showOnAbout !== false,
            showOnBooking: data?.showOnBooking !== false,
            employmentEndDate: normalizeLeaveUntil(data?.employmentEndDate),
            onLeave: !!data?.onLeave,
            leaveUntil: normalizeLeaveUntil(data?.leaveUntil),
            leaveNote: String(data?.leaveNote || ""),
            exceptionalLeaveDates: normalizeExceptionalLeaveDates(data?.exceptionalLeaveDates),
            exceptionalLeaveWeekdays: resolveStaffWeeklyOffDays(data),
            useCustomWorkingHours: !!data?.useCustomWorkingHours,
            customWorkingHours: normalizeWorkingHours(data?.customWorkingHours),
            customWorkingHourOverrides: normalizeWorkingHourOverrides(data?.customWorkingHourOverrides),
            monthlySalary: payrollCfg.monthlySalary,
            overtimeMethod: payrollCfg.method,
            overtimeDaysPerMonth: payrollCfg.daysPerMonth,
            overtimeBaseHoursPerDay: payrollCfg.baseHoursPerDay,
            overtimeSeasonBaseHoursPerDay: payrollCfg.seasonBaseHoursPerDay,
            overtimeHoursBasis: payrollCfg.hoursBasis,
            overtimePercent: payrollCfg.overtimePercent,
            overtimeInvoicePercent: payrollCfg.invoicePercent,
            specialties: canonicalizeSpecialties(data?.specialties, serviceLookup),
            bio: data?.bio ?? "",
            avatarUrl: resolveAvatarFromAssets(pickAvatarUrl(data)),
            cvUrl: data?.cvUrl ?? "",
            leaveBalanceDays: Number(data?.leaveBalanceDays || 0),
            leaveEntitlementDate: String(data?.leaveEntitlementDate || ""),
            leaveEntries: Array.isArray(data?.leaveEntries) ? data.leaveEntries : [],
            createdAt: data?.createdAt,
            updatedAt: data?.updatedAt,
          };

          const linkedUid = String(data?.linkedUid || "").trim();
          const dedupeKey = linkedUid ? `uid:${linkedUid}` : `doc:${d.id}`;
          const existing = deduped.get(dedupeKey);
          if (!existing) {
            deduped.set(dedupeKey, row);
            return;
          }

          const rowTs = toComparableTimestamp(row.updatedAt) || toComparableTimestamp(row.createdAt);
          const existingTs =
            toComparableTimestamp(existing.updatedAt) || toComparableTimestamp(existing.createdAt);
          if (rowTs >= existingTs) deduped.set(dedupeKey, row);
        });

        const rows = Array.from(deduped.values()).sort((a, b) =>
          (a.name || "").localeCompare(b.name || "", "ar")
        );
        setList(rows);
      } catch (e) {
        setErrorMsg(toFirestoreErrorMessage(e, "تعذر تحميل الموظفات."));
        setList([]);
      } finally {
        setLoading(false);
      }
    },
    [resolveStaffWeeklyOffDays]
  );

  // ✅ Original logic for fixing bookings
  const fixBookingsEmployeeUid = async () => {
    if (!ensureCanManage()) return;
    const ok = confirm(
      "سيتم إصلاح الحجوزات القديمة بإضافة employeeUid/employeeKey. هل تريد المتابعة؟"
    );
    if (!ok) return;
    setSaving(true);
    setErrorMsg("");
    try {
      const staffSnap = await getDocs(staffPublicCol());
      const uidByEmployeeId = new Map<string, string>();
      staffSnap.docs.forEach((d) => {
        const data: any = d.data();
        const linkedUid = String(data?.linkedUid || "").trim();
        if (linkedUid) uidByEmployeeId.set(d.id, linkedUid);
      });
      const bookingsRef = collection(db, "salons", SALON_ID, "bookings");
      const bSnap = await getDocs(bookingsRef);
      let batch = writeBatch(db);
      let batchCount = 0;
      for (const d of bSnap.docs) {
        const b: any = d.data();
        const employeeUid = String(b?.employeeUid || "").trim();
        const employeeId = String(b?.employeeId || "").trim();
        if (employeeUid || !employeeId) continue;
        const linkedUid = uidByEmployeeId.get(employeeId) || "";
        if (!linkedUid) continue;
        batch.update(doc(db, "salons", SALON_ID, "bookings", d.id), {
          employeeUid: linkedUid,
          employeeKey: linkedUid,
          updatedAt: serverTimestamp(),
        });
        batchCount++;
        if (batchCount >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
        }
      }
      await batch.commit();
      alert("✅ تم إصلاح الحجوزات");
    } catch (e) {
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر إكمال إصلاح الحجوزات."));
    } finally {
      setSaving(false);
    }
  };

  const reloadData = useCallback(async () => {
    const opts = await loadServiceOptions();
    await load(opts);
  }, [load, loadServiceOptions]);

  useEffect(() => {
    let alive = true;
    const bootstrap = async () => {
      if (!alive) return;
      await reloadData();
    };
    void bootstrap();
    return () => {
      alive = false;
    };
  }, [reloadData]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = AppSettingsService.subscribe((remote: any) => {
      setAppSettings(remote || {});
    });
    return () => {
      try {
        unsub?.();
      } catch {
        // noop
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const compute = async () => {
      if (!(authUser?.role === "owner" || authUser?.role === "admin") || !list.length) {
        setBookingStats({});
        return;
      }
      setStatsLoading(true);
      try {
        const thisMonth = currentMonthKey();
        const initStats = (): StaffBookingStats => ({
          total: 0,
          byStatus: { pending: 0, confirmed: 0, completed: 0, cancelled: 0 },
          month: {
            key: thisMonth,
            salonTotal: 0,
            staffTotal: 0,
            sharePct: 0,
            invoiceCount: 0,
            invoiceRevenue: 0,
          },
        });
        const staffById = new Set(list.map((s) => s.id));
        const staffByKey = new Map<string, string>();
        const staffByName = new Map<string, string>();
        let salonMonthTotal = 0;

        for (const s of list) {
          const sid = String(s.id || "").trim();
          if (sid) staffByKey.set(sid, sid);
          const nKey = normalizeArabicName(s.name);
          if (nKey) staffByName.set(nKey, sid);
          const nk2 = safeKey(String(s.name || "").trim());
          if (nk2) staffByKey.set(nk2, sid);
        }

        const rows: BookingDocWithId[] = await listAllBookings();
        const m: Record<string, StaffBookingStats> = {};

        for (const b of rows) {
          const bMonth = monthKey(String((b as any).date || ""));
          const st = (String((b as any).status || "pending").toLowerCase() ||
            "pending") as BookingStatus;
          const bookingAmount = bookingAmountOf(b);
          const isRevenueStatus = REVENUE_STATUSES.has(st);
          if (bMonth === thisMonth && st !== "cancelled") salonMonthTotal += 1;

          const eid = String((b as any).employeeId || "").trim();
          const euid = String((b as any).employeeUid || "").trim();
          const ekey = String((b as any).employeeKey || "").trim();
          const ename = String((b as any).employeeName || "").trim();

          let staffId: string | null = null;
          if (ekey && staffByKey.has(ekey)) staffId = staffByKey.get(ekey) || null;
          if (!staffId && euid && staffByKey.has(euid))
            staffId = staffByKey.get(euid) || null;
          if (!staffId && eid && staffById.has(eid)) staffId = eid;
          if (!staffId && ename) {
            const k = normalizeArabicName(ename);
            staffId = staffByName.get(k) || null;
          }
          if (!staffId) continue;

          if (!m[staffId]) m[staffId] = initStats();
          m[staffId].total += 1;
          m[staffId].byStatus[st] = (m[staffId].byStatus[st] || 0) + 1;
          if (bMonth === thisMonth && st !== "cancelled") {
            m[staffId].month.staffTotal += 1;
          }
          if (bMonth === thisMonth && isRevenueStatus) {
            m[staffId].month.invoiceCount += 1;
            m[staffId].month.invoiceRevenue += bookingAmount;
          }
        }

        Object.keys(m).forEach((sid) => {
          m[sid].month.salonTotal = salonMonthTotal;
          m[sid].month.sharePct =
            salonMonthTotal > 0 ? Math.round((m[sid].month.staffTotal / salonMonthTotal) * 100) : 0;
        });

        list.forEach((s) => {
          if (!m[s.id]) {
            m[s.id] = initStats();
            m[s.id].month.salonTotal = salonMonthTotal;
          }
        });

        Object.keys(m).forEach((sid) => {
          if (!m[sid].month.sharePct && m[sid].month.salonTotal > 0 && m[sid].month.staffTotal > 0) {
            m[sid].month.sharePct = Math.round(
              (m[sid].month.staffTotal / m[sid].month.salonTotal) * 100
            );
          }
        });
        if (alive) setBookingStats(m);
      } catch (e) {
        console.warn("booking stats error:", e);
        if (alive) setBookingStats({});
      } finally {
        if (alive) setStatsLoading(false);
      }
    };
    compute();
    return () => {
      alive = false;
    };
  }, [authUser?.role, list]);

  useEffect(() => {
    if (!selectedEmployeeId) return;
    const exists = list.some((x) => x.id === selectedEmployeeId);
    if (exists) return;
    setSelectedEmployeeId(null);
    setEditId(null);
    setIsOpen(false);
    setMode("view");
  }, [list, selectedEmployeeId]);

  useEffect(() => {
    setModalHourOverrideFromDateHijri(formatHijriInputFromIso(modalHourOverrideFromDate));
  }, [modalHourOverrideFromDate]);

  useEffect(() => {
    setModalHourOverrideToDateHijri(formatHijriInputFromIso(modalHourOverrideToDate));
  }, [modalHourOverrideToDate]);

  useEffect(() => {
    if (!modalHourOverrideHijriPickerOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      const root = modalHourOverrideHijriPickerRef.current;
      if (!root) return;
      const target = ev.target as Node | null;
      if (target && root.contains(target)) return;
      setModalHourOverrideHijriPickerOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [modalHourOverrideHijriPickerOpen]);

  const sectionOptions = useMemo(() => {
    const m = new Map<string, { id: string; label: string }>();
    for (const s of serviceOptions) {
      const sid = String(s.sectionId || "").trim();
      if (!sid) continue;
      if (!m.has(sid)) m.set(sid, { id: sid, label: sid });
    }
    return Array.from(m.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "ar")
    );
  }, [serviceOptions]);

  const filteredServicesForPicks = useMemo(() => {
    let rows = [...serviceOptions];
    if (srvSection !== "all") {
      rows = rows.filter((s) => String(s.sectionId || "").trim() === srvSection);
    }
    const q = srvQ.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) => String(s.label || "").toLowerCase().includes(q));
    }
    rows.sort((a, b) => String(a.label).localeCompare(String(b.label), "ar"));
    return rows;
  }, [serviceOptions, srvSection, srvQ]);

  const toggleSpecialty = (serviceId: string) => {
    setSpecialties((prev) =>
      prev.includes(serviceId) ? prev.filter((x) => x !== serviceId) : [...prev, serviceId]
    );
  };

  const save = async () => {
    if (!ensureCanManage()) return;
    const cleanName = name.trim();
    const specialtiesFixed = canonicalizeSpecialties(specialties, serviceOptions);
    const effectiveShowOnBooking = specialtiesFixed.length > 0 ? !!showOnBooking : false;
    if (!cleanName) {
      setErrorMsg("اكتب اسم الموظفة");
      return;
    }
    // Allow saving basic data even when no services are assigned.
    // In that case, force-hide from booking until services are added.
    if (specialtiesFixed.length === 0 && showOnBooking) {
      setShowOnBooking(false);
    }
    // ✅ منع "النسيان": موظفة نشطة لكن مخفية من الحجز
    if (active && !effectiveShowOnBooking) {
      const ok = confirm(
        "⚠️ تنبيه: الموظفة (نشطة) لكن (مخفية من الحجز).\nهل تريد الحفظ بهذا الشكل؟"
      );
      if (!ok) return;
    }

    // احفظ فقط الاستثناءات التي تم إضافتها فعلياً في القائمة.
    // لا نطبق المسودة تلقائياً عند الحفظ حتى لا تعيد القيم القديمة.
    let normalizedCustomHourOverrides = normalizeWorkingHourOverrides(modalCustomHourOverrides);
    const hasPendingOverrideDraft =
      !!normalizeLeaveUntil(modalHourOverrideEditingDate) ||
      (!!normalizeLeaveUntil(modalHourOverrideFromDate) && modalHourOverridePreview.affectedDays > 0);
    if (modalUseCustomWorkingHours && hasPendingOverrideDraft) {
      const draftResult = buildModalWorkingHourOverrides(normalizedCustomHourOverrides);
      if (draftResult.error) {
        setErrorMsg(draftResult.error);
        return;
      }
      if (draftResult.appliedCount > 0) {
        normalizedCustomHourOverrides = draftResult.next;
        setModalCustomHourOverrides(draftResult.next);
      }
    }


    setSaving(true);
    setErrorMsg("");
    const normalizedModalLeaveUntil = normalizeLeaveUntil(modalLeaveUntil);
    const normalizedEmploymentEndDate = normalizeLeaveUntil(employmentEndDate);
    const modalLeaveExpired = !!normalizedModalLeaveUntil && normalizedModalLeaveUntil < todayIso();
    const effectiveModalOnLeave = modalOnLeave && !modalLeaveExpired;
    const normalizedExceptionalWeekdays = normalizeExceptionalLeaveWeekdays(
      modalExceptionalLeaveWeekdays
    );
    const normalizedCustomWorkingHours = normalizeWorkingHours(modalCustomWorkingHours);
    const normalizedExceptionalDates = editId
      ? normalizeExceptionalLeaveDates((editingStaff as any)?.exceptionalLeaveDates)
      : [];

    const payload: StaffPublicDoc = {
      name: cleanName,
      active: !!active,
      showOnAbout: !!showOnAbout,
      showOnBooking: effectiveShowOnBooking,
      employmentEndDate: normalizedEmploymentEndDate,
      onLeave: effectiveModalOnLeave,
      leaveUntil: normalizedModalLeaveUntil,
      leaveNote: String(modalLeaveNote || "").trim(),
      exceptionalLeaveDates: normalizedExceptionalDates,
      exceptionalLeaveWeekdays: normalizedExceptionalWeekdays,
      useCustomWorkingHours: !!modalUseCustomWorkingHours,
      customWorkingHours: normalizedCustomWorkingHours,
      customWorkingHourOverrides: normalizedCustomHourOverrides,
      monthlySalary: safeNonNegativeNumber(monthlySalary, 0),
      overtimeMethod:
        overtimeMethod === "invoice_percentage" ? "invoice_percentage" : "hours_from_salary",
      overtimeDaysPerMonth: Math.max(1, safeNonNegativeNumber(overtimeDaysPerMonth, 30)),
      overtimeBaseHoursPerDay: Math.max(1, safeNonNegativeNumber(overtimeBaseHoursPerDay, 8)),
      overtimeSeasonBaseHoursPerDay: Math.max(
        1,
        safeNonNegativeNumber(overtimeSeasonBaseHoursPerDay, 6)
      ),
      overtimeHoursBasis: overtimeHoursBasis === "season" ? "season" : "regular",
      overtimePercent: safeNonNegativeNumber(overtimePercent, 0),
      overtimeInvoicePercent: safeNonNegativeNumber(overtimeInvoicePercent, 0),

      specialties: specialtiesFixed,
      bio: bio.trim(),
      avatarUrl: avatarUrl.trim(),
      cvUrl: cvUrl.trim(),
      updatedAt: serverTimestamp(),
    };

    try {
      if (!editId) {
        const id = cleanName
          .replace(/\s+/g, "_")
          .replace(/[^\w\u0600-\u06FF_]/g, "")
          .slice(0, 40);
        await setDoc(staffPublicDoc(id || crypto.randomUUID()), {
          ...payload,
          leaveBalanceDays: 0,
          leaveEntitlementDate: "",
          leaveEntries: [],
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(staffPublicDoc(editId), payload as any);
      }
      if (!selectedEmployeeId) {
        closeModal();
      } else {
        setMode("view");
      }
      await load();
    } catch (e) {
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر حفظ الموظفة."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!ensureCanManage()) return;
    if (!confirm("متأكد حذف الموظفة؟")) return;
    setSaving(true);
    setErrorMsg("");
    try {
      await deleteDoc(staffPublicDoc(id));
      if (selectedEmployeeId === id) {
        setSelectedEmployeeId(null);
        setEditId(null);
        setIsOpen(false);
        setMode("view");
      }
      await load();
    } catch (e) {
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر حذف الموظفة."));
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    let rows = [...list];
    if (onlyActive === "active") rows = rows.filter((x) => x.active);
    if (onlyActive === "inactive") rows = rows.filter((x) => !x.active);
    if (specialtyFilter !== "all") {
      rows = rows.filter((x) => normalizeSpecialties(x.specialties).includes(specialtyFilter));
    }
    const t = qText.trim().toLowerCase();
    if (t) {
      rows = rows.filter((x) => {
        const n = (x.name || "").toLowerCase();
        const b = (x.bio || "").toLowerCase();
        return n.includes(t) || b.includes(t);
      });
    }
    return rows;
  }, [list, onlyActive, specialtyFilter, qText]);
  const selectedEmployee = useMemo(
    () => (selectedEmployeeId ? list.find((x) => x.id === selectedEmployeeId) || null : null),
    [list, selectedEmployeeId]
  );
  const selectedEmployeeLeaveUntil = normalizeLeaveUntil((selectedEmployee as any)?.leaveUntil);
  const selectedEmployeeLeaveExpired =
    !!selectedEmployeeLeaveUntil && selectedEmployeeLeaveUntil < todayIso();
  const selectedEmployeeOnLeave =
    !!(selectedEmployee as any)?.onLeave && !selectedEmployeeLeaveExpired;
  const selectedEmployeeStatusLabel = selectedEmployeeOnLeave
    ? selectedEmployeeLeaveUntil
      ? `في إجازة حتى ${fmtIsoDate(selectedEmployeeLeaveUntil)}`
      : "في إجازة"
    : selectedEmployee?.active
      ? "نشطة"
      : "غير نشطة";
  const selectedEmployeeStatusClass = selectedEmployeeOnLeave
    ? "warn"
    : selectedEmployee?.active
      ? "on"
      : "off";
  const showPayrollSubTab = !selectedEmployeeId || activeStatsSubTab === "payroll";
  const showStatsSubTab = !selectedEmployeeId || activeStatsSubTab === "stats";

  const staffScheduleSummary = useMemo(() => {
    const now = new Date(nowTick);
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const today = `${yyyy}-${mm}-${dd}`;
    const timeNow = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const weekday = weekdayFromIso(today);
    const booking = (appSettings as any)?.booking || {};
    const businessHours = (booking as any)?.businessHours || {};
    const bookingHourOverrides = readBookingHourOverrides((booking as any)?.bookingHourOverrides);

    const dayKey = weekday || "sat";
    const dayHoursBase = (businessHours as any)?.[dayKey] || {
      enabled: true,
      start: DEFAULT_OPEN_TIME,
      end: DEFAULT_CLOSE_TIME,
    };

    const salonWeeklyEnabled = dayHoursBase?.enabled !== false;
    const salonWeeklyOpen = normalizeTimeHHMM(dayHoursBase?.start) || DEFAULT_OPEN_TIME;
    const salonWeeklyClose = normalizeTimeHHMM(dayHoursBase?.end) || DEFAULT_CLOSE_TIME;
    let salonEnabled = salonWeeklyEnabled;
    let salonOpen = salonWeeklyOpen;
    let salonClose = salonWeeklyClose;
    let salonSourceLabel = "أسبوعي";
    let activeSalonOverride:
      | {
          sourceIndex: number;
          fromDate: string;
          toDate: string;
          mode: BookingHourOverrideMode;
          windowLabel: string;
          includeDays: WeekdayKey[];
          blockedDays: WeekdayKey[];
        }
      | null = null;

    for (let i = bookingHourOverrides.length - 1; i >= 0; i--) {
      const ov = bookingHourOverrides[i];
      if (today < ov.fromDate || today > ov.toDate) continue;
      const includeDays = Array.isArray(ov?.includeWeekdays) ? ov.includeWeekdays : [];
      if (includeDays.length > 0 && !includeDays.includes(dayKey)) continue;
      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? ov.blockedWeekdays : [];
      if (blockedDays.includes(dayKey) || String(ov?.mode || "").trim() === "closed") {
        salonEnabled = false;
        salonSourceLabel = "استثناء فعلي";
        activeSalonOverride = {
          sourceIndex: i,
          fromDate: ov.fromDate,
          toDate: ov.toDate,
          mode: "closed",
          windowLabel: "إغلاق كامل اليوم",
          includeDays: includeDays as WeekdayKey[],
          blockedDays: blockedDays as WeekdayKey[],
        };
      } else {
        salonEnabled = true;
        const ovStart = normalizeTimeHHMM(ov.start) || salonOpen;
        const ovEnd = normalizeTimeHHMM(ov.end) || salonClose;
        salonOpen = ovStart;
        salonClose = ovEnd;
        salonSourceLabel = "استثناء فعلي";
        activeSalonOverride = {
          sourceIndex: i,
          fromDate: ov.fromDate,
          toDate: ov.toDate,
          mode: "hours",
          windowLabel: formatWindow(ovStart, ovEnd),
          includeDays: includeDays as WeekdayKey[],
          blockedDays: blockedDays as WeekdayKey[],
        };
      }
      break;
    }
    const salonWeeklyWindowLabel = salonWeeklyEnabled
      ? formatWindow(salonWeeklyOpen, salonWeeklyClose)
      : "مغلق أسبوعيًا";
    const salonEffectiveWindowLabel = salonEnabled
      ? formatWindow(salonOpen, salonClose)
      : "مغلق للحجوزات اليوم";

    const weekdayLabel = (key: WeekdayKey | "") =>
      WEEKDAY_OPTIONS.find((x) => x.key === key)?.label || "-";
    const formatWeekdaySet = (days: WeekdayKey[]) =>
      days.length ? days.map((d) => weekdayLabel(d)).join(" / ") : "-";
    const formatOverrideMeta = (ov: BookingHourOverride) => {
      const includeDays = Array.isArray(ov?.includeWeekdays) ? (ov.includeWeekdays as WeekdayKey[]) : [];
      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? (ov.blockedWeekdays as WeekdayKey[]) : [];
      const includeLabel = includeDays.length ? formatWeekdaySet(includeDays) : "كل الأيام";
      const blockedLabel = blockedDays.length ? formatWeekdaySet(blockedDays) : "";
      const isClosed = String(ov?.mode || "").trim() === "closed";
      const start = normalizeTimeHHMM(ov?.start) || DEFAULT_OPEN_TIME;
      const end = normalizeTimeHHMM(ov?.end) || DEFAULT_CLOSE_TIME;
      const modeLabel = isClosed ? "إغلاق كامل" : `ساعات ${formatWindow(start, end)}`;
      return `${modeLabel} | الأيام المستهدفة: ${includeLabel}${
        blockedLabel ? ` | أيام الإغلاق: ${blockedLabel}` : ""
      }`;
    };
    const allOverrideDetails = bookingHourOverrides.map((ov, idx) => ({
      sourceIndex: idx,
      rangeDual: formatIsoDateRangeDual(ov.fromDate, ov.toDate),
      meta: formatOverrideMeta(ov),
    }));
        const todayDateGregorian = fmtIsoDate(today);
        const todayDateHijri = fmtIsoDateHijri(today);
        const todayDateCombinedLabel = `${todayDateGregorian} — ${todayDateHijri}`;
        const todayDateLabel = `${todayDateGregorian} م / ${todayDateHijri} هـ`;
    const salonWeeklyDetails = salonWeeklyEnabled
      ? "الدوام الأساسي مأخوذ من الجدول الأسبوعي."
      : "اليوم مغلق في الجدول الأسبوعي.";
    const salonEffectiveBaseDetails = activeSalonOverride
      ? activeSalonOverride.mode === "closed"
        ? "تم إغلاق الصالون اليوم عبر الاستثناء الفعلي."
        : `تم تعديل ساعات الصالون اليوم عبر الاستثناء الفعلي (${activeSalonOverride.windowLabel}).`
      : "لا يوجد استثناء فعلي اليوم على الصالون.";
    const salonSourceDetails = (() => {
      const notes: string[] = [];
      const groups: SummarySourceGroup[] = [];
      const buildGroup = (
        title: string,
        gregorian: string,
        hijri: string,
        details: string[],
        tone: "active" | "other"
      ): SummarySourceGroup => ({
        title,
        gregorian,
        hijri,
        details,
        tone,
      });

      if (activeSalonOverride) {
        const activeDual = formatIsoDateRangeDual(activeSalonOverride.fromDate, activeSalonOverride.toDate);
        const activeDetails: string[] = [];
        if (activeSalonOverride.mode === "closed") {
          activeDetails.push("نوع الاستثناء: إغلاق كامل للحجوزات اليوم.");
        } else {
          activeDetails.push(`وقت الاستثناء الفعلي: ${activeSalonOverride.windowLabel}`);
        }
        if (activeSalonOverride.includeDays.length > 0) {
          activeDetails.push(`الأيام المستهدفة: ${formatWeekdaySet(activeSalonOverride.includeDays)}`);
        }
        if (activeSalonOverride.blockedDays.length > 0) {
          activeDetails.push(`أيام الإغلاق داخل النطاق: ${formatWeekdaySet(activeSalonOverride.blockedDays)}`);
        }
        groups.push(
          buildGroup(
            "الاستثناء الفعلي",
            activeDual.gregorian,
            activeDual.hijri,
            activeDetails,
            "active"
          )
        );

        const others = allOverrideDetails.filter((x) => x.sourceIndex !== activeSalonOverride.sourceIndex);
        if (others.length) {
          notes.push(`استثناءات أخرى مسجلة (${others.length}):`);
          others.forEach((x, idx) => {
            groups.push(
              buildGroup(
                `الاستثناء ${idx + 1}`,
                x.rangeDual.gregorian,
                x.rangeDual.hijri,
                [`تفاصيل الاستثناء ${idx + 1}: ${x.meta}`],
                "other"
              )
            );
          });
        }
      } else if (allOverrideDetails.length) {
        notes.push("لا يوجد استثناء فعلي اليوم.");
        notes.push(`الاستثناءات المسجلة (${allOverrideDetails.length}):`);
        allOverrideDetails.forEach((x, idx) => {
          groups.push(
            buildGroup(
              `الاستثناء ${idx + 1}`,
              x.rangeDual.gregorian,
              x.rangeDual.hijri,
              [`تفاصيل الاستثناء ${idx + 1}: ${x.meta}`],
              "other"
            )
          );
        });
      } else {
        notes.push("لا توجد استثناءات مسجلة على دوام الصالون.");
      }
      return { notes, groups };
    })();

    return list
      .map((staff) => {
        const leaveUntil = normalizeLeaveUntil((staff as any).leaveUntil);
        const employmentEndDate = normalizeLeaveUntil((staff as any).employmentEndDate);
        const exceptionalDates = normalizeExceptionalLeaveDates((staff as any).exceptionalLeaveDates);
        const exceptionalWeekdays = resolveStaffWeeklyOffDays(staff);
        const overrides = normalizeWorkingHourOverrides((staff as any).customWorkingHourOverrides);
        const overrideGroups = buildWorkingHourOverrideGroups(overrides);
        const customWorkingHours = normalizeWorkingHours((staff as any).customWorkingHours);
        const useCustom = !!(staff as any).useCustomWorkingHours;
        const overrideToday = overrides.find((x) => x.date === today);
        const nextSavedOverrideGroup = overrideGroups.find((group) => group.fromDate > today) || null;
        const lastSavedOverrideGroup =
          overrideGroups.length && overrideGroups[overrideGroups.length - 1].toDate < today
            ? overrideGroups[overrideGroups.length - 1]
            : null;
        const baseDay = weekday ? customWorkingHours[weekday] : undefined;
        const resolveOperationalDay = (dateIso: string) => {
          const targetDate = normalizeLeaveUntil(dateIso);
          const targetDayKey = weekdayFromIso(targetDate) || "sat";
          const targetBusinessHours = (businessHours as any)?.[targetDayKey] || {
            enabled: true,
            start: DEFAULT_OPEN_TIME,
            end: DEFAULT_CLOSE_TIME,
          };
          const targetSalonWeeklyEnabled = targetBusinessHours?.enabled !== false;
          const targetSalonWeeklyOpen =
            normalizeTimeHHMM(targetBusinessHours?.start) || DEFAULT_OPEN_TIME;
          const targetSalonWeeklyClose =
            normalizeTimeHHMM(targetBusinessHours?.end) || DEFAULT_CLOSE_TIME;
          let targetSalonEnabled = targetSalonWeeklyEnabled;
          let targetSalonOpen = targetSalonWeeklyOpen;
          let targetSalonClose = targetSalonWeeklyClose;
          let targetSalonOverride:
            | {
                fromDate: string;
                toDate: string;
                mode: BookingHourOverrideMode;
                windowLabel: string;
                includeDays: WeekdayKey[];
                blockedDays: WeekdayKey[];
              }
            | null = null;

          for (let i = bookingHourOverrides.length - 1; i >= 0; i--) {
            const ov = bookingHourOverrides[i];
            if (targetDate < ov.fromDate || targetDate > ov.toDate) continue;
            const includeDays = Array.isArray(ov?.includeWeekdays) ? (ov.includeWeekdays as WeekdayKey[]) : [];
            if (includeDays.length > 0 && !includeDays.includes(targetDayKey)) continue;
            const blockedDays = Array.isArray(ov?.blockedWeekdays) ? (ov.blockedWeekdays as WeekdayKey[]) : [];
            if (blockedDays.includes(targetDayKey) || String(ov?.mode || "").trim() === "closed") {
              targetSalonEnabled = false;
              targetSalonOverride = {
                fromDate: ov.fromDate,
                toDate: ov.toDate,
                mode: "closed",
                windowLabel: "إغلاق كامل اليوم",
                includeDays,
                blockedDays,
              };
            } else {
              targetSalonEnabled = true;
              const ovStart = normalizeTimeHHMM(ov.start) || targetSalonOpen;
              const ovEnd = normalizeTimeHHMM(ov.end) || targetSalonClose;
              targetSalonOpen = ovStart;
              targetSalonClose = ovEnd;
              targetSalonOverride = {
                fromDate: ov.fromDate,
                toDate: ov.toDate,
                mode: "hours",
                windowLabel: formatWindow(ovStart, ovEnd),
                includeDays,
                blockedDays,
              };
            }
            break;
          }

          const targetOverride = overrides.find((x) => x.date === targetDate) || null;
          const targetBaseDay = targetDayKey ? customWorkingHours[targetDayKey] : undefined;
          const targetLeaveByDate = exceptionalDates.includes(targetDate);
          const targetLeaveByWeekday = targetDayKey ? exceptionalWeekdays.includes(targetDayKey) : false;
          const targetLeaveByToggle =
            !!(staff as any).onLeave && (!leaveUntil || leaveUntil >= targetDate);
          const targetLeaveActive = targetLeaveByDate || targetLeaveByWeekday || targetLeaveByToggle;
          const targetEmploymentEnded = !!employmentEndDate && targetDate > employmentEndDate;

          let targetEffectiveEnabled = true;
          let targetEffectiveStart = targetSalonOpen;
          let targetEffectiveEnd = targetSalonClose;

          if (targetOverride) {
            targetEffectiveEnabled = targetOverride.enabled !== false;
            targetEffectiveStart = normalizeTimeHHMM(targetOverride.start) || targetSalonOpen;
            targetEffectiveEnd = normalizeTimeHHMM(targetOverride.end) || targetSalonClose;
          } else if (useCustom) {
            if (!targetBaseDay || targetBaseDay.enabled === false) {
              targetEffectiveEnabled = false;
            } else {
              targetEffectiveStart = normalizeTimeHHMM(targetBaseDay.start) || targetSalonOpen;
              targetEffectiveEnd = normalizeTimeHHMM(targetBaseDay.end) || targetSalonClose;
            }
          }

          const targetHardBlocked = targetEmploymentEnded || targetLeaveActive;
          const targetIntersection =
            !targetHardBlocked && targetSalonEnabled && targetEffectiveEnabled
              ? intersectTimeWindows(
                  targetSalonOpen,
                  targetSalonClose,
                  targetEffectiveStart,
                  targetEffectiveEnd
                )
              : null;
          const targetSourceLabel = targetOverride
            ? "استثناء الموظفة"
            : targetSalonOverride
              ? "ساعات الصالون الخاصة"
              : useCustom
                ? "الجدول الأسبوعي للموظفة"
                : "ساعات تشغيل الصالون";
          const targetSourceNote = targetOverride ? String(targetOverride.note || "").trim() : "";
          const targetImpactNote = targetOverride
            ? targetSourceNote
              ? `أول يوم العودة يتأثر باستثناء الموظفة: ${targetSourceNote}`
              : "أول يوم العودة يتأثر باستثناء الموظفة في هذا التاريخ."
            : targetSalonOverride
              ? "أول يوم العودة يتأثر باستثناء ساعات الصالون في هذا التاريخ."
              : "";

          return {
            dateIso: targetDate,
            dayKey: targetDayKey,
            salonEnabled: targetSalonEnabled,
            salonOpen: targetSalonOpen,
            salonClose: targetSalonClose,
            salonOverride: targetSalonOverride,
            override: targetOverride,
            baseDay: targetBaseDay,
            leaveActive: targetLeaveActive,
            leaveByDate: targetLeaveByDate,
            leaveByWeekday: targetLeaveByWeekday,
            leaveByToggle: targetLeaveByToggle,
            employmentEnded: targetEmploymentEnded,
            effectiveEnabled: targetEffectiveEnabled,
            effectiveStart: targetEffectiveStart,
            effectiveEnd: targetEffectiveEnd,
            intersection: targetIntersection,
            sourceLabel: targetSourceLabel,
            impactNote: targetImpactNote,
          };
        };

        const formatSavedOverrideGroup = (group: StaffWorkingHourOverrideGroup | null) => {
          if (!group) return null;
          const rangeGregorian = formatIsoDateRange(group.fromDate, group.toDate);
          const rangeHijri = formatIsoDateRangeByCalendar(group.fromDate, group.toDate, "hijri");
          const rangeLabel =
            rangeHijri && rangeHijri !== rangeGregorian
              ? `${rangeGregorian} | هجري: ${rangeHijri}`
              : rangeGregorian;
          const modeLabel =
            group.enabled === false
              ? "إغلاق كامل"
              : `ساعات ${formatWindow(
                  normalizeTimeHHMM(group.start) || salonOpen,
                  normalizeTimeHHMM(group.end) || salonClose
                )}`;
          const dayCountLabel =
            group.count > 1 ? `${formatArabicInteger(group.count)} أيام` : "يوم واحد";
          return {
            rangeLabel,
            modeLabel,
            dayCountLabel,
            note: String(group.note || "").trim(),
          };
        };
        const nextSavedOverrideSummary = formatSavedOverrideGroup(nextSavedOverrideGroup);
        const lastSavedOverrideSummary = formatSavedOverrideGroup(lastSavedOverrideGroup);

        const staffBaseWindowLabel = useCustom
          ? baseDay && baseDay.enabled !== false
            ? formatWindow(
                normalizeTimeHHMM(baseDay.start) || salonOpen,
                normalizeTimeHHMM(baseDay.end) || salonClose
              )
            : "مغلق هذا اليوم"
          : formatWindow(salonOpen, salonClose);
        const staffBaseMatchesSalonWeekly = staffBaseWindowLabel === salonWeeklyWindowLabel;

        const staffOverrideLabel = overrideToday
          ? overrideToday.enabled === false
            ? "إغلاق كامل اليوم"
            : formatWindow(
                normalizeTimeHHMM(overrideToday.start) || salonOpen,
                normalizeTimeHHMM(overrideToday.end) || salonClose
              )
          : nextSavedOverrideSummary
            ? nextSavedOverrideSummary.modeLabel
            : lastSavedOverrideSummary
              ? lastSavedOverrideSummary.modeLabel
          : "-";
        const staffBaseDetails = useCustom
          ? baseDay && baseDay.enabled !== false
            ? "الدوام مأخوذ من الجدول الأسبوعي المخصص للموظفة."
            : "اليوم مغلق في جدول الموظفة الأسبوعي المخصص."
          : "لا يوجد جدول أسبوعي مخصص؛ يتم الاعتماد على دوام الصالون الفعلي.";
        const staffOverrideDetails = overrideToday
          ? overrideToday.enabled === false
            ? `تم إغلاق دوام الموظفة بتاريخ ${todayDateLabel}.`
            : `استثناء موظفة فعلي اليوم: ${staffOverrideLabel}.`
          : nextSavedOverrideSummary
            ? `لا يوجد استثناء فعلي اليوم. أقرب استثناء محفوظ (${nextSavedOverrideSummary.dayCountLabel}) من ${nextSavedOverrideSummary.rangeLabel}: ${nextSavedOverrideSummary.modeLabel}${
                nextSavedOverrideSummary.note ? ` | ملاحظة: ${nextSavedOverrideSummary.note}` : ""
              }.`
            : lastSavedOverrideSummary
              ? `لا يوجد استثناء فعلي اليوم. آخر استثناء محفوظ كان (${lastSavedOverrideSummary.dayCountLabel}) في ${lastSavedOverrideSummary.rangeLabel}: ${lastSavedOverrideSummary.modeLabel}${
                  lastSavedOverrideSummary.note ? ` | ملاحظة: ${lastSavedOverrideSummary.note}` : ""
                }.`
          : "لا يوجد استثناء يومي خاص بالموظفة اليوم.";

        const leaveByDate = exceptionalDates.includes(today);
        const leaveByWeekday = weekday ? exceptionalWeekdays.includes(weekday) : false;
        const leaveByToggle =
          !!(staff as any).onLeave && (!leaveUntil || leaveUntil >= today);
        const leaveActiveToday = leaveByDate || leaveByWeekday || leaveByToggle;

        const ended = !!employmentEndDate && today > employmentEndDate;

        let effectiveEnabled = true;
        let effectiveStart = salonOpen;
        let effectiveEnd = salonClose;

        if (overrideToday) {
          effectiveEnabled = overrideToday.enabled !== false;
          effectiveStart = normalizeTimeHHMM(overrideToday.start) || salonOpen;
          effectiveEnd = normalizeTimeHHMM(overrideToday.end) || salonClose;
        } else if (useCustom) {
          if (!baseDay || baseDay.enabled === false) {
            effectiveEnabled = false;
          } else {
            effectiveStart = normalizeTimeHHMM(baseDay.start) || salonOpen;
            effectiveEnd = normalizeTimeHHMM(baseDay.end) || salonClose;
          }
        }
        const hardBlockedToday = ended || leaveActiveToday;
        const intersection =
          !hardBlockedToday && salonEnabled && effectiveEnabled
            ? intersectTimeWindows(salonOpen, salonClose, effectiveStart, effectiveEnd)
            : null;
        const nowInsideWindow =
          !!intersection && isTimeInsideWindow(timeNow, intersection.start, intersection.end);

        const actualNow = ended
          ? "مستبعدة من الحجز (انتهى التوظيف)"
          : leaveActiveToday
            ? "متوقفة اليوم (إجازة)"
            : !salonEnabled
              ? "الحجوزات مغلقة اليوم على مستوى الصالون"
              : !effectiveEnabled
                ? "لا يوجد دوام موظفة اليوم"
                : !intersection
                  ? "لا يوجد تقاطع بين دوام الموظفة ودوام الحجوزات"
                  : nowInsideWindow
                    ? `تعمل الآن: ${formatWindow(intersection.start, intersection.end)}`
                    : `خارج الدوام الآن: ${formatWindow(intersection.start, intersection.end)}`;
        const statusTone: "good" | "warn" | "muted" =
          nowInsideWindow && !!intersection && !ended && !leaveActiveToday
            ? "good"
            : ended || leaveActiveToday || !salonEnabled || !effectiveEnabled || !intersection
              ? "warn"
              : "muted";
        const salonEffectiveDetails = ended
          ? "الموظفة مستبعدة من الحجز بعد انتهاء التوظيف."
          : leaveActiveToday
            ? "الموظفة في إجازة اليوم، لذلك لا يظهر حجز فعلي لها."
            : !salonEnabled
              ? "الحجوزات مغلقة اليوم على مستوى الصالون."
              : !effectiveEnabled
                ? "دوام الموظفة مغلق اليوم."
                : !intersection
                  ? "لا يوجد وقت مشترك بين دوام الصالون ودوام الموظفة."
                  : `المدى المتاح للحجز مع الموظفة: ${formatWindow(intersection.start, intersection.end)}.`;

        const warnings: string[] = [];
        if (leaveByDate) {
          warnings.push(`اليوم ضمن إجازة استثنائية محددة بتاريخ ${todayDateLabel}.`);
        }
        if ((staff as any).onLeave) {
          if (leaveUntil && leaveUntil >= today) {
            warnings.push(`في إجازة من ${fmtIsoDate(today)} إلى ${fmtIsoDate(leaveUntil)}.`);
          } else if (leaveUntil && leaveUntil < today) {
            warnings.push(`انتهت إجازتها بتاريخ ${fmtIsoDate(leaveUntil)}.`);
          } else {
            warnings.push("في إجازة حالياً بدون تاريخ نهاية محدد.");
          }
        }

        const futureExceptional = exceptionalDates.filter((d) => d > today).sort((a, b) => a.localeCompare(b));
        if (futureExceptional.length > 0) {
          const start = futureExceptional[0];
          let end = start;
          for (let i = 1; i < futureExceptional.length; i++) {
            const expectedNext = addDaysIso(end, 1);
            if (futureExceptional[i] === expectedNext) {
              end = futureExceptional[i];
              continue;
            }
            break;
          }
          const diffDays = Math.max(
            0,
            Math.floor(
              (new Date(`${start}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) /
                86400000
            )
          );
          const lead = diffDays <= 14 ? "إجازة قريبة" : "إجازة مجدولة";
          warnings.push(`${lead} تبدأ ${fmtIsoDate(start)} وتنتهي ${fmtIsoDate(end)}.`);
        }

        if (exceptionalWeekdays.length > 0) {
          const weeklyLabels = exceptionalWeekdays.map((d) => weekdayLabel(d));
          if (weeklyLabels.length === 1) {
            warnings.push(`إجازة ثابتة كل ${weeklyLabels[0]}.`);
          } else {
            warnings.push(`إجازة ثابتة كل: ${weeklyLabels.join(" / ")}.`);
          }
        }

        const leaveDaysLabel = exceptionalWeekdays.length
          ? exceptionalWeekdays.map((d) => weekdayLabel(d)).join("، ")
          : "-";
        const leaveDaysDetails = exceptionalWeekdays.length
          ? leaveByWeekday
            ? "اليوم يقع ضمن الإجازة الأسبوعية الثابتة."
            : "اليوم ليس ضمن الإجازة الأسبوعية الثابتة."
          : "لا توجد أيام إجازة أسبوعية ثابتة.";
        const weeklyOffTodayLabel = exceptionalWeekdays.length
          ? `إجازة الموظفة الثابتة: ${exceptionalWeekdays.map((d) => weekdayLabel(d)).join("، ")}`
          : "";
        const finalWindowLabel = hardBlockedToday
          ? leaveByWeekday
            ? "اليوم إجازة أسبوعية ثابتة"
            : "لا يوجد ساعات عمل اليوم"
          : intersection
            ? formatWindow(intersection.start, intersection.end)
            : "مغلق اليوم";
        const operationalState: "working" | "outside" | "closed" =
          nowInsideWindow && !!intersection ? "working" : intersection ? "outside" : "closed";
        const operationalStatusLabel = ended
          ? "خارج الخدمة"
          : leaveActiveToday
            ? "متوقفة اليوم"
            : !intersection
              ? "مغلقة اليوم"
              : nowInsideWindow
                ? "تعمل الآن"
                : "خارج ساعات العمل";
        const reasonLabel = ended
          ? "مغلقة بسبب انتهاء التوظيف"
          : leaveActiveToday
            ? "مغلقة بسبب الإجازة"
            : !salonEnabled
              ? activeSalonOverride?.mode === "closed"
                ? "مغلقة بسبب إغلاق الصالون اليوم"
                : "مغلقة وفق ساعات الصالون"
              : !effectiveEnabled
                ? overrideToday?.enabled === false
                  ? "مغلقة بسبب استثناء الموظفة"
                  : useCustom
                    ? "مغلقة وفق جدول الموظفة الأسبوعي"
                    : "مغلقة وفق جدول الصالون"
                : !intersection
                  ? "مغلقة لعدم وجود وقت مشترك"
                  : overrideToday
                    ? "بناءً على استثناء الموظفة"
                    : useCustom
                      ? "بناءً على جدول الموظفة الأسبوعي"
                      : activeSalonOverride
                        ? "بناءً على ساعات الصالون الخاصة"
                        : "بناءً على جدول الصالون";
        const savedOverrideRows = overrideGroups.map((group, groupIndex) => {
          const tone = group.dates.includes(today)
            ? "active"
            : group.toDate < today
              ? "past"
              : "upcoming";
          const rangeDual = formatIsoDateRangeDual(group.fromDate, group.toDate);
          const weekdaysInGroup = WEEKDAY_OPTIONS.map((x) => x.key).filter((key) =>
            group.dates.some((date) => weekdayFromIso(date) === key)
          ) as WeekdayKey[];
          const appliesToLabel =
            weekdaysInGroup.length === WEEKDAY_OPTIONS.length
              ? "كل الأيام"
              : formatWeekdaySet(weekdaysInGroup);
          return {
            id: group.id,
            tone,
            badge: tone === "active" ? "نشط" : tone === "upcoming" ? "قادم" : "منتهي",
            title: `الاستثناء ${formatArabicInteger(groupIndex + 1)}`,
            gregorianRange: rangeDual.gregorian,
            hijriRange: rangeDual.hijri,
            hoursLabel:
              group.enabled === false
                ? "إغلاق كامل"
                : formatWindow(
                    normalizeTimeHHMM(group.start) || salonOpen,
                    normalizeTimeHHMM(group.end) || salonClose
                  ),
            appliesToLabel,
            note: String(group.note || "").trim(),
            fromDate: group.fromDate,
            toDate: group.toDate,
          };
        });
        const lastTimelineOverrideGroup =
          overrideGroups.length ? overrideGroups[overrideGroups.length - 1] : null;
        const overrideTimelineSummary = lastTimelineOverrideGroup
          ? `آخر استثناء مجدول ينتهي في ${fmtIsoDate(lastTimelineOverrideGroup.toDate)} — ${fmtIsoDateHijri(
              lastTimelineOverrideGroup.toDate
            )}`
          : "";
        const overrideTimelineFallback = lastTimelineOverrideGroup
          ? `بعد ${fmtIsoDate(lastTimelineOverrideGroup.toDate)} (${fmtIsoDateHijri(
              lastTimelineOverrideGroup.toDate
            )}) يعود النظام إلى الجدول الأسبوعي المعتاد ما لم يُضف استثناء جديد.`
          : "";
        const overrideTodayLabel = overrideToday ? staffOverrideLabel : "لا يوجد اليوم";
        const overrideTodayNote = overrideToday
          ? "الاستثناء المطبق اليوم موضح ضمن الجدول الزمني أعلاه."
          : "لا يوجد استثناء موظفة مطبق على هذا اليوم.";
        const hasClosureStatus = ended || leaveActiveToday || !salonEnabled || !effectiveEnabled || !intersection;
        const closureStatusValue = ended
          ? "انتهى التوظيف"
          : leaveActiveToday
            ? "إجازة / توقف"
            : !salonEnabled
              ? "إغلاق على مستوى الصالون"
              : !effectiveEnabled
                ? "إغلاق على مستوى الموظفة"
                : !intersection
                  ? "لا يوجد وقت مشترك"
                  : "لا يوجد إغلاق اليوم";
        const closureStatusNote = ended
          ? "الموظفة غير متاحة للحجز بعد تاريخ انتهاء التوظيف."
          : leaveActiveToday
            ? "متوقفة اليوم بسبب الإجازة أو التعطيل."
            : !salonEnabled
              ? "الحجوزات مغلقة اليوم على مستوى الصالون."
              : !effectiveEnabled
                ? "دوام الموظفة مغلق اليوم."
                : !intersection
                  ? "لا يوجد وقت مشترك بين دوام الموظفة وساعات الصالون."
                  : undefined;
        const reasonStatusValue = ended
          ? "انتهاء التوظيف"
          : leaveActiveToday
            ? "إجازة أو تعطيل"
            : overrideToday
              ? "استثناء الموظفة"
              : useCustom
                ? "الجدول الأسبوعي للموظفة"
                : activeSalonOverride
                  ? activeSalonOverride.mode === "closed"
                    ? "إغلاق الصالون اليوم"
                    : "ساعات الصالون الخاصة"
                  : "ساعات الصالون";
        const bookingAvailabilityValue =
          ended || leaveActiveToday || !salonEnabled || !effectiveEnabled || !intersection
            ? "غير متاح اليوم"
            : "متاح ضمن هذه الفترة";
        const statusRows = [
          {
            label: "السبب",
            value: reasonStatusValue,
          },
          {
            label: "حالة الإغلاق",
            value: hasClosureStatus ? closureStatusValue : "لا يوجد",
          },
          {
            label: "إتاحة الحجز",
            value: bookingAvailabilityValue,
          },
        ];
        const upcomingReturn = (() => {
          if (ended || !!intersection) return null;

          const ongoingLeaveWithoutEnd = leaveByToggle && !leaveUntil;
          if (ongoingLeaveWithoutEnd) {
            return {
              gregorianDate: "غير محدد حتى الآن",
              hijriDate: "بانتظار تحديد نهاية الإجازة",
              windowLabel: "سيُحدد لاحقًا",
              sourceLabel: "بانتظار تحديد نهاية الإجازة",
              availabilityLabel: "الحجز غير متاح حتى يتم تحديد موعد العودة",
              note: "لا يمكن احتساب أول يوم عمل لأن الإجازة الحالية بلا تاريخ نهاية محدد.",
              leaveEndsLabel: "",
            };
          }

          const leaveEndsOn =
            leaveByToggle && leaveUntil && leaveUntil >= today
              ? leaveUntil
              : leaveByDate
                ? today
                : "";
          let cursor =
            leaveByToggle && leaveUntil && leaveUntil >= today ? addDaysIso(leaveUntil, 1) : addDaysIso(today, 1);

          for (let i = 0; i < 120; i++) {
            const candidate = resolveOperationalDay(cursor);
            if (candidate.employmentEnded) break;
            if (candidate.intersection) {
              return {
                gregorianDate: fmtIsoDate(candidate.dateIso),
                hijriDate: fmtIsoDateHijri(candidate.dateIso),
                windowLabel: formatWindow(candidate.intersection.start, candidate.intersection.end),
                sourceLabel: candidate.sourceLabel,
                availabilityLabel: "الحجز سيكون متاحًا ابتداءً من هذا الوقت",
                note: candidate.impactNote,
                leaveEndsLabel: leaveEndsOn
                  ? `${fmtIsoDate(leaveEndsOn)} — ${fmtIsoDateHijri(leaveEndsOn)}`
                  : "",
              };
            }
            cursor = addDaysIso(cursor, 1);
          }

          return {
            gregorianDate: "لا توجد عودة مجدولة",
            hijriDate: "بحسب البيانات الحالية",
            windowLabel: "سيُحدد لاحقًا",
            sourceLabel: "لا توجد ساعات عمل لاحقة ضمن الإعدادات الحالية",
            availabilityLabel: "الحجز غير متاح حتى تتوفر ساعات عمل لاحقة",
            note: "لم يتم العثور على يوم عمل قادم ضمن الجدول الحالي.",
            leaveEndsLabel: leaveEndsOn ? `${fmtIsoDate(leaveEndsOn)} — ${fmtIsoDateHijri(leaveEndsOn)}` : "",
          };
        })();
        const detailRows = [
          {
            label: "الجدول الأسبوعي للموظفة",
            value: staffBaseWindowLabel,
            note: useCustom
              ? "الساعات الأساسية المعتمدة من جدول الموظفة."
              : "لا يوجد جدول أسبوعي مخصص؛ تعتمد الموظفة على ساعات الصالون.",
          },
          {
            label: "ساعات تشغيل الصالون",
            value: salonEffectiveWindowLabel,
            note: activeSalonOverride
              ? "تشمل استثناء الصالون المطبق اليوم."
              : "ساعات التشغيل المعتمدة للصالون اليوم.",
          },
          {
            label: "استثناء الموظفة المطبق اليوم",
            value: overrideTodayLabel,
            note: overrideTodayNote,
          },
          hasClosureStatus
            ? {
                label: "حالة الإغلاق",
                value: closureStatusValue,
                note: closureStatusNote,
              }
            : {
                label: "حالة الإغلاق",
                value: "لا يوجد",
                note: "لا يوجد إغلاق أو تعطيل يؤثر على الدوام اليوم.",
              },
          {
            label: "إتاحة الحجز",
            value: bookingAvailabilityValue,
            note:
              bookingAvailabilityValue === "متاح ضمن هذه الفترة"
                ? `الحجز متاح ضمن ${finalWindowLabel}.`
                : "الحجز غير متاح اليوم بحسب النتيجة النهائية أعلاه.",
          },
        ].filter(Boolean);

        return {
          id: staff.id,
          name: String(staff.name || "-"),
          todayWeekdayLabel: weekdayLabel(weekday),
          todayDateGregorianLabel: `${todayDateGregorian} م`,
          todayDateHijriLabel: `${todayDateHijri} هـ`,
          todayDateCombinedLabel,
          salonWeeklyWindowLabel,
          salonWeeklyDetails,
          salonEffectiveWindowLabel,
          salonEffectiveDetails: `${salonEffectiveBaseDetails} ${salonEffectiveDetails}`,
          salonSourceLabel,
          salonSourceDetails,
          staffBaseWindowLabel,
          staffBaseMatchesSalonWeekly,
          staffBaseDetails,
          staffOverrideLabel,
          staffOverrideDetails,
          leaveDaysLabel,
          leaveDaysDetails,
          weeklyOffToday: leaveByWeekday,
          weeklyOffTodayLabel,
          statusNowLabel: actualNow,
          statusTone,
          operationalState,
          operationalStatusLabel,
          finalWindowLabel,
          reasonLabel,
          statusRows,
          savedOverrideRows,
          overrideTimelineSummary,
          overrideTimelineFallback,
          upcomingReturn,
          detailRows,
          warnings,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [appSettings, list, nowTick, resolveStaffWeeklyOffDays]);

  const editingStaff = useMemo(
    () => (editId ? list.find((x) => x.id === editId) || null : null),
    [editId, list]
  );
  const modalStaffScheduleSummary = useMemo(
    () => (editingStaff ? staffScheduleSummary.find((x) => x.id === editingStaff.id) || null : null),
    [editingStaff, staffScheduleSummary]
  );
  const modalPayrollMonthSummary = useMemo(() => {
    if (!editingStaff) return null;
    const monthStats = bookingStats[editingStaff.id]?.month;
    const cycleMonthKey =
      payrollCycleKeyFromDate(todayIso(), PAYROLL_CLOSE_DAY) ||
      String(monthStats?.key || currentMonthKey());
    const staffCalc: StaffPublicDoc & { id: string } = {
      ...editingStaff,
      id: editingStaff.id,
      name: String(name || editingStaff.name || "").trim() || editingStaff.name || editingStaff.id,
      active: !!active,
      useCustomWorkingHours: !!modalUseCustomWorkingHours,
      customWorkingHours: normalizeWorkingHours(modalCustomWorkingHours),
      customWorkingHourOverrides: normalizeWorkingHourOverrides(modalCustomHourOverrides),
      monthlySalary: safeNonNegativeNumber(monthlySalary, 0),
      overtimeMethod:
        overtimeMethod === "invoice_percentage" ? "invoice_percentage" : "hours_from_salary",
      overtimeDaysPerMonth: Math.max(1, safeNonNegativeNumber(overtimeDaysPerMonth, 30)),
      overtimeBaseHoursPerDay: Math.max(1, safeNonNegativeNumber(overtimeBaseHoursPerDay, 8)),
      overtimeSeasonBaseHoursPerDay: Math.max(
        1,
        safeNonNegativeNumber(overtimeSeasonBaseHoursPerDay, 6)
      ),
      overtimeHoursBasis: overtimeHoursBasis === "season" ? "season" : "regular",
      overtimePercent: safeNonNegativeNumber(overtimePercent, 0),
      overtimeInvoicePercent: safeNonNegativeNumber(overtimeInvoicePercent, 0),
    };
    return computeStaffPayrollForMonth({
      staff: staffCalc as any,
      monthKey: cycleMonthKey,
      appSettings,
      invoiceCount: Number(monthStats?.invoiceCount || 0),
      invoiceRevenue: Number(monthStats?.invoiceRevenue || 0),
    });
  }, [
    editingStaff,
    bookingStats,
    appSettings,
    name,
    active,
    modalUseCustomWorkingHours,
    modalCustomWorkingHours,
    modalCustomHourOverrides,
    monthlySalary,
    overtimeMethod,
    overtimeDaysPerMonth,
    overtimeBaseHoursPerDay,
    overtimeSeasonBaseHoursPerDay,
    overtimeHoursBasis,
    overtimePercent,
    overtimeInvoicePercent,
  ]);
  const modalTabs: Array<{ key: EmployeeModalTab; label: string }> = editingStaff
    ? [
        { key: "basic", label: "البيانات الأساسية" },
        { key: "booking", label: "الحجز والدوام" },
        { key: "services", label: "الخدمات" },
        { key: "profile", label: "الملف" },
        { key: "stats", label: "الإحصائيات والإجازات" },
      ]
    : [
        { key: "basic", label: "البيانات الأساسية" },
        { key: "booking", label: "الحجز والدوام" },
        { key: "services", label: "الخدمات" },
        { key: "profile", label: "الملف" },
      ];
  const modalLeaveExpired = useMemo(() => {
    const leaveUntil = normalizeLeaveUntil(modalLeaveUntil);
    return !!leaveUntil && leaveUntil < todayIso();
  }, [modalLeaveUntil]);
  const modalHourOverrideTargetCount = useMemo(() => {
    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    if (!fromInput) return 0;
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    let cursor = from;
    let guard = 0;
    let count = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed) count += 1;
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > 120) break;
    }
    return count;
  }, [modalHourOverrideFromDate, modalHourOverrideToDate, modalHourOverrideApplyWeekdays, modalHourOverrideMode]);
  const modalHourOverrideExistingTargetCount = useMemo(() => {
    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    if (!fromInput) return 0;
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    const existingDates = new Set(
      modalCustomHourOverrides.map((x) => normalizeLeaveUntil(x.date)).filter((x): x is string => !!x)
    );
    let cursor = from;
    let guard = 0;
    let count = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed && existingDates.has(cursor)) count += 1;
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > 120) break;
    }
    return count;
  }, [
    modalHourOverrideFromDate,
    modalHourOverrideToDate,
    modalHourOverrideApplyWeekdays,
    modalHourOverrideMode,
    modalCustomHourOverrides,
  ]);
  const modalHourOverrideApplyCount = modalHourOverrideUpdateExistingOnly
    ? modalHourOverrideExistingTargetCount
    : modalHourOverrideTargetCount;
  const modalHourOverridePreview = useMemo(() => {
    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    if (!fromInput) return { affectedDays: 0, totalHours: 0, baseHours: 0, diffHours: 0 };
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    const nextEnabled =
      modalHourOverrideQuickMode === "closed" ? false : modalHourOverrideEnabled;
    const nextHours = durationHours(
      nextEnabled,
      normalizeTimeHHMM(modalHourOverrideStart) || "10:00",
      normalizeTimeHHMM(modalHourOverrideEnd) || "22:00"
    );
    const existingDates = new Set(modalCustomHourOverrides.map((x) => x.date));
    let cursor = from;
    let guard = 0;
    let affected = 0;
    let total = 0;
    let base = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed) {
        const canApply = modalHourOverrideUpdateExistingOnly
          ? existingDates.has(cursor)
          : modalHourOverrideApplyMethod === "replace" || !existingDates.has(cursor);
        if (canApply) {
          const baseDay = day ? modalCustomWorkingHours[day] : undefined;
          const baseEnabled = (baseDay?.enabled ?? true) !== false;
          const baseStart = normalizeTimeHHMM(baseDay?.start) || "10:00";
          const baseEnd = normalizeTimeHHMM(baseDay?.end) || "22:00";
          base += durationHours(baseEnabled, baseStart, baseEnd);
          total += nextHours;
          affected += 1;
        }
      }
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > 120) break;
    }
    return { affectedDays: affected, totalHours: total, baseHours: base, diffHours: total - base };
  }, [
    modalHourOverrideFromDate,
    modalHourOverrideToDate,
    modalHourOverrideMode,
    modalHourOverrideQuickMode,
    modalHourOverrideEnabled,
    modalHourOverrideStart,
    modalHourOverrideEnd,
    modalHourOverrideApplyWeekdays,
    modalHourOverrideApplyMethod,
    modalHourOverrideUpdateExistingOnly,
    modalCustomHourOverrides,
    modalCustomWorkingHours,
  ]);
  const modalHourOverrideGroups = useMemo(
    () => buildWorkingHourOverrideGroups(modalCustomHourOverrides),
    [modalCustomHourOverrides]
  );

  const updateModalWorkingDay = (
    day: WeekdayKey,
    patch: Partial<StaffWorkingDay>
  ) => {
    setModalCustomWorkingHours((prev) => ({
      ...prev,
      [day]: {
        ...(prev[day] || { enabled: true, start: "10:00", end: "22:00" }),
        ...patch,
      },
    }));
  };
  const copyModalWorkingDayToAll = (sourceDay: WeekdayKey) => {
    setModalCustomWorkingHours((prev) => {
      const sourceRaw = prev[sourceDay] || { enabled: true, start: "10:00", end: "22:00" };
      const source: StaffWorkingDay = {
        enabled: sourceRaw.enabled !== false,
        start: normalizeTimeHHMM(sourceRaw.start) || "10:00",
        end: normalizeTimeHHMM(sourceRaw.end) || "22:00",
      };
      const next = { ...prev };
      WEEKDAY_OPTIONS.forEach((d) => {
        next[d.key] = { ...source };
      });
      return next;
    });
  };

  const toggleModalHourOverrideWeekday = (day: WeekdayKey) => {
    setModalHourOverrideApplyWeekdays((prev) =>
      prev.includes(day) ? prev.filter((x) => x !== day) : [...prev, day]
    );
  };

  const setModalHourOverrideFromGregorian = (next: string) => {
    const iso = normalizeLeaveUntil(next);
    setModalHourOverrideFromDate(iso);
    if (modalHourOverrideEditingDate || modalHourOverrideMode === "single") {
      setModalHourOverrideToDate(iso);
    }
  };

  const setModalHourOverrideToGregorian = (next: string) => {
    const iso = normalizeLeaveUntil(next);
    setModalHourOverrideToDate(iso);
    if (
      iso &&
      !normalizeLeaveUntil(modalHourOverrideEditingDate) &&
      modalHourOverrideMode === "single"
    ) {
      setModalHourOverrideMode("range");
    }
  };

  const openModalHourOverrideHijriPicker = (target: "from" | "to") => {
    const baseIso =
      target === "from"
        ? normalizeLeaveUntil(modalHourOverrideFromDate) || todayIso()
        : normalizeLeaveUntil(modalHourOverrideToDate) ||
          normalizeLeaveUntil(modalHourOverrideFromDate) ||
          todayIso();
    setModalHourOverrideHijriPickerTarget(target);
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(baseIso));
    setModalHourOverrideHijriPickerOpen(true);
    setErrorMsg("");
  };

  const applyModalHourOverrideHijriPick = (iso: string) => {
    const dateIso = normalizeLeaveUntil(iso);
    if (!dateIso) return;
    if (modalHourOverrideHijriPickerTarget === "from") {
      setModalHourOverrideFromGregorian(dateIso);
    } else {
      setModalHourOverrideToGregorian(dateIso);
    }
    setModalHourOverrideHijriPickerOpen(false);
    setErrorMsg("");
  };

  const applyModalHourOverrideHijriInput = (
    target: "from" | "to",
    raw: string,
    commit = false
  ) => {
    const nextRaw = String(raw || "");
    if (target === "from") setModalHourOverrideFromDateHijri(nextRaw);
    else setModalHourOverrideToDateHijri(nextRaw);

    const parsed = parseHijriDateInput(nextRaw);
    if (!parsed) {
      if (commit && nextRaw.trim()) {
        setErrorMsg("صيغة التاريخ الهجري يجب أن تكون: يوم/شهر/سنة (مثال: 09/09/1447).");
      }
      return;
    }
    const iso = isoFromHijriDateParts(parsed);
    if (!iso) {
      if (commit) {
        setErrorMsg("تعذر تحويل التاريخ الهجري. تأكد من إدخال تاريخ هجري صحيح.");
      }
      return;
    }
    if (target === "from") setModalHourOverrideFromGregorian(iso);
    else setModalHourOverrideToGregorian(iso);
    if (commit) setErrorMsg("");
  };

  const setModalHourOverrideRangeFromExisting = () => {
    const rows = normalizeWorkingHourOverrides(modalCustomHourOverrides);
    if (!rows.length) {
      setErrorMsg("لا توجد استثناءات حالية لتعديلها.");
      return false;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];

    // Prefill by the most repeated schedule pattern among existing overrides.
    const patternMap = new Map<string, { count: number; row: StaffWorkingHourOverride }>();
    rows.forEach((row) => {
      const enabled = row.enabled !== false;
      const start = normalizeTimeHHMM(row.start) || "10:00";
      const end = normalizeTimeHHMM(row.end) || "22:00";
      const key = `${enabled ? "1" : "0"}|${start}|${end}`;
      const cur = patternMap.get(key);
      if (cur) {
        patternMap.set(key, { count: cur.count + 1, row: cur.row });
      } else {
        patternMap.set(key, { count: 1, row: { date: row.date, enabled, start, end } });
      }
    });
    let seed = first;
    let maxCount = -1;
    patternMap.forEach((entry) => {
      if (entry.count > maxCount) {
        maxCount = entry.count;
        seed = entry.row;
      }
    });

    // Reset stale draft filters so "edit existing only" always targets the saved overrides.
    setModalHourOverrideEditingGroupId("");
    setModalHourOverrideEditingDate("");
    setModalHourOverrideFromDate(first.date);
    setModalHourOverrideToDate(last.date);
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(first.date));
    setModalHourOverrideMode(first.date === last.date ? "single" : "range");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideEnabled(seed.enabled !== false);
    setModalHourOverrideStart(normalizeTimeHHMM(seed.start) || "10:00");
    setModalHourOverrideEnd(normalizeTimeHHMM(seed.end) || "22:00");
    setModalHourOverrideNote(String(seed.note || "").trim());
    setModalHourOverrideUpdateExistingOnly(true);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideApplyWeekdays([]);
    return true;
  };

  const fillModalHourOverrideFromBaseDay = () => {
    const baseDate = normalizeLeaveUntil(modalHourOverrideFromDate) || todayIso();
    const dayKey = weekdayFromIso(baseDate);
    if (!dayKey) return;
    let enabled = true;
    let start = DEFAULT_OPEN_TIME;
    let end = DEFAULT_CLOSE_TIME;

    if (modalUseCustomWorkingHours) {
      const row = modalCustomWorkingHours[dayKey];
      if (row) {
        enabled = row.enabled !== false;
        start = normalizeTimeHHMM(row.start) || start;
        end = normalizeTimeHHMM(row.end) || end;
      }
    } else {
      const booking = (appSettings as any)?.booking || {};
      const businessHours = (booking as any)?.businessHours || {};
      const row = (businessHours as any)?.[dayKey];
      if (row) {
        enabled = row.enabled !== false;
        start = normalizeTimeHHMM(row.start) || start;
        end = normalizeTimeHHMM(row.end) || end;
      }
    }

    setModalHourOverrideEnabled(enabled);
    setModalHourOverrideStart(start);
    setModalHourOverrideEnd(end);
  };

  const cancelModalWorkingHourOverrideEdit = () => {
    setModalHourOverrideEditingGroupId("");
    setModalHourOverrideEditingDate("");
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideApplyWeekdays([]);
  };

  const startModalWorkingHourOverrideGroupEdit = (group: StaffWorkingHourOverrideGroup) => {
    if (!group) return;
    setModalHourOverrideEditingGroupId(group.id);
    setModalHourOverrideEditingDate("");
    setModalHourOverrideFromDate(group.fromDate);
    setModalHourOverrideToDate(group.toDate);
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(group.fromDate));
    setModalHourOverrideEnabled(group.enabled !== false);
    setModalHourOverrideStart(normalizeTimeHHMM(group.start) || "10:00");
    setModalHourOverrideEnd(normalizeTimeHHMM(group.end) || "22:00");
    setModalHourOverrideMode(group.fromDate === group.toDate ? "single" : "range");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote(String(group.note || "").trim());
    setModalHourOverrideApplyWeekdays([]);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideUpdateExistingOnly(true);
  };

  const removeModalWorkingHourOverrideGroup = (group: StaffWorkingHourOverrideGroup) => {
    const targetDates = new Set(
      (group?.dates || [])
        .map((d) => normalizeLeaveUntil(d))
        .filter((d): d is string => !!d)
    );
    if (!targetDates.size) return;
    setModalCustomHourOverrides((prev) =>
      prev.filter((x) => !targetDates.has(normalizeLeaveUntil(x.date)))
    );

    const editingDate = normalizeLeaveUntil(modalHourOverrideEditingDate);
    if (editingDate && targetDates.has(editingDate)) {
      cancelModalWorkingHourOverrideEdit();
      return;
    }

    if (!editingDate && modalHourOverrideUpdateExistingOnly) {
      const from = normalizeLeaveUntil(modalHourOverrideFromDate);
      const to = normalizeLeaveUntil(modalHourOverrideToDate) || from;
      if ((from && targetDates.has(from)) || (to && targetDates.has(to))) {
        cancelModalWorkingHourOverrideEdit();
      }
    }
  };

  const buildModalWorkingHourOverrides = (
    sourceOverrides: StaffWorkingHourOverride[]
  ): { next: StaffWorkingHourOverride[]; appliedCount: number; error?: string } => {
    const base = normalizeWorkingHourOverrides(sourceOverrides);
    const editingDate = normalizeLeaveUntil(modalHourOverrideEditingDate);
    if (editingDate) {
      const targetDate = normalizeLeaveUntil(modalHourOverrideFromDate) || editingDate;
      const start = normalizeTimeHHMM(modalHourOverrideStart) || "10:00";
      const end = normalizeTimeHHMM(modalHourOverrideEnd) || "22:00";
      const note = String(modalHourOverrideNote || "").trim() || undefined;
      return {
        next: normalizeWorkingHourOverrides([
          ...base.filter((x) => x.date !== editingDate && x.date !== targetDate),
          {
            date: targetDate,
            enabled: modalHourOverrideQuickMode === "closed" ? false : modalHourOverrideEnabled,
            start,
            end,
            ...(note ? { note } : {}),
          },
        ]),
        appliedCount: 1,
      };
    }

    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    if (!fromInput) return { next: base, appliedCount: 0 };
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    const start = normalizeTimeHHMM(modalHourOverrideStart) || "10:00";
    const end = normalizeTimeHHMM(modalHourOverrideEnd) || "22:00";
    const note = String(modalHourOverrideNote || "").trim() || undefined;
    const maxDays = 120;
    const rows: StaffWorkingHourOverride[] = [];
    let cursor = from;
    let guard = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed) {
        const rowStart = start;
        let rowEnd = end;
        let rowEnabled = modalHourOverrideEnabled;
        if (modalHourOverrideQuickMode === "closed") {
          rowEnabled = false;
        } else if (modalHourOverrideQuickMode === "plus1" || modalHourOverrideQuickMode === "plus2") {
          const plusMin = modalHourOverrideQuickMode === "plus1" ? 60 : 120;
          rowEnd = minutesToHHMM(toMinutes(end) + plusMin);
        }
        rows.push({
          date: cursor,
          enabled: rowEnabled,
          start: rowStart,
          end: rowEnd,
          ...(note ? { note } : {}),
        });
      }
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > maxDays) {
        return { next: base, appliedCount: 0, error: "نطاق التاريخ كبير جداً. الحد الأقصى 120 يوم." };
      }
    }
    if (rows.length === 0) {
      return { next: base, appliedCount: 0, error: "لا يوجد أيام مطابقة للفلاتر المختارة داخل النطاق." };
    }

    const rowsToApply = modalHourOverrideUpdateExistingOnly
      ? rows.filter((r) => base.some((x) => x.date === r.date))
      : rows;
    if (modalHourOverrideUpdateExistingOnly && rowsToApply.length === 0) {
      return { next: base, appliedCount: 0, error: "لا يوجد استثناءات حالية مطابقة للنطاق/الفلاتر لتعديلها." };
    }

    if (modalHourOverrideUpdateExistingOnly || modalHourOverrideApplyMethod === "replace") {
      return {
        next: normalizeWorkingHourOverrides([
          ...base.filter((x) => !rowsToApply.some((r) => r.date === x.date)),
          ...rowsToApply,
        ]),
        appliedCount: rowsToApply.length,
      };
    }

    const existing = new Set(base.map((x) => x.date));
    const toAdd = rowsToApply.filter((r) => !existing.has(r.date));
    return {
      next: normalizeWorkingHourOverrides([...base, ...toAdd]),
      appliedCount: toAdd.length,
    };
  };

  const addModalWorkingHourOverride = () => {
    const result = buildModalWorkingHourOverrides(modalCustomHourOverrides);
    if (result.error) {
      setErrorMsg(result.error);
      return;
    }
    if (result.appliedCount <= 0) {
      return;
    }
    setModalCustomHourOverrides(result.next);
    if (
      normalizeLeaveUntil(modalHourOverrideEditingDate) ||
      String(modalHourOverrideEditingGroupId || "").trim()
    ) {
      cancelModalWorkingHourOverrideEdit();
      return;
    }
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideEditingDate("");
    setModalHourOverrideEditingGroupId("");
    setModalHourOverrideUpdateExistingOnly(false);
  };

  const applyLeaveChange = async (mode: "add" | "deduct") => {
    if (!authUser || !editingStaff || !ensureCanManageLeaveBalance()) return;
    const days = parsePositiveInt(leaveAdjustDays, 0);
    if (days <= 0) {
      setErrorMsg("اكتب عدد أيام صحيح.");
      return;
    }
    const opDate = String(leaveAdjustDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opDate)) {
      setErrorMsg("اختر تاريخ العملية.");
      return;
    }

    setSaving(true);
    setErrorMsg("");
    try {
      const result = await applyStaffLeaveEntryWithBalanceAdjustment({
        staffId: editingStaff.id,
        actionType: mode,
        days,
        opDate,
        note: leaveAdjustNote.trim(),
        actor: {
          uid: authUser.uid,
          role: authUser.role,
          displayName: authUser.displayName,
          email: authUser.email,
        },
      });

      setList((prev) =>
        prev.map((r) =>
          r.id === editingStaff.id
            ? ({
                ...r,
                leaveBalanceDays: result.leaveBalanceDays,
                leaveEntries: result.leaveEntries,
              } as StaffPublicUi)
            : r
        )
      );

      setLeaveAdjustDays("1");
      setLeaveAdjustNote("");

      void writeAuditLog({
        action: "employee_updated",
        entityType: "employee",
        entityId: editingStaff.id,
        source: "dashboard",
        description: mode === "add" ? "إضافة رصيد إجازة للموظفة" : "خصم رصيد إجازة من الموظفة",
        before: { leaveBalanceDays: result.previousBalance },
        after: { leaveBalanceDays: result.leaveBalanceDays },
        meta: {
          leaveAction: mode,
          days,
          changeAmount: result.createdEntry.changeAmount,
          balanceBefore: result.createdEntry.balanceBefore,
          balanceAfter: result.createdEntry.balanceAfter,
          opDate,
          staffName: editingStaff.name,
        },
      });
    } catch (e) {
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر حفظ حركة الإجازة."));
    } finally {
      setSaving(false);
    }
  };

  const deleteLeaveEntry = async (entry: LeaveEntry) => {
    if (!authUser || !editingStaff || !ensureCanManageLeaveBalance()) return;
    if (!String(entry?.id || "").trim()) {
      setErrorMsg("تعذر تحديد سجل الإجازة المطلوب.");
      return;
    }

    const ok = confirm("هل أنت متأكد من حذف هذا السجل؟ سيتم تعديل رصيد الإجازات تلقائيًا.");
    if (!ok) return;

    setSaving(true);
    setErrorMsg("");
    try {
      const result = await deleteStaffLeaveEntryWithBalanceAdjustment({
        staffId: editingStaff.id,
        entryId: entry.id,
        actor: {
          uid: authUser.uid,
          role: authUser.role,
          displayName: authUser.displayName,
          email: authUser.email,
        },
      });

      setList((prev) =>
        prev.map((row) =>
          row.id === editingStaff.id
            ? ({
                ...row,
                leaveBalanceDays: result.leaveBalanceDays,
                leaveEntries: result.leaveEntries,
              } as StaffPublicUi)
            : row
        )
      );

      void writeAuditLog({
        action: "employee_updated",
        entityType: "employee",
        entityId: editingStaff.id,
        source: "dashboard",
        description: "حذف حركة من سجل الإجازات للموظفة",
        before: { leaveBalanceDays: result.previousBalance },
        after: { leaveBalanceDays: result.leaveBalanceDays },
        meta: {
          leaveAction: normalizeLeaveEntryType(result.deletedEntry.type) || String(result.deletedEntry.type || ""),
          deletedLeaveEntryId: result.deletedEntry.id,
          days: result.deletedEntry.days,
          changeAmount: result.deletedEntry.changeAmount,
          reversedChangeAmount: result.reversedChangeAmount,
          balanceBefore: result.deletedEntry.balanceBefore,
          balanceAfter: result.deletedEntry.balanceAfter,
          opDate: result.deletedEntry.date,
          staffName: editingStaff.name,
          softDeleted: true,
        },
      });
    } catch (e) {
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر حذف حركة الإجازة."));
    } finally {
      setSaving(false);
    }
  };

  const saveEntitlementDate = async () => {
    if (!editingStaff || !ensureCanManageLeaveBalance()) return;
    const d = String(leaveEntitlementDate || "").trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setErrorMsg("تاريخ الاستحقاق غير صحيح.");
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      await updateDoc(staffPublicDoc(editingStaff.id), {
        leaveEntitlementDate: d || "",
        updatedAt: serverTimestamp(),
      } as any);
      setList((prev) =>
        prev.map((r) => (r.id === editingStaff.id ? ({ ...r, leaveEntitlementDate: d } as StaffPublicUi) : r))
      );
    } catch (e) {
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر حفظ تاريخ الاستحقاق."));
    } finally {
      setSaving(false);
    }
  };

  if (!authUser) {
    return (
      <div className="emp-page-wrapper">
        <div className="container">
          <div className="dash-card">
            <h3>غير مصرح</h3>
            <p>سجّل دخول ثم جرّب.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!canAccessEmployeesDashboard) {
    return (
      <div className="emp-page-wrapper">
        <div className="container">
          <div className="dash-card">
            <h3>صلاحيات غير كافية</h3>
            <p>هذه الصفحة للإدارة فقط.</p>
          </div>
        </div>
      </div>
    );
  }

  const openCreateEmployee = () => {
    resetForm();
    setIsOpen(true);
  };
  const handleSplitTabChange = (tab: EmployeeSplitTab) => {
    setActiveTab(tab);
    if (tab === "payroll") {
      setActiveStatsSubTab("payroll");
      setModalTab("stats");
      return;
    }
    if (tab === "stats") {
      setActiveStatsSubTab("stats");
      setModalTab("stats");
      return;
    }
    setModalTab(tab);
  };
  const handleCancelEdit = () => {
    const currentTab = activeTab;
    const currentModalTab = modalTab;
    const currentStatsTab = activeStatsSubTab;
    if (selectedEmployee) {
      openEdit(selectedEmployee);
      setActiveTab(currentTab);
      setModalTab(currentModalTab);
      setActiveStatsSubTab(currentStatsTab);
    }
    setMode("view");
  };
  const modalOverrideEditor = {
    modalHourOverrideMode,
    modalHourOverrideEditingDate,
    modalHourOverrideEditingGroupId,
    modalHourOverrideQuickMode,
    modalHourOverrideUpdateExistingOnly,
    modalHourOverrideCalendar,
    modalHourOverrideHijriPickerOpen,
    modalHourOverrideHijriMonthTitle,
    modalHourOverrideHijriWeekOffset,
    modalHourOverrideHijriMonthDays,
    modalHourOverrideHijriPickerTarget,
    modalHourOverrideFromDate,
    modalHourOverrideToDate,
    modalHourOverrideFromDateHijri,
    modalHourOverrideToDateHijri,
    modalHourOverrideEnabled,
    modalHourOverrideStart,
    modalHourOverrideEnd,
    modalHourOverrideNote,
    modalHourOverridePreview,
    modalHourOverrideApplyWeekdays,
    modalHourOverrideApplyCount,
    modalHourOverrideOverwriteExisting,
    modalCustomHourOverrides,
    modalHourOverrideGroups,
    setModalHourOverrideEditingGroupId,
    setModalHourOverrideMode,
    fillModalHourOverrideFromBaseDay,
    setModalHourOverrideQuickMode,
    setModalHourOverrideEnabled,
    setModalHourOverrideStart,
    setModalHourOverrideEnd,
    setModalHourOverrideApplyMethod,
    setModalHourOverrideOverwriteExisting,
    setModalHourOverrideUpdateExistingOnly,
    setModalHourOverrideCalendar,
    setModalHourOverrideHijriPickerOpen,
    applyModalHourOverrideHijriInput,
    openModalHourOverrideHijriPicker,
    setModalHourOverrideFromGregorian,
    setModalHourOverrideToGregorian,
    setModalHourOverrideHijriViewMonthISO,
    applyModalHourOverrideHijriPick,
    setModalHourOverrideNote,
    addModalWorkingHourOverride,
    cancelModalWorkingHourOverrideEdit,
    toggleModalHourOverrideWeekday,
    startModalWorkingHourOverrideGroupEdit,
    removeModalWorkingHourOverrideGroup,
    setModalCustomHourOverrides,
    setModalHourOverrideRangeFromExisting,
    shiftHijriMonthStartIso,
  };
  const modalLeaveEntries = Array.isArray((editingStaff as any)?.leaveEntries)
    ? ((editingStaff as any).leaveEntries as LeaveEntry[])
    : [];

  return (
    <div className="emp-page-wrapper">
      <div className="container">
        <div className="dash-topbar dash-topbar--sticky">
          <div className="dash-topbar-title">
            <h2>
              <FontAwesomeIcon icon={faUserTie} /> إدارة الموظفات
            </h2>
            <p className="dash-sub">
              المصدر: <b>salons/main/staff_public</b>
            </p>
          </div>

          <div className="dash-topbar-actions">
            {authUser?.role === "owner" && (
              <button
                className="exp-btn ghost"
                onClick={fixBookingsEmployeeUid}
                title="إصلاح الحجوزات"
              >
                🔧 إصلاح
              </button>
            )}
            <button
              className="exp-btn"
              onClick={() => void reloadData()}
              disabled={busy}
              type="button"
            >
              <FontAwesomeIcon icon={faRotateRight} /> تحديث
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="alert alert-danger mt-3" style={{ borderRadius: 14 }}>
            {errorMsg}
          </div>
        )}

        <div className="emp-split-shell mt-3">
          <div className="emp-split-col emp-split-col--list">
            <EmployeeListPanel
              qText={qText}
              onlyActive={onlyActive}
              specialtyFilter={specialtyFilter}
              serviceOptions={serviceOptions}
              sectionOptions={sectionOptions}
              filtered={filtered}
              loading={loading}
              statsLoading={statsLoading}
              bookingStats={bookingStats}
              selectedEmployeeId={selectedEmployeeId}
              onQTextChange={setQText}
              onOnlyActiveChange={setOnlyActive}
              onSpecialtyFilterChange={setSpecialtyFilter}
              onCreateEmployee={openCreateEmployee}
              onOpenEmployee={openEdit}
            />
          </div>

          <EmployeeDetailShell
            selectedEmployeeId={selectedEmployeeId}
            selectedEmployee={selectedEmployee}
            selectedEmployeeStatusLabel={selectedEmployeeStatusLabel}
            selectedEmployeeStatusClass={selectedEmployeeStatusClass}
            mode={mode}
            busy={busy}
            activeTab={activeTab}
            onSave={save}
            onStartEdit={() => setMode("edit")}
            onDelete={() => selectedEmployeeId && remove(selectedEmployeeId)}
            onCancelEdit={handleCancelEdit}
            onTabChange={handleSplitTabChange}
          >
            <EmployeeEditorModal
              isOpen={isOpen}
              selectedEmployeeId={selectedEmployeeId}
              mode={mode}
              busy={busy}
              saving={saving}
              editId={editId}
              editingStaff={editingStaff}
              name={name}
              modalTab={modalTab}
              modalTabs={modalTabs}
              onClose={closeModal}
              onSave={save}
              onModalTabChange={setModalTab}
            >
              <ScheduleSummarySection
                isVisible={modalTab === "basic"}
                nowTick={nowTick}
                summary={modalStaffScheduleSummary}
              />
              <EmployeeStatsSection
                isVisible={!!editingStaff && modalTab === "stats"}
                busy={busy}
                loading={loading}
                authRole={authUser?.role}
                leaveBalanceDays={parsePositiveInt(String((editingStaff as any)?.leaveBalanceDays || 0), 0)}
                leaveEntries={modalLeaveEntries}
                showPayrollSubTab={showPayrollSubTab}
                showStatsSubTab={showStatsSubTab}
                currentMonthKeyLabel={currentMonthKey()}
                payroll={{
                  monthlySalary,
                  overtimeMethod,
                  overtimeDaysPerMonth,
                  overtimeBaseHoursPerDay,
                  overtimeSeasonBaseHoursPerDay,
                  overtimeHoursBasis,
                  overtimePercent,
                  overtimeInvoicePercent,
                  summary: modalPayrollMonthSummary,
                  onMonthlySalaryChange: setMonthlySalary,
                  onOvertimeMethodChange: setOvertimeMethod,
                  onOvertimeDaysPerMonthChange: setOvertimeDaysPerMonth,
                  onOvertimeBaseHoursPerDayChange: setOvertimeBaseHoursPerDay,
                  onOvertimeSeasonBaseHoursPerDayChange: setOvertimeSeasonBaseHoursPerDay,
                  onOvertimeHoursBasisChange: setOvertimeHoursBasis,
                  onOvertimePercentChange: setOvertimePercent,
                  onOvertimeInvoicePercentChange: setOvertimeInvoicePercent,
                }}
                leave={{
                  modalOnLeave,
                  modalLeaveUntil,
                  modalLeaveNote,
                  modalLeaveWeekdayDraft,
                  modalExceptionalLeaveWeekdays,
                  modalLeaveExpired,
                  leaveEntitlementDate,
                  leaveAdjustDays,
                  leaveAdjustDate,
                  leaveAdjustNote,
                  onModalOnLeaveChange: setModalOnLeave,
                  onModalLeaveUntilChange: setModalLeaveUntil,
                  onModalLeaveNoteChange: setModalLeaveNote,
                  onModalLeaveWeekdayDraftChange: setModalLeaveWeekdayDraft,
                  onModalExceptionalLeaveWeekdaysChange: setModalExceptionalLeaveWeekdays,
                  onLeaveEntitlementDateChange: setLeaveEntitlementDate,
                  onLeaveAdjustDaysChange: setLeaveAdjustDays,
                  onLeaveAdjustDateChange: setLeaveAdjustDate,
                  onLeaveAdjustNoteChange: setLeaveAdjustNote,
                  onSaveEntitlementDate: () => {
                    void saveEntitlementDate();
                  },
                  onApplyLeaveChange: (leaveMode) => {
                    void applyLeaveChange(leaveMode);
                  },
                  onDeleteLeaveEntry: (entry) => {
                    void deleteLeaveEntry(entry);
                  },
                }}
              />
              <BasicInfoSection
                isVisible={modalTab === "basic"}
                name={name}
                active={active}
                showOnAbout={showOnAbout}
                showOnBooking={showOnBooking}
                weeklyOffLabel={
                  modalExceptionalLeaveWeekdays.length
                    ? modalExceptionalLeaveWeekdays.map((day) => WEEKDAY_OPTIONS.find((item) => item.key === day)?.label || day).join("، ")
                    : "لا توجد إجازة أسبوعية ثابتة."
                }
                onNameChange={setName}
                onActiveChange={setActive}
                onShowOnAboutChange={setShowOnAbout}
                onShowOnBookingChange={setShowOnBooking}
              />
              <BookingSettingsSection
                isVisible={modalTab === "booking"}
                busy={busy}
                loading={loading}
                employmentEndDate={employmentEndDate}
                modalUseCustomWorkingHours={modalUseCustomWorkingHours}
                modalCustomWorkingHours={modalCustomWorkingHours}
                modalHourOverrideHijriPickerRef={modalHourOverrideHijriPickerRef}
                overrideEditor={modalOverrideEditor}
                onEmploymentEndDateChange={setEmploymentEndDate}
                onModalUseCustomWorkingHoursChange={setModalUseCustomWorkingHours}
                onUpdateModalWorkingDay={updateModalWorkingDay}
                onCopyModalWorkingDayToAll={copyModalWorkingDayToAll}
              />
              <ProfileSection
                isVisible={modalTab === "profile"}
                avatarUrl={avatarUrl}
                bio={bio}
                cvUrl={cvUrl}
                staffImageOptions={STAFF_IMAGE_OPTIONS}
                resolveAvatarFromAssets={resolveAvatarFromAssets}
                onAvatarUrlChange={setAvatarUrl}
                onBioChange={setBio}
                onCvUrlChange={setCvUrl}
              />
              <ServicesSection
                isVisible={modalTab === "services"}
                srvQ={srvQ}
                srvSection={srvSection}
                sectionOptions={sectionOptions}
                filteredServicesForPicks={filteredServicesForPicks}
                specialties={specialties}
                onSrvQChange={setSrvQ}
                onSrvSectionChange={setSrvSection}
                onToggleSpecialty={toggleSpecialty}
              />
            </EmployeeEditorModal>
          </EmployeeDetailShell>
        </div>
      </div>
    </div>
  );
}
