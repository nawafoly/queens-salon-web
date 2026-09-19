import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CoreInventoryService,
  type InventoryItem,
  type PendingServiceConsumption,
  type ServiceConsumptionLifecycle,
  type ServiceRecipeLine,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";
import {
  CoreBookingService,
  type CoreStaffPortalBooking,
} from "../services/CoreBookingService";
import type { HrSession } from "./hr/shared";
import { useEmployeePortalLanguage } from "../features/employee-portal/EmployeePortalLanguage";

const bookingCopy = {
  ar: {
    loadError: "تعذر تأكيد الاستهلاك.", success: "تم تأكيد الاستهلاك وخصم المخزون.", client: "عميلة", source: "المصدر", previewOnly: "للمعاينة فقط — لا يمكن التأكيد قبل يوم الخدمة", sticky: "يبقى حتى التأكيد — لا يمكن الإغلاق دون معالجة", none: "لا يوجد.", loadingBookings: "جاري تحميل حجوزاتك...", subtitle: "حجوزاتك اليوم والمتأخرة", title: "حجوزاتي", overdueAlert: "لديك حجوزات متأخرة بدون تأكيد مواد", overdueTail: "بند استهلاك دون تأكيد. المهمة لا تُغلق إلا بعد المعالجة — بدون خصم وهمي.", todayBookings: "حجوزات اليوم", noneToday: "لا يوجد مطلوب اليوم.", awaiting: "بانتظار التأكيد", noneAwaiting: "لا يوجد بانتظار التأكيد.", overdue: "متأخرة", noneOverdue: "لا يوجد متأخر.", upcoming: "قادمة", materials: "مواد هذا الحجز", upcomingPrefix: "هذا البند قادم في", confirmRule: "التأكيد يتاح بعد بدء تنفيذ الخدمة أو إذا أصبح الحجز متأخرًا.", loadingRecipe: "جاري تحميل الوصفة...", product: "المنتج", default: "الافتراضي", quantity: "الكمية", noRecipe: "لا توجد مواد قابلة للتأكيد في وصفة هذه الخدمة.", confirming: "جاري التأكيد...", unavailable: "التأكيد غير متاح قبل بدء تنفيذ الخدمة", confirm: "تأكيد المواد وخصم المخزون", bookingWorkspace: "مسار تنفيذ الحجوزات", bookingWorkspaceHint: "اختاري الحجز ثم نفّذي المواد المطلوبة قبل إكماله.", noActiveBookings: "لا توجد حجوزات مفتوحة حاليًا.", bookingStatus: "حالة الحجز", pendingBooking: "بانتظار التأكيد", bookedBooking: "مؤكد للحجز", confirmedBooking: "مؤكد", completedBooking: "مكتمل", cancelledBooking: "ملغي", confirmBooking: "تأكيد الحجز", confirmingBooking: "جاري تأكيد الحجز...", completeBooking: "إكمال الحجز", completingBooking: "جاري إكمال الحجز...", bookingConfirmed: "تم تأكيد الحجز وأصبح جاهزًا للتنفيذ.", bookingCompleted: "تم إكمال الحجز بنجاح.", materialsRemaining: "لا يزال هناك مواد تحتاج تأكيد قبل إكمال الحجز.", executionNotStarted: "لا يمكن إكمال الحجز قبل بدء جميع الخدمات.", readyToComplete: "تمت معالجة المواد المطلوبة ويمكن إكمال الحجز.", services: "الخدمات",
    UPCOMING: "قادم", DUE_TODAY: "مطلوب اليوم", PENDING_CONFIRMATION: "بانتظار التأكيد", OVERDUE: "متأخر", CONFIRMED: "مؤكد",
  },
  en: {
    loadError: "Could not confirm material consumption.", success: "Consumption confirmed and inventory deducted.", client: "Client", source: "Source", previewOnly: "Preview only — confirmation is unavailable before the service date", sticky: "Remains open until confirmed — it cannot be closed without action", none: "None.", loadingBookings: "Loading your bookings...", subtitle: "Today’s and overdue bookings", title: "My Bookings", overdueAlert: "You have overdue bookings without material confirmation", overdueTail: "consumption items are unconfirmed. The task stays open until handled — no automatic deduction.", todayBookings: "Today’s bookings", noneToday: "Nothing is due today.", awaiting: "Awaiting confirmation", noneAwaiting: "Nothing is awaiting confirmation.", overdue: "Overdue", noneOverdue: "Nothing is overdue.", upcoming: "Upcoming", materials: "Materials for this booking", upcomingPrefix: "This item is scheduled for", confirmRule: "Confirmation becomes available after service execution starts or when the booking is overdue.", loadingRecipe: "Loading recipe...", product: "Product", default: "Default", quantity: "Quantity", noRecipe: "This service recipe has no confirmable material lines.", confirming: "Confirming...", unavailable: "Confirmation is unavailable before service execution starts", confirm: "Confirm materials and deduct inventory", bookingWorkspace: "Booking workflow", bookingWorkspaceHint: "Select a booking, then confirm required materials before completing it.", noActiveBookings: "There are no open bookings right now.", bookingStatus: "Booking status", pendingBooking: "Pending confirmation", bookedBooking: "Booked", confirmedBooking: "Confirmed", completedBooking: "Completed", cancelledBooking: "Cancelled", confirmBooking: "Confirm booking", confirmingBooking: "Confirming booking...", completeBooking: "Complete booking", completingBooking: "Completing booking...", bookingConfirmed: "The booking is confirmed and ready for execution.", bookingCompleted: "The booking was completed successfully.", materialsRemaining: "Required materials must still be confirmed before completing this booking.", executionNotStarted: "The booking cannot be completed before all services have started.", readyToComplete: "Required materials are handled and the booking can be completed.", services: "Services",
    UPCOMING: "Upcoming", DUE_TODAY: "Due today", PENDING_CONFIRMATION: "Awaiting confirmation", OVERDUE: "Overdue", CONFIRMED: "Confirmed",
  },
} as const;

