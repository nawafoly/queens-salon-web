import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardTimePickerV2,
} from "../../components/dashboard-v2";
import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceTableV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import {
  CoreHrService,
  type CoreAnnualLeaveRecall,
  type CoreLeaveRestOverview,
  type CoreWeeklyRestWorkAssignment,
} from "../../services/CoreHrService";
import type { CoreLeave } from "../../types/hrCoreApi";
import {
  WEEKDAY_OPTIONS,
  fmtIsoDate,
  type WeekdayKey,
} from "./shared";

type LeaveRestManagementPanelProps = {
  employeeId: string;
  readOnly: boolean;
  weeklyRestWeekdays: WeekdayKey[];
};

function riyadhToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function numberLabel(value: unknown, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "غير متوفر";
  return `${number.toLocaleString("ar-SA-u-nu-latn")}${suffix}`;
}

function annualReviewReasonLabel(value: unknown) {
  const reason = clean(value);
  if (reason === "service_start_date_required") {
    return "تاريخ بداية الخدمة غير محدد";
  }
  if (reason === "service_start_date_invalid") {
    return "تاريخ بداية الخدمة غير صالح";
  }
  if (reason === "opening_balance_required") {
    return "يحتاج رصيدًا افتتاحيًا قبل اعتماده";
  }
  if (reason === "as_of_before_service_start") {
    return "تاريخ الحساب قبل بداية الخدمة";
  }
  return reason || "يحتاج مراجعة من الموارد البشرية";
}

function annualBalanceValue(
  value: unknown,
  reviewRequired = false
) {
  if (reviewRequired) return "يحتاج مراجعة";
  return numberLabel(value, " يوم");
}

function statusLabel(value: unknown) {
  const status = clean(value).toLowerCase();
  if (status === "active") return "فعال";
  if (status === "assigned") return "مكلفة";
  if (status === "completed") return "مكتمل";
  if (status === "cancelled") return "ملغي";
  return clean(value) || "غير محدد";
}

function formatTime12Hour(value: unknown) {
  const raw = clean(value);
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return raw || "—";

  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour24) ||
    hour24 < 0 ||
    hour24 > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return raw;
  }

  const hour12 = hour24 % 12 || 12;
  const period = hour24 >= 12 ? "م" : "ص";
  return `${hour12}:${match[2]} ${period}`;
}

function humanError(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : String(error || "");

  if (raw.includes("not_weekly_rest_day")) {
    return "التاريخ المحدد ليس يوم الراحة الأسبوعية لهذه الموظفة.";
  }
  if (raw.includes("approved_leave_conflict")) {
    return "يوجد في هذا اليوم إجازة معتمدة. عالجي الإجازة أولًا قبل تكليف يوم الراحة.";
  }
  if (raw.includes("recall_requires_approved_annual_leave")) {
    return "الاستدعاء متاح فقط لإجازة سنوية معتمدة.";
  }
  if (raw.includes("recall_date_outside_leave")) {
    return "تاريخ الاستدعاء يجب أن يكون داخل مدة الإجازة السنوية.";
  }
  if (raw.includes("future_recall_not_supported")) {
    return "الاستدعاء يسجل لليوم الحالي أو لتاريخ سابق فقط.";
  }
  if (raw.includes("opening_reason_required")) {
    return "سبب تسوية الرصيد الافتتاحي مطلوب.";
  }
  if (raw.includes("opening_balance_already_exists")) {
    return "تم تسجيل رصيد افتتاحي سابقًا لهذه الموظفة.";
  }
  if (raw.includes("opening_before_service_start")) {
    return "تاريخ سريان الرصيد لا يمكن أن يسبق تاريخ بداية الخدمة.";
  }
  if (raw.includes("opening_effective_date_in_future")) {
    return "تاريخ سريان الرصيد لا يمكن أن يكون في المستقبل.";
  }
  if (raw.includes("reason_required")) {
    return "السبب مطلوب.";
  }
  return raw || "تعذر تنفيذ العملية.";
}

function leaveCoversDate(
  leave: CoreLeave,
  date: string
) {
  return (
    clean(leave.status).toLowerCase() === "approved" &&
    clean(leave.leaveType).toLowerCase() === "annual" &&
    clean(leave.durationKind).toLowerCase() !== "partial" &&
    clean(leave.startDate) <= date &&
    clean(leave.endDate) >= date
  );
}

