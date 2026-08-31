import { useCallback, useEffect, useMemo, useState } from "react";
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
      const [nextOverview, leaves] =
        await Promise.all([
          CoreHrService.getLeaveRestOverview(
            employeeId
          ),
          CoreHrService.listLeaves({
            employeeId,
            status: "approved",
          }),
        ]);

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
        description="يعرض الاستحقاق، المكتسب، الافتتاحي، المستخدم، والمسترجع قبل احتساب الرصيد المتاح."
      >
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
            label="المكتسب حتى اليوم"
            value={
              loading
                ? "جاري التحميل..."
                : numberLabel(
                    annualLeave.earnedCurrentServiceYearDays ??
                      annualLeave.accruedDays,
                    " يوم"
                  )
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