type BookingCopy = { [K in keyof typeof bookingCopy.ar]: string };

function salonTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function salonNowClock() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    time: `${read("hour")}:${read("minute")}`,
  };
}

function bookingExecutionReady(booking: CoreStaffPortalBooking | null) {
  if (!booking) return false;
  const clock = salonNowClock();
  const rows = booking.items?.length
    ? booking.items.map((item) => ({
        date: String(item.bookingDate || booking.bookingDate || ""),
        time: String(item.startTime || booking.startTime || ""),
      }))
    : [{
        date: String(booking.bookingDate || ""),
        time: String(booking.startTime || ""),
      }];

  return rows.every(({ date, time }) => {
    if (!date) return false;
    if (date < clock.date) return true;
    if (date > clock.date) return false;
    return Boolean(time && time <= clock.time);
  });
}

function errorMessage(error: unknown, language: "ar" | "en", copy: BookingCopy) {
  if (error instanceof CoreApiError) {
    const workflowMessages: Record<string, { ar: string; en: string }> = {
      "core_booking:materials_confirmation_required": {
        ar: "أكدي المواد الفعلية المستخدمة قبل إكمال الحجز.",
        en: "Confirm the actual materials used before completing the booking.",
      },
      "core_booking:service_not_started": {
        ar: "لا يمكن إكمال الحجز قبل بدء جميع الخدمات المسندة لك.",
        en: "The booking cannot be completed before all assigned services have started.",
      },
      "core_booking:staff_status_change_disabled": {
        ar: "تغيير حالة الحجز من حساب الموظفة غير مفعّل في إعدادات الصالون.",
        en: "Staff booking status changes are disabled in salon settings.",
      },
      "inventory:booking_not_confirmed": {
        ar: "يجب تأكيد الحجز أولًا قبل تسجيل المواد المستخدمة.",
        en: "Confirm the booking before recording material consumption.",
      },
      "inventory:consumption_not_due": {
        ar: "تأكيد المواد غير متاح قبل بدء تنفيذ الخدمة.",
        en: "Material confirmation is unavailable before service execution starts.",
      },
    };
    const known = workflowMessages[error.code];
    if (known) return known[language];
    if (language === "ar") {
      return [error.code, error.message].filter(Boolean).join(" — ");
    }
  }
  return copy.loadError;
}

type DraftLine = {
  key: string;
  recipeLineId: string | null;
  lineType: ServiceRecipeLine["line_type"];
  categoryId: string | null;
  defaultInventoryItemId: string;
  inventoryItemId: string;
  itemName: string;
  quantity: string;
  defaultQty: string;
  unit: string;
};