export default function LeaveRestManagementPanel({
  employeeId,
  readOnly,
  weeklyRestWeekdays,
}: LeaveRestManagementPanelProps) {
  const today = useMemo(riyadhToday, []);
  const [overview, setOverview] =
    useState<CoreLeaveRestOverview | null>(null);
  const [approvedAnnualLeaves, setApprovedAnnualLeaves] =
    useState<CoreLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // ANNUAL_LEAVE_SERVICE_START_GOSI_BRIDGE_V1
  // GOSI is an initial suggestion only.
  // employee_employment.start_date is canonical.
  const [
    persistedServiceStartDate,
    setPersistedServiceStartDate,
  ] = useState("");

  const [
    gosiEffectiveDate,
    setGosiEffectiveDate,
  ] = useState("");

  const [
    serviceStartDate,
    setServiceStartDate,
  ] = useState("");

  const [
    openingBalanceDays,
    setOpeningBalanceDays,
  ] = useState("");

  const [
    openingBalanceEffectiveDate,
    setOpeningBalanceEffectiveDate,
  ] = useState(today);

  const [
    openingBalanceReason,
    setOpeningBalanceReason,
  ] = useState("");

  const openingBalanceOperationIdRef =
    useRef("");

  const [
    weeklyRestOpeningDays,
    setWeeklyRestOpeningDays,
  ] = useState("");

  const [
    weeklyRestOpeningEffectiveDate,
    setWeeklyRestOpeningEffectiveDate,
  ] = useState(today);

  const [
    weeklyRestOpeningReason,
    setWeeklyRestOpeningReason,
  ] = useState("");

  const [
    annualAdjustmentAction,
    setAnnualAdjustmentAction,
  ] = useState<"add" | "deduct">("add");

  const [
    annualAdjustmentDays,
    setAnnualAdjustmentDays,
  ] = useState("");

  const [
    annualAdjustmentEffectiveDate,
    setAnnualAdjustmentEffectiveDate,
  ] = useState(today);

  const [
    annualAdjustmentReason,
    setAnnualAdjustmentReason,
  ] = useState("");

  const annualAdjustmentOperationIdRef =
    useRef("");

  const [
    weeklyRestAdjustmentAction,
    setWeeklyRestAdjustmentAction,
  ] = useState<"credit" | "debit">("credit");

  const [
    weeklyRestAdjustmentDays,
    setWeeklyRestAdjustmentDays,
  ] = useState("");

  const [
    weeklyRestAdjustmentEffectiveDate,
    setWeeklyRestAdjustmentEffectiveDate,
  ] = useState(today);

  const [
    weeklyRestAdjustmentReason,
    setWeeklyRestAdjustmentReason,
  ] = useState("");

  const weeklyRestAdjustmentOperationIdRef =
    useRef("");
  const [recallDate, setRecallDate] =
    useState(today);
  const [recallReason, setRecallReason] =
    useState("");

  const [restDate, setRestDate] =
    useState(today);
  const [restStartTime, setRestStartTime] =
    useState("");
  const [restEndTime, setRestEndTime] =
    useState("");
  const [restReason, setRestReason] =
    useState("");

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setMessage("");
    try {
      const [
        nextOverview,
        leaves,
        employee,
      ] = await Promise.all([
        CoreHrService.getLeaveRestOverview(
          employeeId
        ),
        CoreHrService.listLeaves({
          employeeId,
          status: "approved",
        }),
        CoreHrService.getEmployee(
          employeeId
        ),
      ]);

      const employment =
        (employee.employment || {}) as Record<
          string,
          unknown
        >;

      const persistedStartDate = clean(
        employment.start_date ??
        employment.startDate
      );

      const insuranceDate = clean(
        employment.social_insurance_effective_from ??
        employment.socialInsuranceEffectiveFrom
      );

      setPersistedServiceStartDate(
        persistedStartDate
      );

      setGosiEffectiveDate(
        insuranceDate
      );

      setServiceStartDate(
        persistedStartDate ||
        insuranceDate
      );

      setOverview(nextOverview);
      setApprovedAnnualLeaves(
        leaves.filter(
          (leave) =>
            clean(leave.leaveType).toLowerCase() ===
              "annual" &&
            clean(leave.durationKind).toLowerCase() !==
              "partial"
        )
      );
    } catch (error) {
      setMessage(humanError(error));
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const recallLeave =
    approvedAnnualLeaves.find(
      (leave) =>
        leaveCoversDate(
          leave,
          recallDate
        )
    ) || null;

  const activeRecalls =
    (overview?.annualLeaveRecalls || [])
      .filter(
        (recall) =>
          clean(recall.status).toLowerCase() ===
          "active"
      )
      .slice(0, 8);

  const assignments =
    (overview?.weeklyRest.assignments || [])
      .slice(0, 8);

  const historicalWeeklyRestOpening =
    overview?.weeklyRest.historicalOpening ||
    null;

  const hasHistoricalWeeklyRestOpening =
    Boolean(
      historicalWeeklyRestOpening
    );

  const weeklyRestLabel =
    weeklyRestWeekdays.length
      ? weeklyRestWeekdays
          .map(
            (key) =>
              WEEKDAY_OPTIONS.find(
                (day) => day.key === key
              )?.label || key
          )
          .join("، ")
      : "غير محددة";

  const annualLeave =
    overview?.annualLeave || {};
  const annualReviewRequired =
    Boolean(annualLeave.reviewRequired);
  const annualReviewDescription =
    annualReviewRequired
      ? `الرصيد يحتاج مراجعة — ${annualReviewReasonLabel(
          annualLeave.reviewReason
        )}`
      : "";
  const annualAvailable =
    annualLeave.availableDays;

  const hasOpeningBalance =
    Boolean(
      annualLeave.openingBalance
    );

  const serviceStartSourceLabel =
    persistedServiceStartDate
      ? gosiEffectiveDate &&
        persistedServiceStartDate ===
          gosiEffectiveDate
        ? "مطابق لتاريخ سريان التصنيف"
        : gosiEffectiveDate
          ? "معدل من الموارد البشرية"
          : "من ملف الموظفة"
      : gosiEffectiveDate
        ? "مقترح من تاريخ سريان التصنيف — غير محفوظ"
        : "غير محدد";

  const nearbyApprovedAnnualLeaves =
    approvedAnnualLeaves
      .slice()
      .sort((left, right) => {
        const leftCovers = leaveCoversDate(left, recallDate);
        const rightCovers = leaveCoversDate(right, recallDate);
        if (leftCovers !== rightCovers) return leftCovers ? -1 : 1;
        const recallMs = Date.parse(`${recallDate}T00:00:00Z`);
        const leftMs = Date.parse(`${clean(left.startDate)}T00:00:00Z`);
        const rightMs = Date.parse(`${clean(right.startDate)}T00:00:00Z`);
        const leftDistance = Number.isFinite(leftMs) && Number.isFinite(recallMs)
          ? Math.abs(leftMs - recallMs)
          : Number.MAX_SAFE_INTEGER;
        const rightDistance = Number.isFinite(rightMs) && Number.isFinite(recallMs)
          ? Math.abs(rightMs - recallMs)
          : Number.MAX_SAFE_INTEGER;
        return leftDistance - rightDistance;
      })
      .slice(0, 3);
  const nearbyApprovedAnnualLeavesDescription =
    nearbyApprovedAnnualLeaves.length
      ? `الإجازات السنوية المعتمدة الحالية/القريبة: ${nearbyApprovedAnnualLeaves
          .map(
            (leave) =>
              `${fmtIsoDate(leave.startDate)} إلى ${fmtIsoDate(
                leave.endDate
              )}`
          )
          .join("، ")}.`
      : "لا توجد إجازات سنوية معتمدة كاملة لهذا الموظف في القائمة الحالية.";

  const saveServiceStartDate =
    async () => {
      if (!serviceStartDate) {
        setMessage(
          "حدد تاريخ بداية الخدمة."
        );
        return;
      }

      setSaving(true);
      setMessage("");

      try {
        await CoreHrService.saveEmployee({
          id: employeeId,
          employment: {
            startDate:
              serviceStartDate,
          },
        });

        await load();

        setMessage(
          "تم حفظ تاريخ بداية الخدمة وأصبح المرجع الموحد لحساب الإجازة السنوية."
        );
      } catch (error) {
        setMessage(
          humanError(error)
        );
      } finally {
        setSaving(false);
      }
    };

  const submitOpeningBalance =
    async () => {
      if (!persistedServiceStartDate) {
        setMessage(
          "احفظ تاريخ بداية الخدمة أولًا."
        );
        return;
      }

      const days =
        Number(openingBalanceDays);

      if (
        !Number.isFinite(days) ||
        days < 0
      ) {
        setMessage(
          "أدخل رصيدًا افتتاحيًا صالحًا."
        );
        return;
      }

      if (
        !openingBalanceEffectiveDate
      ) {
        setMessage(
          "حدد تاريخ سريان الرصيد."
        );
        return;
      }

      if (
        !openingBalanceReason.trim()
      ) {
        setMessage(
          "اكتب سبب التسوية."
        );
        return;
      }

      setSaving(true);
      setMessage("");

      try {
        if (!openingBalanceOperationIdRef.current) {
          openingBalanceOperationIdRef.current =
            `annual-opening-${employeeId}-${crypto.randomUUID()}`;
        }

        await CoreHrService
          .setAnnualLeaveOpeningBalance(
            employeeId,
            {
              days,
              effectiveDate:
                openingBalanceEffectiveDate,
              reason:
                openingBalanceReason.trim(),
              operationId:
                openingBalanceOperationIdRef.current,
            }
          );

        setOpeningBalanceDays("");
        setOpeningBalanceReason("");
        openingBalanceOperationIdRef.current = "";

        await load();

        setMessage(
          "تم تسجيل الرصيد الافتتاحي في السجل الموحد للإجازة السنوية."
        );
      } catch (error) {
        setMessage(
          humanError(error)
        );
      } finally {
        setSaving(false);
      }
    };

  const submitHistoricalWeeklyRestOpening =
    async () => {
      const days =
        Number(weeklyRestOpeningDays);

      if (
        !Number.isInteger(days) ||
        days < 1 ||
        days > 366
      ) {
        setMessage(
          "أدخل عدد أيام صحيح من 1 إلى 366."
        );
        return;
      }

      if (
        !weeklyRestOpeningEffectiveDate
      ) {
        setMessage(
          "حدد تاريخ سريان الرصيد التاريخي."
        );
        return;
      }

      const reason =
        weeklyRestOpeningReason.trim();

      if (!reason) {
        setMessage(
          "اكتب سبب التسوية."
        );
        return;
      }

      setSaving(true);
      setMessage("");

      try {
        await CoreHrService
          .setHistoricalWeeklyRestOpeningBalance(
            employeeId,
            {
              days,
              effectiveDate:
                weeklyRestOpeningEffectiveDate,
              reason,
            }
          );

        setWeeklyRestOpeningDays("");
        setWeeklyRestOpeningReason("");

        await load();

        setMessage(
          "تم تسجيل الرصيد التاريخي للراحة التعويضية في السجل الموحد."
        );
      } catch (error) {
        setMessage(
          humanError(error)
        );
      } finally {
        setSaving(false);
      }
    };

  const submitAnnualLeaveAdjustment =
    async () => {
      if (annualReviewRequired) {
        setMessage(
          "لا يمكن تسوية الرصيد السنوي قبل اكتمال مراجعة الرصيد واعتماد نقطة البداية."
        );
        return;
      }

      const days =
        Number(annualAdjustmentDays);

      if (
        !Number.isFinite(days) ||
        days < 0.5 ||
        days > 3650 ||
        Math.round(days * 2) !== days * 2
      ) {
        setMessage(
          "أدخل عدد أيام صحيح بمضاعفات نصف يوم، مثل 0.5 أو 1 أو 1.5."
        );
        return;
      }

      if (!annualAdjustmentEffectiveDate) {
        setMessage(
          "حدد تاريخ سريان التسوية."
        );
        return;
      }

      const reason =
        annualAdjustmentReason.trim();

      if (!reason) {
        setMessage(
          "اكتب سبب التسوية."
        );
        return;
      }

      setSaving(true);
      setMessage("");

      try {
        if (
          !annualAdjustmentOperationIdRef.current
        ) {
          annualAdjustmentOperationIdRef.current =
            `annual-adjustment-${employeeId}-${crypto.randomUUID()}`;
        }

        await CoreHrService
          .adjustAnnualLeaveBalance(
            employeeId,
            {
              action:
                annualAdjustmentAction,
              days,
              effectiveDate:
                annualAdjustmentEffectiveDate,
              reason,
              operationId:
                annualAdjustmentOperationIdRef.current,
            }
          );

        setAnnualAdjustmentDays("");
        setAnnualAdjustmentReason("");
        annualAdjustmentOperationIdRef.current =
          "";

        await load();

        setMessage(
          annualAdjustmentAction === "add"
            ? "تمت إضافة التسوية إلى رصيد الإجازة السنوية."
            : "تم خصم التسوية من رصيد الإجازة السنوية."
        );
      } catch (error) {
        setMessage(
          humanError(error)
        );
      } finally {
        setSaving(false);
      }
    };

  const submitWeeklyRestAdjustment =
    async () => {
      const days =
        Number(weeklyRestAdjustmentDays);

      if (
        !Number.isInteger(days) ||
        days < 1 ||
        days > 366
      ) {
        setMessage(
          "أدخل عدد أيام صحيح من 1 إلى 366."
        );
        return;
      }

      if (
        !weeklyRestAdjustmentEffectiveDate
      ) {
        setMessage(
          "حدد تاريخ سريان التسوية."
        );
        return;
      }

      const reason =
        weeklyRestAdjustmentReason.trim();

      if (!reason) {
        setMessage(
          "اكتب سبب التسوية."
        );
        return;
      }

      setSaving(true);
      setMessage("");

      try {
        if (
          !weeklyRestAdjustmentOperationIdRef.current
        ) {
          weeklyRestAdjustmentOperationIdRef.current =
            `weekly-rest-adjustment-${employeeId}-${crypto.randomUUID()}`;
        }

        await CoreHrService
          .adjustWeeklyRestBalance(
            employeeId,
            {
              action:
                weeklyRestAdjustmentAction,
              days,
              effectiveDate:
                weeklyRestAdjustmentEffectiveDate,
              reason,
              operationId:
                weeklyRestAdjustmentOperationIdRef.current,
            }
          );

        setWeeklyRestAdjustmentDays("");
        setWeeklyRestAdjustmentReason("");
        weeklyRestAdjustmentOperationIdRef.current =
          "";

        await load();

        setMessage(
          weeklyRestAdjustmentAction ===
            "credit"
            ? "تمت إضافة التسوية إلى رصيد الراحة التعويضية."
            : "تم خصم التسوية من رصيد الراحة التعويضية."
        );
      } catch (error) {
        setMessage(
          humanError(error)
        );
      } finally {
        setSaving(false);
      }
    };
  const submitRecall = async () => {
    if (!recallLeave) {
      setMessage(
        "لا توجد إجازة سنوية معتمدة تغطي تاريخ الاستدعاء المحدد."
      );
      return;
    }
    if (!recallReason.trim()) {
      setMessage("اكتب سبب الاستدعاء.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await CoreHrService.createAnnualLeaveRecall(
        recallLeave.id,
        {
          recallDate,
          reason: recallReason.trim(),
        }
      );
      setRecallReason("");
      setMessage(
        "تم تسجيل الاستدعاء وإعادة يوم واحد إلى رصيد الإجازة السنوية."
      );
      await load();
    } catch (error) {
      setMessage(humanError(error));
    } finally {
      setSaving(false);
    }
  };

  const cancelRecall = async (
    recall: CoreAnnualLeaveRecall
  ) => {
    const reason = window.prompt(
      "سبب إلغاء الاستدعاء"
    );
    if (!reason?.trim()) return;

    setSaving(true);
    setMessage("");
    try {
      await CoreHrService.cancelAnnualLeaveRecall(
        recall.leaveId,
        recall.id,
        reason.trim()
      );
      setMessage("تم إلغاء الاستدعاء.");
      await load();
    } catch (error) {
      setMessage(humanError(error));
    } finally {
      setSaving(false);
    }
  };

  const submitWeeklyRestWork = async () => {
    if (
      !restDate ||
      !restStartTime ||
      !restEndTime
    ) {
      setMessage(
        "حدد التاريخ ووقت بداية ونهاية التكليف."
      );
      return;
    }
    if (!restReason.trim()) {
      setMessage("اكتب سبب التكليف.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await CoreHrService.createWeeklyRestWorkAssignment({
        employeeId,
        restDate,
        startTime: restStartTime,
        endTime: restEndTime,
        reason: restReason.trim(),
      });
      setRestReason("");
      setMessage(
        "تم تسجيل التكليف. أصبحت البصمة والحجز مسموحين داخل نافذة العمل المحددة."
      );
      await load();
    } catch (error) {
      setMessage(humanError(error));
    } finally {
      setSaving(false);
    }
  };

  const cancelAssignment = async (
    assignment: CoreWeeklyRestWorkAssignment
  ) => {
    const reason = window.prompt(
      "سبب إلغاء تكليف يوم الراحة"
    );
    if (!reason?.trim()) return;

    setSaving(true);
    setMessage("");
    try {
      await CoreHrService.cancelWeeklyRestWorkAssignment(
        assignment.id,
        employeeId,
        reason.trim()
      );
      setMessage("تم إلغاء التكليف.");
      await load();
    } catch (error) {
      setMessage(humanError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2
          label="الإجازة السنوية"
          value={
            loading
              ? "جاري التحميل..."
              : annualBalanceValue(
                  annualAvailable,
                  annualReviewRequired
                )
          }
          note={
            annualReviewRequired
              ? annualReviewReasonLabel(annualLeave.reviewReason)
              : "الرصيد المتاح"
          }
          tone={annualReviewRequired ? "gold" : "success"}
        />
        <WorkspaceMetricV2
          label="الراحة الأسبوعية"
          value={weeklyRestLabel}
          note="من جدول الدوام"
        />
        <WorkspaceMetricV2
          label="الراحة التعويضية"
          value={
            loading
              ? "جاري التحميل..."
              : numberLabel(
                  overview?.weeklyRest.dueDays,
                  " يوم"
                )
          }
          note="مستحقة بسبب العمل في يوم الراحة"
          tone={
            Number(
              overview?.weeklyRest.dueDays || 0
            ) > 0
              ? "gold"
              : "neutral"
          }
        />
      </div>

      {message ? (
        <WorkspaceNoticeV2
          title={
            message.startsWith("تم")
              ? "تمت العملية"
              : "تنبيه"
          }
          description={message}
          tone={
            message.startsWith("تم")
              ? "success"
              : "gold"
          }
        />
      ) : null}

      {annualReviewRequired ? (
        <WorkspaceNoticeV2
          title="الرصيد يحتاج مراجعة"
          description={annualReviewDescription}
          tone="gold"
        />
      ) : null}

      <WorkspaceCardV2
        title="تفصيل رصيد الإجازة السنوية"
        description="يفصل بين الاستحقاق السنوي النظامي وبين الرصيد المتبقي المعتمد فعليًا للموظفة."
      >
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2
            id="employee-live-v2-service-start-date"
            label="تاريخ بداية الخدمة"
          >
            <DashboardDatePickerV2
              id="employee-live-v2-service-start-date"
              value={serviceStartDate}
              max={today}
              disabled={readOnly || saving}
              onChange={setServiceStartDate}
            />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="employee-live-v2-service-start-source"
            label="حالة المرجع"
          >
            <input
              id="employee-live-v2-service-start-source"
              className="dsv2-input"
              value={serviceStartSourceLabel}
              readOnly
            />
          </DashboardFieldV2>
        </div>

        <WorkspaceNoticeV2
          title={
            !persistedServiceStartDate &&
            gosiEffectiveDate
              ? "اقتراح أولي من التأمينات"
              : "مرجع احتساب الإجازة"
          }
          description={
            !persistedServiceStartDate &&
            gosiEffectiveDate
              ? "تم اقتراح تاريخ سريان التصنيف لأن تاريخ بداية الخدمة غير محفوظ. احفظ التاريخ لتثبيته كمرجع الإجازة السنوية."
              : "الحساب يعتمد على تاريخ بداية الخدمة المحفوظ في Core. تعديل هذا التاريخ لا يغيّر تاريخ سريان التصنيف في التأمينات."
          }
          tone={
            !persistedServiceStartDate &&
            gosiEffectiveDate
              ? "gold"
              : "neutral"
          }
        />

        <button
          type="button"
          className="dsv2-btn dsv2-btn--secondary"
          disabled={
            readOnly ||
            saving ||
            !serviceStartDate ||
            serviceStartDate ===
              persistedServiceStartDate
          }
          onClick={() =>
            void saveServiceStartDate()
          }
        >
          حفظ تاريخ بداية الخدمة
        </button>

        <div className="dsv2-ew-metrics">
          <WorkspaceMetricV2
            label="الاستحقاق السنوي"
            value={
              loading
                ? "جاري التحميل..."
                : numberLabel(annualLeave.annualEntitlementDays, " يوم")
            }
          />

          <WorkspaceMetricV2
            label="الرصيد الافتتاحي"
            value={
              loading
                ? "جاري التحميل..."
                : annualReviewRequired &&
                    annualLeave.reviewReason === "opening_balance_required"
                  ? "مطلوب"
                  : numberLabel(annualLeave.openingBalanceDays ?? 0, " يوم")
            }
            tone={
              annualReviewRequired &&
              annualLeave.reviewReason === "opening_balance_required"
                ? "gold"
                : "neutral"
            }
          />
          <WorkspaceMetricV2
            label="المستخدم"
            value={
              loading
                ? "جاري التحميل..."
                : numberLabel(annualLeave.usedDays ?? 0, " يوم")
            }
          />
          <WorkspaceMetricV2
            label="المعاد/المسترجع"
            value={
              loading
                ? "جاري التحميل..."
                : numberLabel(annualLeave.reversedDays ?? 0, " يوم")
            }
          />
          <WorkspaceMetricV2
            label="الرصيد المتاح"
            value={
              loading
                ? "جاري التحميل..."
                : annualBalanceValue(
                    annualLeave.availableDays,
                    annualReviewRequired
                  )
            }
            note={
              annualReviewRequired
                ? annualReviewReasonLabel(annualLeave.reviewReason)
                : undefined
            }
            tone={annualReviewRequired ? "gold" : "success"}
          />
          <WorkspaceMetricV2
            label="بداية سنة الخدمة"
            value={
              loading
                ? "جاري التحميل..."
                : annualLeave.serviceYearStart
                  ? fmtIsoDate(String(annualLeave.serviceYearStart))
                  : annualLeave.startDate
                    ? fmtIsoDate(String(annualLeave.startDate))
                    : "غير محددة"
            }
          />
          <WorkspaceMetricV2
            label="نهاية سنة الخدمة"
            value={
              loading
                ? "جاري التحميل..."
                : annualLeave.serviceYearEnd
                  ? fmtIsoDate(String(annualLeave.serviceYearEnd))
                  : "غير محددة"
            }
          />
        </div>

        <WorkspaceNoticeV2
          title="معلومة احتسابية"
          description={
            loading
              ? "جاري تحميل تفاصيل الاحتساب..."
              : `الاستحقاق النظري المتراكم حسب تاريخ الخدمة: ${numberLabel(
                  annualLeave.earnedCurrentServiceYearDays ??
                    annualLeave.accruedDays,
                  " يوم"
                )}. هذه المعلومة لا تمثل الرصيد المتبقي ولا تُضاف فوق الرصيد الافتتاحي المعتمد.`
          }
          tone="neutral"
        />
      </WorkspaceCardV2>

      {!annualReviewRequired ? (
        <WorkspaceCardV2
          title="تسوية رصيد الإجازة السنوية"
          description="استخدم هذه العملية لتصحيح رصيد مؤكد بعد اعتماد الرصيد السنوي. كل تسوية تسجل كحركة مستقلة ومدققة ولا تعدل الحركات السابقة."
        >
          <div className="dsv2-ew-metrics">
            <WorkspaceMetricV2
              label="الرصيد الحالي"
              value={
                loading
                  ? "جاري التحميل..."
                  : annualBalanceValue(
                      annualLeave.availableDays,
                      false
                    )
              }
              note="الرصيد السنوي المتاح"
              tone="success"
            />
          </div>

          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2
              id="employee-live-v2-annual-adjustment-action"
              label="نوع التسوية"
            >
              <select
                id="employee-live-v2-annual-adjustment-action"
                className="dsv2-input"
                value={annualAdjustmentAction}
                disabled={readOnly || saving}
                onChange={(event) =>
                  setAnnualAdjustmentAction(
                    event.target.value as
                      | "add"
                      | "deduct"
                  )
                }
              >
                <option value="add">
                  إضافة إلى الرصيد
                </option>
                <option value="deduct">
                  خصم من الرصيد
                </option>
              </select>
            </DashboardFieldV2>

            <DashboardFieldV2
              id="employee-live-v2-annual-adjustment-days"
              label="عدد الأيام"
            >
              <input
                id="employee-live-v2-annual-adjustment-days"
                className="dsv2-input"
                inputMode="decimal"
                value={annualAdjustmentDays}
                disabled={readOnly || saving}
                placeholder="مثال: 0.5 أو 1 أو 1.5"
                onChange={(event) =>
                  setAnnualAdjustmentDays(
                    event.target.value
                  )
                }
              />
            </DashboardFieldV2>

            <DashboardFieldV2
              id="employee-live-v2-annual-adjustment-effective-date"
              label="تاريخ سريان التسوية"
            >
              <DashboardDatePickerV2
                id="employee-live-v2-annual-adjustment-effective-date"
                value={annualAdjustmentEffectiveDate}
                max={today}
                disabled={readOnly || saving}
                onChange={
                  setAnnualAdjustmentEffectiveDate
                }
              />
            </DashboardFieldV2>

            <DashboardFieldV2
              id="employee-live-v2-annual-adjustment-reason"
              label="سبب التسوية"
            >
              <input
                id="employee-live-v2-annual-adjustment-reason"
                className="dsv2-input"
                value={annualAdjustmentReason}
                disabled={readOnly || saving}
                placeholder="مثال: تصحيح رصيد مؤكد بعد مراجعة السجل"
                onChange={(event) =>
                  setAnnualAdjustmentReason(
                    event.target.value
                  )
                }
              />
            </DashboardFieldV2>
          </div>

          <WorkspaceNoticeV2
            title="حركة مدققة وليست تعديلًا مباشرًا"
            description="الإضافة أو الخصم يسجلان كتصحيح يدوي في السجل الموحد للإجازة السنوية. لا يتم حذف الحركات السابقة أو تعديلها."
            tone="neutral"
          />

          <button
            type="button"
            className={
              annualAdjustmentAction === "deduct"
                ? "dsv2-btn dsv2-btn--danger"
                : "dsv2-btn dsv2-btn--success"
            }
            disabled={
              readOnly ||
              saving ||
              annualAdjustmentDays === "" ||
              !annualAdjustmentEffectiveDate ||
              !annualAdjustmentReason.trim()
            }
            onClick={() =>
              void submitAnnualLeaveAdjustment()
            }
          >
            {annualAdjustmentAction === "add"
              ? "إضافة التسوية"
              : "خصم التسوية"}
          </button>
        </WorkspaceCardV2>
      ) : null}

      <WorkspaceCardV2
        title="الرصيد الافتتاحي / تسوية بدء النظام"
        description="سجل هنا فقط الرصيد المتبقي الذي تم اعتماده فعليًا عند بدء النظام. إذا كان السجل السابق غير مكتمل فلا تخمّن الرصيد."
      >
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2
            id="employee-live-v2-opening-balance-days"
            label="الرصيد المتبقي المعتمد"
          >
            <input
              id="employee-live-v2-opening-balance-days"
              className="dsv2-input"
              inputMode="decimal"
              value={openingBalanceDays}
              disabled={
                readOnly ||
                saving ||
                hasOpeningBalance
              }
              placeholder="مثال: 21 أو 15.5"
              onChange={(event) =>
                setOpeningBalanceDays(
                  event.target.value
                )
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="employee-live-v2-opening-balance-effective-date"
            label="تاريخ سريان الرصيد"
          >
            <DashboardDatePickerV2
              id="employee-live-v2-opening-balance-effective-date"
              value={openingBalanceEffectiveDate}
              max={today}
              disabled={
                readOnly ||
                saving ||
                hasOpeningBalance
              }
              onChange={
                setOpeningBalanceEffectiveDate
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="employee-live-v2-opening-balance-reason"
            label="سبب التسوية"
          >
            <input
              id="employee-live-v2-opening-balance-reason"
              className="dsv2-input"
              value={openingBalanceReason}
              disabled={
                readOnly ||
                saving ||
                hasOpeningBalance
              }
              placeholder="مثال: الرصيد الفعلي عند بدء النظام"
              onChange={(event) =>
                setOpeningBalanceReason(
                  event.target.value
                )
              }
            />
          </DashboardFieldV2>
        </div>

        <WorkspaceNoticeV2
          title={
            hasOpeningBalance
              ? "الرصيد الافتتاحي مثبت"
              : "تسوية انتقالية"
          }
          description={
            hasOpeningBalance
              ? "يوجد رصيد افتتاحي مسجل في السجل الموحد. الحركات والاستحقاقات التالية تستمر من خلال Core."
              : "أدخل فقط الرصيد المتبقي الذي اعتمدته الموارد البشرية في تاريخ السريان. إذا لم تعرف ما تم استخدامه سابقًا فلا تدخل رقمًا تقديريًا واترك الرصيد بحالة مراجعة حتى تتم التسوية."
          }
          tone={
            hasOpeningBalance
              ? "success"
              : "neutral"
          }
        />

        <button
          type="button"
          className="dsv2-btn dsv2-btn--success"
          disabled={
            readOnly ||
            saving ||
            hasOpeningBalance ||
            !persistedServiceStartDate ||
            openingBalanceDays === "" ||
            !openingBalanceEffectiveDate ||
            !openingBalanceReason.trim()
          }
          onClick={() =>
            void submitOpeningBalance()
          }
        >
          اعتماد الرصيد المتبقي
        </button>
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="الرصيد التاريخي للراحة التعويضية"
        description="تسوية مرة واحدة لنقل الرصيد المؤكد المستحق قبل بدء الاعتماد الكامل على Core. لا تدخل رصيدا تقديريا."
      >
        {hasHistoricalWeeklyRestOpening ? (
          <WorkspaceNoticeV2
            title="الرصيد التاريخي مثبت"
            description={
              "الرصيد المسجل: " +
              numberLabel(
                historicalWeeklyRestOpening
                  ?.days,
                " يوم"
              ) +
              "، تاريخ السريان: " +
              (
                historicalWeeklyRestOpening
                  ?.effectiveDate
                  ? fmtIsoDate(
                      String(
                        historicalWeeklyRestOpening
                          .effectiveDate
                      )
                    )
                  : "غير محدد"
              ) +
              "."
            }
            tone="success"
          />
        ) : (
          <>
            <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
              <DashboardFieldV2
                id="employee-live-v2-weekly-rest-opening-days"
                label="عدد الأيام المستحقة"
              >
                <input
                  id="employee-live-v2-weekly-rest-opening-days"
                  className="dsv2-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={
                    weeklyRestOpeningDays
                  }
                  disabled={
                    readOnly || saving
                  }
                  placeholder="3"
                  onChange={(event) =>
                    setWeeklyRestOpeningDays(
                      event.target.value
                    )
                  }
                />
              </DashboardFieldV2>

              <DashboardFieldV2
                id="employee-live-v2-weekly-rest-opening-effective-date"
                label="تاريخ سريان الرصيد"
              >
                <DashboardDatePickerV2
                  id="employee-live-v2-weekly-rest-opening-effective-date"
                  value={
                    weeklyRestOpeningEffectiveDate
                  }
                  max={today}
                  disabled={
                    readOnly || saving
                  }
                  onChange={
                    setWeeklyRestOpeningEffectiveDate
                  }
                />
              </DashboardFieldV2>

              <DashboardFieldV2
                id="employee-live-v2-weekly-rest-opening-reason"
                label="سبب التسوية"
              >
                <input
                  id="employee-live-v2-weekly-rest-opening-reason"
                  className="dsv2-input"
                  value={
                    weeklyRestOpeningReason
                  }
                  maxLength={1500}
                  disabled={
                    readOnly || saving
                  }
                  placeholder="رصيد تاريخي مؤكد من الموارد البشرية"
                  onChange={(event) =>
                    setWeeklyRestOpeningReason(
                      event.target.value
                    )
                  }
                />
              </DashboardFieldV2>
            </div>

            <WorkspaceNoticeV2
              title="تسوية انتقالية"
              description="بعد اعتماد هذا الرصيد لا يتم استبداله أو حذفه. أي تصحيح لاحق يجب أن يكون حركة مستقلة ومدققة."
              tone="neutral"
            />

            <button
              type="button"
              className="dsv2-btn dsv2-btn--success"
              disabled={
                readOnly ||
                saving ||
                weeklyRestOpeningDays === "" ||
                !weeklyRestOpeningEffectiveDate ||
                !weeklyRestOpeningReason
                  .trim()
              }
              onClick={() =>
                void submitHistoricalWeeklyRestOpening()
              }
            >
              {"اعتماد الرصيد التاريخي"}
            </button>
          </>
        )}
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="تسوية رصيد الراحة التعويضية"
        description="استخدم هذه العملية لتصحيح رصيد مؤكد بعد بدء النظام. كل تسوية تسجل كحركة مستقلة ومدققة ولا تعدل الرصيد التاريخي."
      >
        <div className="dsv2-ew-metrics">
          <WorkspaceMetricV2
            label="الرصيد الحالي"
            value={
              loading
                ? "جاري التحميل..."
                : numberLabel(
                    overview?.weeklyRest.dueDays,
                    " يوم"
                  )
            }
            note="رصيد الراحة التعويضية"
            tone={
              Number(
                overview?.weeklyRest.dueDays || 0
              ) > 0
                ? "gold"
                : "neutral"
            }
          />
        </div>

        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2
            id="employee-live-v2-weekly-rest-adjustment-action"
            label="نوع التسوية"
          >
            <select
              id="employee-live-v2-weekly-rest-adjustment-action"
              className="dsv2-input"
              value={
                weeklyRestAdjustmentAction
              }
              disabled={readOnly || saving}
              onChange={(event) =>
                setWeeklyRestAdjustmentAction(
                  event.target.value as
                    | "credit"
                    | "debit"
                )
              }
            >
              <option value="credit">
                إضافة إلى الرصيد
              </option>
              <option value="debit">
                خصم من الرصيد
              </option>
            </select>
          </DashboardFieldV2>

          <DashboardFieldV2
            id="employee-live-v2-weekly-rest-adjustment-days"
            label="عدد الأيام"
          >
            <input
              id="employee-live-v2-weekly-rest-adjustment-days"
              className="dsv2-input"
              inputMode="numeric"
              pattern="[0-9]*"
              value={
                weeklyRestAdjustmentDays
              }
              disabled={readOnly || saving}
              placeholder="1"
              onChange={(event) =>
                setWeeklyRestAdjustmentDays(
                  event.target.value
                )
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="employee-live-v2-weekly-rest-adjustment-effective-date"
            label="تاريخ سريان التسوية"
          >
            <DashboardDatePickerV2
              id="employee-live-v2-weekly-rest-adjustment-effective-date"
              value={
                weeklyRestAdjustmentEffectiveDate
              }
              max={today}
              disabled={readOnly || saving}
              onChange={
                setWeeklyRestAdjustmentEffectiveDate
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="employee-live-v2-weekly-rest-adjustment-reason"
            label="سبب التسوية"
          >
            <input
              id="employee-live-v2-weekly-rest-adjustment-reason"
              className="dsv2-input"
              value={
                weeklyRestAdjustmentReason
              }
              maxLength={1500}
              disabled={readOnly || saving}
              placeholder="مثال: تصحيح استحقاق مؤكد من الموارد البشرية"
              onChange={(event) =>
                setWeeklyRestAdjustmentReason(
                  event.target.value
                )
              }
            />
          </DashboardFieldV2>
        </div>

        <WorkspaceNoticeV2
          title="حركة مدققة وليست تعديلًا مباشرًا"
          description="الإضافة أو الخصم يسجلان في السجل الموحد للراحة التعويضية. لا يتم حذف الرصيد التاريخي أو تعديل الحركات السابقة."
          tone="neutral"
        />

        <button
          type="button"
          className={
            weeklyRestAdjustmentAction ===
            "debit"
              ? "dsv2-btn dsv2-btn--danger"
              : "dsv2-btn dsv2-btn--success"
          }
          disabled={
            readOnly ||
            saving ||
            weeklyRestAdjustmentDays === "" ||
            !weeklyRestAdjustmentEffectiveDate ||
            !weeklyRestAdjustmentReason.trim()
          }
          onClick={() =>
            void submitWeeklyRestAdjustment()
          }
        >
          {weeklyRestAdjustmentAction ===
          "credit"
            ? "إضافة التسوية"
            : "خصم التسوية"}
        </button>
      </WorkspaceCardV2>
      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2
          title="استدعاء من الإجازة السنوية"
          description="هذه العملية ليست لإضافة رصيد إجازة. تستخدم فقط عند استدعاء موظفة أثناء إجازة سنوية معتمدة قائمة."
        >
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2
              id="employee-live-v2-leave-recall-date"
              label="تاريخ الاستدعاء"
            >
              <DashboardDatePickerV2
                id="employee-live-v2-leave-recall-date"
                value={recallDate}
                max={today}
                disabled={readOnly || saving}
                onChange={setRecallDate}
              />
            </DashboardFieldV2>

            <DashboardFieldV2
              id="employee-live-v2-leave-recall-reason"
              label="سبب الاستدعاء"
            >
              <input
                id="employee-live-v2-leave-recall-reason"
                className="dsv2-input"
                value={recallReason}
                disabled={readOnly || saving}
                placeholder="مثال: احتياج تشغيلي طارئ"
                onChange={(event) =>
                  setRecallReason(
                    event.target.value
                  )
                }
              />
            </DashboardFieldV2>
          </div>

          <WorkspaceNoticeV2
            title={
              recallLeave
                ? "الإجازة السنوية المطابقة"
                : "لا توجد إجازة مطابقة"
            }
            description={
              recallLeave
                ? `من ${fmtIsoDate(
                    recallLeave.startDate
                  )} إلى ${fmtIsoDate(
                    recallLeave.endDate
                  )}. سيتم استرجاع يوم واحد فقط.`
                : `اختر تاريخًا داخل إجازة سنوية معتمدة. ${nearbyApprovedAnnualLeavesDescription}`
            }
            tone={
              recallLeave
                ? "neutral"
                : "gold"
            }
          />

          <button
            type="button"
            className="dsv2-btn dsv2-btn--success"
            disabled={
              readOnly ||
              saving ||
              !recallLeave
            }
            onClick={() => void submitRecall()}
          >
            تسجيل الاستدعاء
          </button>
        </WorkspaceCardV2>

        <WorkspaceCardV2
          title="تكليف بالعمل في يوم الراحة"
          description="يفتح البصمة والحجز لهذا اليوم فقط ولا يحول يوم الراحة الأصلي إلى يوم دوام دائم."
        >
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2
              id="employee-live-v2-weekly-rest-work-date"
              label="يوم الراحة"
            >
              <DashboardDatePickerV2
                id="employee-live-v2-weekly-rest-work-date"
                value={restDate}
                disabled={readOnly || saving}
                onChange={setRestDate}
              />
            </DashboardFieldV2>

            <DashboardFieldV2
              id="employee-live-v2-weekly-rest-work-reason"
              label="سبب التكليف"
            >
              <input
                id="employee-live-v2-weekly-rest-work-reason"
                className="dsv2-input"
                value={restReason}
                disabled={readOnly || saving}
                placeholder="مثال: ضغط حجوزات طارئ"
                onChange={(event) =>
                  setRestReason(
                    event.target.value
                  )
                }
              />
            </DashboardFieldV2>

            <DashboardFieldV2
              id="employee-live-v2-weekly-rest-work-start"
              label="بداية العمل"
            >
              <DashboardTimePickerV2
                id="employee-live-v2-weekly-rest-work-start"
                value={restStartTime}
                clock="12h"
                disabled={readOnly || saving}
                onChange={setRestStartTime}
              />
            </DashboardFieldV2>

            <DashboardFieldV2
              id="employee-live-v2-weekly-rest-work-end"
              label="نهاية العمل"
            >
              <DashboardTimePickerV2
                id="employee-live-v2-weekly-rest-work-end"
                value={restEndTime}
                clock="12h"
                disabled={readOnly || saving}
                onChange={setRestEndTime}
              />
            </DashboardFieldV2>
          </div>

          <WorkspaceNoticeV2
            title="الراحة الأسبوعية الأصلية محفوظة"
            description="بعد اكتمال الحضور الفعلي يُسجل استحقاق الراحة التعويضية في رصيد مستقل، ولا يضاف إلى رصيد الإجازة السنوية."
            tone="neutral"
          />

          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            disabled={readOnly || saving}
            onClick={() =>
              void submitWeeklyRestWork()
            }
          >
            تسجيل تكليف يوم الراحة
          </button>
        </WorkspaceCardV2>
      </div>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2
          title="استدعاءات الإجازة السنوية"
          description="الاستدعاءات الفعالة المسجلة على الأيام السنوية."
        >
          <WorkspaceTableV2
            headers={[
              "التاريخ",
              "السبب",
              "الحالة",
              "إجراء",
            ]}
            rows={activeRecalls.map(
              (recall) => [
                fmtIsoDate(
                  recall.recallDate
                ),
                recall.reason || "—",
                <WorkspaceStatusBadgeV2
                  key={`${recall.id}-status`}
                  tone="success"
                >
                  {statusLabel(
                    recall.status
                  )}
                </WorkspaceStatusBadgeV2>,
                <button
                  key={`${recall.id}-cancel`}
                  type="button"
                  className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                  disabled={readOnly || saving}
                  onClick={() =>
                    void cancelRecall(
                      recall
                    )
                  }
                >
                  إلغاء
                </button>,
              ]
            )}
            emptyText={
              loading
                ? "جاري التحميل..."
                : "لا توجد استدعاءات فعالة."
            }
          />
        </WorkspaceCardV2>

        <WorkspaceCardV2
          title="تكليفات أيام الراحة"
          description="آخر تكليفات العمل المسجلة على أيام الراحة الأسبوعية."
        >
          <WorkspaceTableV2
            headers={[
              "التاريخ",
              "الوقت",
              "الحالة",
              "إجراء",
            ]}
            rows={assignments.map(
              (assignment) => [
                fmtIsoDate(
                  assignment.restDate
                ),
                `${formatTime12Hour(assignment.startTime)} – ${formatTime12Hour(assignment.endTime)}`,
                <WorkspaceStatusBadgeV2
                  key={`${assignment.id}-status`}
                  tone={
                    assignment.status ===
                    "completed"
                      ? "success"
                      : assignment.status ===
                        "cancelled"
                      ? "danger"
                      : "gold"
                  }
                >
                  {statusLabel(
                    assignment.status
                  )}
                </WorkspaceStatusBadgeV2>,
                assignment.status ===
                "assigned" ? (
                  <button
                    key={`${assignment.id}-cancel`}
                    type="button"
                    className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                    disabled={readOnly || saving}
                    onClick={() =>
                      void cancelAssignment(
                        assignment
                      )
                    }
                  >
                    إلغاء
                  </button>
                ) : (
                  "—"
                ),
              ]
            )}
            emptyText={
              loading
                ? "جاري التحميل..."
                : "لا توجد تكليفات مسجلة."
            }
          />
        </WorkspaceCardV2>
      </div>
    </>
  );
}
