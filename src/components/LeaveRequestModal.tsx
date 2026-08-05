import React, { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
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

  useEffect(() => {
    setType(defaultType);
  }, [defaultType]);

  useEffect(() => {
    setFromDate(initialDate || "");
    setToDate(initialDate || "");
    setNote("");
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
      const f = new Date(fromDate);
      const t = new Date(toDate);
      const diff = Math.floor((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return diff > 0 ? diff : 0;
    } catch (e) {
      return 0;
    }
  }, [fromDate, toDate]);

  const validate = (): string[] => {
    const res: string[] = [];
    if (!type) res.push("اختر نوع الإجازة.");
    if (!fromDate) res.push("اختر تاريخ البداية.");
    if (!toDate) res.push("اختر تاريخ النهاية.");
    if (days <= 0) res.push("المدى الزمني غير صحيح.");
    if (deductFromBalance && availableBalance != null && availableBalance < days) res.push("الرصيد غير كافٍ لهذه الإجازة.");
    if (hasAttendanceInRange && hasAttendanceInRange(fromDate, toDate)) res.push("يوجد بصمة داخل النطاق المحدد.");
    if (hasOverlappingLeave && hasOverlappingLeave(fromDate, toDate)) res.push("توجد إجازة معتمدة تتداخل مع النطاق المحدد.");
    return res;
  };

  const handleSubmit = async () => {
    const v = validate();
    setErrors(v);
    if (v.length) return;
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
    } catch (e: any) {
      setErrors([String(e?.message || e || "تعذر حفظ الطلب.")]);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="تسجيل إجازة"
      panelClassName="leave-request-modal__panel"
      overlayClassName="leave-request-modal__overlay"
      size="md"
    >
      <div className="leave-request-modal">
        <div className="leave-request-modal__head">
          <div className="leave-request-modal__titles">
            <span className="leave-request-modal__eyebrow">طلب جديد</span>
            <h3 className="leave-request-modal__title">تسجيل إجازة</h3>
            <p className="leave-request-modal__subtitle">حدد نوع الإجازة والمدى ثم اعتمد الطلب.</p>
          </div>
          <button
            type="button"
            className="leave-request-modal__close"
            onClick={onClose}
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        <div className="leave-request-modal__body">
          <div className="leave-request-modal__field">
            <label className="leave-request-modal__label" htmlFor="leave-type">
              نوع الإجازة
            </label>
            <select
              id="leave-type"
              className="leave-request-modal__select"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="annual">{LEAVE_TYPE_LABELS.annual}</option>
              <option value="sick">{LEAVE_TYPE_LABELS.sick}</option>
              <option value="emergency">{LEAVE_TYPE_LABELS.emergency}</option>
              <option value="unpaid">{LEAVE_TYPE_LABELS.unpaid}</option>
              <option value="rest">{LEAVE_TYPE_LABELS.rest}</option>
              <option value="other">{LEAVE_TYPE_LABELS.other}</option>
            </select>
          </div>

          <div className="leave-request-modal__grid">
            <div className="leave-request-modal__field">
              <label className="leave-request-modal__label" htmlFor="from-date">
                من تاريخ
              </label>
              <input
                id="from-date"
                type="date"
                className="leave-request-modal__input"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="leave-request-modal__field">
              <label className="leave-request-modal__label" htmlFor="to-date">
                إلى تاريخ
              </label>
              <input
                id="to-date"
                type="date"
                className="leave-request-modal__input"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>

          <div className="leave-request-modal__field">
            <label className="leave-request-modal__label" htmlFor="leave-days">
              عدد الأيام
            </label>
            <input
              id="leave-days"
              type="text"
              className="leave-request-modal__input leave-request-modal__input--readonly"
              readOnly
              value={String(days)}
            />
            <p className="leave-request-modal__field-hint">يتم الحساب تلقائيًا حسب نطاق التواريخ.</p>
          </div>

          <div className="leave-request-modal__toggles">
            <div className={`leave-request-modal__toggle-card ${isOtherLeaveType ? "" : "leave-request-modal__toggle-card--locked"}`}>
              <div className="leave-request-modal__toggle-info">
                <div>
                  <span className="leave-request-modal__toggle-title">خصم من الرصيد</span>
                  <span className="leave-request-modal__toggle-meta">
                    {isOtherLeaveType ? "يمكن تعديل الخيار يدويًا." : "محدد تلقائيًا حسب نوع الإجازة."}
                  </span>
                </div>
                <label className="leave-request-modal__switch">
                  <input
                    type="checkbox"
                    checked={deductFromBalance}
                    disabled={!isOtherLeaveType}
                    onChange={(e) => setDeductFromBalance(e.target.checked)}
                  />
                  <span className="leave-request-modal__slider" />
                </label>
              </div>
            </div>

            <div className={`leave-request-modal__toggle-card ${isOtherLeaveType ? "" : "leave-request-modal__toggle-card--locked"}`}>
              <div className="leave-request-modal__toggle-info">
                <div>
                  <span className="leave-request-modal__toggle-title">تؤثر على الراتب</span>
                  <span className="leave-request-modal__toggle-meta">
                    {isOtherLeaveType ? "يمكن تعديل الخيار يدويًا." : "محدد تلقائيًا حسب نوع الإجازة."}
                  </span>
                </div>
                <label className="leave-request-modal__switch">
                  <input
                    type="checkbox"
                    checked={affectsPayroll}
                    disabled={!isOtherLeaveType}
                    onChange={(e) => setAffectsPayroll(e.target.checked)}
                  />
                  <span className="leave-request-modal__slider" />
                </label>
              </div>
            </div>
          </div>

          <div className="leave-request-modal__field">
            <label className="leave-request-modal__label" htmlFor="leave-note">
              ملاحظة
            </label>
            <textarea
              id="leave-note"
              className="leave-request-modal__textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
            />
          </div>

          {errors.length > 0 && (
            <div className="leave-request-modal__errors" role="alert">
              {errors.map((err, i) => (
                <div key={i} className="leave-request-modal__error">
                  {err}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="leave-request-modal__actions">
          <button
            type="button"
            className="leave-request-modal__button leave-request-modal__button--secondary"
            onClick={onClose}
            disabled={submitting}
          >
            إلغاء
          </button>
          <button
            type="button"
            className="leave-request-modal__button leave-request-modal__button--primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "جاري الحفظ..." : "اعتماد الإجازة"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