const LIFECYCLE_META: Record<
  ServiceConsumptionLifecycle,
  { label: string; tone: string; bg: string; border: string }
> = {
  UPCOMING: { label: "قادم", tone: "#1e3a5f", bg: "#eff6ff", border: "#bfdbfe" },
  DUE_TODAY: { label: "مطلوب اليوم", tone: "#7c2d12", bg: "#fff7ed", border: "#fed7aa" },
  PENDING_CONFIRMATION: { label: "بانتظار التأكيد", tone: "#1e3a8a", bg: "#eef2ff", border: "#c7d2fe" },
  OVERDUE: { label: "متأخر", tone: "#7f1d1d", bg: "#fef2f2", border: "#fecaca" },
  CONFIRMED: { label: "مؤكد", tone: "#14532d", bg: "#f0fdf4", border: "#bbf7d0" },
};

function Badge({ lifecycle, copy }: { lifecycle?: ServiceConsumptionLifecycle; copy: BookingCopy }) {
  const key = lifecycle || "PENDING_CONFIRMATION";
  const meta = LIFECYCLE_META[key] || LIFECYCLE_META.PENDING_CONFIRMATION;
  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: 999,
        padding: "3px 10px",
        fontSize: 11,
        fontWeight: 700,
        color: meta.tone,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
      }}
    >
      {copy[key]}
    </span>
  );
}

