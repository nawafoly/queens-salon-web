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
  const [note, setNote] = useState("");
  const [deductFromBalance, setDeductFromBalance] = useState(false);
  const [affectsPayroll, setAffectsPayroll] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const isOtherLeaveType = type === "other";
  const selectedTypeLabel = LEAVE_TYPE_LABELS[type] || "غير محدد";

  useEffect(() => {
    setType(defaultType);
  }, [defaultType]);

  useEffect(() => {
    if (!open) return;
    setFromDate(initialDate || "");
    setToDate(initialDate || "");
    setNote("");
    setErrors([]);
    setSubmitting(false);
  }, [initialDate, open]);

  useEffect(() => {
    if (isOtherLeaveType) {
      setDeductFromBalance(false);
      setAffectsPayroll(false);
      return;
    }
    const policy = LEAVE_TYPE_POLICY[type] || { deductFromBalance: false, affectsPayroll: false };
    setDeductFromBalance(policy.deductFromBalance);
    setAffectsPayroll(policy.affectsPayroll);
  }, [type, isOtherLeaveType]);

  const days = useMemo(() => {
    if (!fromDate || !toDate) return 0;
    try {
      const f = new Date(`${fromDate}T00:00:00`);
      const t = new Date(`${toDate}T00:00:00`);
      const diff = Math.floor((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return diff > 0 ? diff : 0;
    } catch {
      return 0;
    }
  }, [fromDate, toDate]);

  const validate = (): string[] => {
    const result: string[] = [];
    if (!type) result.push("اختر نوع الإجازة.");
    if (!fromDate) result.push("اختر تاريخ البداية.");
    if (!toDate) result.push("اختر تاريخ النهاية.");
    if (days <= 0) result.push("المدى الزمني غير صحيح.");
    if (deductFromBalance && availableBalance != null && availableBalance < days) {
      result.push("الرصيد غير كافٍ لهذه الإجازة.");
    }
    if (hasAttendanceInRange && hasAttendanceInRange(fromDate, toDate)) {
      result.push("يوجد بصمة داخل النطاق المحدد.");
    }
    if (hasOverlappingLeave && hasOverlappingLeave(fromDate, toDate)) {
      result.push("توجد إجازة معتمدة تتداخل مع النطاق المحدد.");
    }
    return result;
  };

  const handleFromDateChange = (value: string) => {
    setFromDate(value);
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
      title="تسجيل إجازة"
      description="حدّد نوع الإجازة وفترتها، ثم راجع أثرها على الرصيد والراتب قبل الاعتماد."
      eyebrow="طلبات الإجازات"
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
            {submitting ? "جاري الاعتماد..." : "اعتماد الإجازة"}
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

        <div className="leave-request-v2__date-grid">
          <DashboardFieldV2 id="leave-from-date-v2" label="من تاريخ" required>
            <DashboardDatePickerV2
              id="leave-from-date-v2"
              value={fromDate}
              max={toDate || undefined}
              onChange={handleFromDateChange}
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="leave-to-date-v2" label="إلى تاريخ" required>
            <DashboardDatePickerV2
              id="leave-to-date-v2"
              value={toDate}
              min={fromDate || undefined}
              onChange={setToDate}
            />
          </DashboardFieldV2>
        </div>

        <section className="leave-request-v2__summary" aria-label="ملخص الإجازة">
          <div className="leave-request-v2__summary-item">
            <span>النوع</span>
            <strong>{selectedTypeLabel}</strong>
          </div>
          <div className="leave-request-v2__summary-item">
            <span>عدد الأيام</span>
            <strong>{days > 0 ? `${days} يوم` : "—"}</strong>
          </div>
          <div className="leave-request-v2__summary-item">
            <span>الرصيد المتاح</span>
            <strong>{availableBalance == null ? "غير محدد" : `${availableBalance} يوم`}</strong>
          </div>
        </section>

        <section className="leave-request-v2__policy" aria-labelledby="leave-policy-title-v2">
          <header className="leave-request-v2__section-head">
            <div>
              <h3 id="leave-policy-title-v2">سياسة الاحتساب</h3>
              <p>
                {isOtherLeaveType
                  ? "نوع «أخرى» يسمح بتحديد السياسة يدويًا."
                  : "تم ضبط السياسة تلقائيًا حسب نوع الإجازة المختار."}
              </p>
            </div>
            <span className={`dsv2-badge ${affectsPayroll ? "dsv2-badge--danger" : "dsv2-badge--success"}`}>
              {affectsPayroll ? "تؤثر على الراتب" : "لا تؤثر على الراتب"}
            </span>
          </header>

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
        </section>

        <DashboardFieldV2
          id="leave-note-v2"
          label="ملاحظة"
          hint="اختياري — تظهر الملاحظة في سجل الإجازة والمراجعة."
        >
          <textarea
            id="leave-note-v2"
            className="dsv2-textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="اكتب سبب الإجازة أو أي تفاصيل يحتاجها المسؤول..."
            rows={4}
          />
        </DashboardFieldV2>

        {errors.length > 0 ? (
          <div className="leave-request-v2__errors" role="alert" aria-live="assertive">
            <strong>تعذر اعتماد الإجازة</strong>
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
