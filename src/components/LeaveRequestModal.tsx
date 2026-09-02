import { DashboardTimeInputV2 } from "./dashboard-v2/DashboardNativeControlBridgeV2";
import { useEffect, useMemo, useState } from "react";
import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardModalV2,
  DashboardSelectV2,
} from "./dashboard-v2";
import { WorkspaceSwitchV2 } from "./dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import "../styles/LeaveRequestModal.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    type: string;
    fromDate: string;
    toDate: string;
    days: number;
    durationKind: "full_day" | "partial";
    partialStartTime: string;
    partialEndTime: string;
    deductFromBalance: boolean;
    affectsPayroll: boolean;
    note: string;
  }) => Promise<void> | void;
  initialDate?: string;
  defaultType?: string;
  availableBalance?: number | null;
  hasAttendanceInRange?: (fromDate: string, toDate: string) => boolean;
  hasOverlappingLeave?: (fromDate: string, toDate: string) => boolean;
};

const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: "سنوية",
  sick: "مرضية",
  emergency: "طارئة",
  unpaid: "غير مدفوعة",
  rest: "راحة",
  other: "أخرى",
};

const LEAVE_TYPE_OPTIONS = Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const LEAVE_TYPE_POLICY: Record<string, { deductFromBalance: boolean; affectsPayroll: boolean }> = {
  annual: { deductFromBalance: true, affectsPayroll: false },
  emergency: { deductFromBalance: true, affectsPayroll: false },
  unpaid: { deductFromBalance: false, affectsPayroll: true },
  rest: { deductFromBalance: false, affectsPayroll: false },
  other: { deductFromBalance: false, affectsPayroll: false },
  sick: { deductFromBalance: true, affectsPayroll: false },
};