export default function EmployeeServiceConsumption({ session }: { session: HrSession }) {
  const { language } = useEmployeePortalLanguage();
  const copy = bookingCopy[language] as BookingCopy;
  const employeeId = String(session.employeeId || session.uid || "");
  const [pending, setPending] = useState<PendingServiceConsumption[]>([]);
  const [bookings, setBookings] = useState<CoreStaffPortalBooking[]>([]);
  const [trackedItems, setTrackedItems] = useState<InventoryItem[]>([]);
  const [activeBookingId, setActiveBookingId] = useState("");
  const [bookingItemId, setBookingItemId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const itemNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const item of trackedItems) names[item.id] = item.name;
    return names;
  }, [trackedItems]);

  const sections = useMemo(() => {
    const dueToday = pending.filter((row) => row.lifecycle === "DUE_TODAY");
    const awaiting = pending.filter((row) => row.lifecycle === "PENDING_CONFIRMATION");
    const overdue = pending.filter((row) => row.lifecycle === "OVERDUE");
    const upcoming = pending.filter((row) => row.lifecycle === "UPCOMING");
    return { dueToday, awaiting, overdue, upcoming };
  }, [pending]);

  const selected = pending.find((row) => row.booking_item_id === bookingItemId) || null;
  const selectedBookingId = activeBookingId || selected?.booking_id || "";
  const selectedBooking =
    bookings.find((row) => row.id === selectedBookingId) || null;
  const selectedBookingPending = selectedBooking
    ? pending.filter((row) => row.booking_id === selectedBooking.id)
    : [];
  const selectedConfirmable = Boolean(
    selected?.can_confirm === true &&
    (
      selected?.lifecycle === "PENDING_CONFIRMATION" ||
      selected?.lifecycle === "OVERDUE"
    )
  );
  const overdueCount = sections.overdue.length;
  const activeBookings = useMemo(
    () =>
      [...bookings]
        .filter((booking) => {
          const status = String(booking.status || "").toLowerCase();
          return !["completed", "cancelled", "canceled", "rejected"].includes(status);
        })
        .sort((left, right) =>
          `${left.bookingDate || ""}T${left.startTime || ""}`.localeCompare(
            `${right.bookingDate || ""}T${right.startTime || ""}`
          )
        ),
    [bookings]
  );
  const selectedBookingStatus = String(selectedBooking?.status || "").toLowerCase();
  const selectedBookingAccepted = ["booked", "confirmed"].includes(selectedBookingStatus);
  const selectedBookingExecutionReady = bookingExecutionReady(selectedBooking);
  const selectedBookingCanComplete =
    Boolean(selectedBooking) &&
    selectedBookingAccepted &&
    selectedBookingExecutionReady &&
    selectedBookingPending.length === 0;
  const materialLinesReady =
    lines.length > 0 &&
    lines.every(
      (line) =>
        Boolean(line.inventoryItemId) &&
        Number.isFinite(Number(line.quantity)) &&
        Number(line.quantity) > 0
    );

  const refreshWorkspace = useCallback(async () => {
    if (!employeeId) {
      setPending([]);
      setBookings([]);
      return { pendingRows: [] as PendingServiceConsumption[], bookingRows: [] as CoreStaffPortalBooking[] };
    }

    const [pendingRows, bookingRows] = await Promise.all([
      CoreInventoryService.listPendingConsumptions({
        employeeId,
        scope: "worklist",
        includeUpcoming: "1",
        includeOverdue: "1",
        upcomingDays: 7,
        overdueDays: 30,
      }),
      CoreBookingService.mine(),
    ]);

    setPending(pendingRows || []);
    setBookings(bookingRows || []);
    return {
      pendingRows: pendingRows || [],
      bookingRows: bookingRows || [],
    };
  }, [employeeId]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [pendingRows, inventoryItems, bookingRows] = await Promise.all([
          employeeId
            ? CoreInventoryService.listPendingConsumptions({
                employeeId,
                scope: "worklist",
                includeUpcoming: "1",
                includeOverdue: "1",
                upcomingDays: 7,
                overdueDays: 30,
              })
            : Promise.resolve([]),
          CoreInventoryService.listItems({ active: "1", policy: "SERVICE_TRACKED" }),
          employeeId ? CoreBookingService.mine() : Promise.resolve([]),
        ]);
        setPending(pendingRows || []);
        setTrackedItems(inventoryItems || []);
        setBookings(bookingRows || []);
        const actionable = (pendingRows || []).filter(
          (row) =>
            row.lifecycle === "OVERDUE" ||
            row.lifecycle === "PENDING_CONFIRMATION"
        );
        if (actionable.length === 1) {
          setBookingItemId(actionable[0].booking_item_id);
          setActiveBookingId(actionable[0].booking_id);
        }
      } catch (err) {
        setError(errorMessage(err, language, copy));
      } finally {
        setLoading(false);
      }
    })();
  }, [copy, employeeId, language]);

  useEffect(() => {
    setLines([]);
    setNotice("");
    if (!bookingItemId) return;
    const row = pending.find((item) => item.booking_item_id === bookingItemId);
    if (!row) return;
    void (async () => {
      setLoadingRecipe(true);
      setError("");
      try {
        const recipe = await CoreInventoryService.getRecipeByService(row.service_id);
        const recipeLines = ((recipe as { lines?: ServiceRecipeLine[] } | null)?.lines || []).filter(
          (line) =>
            (line.line_type === "SPECIFIC_ITEM" && line.inventory_item_id) ||
            (line.line_type === "CATEGORY" && line.category_id)
        );
        setLines(
          recipeLines.map((line, index) => {
            const categoryId = line.category_id ? String(line.category_id) : null;
            const specificItemId = line.inventory_item_id ? String(line.inventory_item_id) : "";
            const categoryDefault = categoryId
              ? trackedItems.find(
                  (item) =>
                    item.category_id === categoryId &&
                    item.unit === line.unit
                )?.id || ""
              : "";
            const inventoryItemId =
              line.line_type === "SPECIFIC_ITEM"
                ? specificItemId
                : categoryDefault;
            return {
              key: line.id || `${inventoryItemId || categoryId || "recipe"}-${index}`,
              recipeLineId: line.id,
              lineType: line.line_type,
              categoryId,
              defaultInventoryItemId: specificItemId || categoryDefault,
              inventoryItemId,
              itemName: itemNames[inventoryItemId] || inventoryItemId,
              quantity: String(line.default_qty),
              defaultQty: String(line.default_qty),
              unit: line.unit,
            };
          })
        );
      } catch (err) {
        setError(errorMessage(err, language, copy));
      } finally {
        setLoadingRecipe(false);
      }
    })();
  }, [bookingItemId, pending, itemNames, trackedItems, language, copy]);

  async function confirm() {
    if (!employeeId || !bookingItemId || !materialLinesReady || !selectedConfirmable) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await CoreInventoryService.confirmConsumption({
        bookingItemId,
        employeeId,
        lines: lines.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          quantity: Number(line.quantity),
          unit: line.unit,
          recipeLineId: line.recipeLineId,
        })),
      });
      const confirmedBookingId = selected?.booking_id || activeBookingId;
      setNotice(copy.success);
      setBookingItemId("");
      setLines([]);
      if (confirmedBookingId) setActiveBookingId(confirmedBookingId);
      await refreshWorkspace();
    } catch (err) {
      setError(errorMessage(err, language, copy));
    } finally {
      setSaving(false);
    }
  }

  function bump(key: string, delta: number) {
    setLines((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = Math.max(0, Number(row.quantity || 0) + delta);
        return { ...row, quantity: String(Number.isInteger(next) ? next : next.toFixed(1)) };
      })
    );
  }

  function productOptions(line: DraftLine) {
    if (line.lineType === "SPECIFIC_ITEM") {
      return trackedItems.filter(
        (item) => item.id === line.defaultInventoryItemId
      );
    }
    return trackedItems.filter(
      (item) =>
        item.category_id === line.categoryId &&
        item.unit === line.unit
    );
  }

  function changeProduct(key: string, inventoryItemId: string) {
    const item = trackedItems.find((row) => row.id === inventoryItemId);
    setLines((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        return {
          ...row,
          inventoryItemId,
          itemName: item?.name || inventoryItemId,
          unit: item?.unit || row.unit,
        };
      })
    );
  }

  function openBooking(booking: CoreStaffPortalBooking) {
    setActiveBookingId(booking.id);
    const bookingRows = pending.filter((row) => row.booking_id === booking.id);
    const preferredRow =
      bookingRows.find(
        (row) =>
          row.lifecycle === "OVERDUE" ||
          row.lifecycle === "PENDING_CONFIRMATION"
      ) || bookingRows[0];
    setBookingItemId(preferredRow?.booking_item_id || "");
    setError("");
    setNotice("");
  }

  async function updateBookingStatus(status: "confirmed" | "completed") {
    if (!selectedBooking || bookingBusy) return;
    setBookingBusy(true);
    setError("");
    setNotice("");
    try {
      await CoreBookingService.updateMineStatus(selectedBooking.id, status);
      setNotice(status === "completed" ? copy.bookingCompleted : copy.bookingConfirmed);
      await refreshWorkspace();
    } catch (err) {
      setError(errorMessage(err, language, copy));
    } finally {
      setBookingBusy(false);
    }
  }

  function renderItemButton(row: PendingServiceConsumption) {
    const active = row.booking_item_id === bookingItemId;
    const locked = row.lifecycle === "UPCOMING" || row.can_confirm === false;
    return (
      <button
        key={row.booking_item_id}
        type="button"
        onClick={() => { setBookingItemId(row.booking_item_id); setActiveBookingId(row.booking_id); }}
        style={{
          textAlign: language === "ar" ? "right" : "left",
          border: active ? "2px solid #111" : `1px solid ${LIFECYCLE_META[row.lifecycle || "PENDING_CONFIRMATION"]?.border || "#e5e7eb"}`,
          background: active ? "#111" : "#fff",
          color: active ? "#fff" : "#111",
          borderRadius: 16,
          padding: "14px 16px",
          opacity: locked && !active ? 0.85 : 1,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <strong style={{ display: "block", fontSize: 16 }}>{row.client_name || copy.client}</strong>
          {!active ? <Badge lifecycle={row.lifecycle} copy={copy} /> : null}
        </div>
        <span style={{ opacity: 0.85, fontSize: 13 }}>
          {row.booking_date || "—"} · {row.start_time || "--:--"}
          {row.effective_end_time || row.end_time ? `–${row.effective_end_time || row.end_time}` : ""} —{" "}
          {row.service_name_snapshot || row.service_id}
        </span>
        {row.booking_source ? (
          <span style={{ display: "block", opacity: 0.7, fontSize: 11, marginTop: 4 }}>{copy.source}: {row.booking_source}</span>
        ) : null}
        {locked ? (
          <span style={{ display: "block", opacity: 0.75, fontSize: 11, marginTop: 6 }}>{copy.previewOnly}</span>
        ) : null}
      </button>
    );
  }

  function renderSection(
    title: string,
    rows: PendingServiceConsumption[],
    opts: { sticky?: boolean; empty?: string } = {}
  ) {
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>
            {title}{" "}
            <span style={{ fontWeight: 500, color: "#6b7280", fontSize: 13 }}>({rows.length})</span>
          </p>
          {opts.sticky && rows.length ? (
            <span style={{ color: "#b91c1c", fontSize: 12, fontWeight: 700 }}>{copy.sticky}</span>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map(renderItemButton)}
          {!rows.length ? <p className="text-muted" style={{ margin: 0 }}>{opts.empty || copy.none}</p> : null}
        </div>
      </div>
    );
  }

  if (loading) {
    return <section className="employee-portal-card">{copy.loadingBookings}</section>;
  }

  return (
    <section className="employee-portal-card" dir={language === "ar" ? "rtl" : "ltr"} lang={language} style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>{copy.subtitle}</p>
          <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>{copy.title}</h2>
        </div>
        <span style={{ background: "#111", color: "#fff", borderRadius: 999, padding: "6px 12px", fontSize: 12 }}>
          {salonTodayISO()} · {pending.length}
        </span>
      </div>

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 14,
          marginBottom: 16,
          background: "#fafafa",
        }}
      >
        <div style={{ marginBottom: 10 }}>
          <strong style={{ display: "block", fontSize: 15 }}>{copy.bookingWorkspace}</strong>
          <small style={{ color: "#6b7280" }}>{copy.bookingWorkspaceHint}</small>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {activeBookings.map((booking) => {
            const active = booking.id === selectedBookingId;
            const materialCount = pending.filter((row) => row.booking_id === booking.id).length;
            const serviceNames = (booking.items || [])
              .map((item) => item.serviceNameSnapshot)
              .filter(Boolean)
              .join("، ");
            const status = String(booking.status || "").toLowerCase();
            const statusLabel =
              status === "pending"
                ? copy.pendingBooking
                : status === "booked"
                  ? copy.bookedBooking
                  : status === "confirmed"
                    ? copy.confirmedBooking
                    : status === "completed"
                      ? copy.completedBooking
                      : status === "cancelled"
                        ? copy.cancelledBooking
                        : booking.status;

            return (
              <button
                key={booking.id}
                type="button"
                onClick={() => openBooking(booking)}
                style={{
                  width: "100%",
                  textAlign: language === "ar" ? "right" : "left",
                  border: active ? "2px solid #111" : "1px solid #e5e7eb",
                  background: active ? "#111" : "#fff",
                  color: active ? "#fff" : "#111",
                  borderRadius: 14,
                  padding: "12px 14px",
                }}
              >
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong>{booking.clientName || copy.client}</strong>
                  <small>{statusLabel}</small>
                </span>
                <small style={{ display: "block", marginTop: 4, opacity: 0.82 }}>
                  {booking.bookingDate || "—"} · {booking.startTime || "--:--"}
                  {serviceNames ? ` — ${serviceNames}` : ""}
                </small>
                {materialCount > 0 ? (
                  <small style={{ display: "block", marginTop: 4, opacity: 0.75 }}>
                    {copy.materials}: {materialCount}
                  </small>
                ) : null}
              </button>
            );
          })}
          {!activeBookings.length ? (
            <p className="text-muted" style={{ margin: 0 }}>{copy.noActiveBookings}</p>
          ) : null}
        </div>
      </div>

      {selectedBooking ? (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 18,
            padding: 14,
            marginBottom: 16,
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <strong style={{ display: "block" }}>{selectedBooking.clientName || copy.client}</strong>
              <small style={{ color: "#6b7280" }}>
                {copy.services}: {(selectedBooking.items || []).map((item) => item.serviceNameSnapshot).filter(Boolean).join("، ") || "—"}
              </small>
            </div>
            <small style={{ fontWeight: 700 }}>
              {copy.bookingStatus}: {selectedBookingStatus}
            </small>
          </div>

          <div style={{ marginTop: 12 }}>
            {selectedBookingStatus === "pending" ? (
              <button
                type="button"
                className="dsv2-btn dsv2-btn--primary"
                style={{ width: "100%" }}
                disabled={bookingBusy}
                onClick={() => void updateBookingStatus("confirmed")}
              >
                {bookingBusy ? copy.confirmingBooking : copy.confirmBooking}
              </button>
            ) : selectedBookingAccepted ? (
              <>
                <p className="text-muted" style={{ margin: "0 0 10px" }}>
                  {selectedBookingPending.length > 0
                    ? copy.materialsRemaining
                    : !selectedBookingExecutionReady
                      ? copy.executionNotStarted
                      : copy.readyToComplete}
                </p>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--primary"
                  style={{ width: "100%" }}
                  disabled={bookingBusy || !selectedBookingCanComplete}
                  onClick={() => void updateBookingStatus("completed")}
                >
                  {bookingBusy ? copy.completingBooking : copy.completeBooking}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {overdueCount > 0 ? (
        <div
          className="alert alert-danger"
          style={{
            borderRadius: 14,
            marginBottom: 16,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#7f1d1d",
            fontWeight: 600,
          }}
        >
          {copy.overdueAlert}: {overdueCount} {copy.overdueTail}
        </div>
      ) : null}

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}

      {renderSection(copy.todayBookings, sections.dueToday, { empty: copy.noneToday })}
      {renderSection(copy.awaiting, sections.awaiting, { empty: copy.noneAwaiting })}
      {renderSection(copy.overdue, sections.overdue, { sticky: true, empty: copy.noneOverdue })}
      {sections.upcoming.length ? renderSection(copy.upcoming, sections.upcoming, { empty: "" }) : null}

      {selected ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{copy.materials}</p>
            <Badge lifecycle={selected.lifecycle} copy={copy} />
          </div>
          {!selectedConfirmable ? (
            <p className="text-muted" style={{ marginBottom: 12 }}>
              {copy.upcomingPrefix} {selected.booking_date}. {copy.confirmRule}
            </p>
          ) : null}
          {loadingRecipe ? <p className="text-muted">{copy.loadingRecipe}</p> : null}
          {lines.length ? (
            <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
              {lines.map((line) => (
                <div
                  key={line.key}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 16,
                    padding: 14,
                    display: "grid",
                    gap: 10,
                    opacity: selectedConfirmable ? 1 : 0.7,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{copy.product}</label>
                      <select
                        value={line.inventoryItemId}
                        disabled={!selectedConfirmable || line.lineType === "SPECIFIC_ITEM"}
                        onChange={(e) => changeProduct(line.key, e.target.value)}
                        style={{
                          width: "100%",
                          border: "1px solid #e5e7eb",
                          borderRadius: 10,
                          height: 40,
                          padding: "0 10px",
                          background: "#fff",
                        }}
                      >
                        {!line.inventoryItemId ? (
                          <option value="">
                            {language === "ar" ? "اختاري المنتج" : "Select product"}
                          </option>
                        ) : null}
                        {productOptions(line).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
                        {copy.default}: {line.lineType === "CATEGORY"
                          ? (language === "ar" ? "اختيار من الفئة المحددة" : "Choose from the configured category")
                          : (itemNames[line.defaultInventoryItemId] || line.defaultInventoryItemId)} · {line.defaultQty}{" "}
                        {line.unit}
                      </div>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{copy.quantity}</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          type="button"
                          className="dsv2-btn dsv2-btn--secondary"
                          disabled={!selectedConfirmable}
                          onClick={() => bump(line.key, -1)}
                        >
                          -
                        </button>
                        <input
                          value={line.quantity}
                          disabled={!selectedConfirmable}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((row) => (row.key === line.key ? { ...row, quantity: e.target.value } : row))
                            )
                          }
                          style={{ width: 72, textAlign: "center", border: "1px solid #e5e7eb", borderRadius: 10, height: 40 }}
                        />
                        <button
                          type="button"
                          className="dsv2-btn dsv2-btn--secondary"
                          disabled={!selectedConfirmable}
                          onClick={() => bump(line.key, 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : !loadingRecipe ? (
            <p className="text-muted">{copy.noRecipe}</p>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        className="dsv2-btn dsv2-btn--primary"
        style={{ width: "100%", height: 48, borderRadius: 14 }}
        disabled={saving || !employeeId || !bookingItemId || !materialLinesReady || !selectedConfirmable}
        onClick={() => void confirm()}
      >
        {saving
          ? copy.confirming
          : !selectedConfirmable && selected
            ? copy.unavailable
            : copy.confirm}
      </button>
    </section>
  );
}