export default function LeaveRequestModal({
  open,
  onClose,
  onSubmit,
  initialDate,
  defaultType = "emergency",
  availableBalance = null,
  hasAttendanceInRange,
  hasOverlappingLeave,
}: Props) {
  const [type, setType] = useState(defaultType);
  const [fromDate, setFromDate] = useState(initialDate || "");
  const [toDate, setToDate] = useState(initialDate || "");
  const [durationKind, setDurationKind] = useState<"full_day" | "partial">("full_day");
  const [partialStartTime, setPartialStartTime] = useState("18:00");
  const [partialEndTime, setPartialEndTime] = useState("20:00");
  const [note, setNote] = useState("");
  const [deductFromBalance, setDeductFromBalance] = useState(false);
  const [affectsPayroll, setAffectsPayroll] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const isOtherLeaveType = type === "other";
  const isPartialLeave = durationKind === "partial";
  const selectedTypeLabel = LEAVE_TYPE_LABELS[type] || "غير محدد";

  useEffect(() => {
    setType(defaultType);
  }, [defaultType]);

  useEffect(() => {
    if (!open) return;
    setType(defaultType);
    setFromDate(initialDate || "");
    setToDate(initialDate || "");
    setDurationKind("full_day");
    setPartialStartTime("18:00");
    setPartialEndTime("20:00");
    setNote("");
    setErrors([]);
    setSubmitting(false);
  }, [defaultType, initialDate, open]);

  useEffect(() => {
    if (isPartialLeave || isOtherLeaveType) {
      setDeductFromBalance(false);
      setAffectsPayroll(false);
      return;
    }
    const policy = LEAVE_TYPE_POLICY[type] || { deductFromBalance: false, affectsPayroll: false };
    setDeductFromBalance(policy.deductFromBalance);
    setAffectsPayroll(policy.affectsPayroll);
  }, [type, isOtherLeaveType, isPartialLeave]);

  const days = useMemo(() => {
    if (isPartialLeave) return fromDate ? 1 : 0;
    if (!fromDate || !toDate) return 0;
    try {
      const f = new Date(`${fromDate}T00:00:00`);
      const t = new Date(`${toDate}T00:00:00`);
      const diff = Math.floor((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return diff > 0 ? diff : 0;
    } catch {
      return 0;
    }
  }, [fromDate, isPartialLeave, toDate]);

  const validate = (): string[] => {
    const result: string[] = [];
    if (!isPartialLeave && !type) result.push("اختر نوع الإجازة.");
    if (!fromDate) result.push("اختر تاريخ البداية.");
    if (!toDate) result.push("اختر تاريخ النهاية.");
    if (days <= 0) result.push("المدى الزمني غير صحيح.");
    if (isPartialLeave) {
      if (fromDate !== toDate) result.push("الاستئذان يجب أن يكون في يوم واحد.");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(partialStartTime)) result.push("حدد وقت بداية صحيح للاستئذان.");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(partialEndTime)) result.push("حدد وقت نهاية صحيح للاستئذان.");
      if (partialStartTime >= partialEndTime) result.push("وقت نهاية الاستئذان يجب أن يكون بعد وقت البداية.");
    }
    if (!isPartialLeave && deductFromBalance && availableBalance != null && availableBalance < days) {
      result.push("الرصيد غير كافٍ لهذه الإجازة.");
    }
    if (!isPartialLeave && hasAttendanceInRange && hasAttendanceInRange(fromDate, toDate)) {
      result.push("يوجد بصمة داخل النطاق المحدد.");
    }
    if (hasOverlappingLeave && hasOverlappingLeave(fromDate, toDate)) {
      result.push("توجد إجازة معتمدة تتداخل مع النطاق المحدد.");
    }
    return result;
  };

  const handleFromDateChange = (value: string) => {
    setFromDate(value);
    if (isPartialLeave) {
      setToDate(value);
      return;
    }
    if (value && (!toDate || toDate < value)) {
      setToDate(value);
    }
  };

  const handleSubmit = async () => {
    const validationErrors = validate();
    setErrors(validationErrors);
    if (validationErrors.length) return;

    setSubmitting(true);
    try {
      await onSubmit({
        type,
        fromDate,
        toDate,
        days,
        durationKind,
        partialStartTime: isPartialLeave ? partialStartTime : "",
        partialEndTime: isPartialLeave ? partialEndTime : "",
        deductFromBalance,
        affectsPayroll,
        note,
      });
      onClose();
    } catch (error: any) {
      setErrors([String(error?.message || error || "تعذر حفظ الطلب.")]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardModalV2
      open={open}
      onClose={onClose}
      title="تسجيل إجازة أو استئذان"
      description={isPartialLeave ? "حدّد فترة الاستئذان؛ هذه الفترة فقط ستُحجب من الحجز." : "اختر إجازة أو استئذان، ثم أدخل البيانات المطلوبة للاعتماد."}
      eyebrow="الحضور والإجازات"
      size="md"
      tone="gold"
      className="leave-request-v2__modal"
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
      footer={
        <>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--primary"
            data-dsv2-autofocus="true"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "جاري الاعتماد..." : isPartialLeave ? "اعتماد الاستئذان" : "اعتماد الإجازة"}
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            onClick={onClose}
            disabled={submitting}
          >
            إلغاء
          </button>
        </>
      }
    >
      <div className="leave-request-v2__form">
        <DashboardFieldV2 id="leave-duration-kind-v2" label="نوع التسجيل" required>
          <DashboardSelectV2
            id="leave-duration-kind-v2"
            value={durationKind}
            options={[
              { value: "full_day", label: "إجازة" },
              { value: "partial", label: "استئذان" },
            ]}
            onChange={(value) => {
              const next = value === "partial" ? "partial" : "full_day";
              setDurationKind(next);
              if (next === "partial") {
                setToDate(fromDate);
                setDeductFromBalance(false);
                setAffectsPayroll(false);
              }
              setErrors([]);
            }}
          />
        </DashboardFieldV2>

        {!isPartialLeave ? (
          <DashboardFieldV2 id="leave-type-v2" label="نوع الإجازة" required>
            <DashboardSelectV2
              id="leave-type-v2"
              value={type}
              options={LEAVE_TYPE_OPTIONS}
              onChange={(value) => {
                setType(value);
                setErrors([]);
              }}
            />
          </DashboardFieldV2>
        ) : null}

        <div className="leave-request-v2__date-grid">
          <DashboardFieldV2 id="leave-from-date-v2" label={isPartialLeave ? "التاريخ" : "من تاريخ"} required>
            <DashboardDatePickerV2
              id="leave-from-date-v2"
              value={fromDate}
              onChange={handleFromDateChange}
            />
          </DashboardFieldV2>

          {!isPartialLeave ? (
            <DashboardFieldV2 id="leave-to-date-v2" label="إلى تاريخ" required>
              <DashboardDatePickerV2
                id="leave-to-date-v2"
                value={toDate}
                min={fromDate || undefined}
                onChange={setToDate}
              />
            </DashboardFieldV2>
          ) : null}
        </div>

        {isPartialLeave ? (
          <div className="leave-request-v2__date-grid leave-request-v2__time-grid">
            <DashboardFieldV2 id="leave-partial-start-v2" label="من الساعة" required>
              <DashboardTimeInputV2 id="leave-partial-start-v2" className="leave-request-v2__time-input" value={partialStartTime} onChange={(event) => { setPartialStartTime(event.target.value); setErrors([]); }} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="leave-partial-end-v2" label="إلى الساعة" required>
              <DashboardTimeInputV2 id="leave-partial-end-v2" className="leave-request-v2__time-input" value={partialEndTime} onChange={(event) => { setPartialEndTime(event.target.value); setErrors([]); }} />
            </DashboardFieldV2>
          </div>
        ) : null}

        <section className="leave-request-v2__summary" aria-label="ملخص التسجيل">
          <div className="leave-request-v2__summary-item">
            <span>التسجيل</span>
            <strong>{isPartialLeave ? "استئذان" : "إجازة"}</strong>
          </div>
          <div className="leave-request-v2__summary-item">
            <span>{isPartialLeave ? "التاريخ" : "نوع الإجازة"}</span>
            <strong>{isPartialLeave ? fromDate || "—" : selectedTypeLabel}</strong>
          </div>
          <div className="leave-request-v2__summary-item">
            <span>{isPartialLeave ? "الفترة" : "عدد الأيام"}</span>
            <strong>{isPartialLeave ? `${partialStartTime} – ${partialEndTime}` : days > 0 ? `${days} يوم` : "—"}</strong>
          </div>
          {!isPartialLeave ? (
            <div className="leave-request-v2__summary-item">
              <span>الرصيد المتاح</span>
              <strong>{availableBalance == null ? "غير محدد" : `${availableBalance} يوم`}</strong>
            </div>
          ) : null}
        </section>

        <section className="leave-request-v2__policy" aria-labelledby="leave-policy-title-v2">
          <header className="leave-request-v2__section-head">
            <div>
              <h3 id="leave-policy-title-v2">{isPartialLeave ? "أثر الاستئذان" : "سياسة الاحتساب"}</h3>
              <p>
                {isPartialLeave
                  ? "الاستئذان يحجب فترة الحجز المحددة فقط، ولا تخصم يومًا كاملًا من الرصيد أو الراتب."
                  : isOtherLeaveType
                    ? "نوع «أخرى» يسمح بتحديد السياسة يدويًا."
                    : "تم ضبط السياسة تلقائيًا حسب نوع الإجازة المختار."}
              </p>
            </div>
            <span className={`dsv2-badge ${affectsPayroll ? "dsv2-badge--danger" : "dsv2-badge--success"}`}>
              {isPartialLeave ? "لا خصم — حجب وقتي" : affectsPayroll ? "تؤثر على الراتب" : "لا تؤثر على الراتب"}
            </span>
          </header>

          {!isPartialLeave ? (
            <div className="dsv2-ew-switch-list leave-request-v2__switch-list">
              <WorkspaceSwitchV2
                checked={deductFromBalance}
                onChange={setDeductFromBalance}
                disabled={!isOtherLeaveType}
                label="خصم من رصيد الإجازات"
                description={
                  deductFromBalance
                    ? "سيتم خصم عدد الأيام من رصيد الموظفة عند الاعتماد."
                    : "لن يتم خصم هذه المدة من رصيد الإجازات."
                }
              />
              <WorkspaceSwitchV2
                checked={affectsPayroll}
                onChange={setAffectsPayroll}
                disabled={!isOtherLeaveType}
                label="تؤثر على الراتب"
                description={
                  affectsPayroll
                    ? "ستدخل هذه الأيام ضمن الخصم في دورة الرواتب."
                    : "ستُستبعد هذه الأيام من الغياب والخصم في الراتب."
                }
              />
            </div>
          ) : null}
        </section>

        <DashboardFieldV2
          id="leave-note-v2"
          label={isPartialLeave ? "سبب الاستئذان" : "ملاحظة"}
          hint={isPartialLeave ? "اختياري — يظهر السبب في سجل الاستئذان." : "اختياري — تظهر الملاحظة في سجل الإجازة والمراجعة."}
        >
          <textarea
            id="leave-note-v2"
            className="dsv2-textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={isPartialLeave ? "اكتب سبب الاستئذان أو أي تفاصيل يحتاجها المسؤول..." : "اكتب سبب الإجازة أو أي تفاصيل يحتاجها المسؤول..."}
            rows={4}
          />
        </DashboardFieldV2>

        {errors.length > 0 ? (
          <div className="leave-request-v2__errors" role="alert" aria-live="assertive">
            <strong>{isPartialLeave ? "تعذر اعتماد الاستئذان" : "تعذر اعتماد الإجازة"}</strong>
            <ul>
              {errors.map((error, index) => (
                <li key={`${error}-${index}`}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </DashboardModalV2>
  );
}
