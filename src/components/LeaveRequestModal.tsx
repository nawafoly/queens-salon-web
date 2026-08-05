import React, { useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    setType(defaultType);
  }, [defaultType]);

  useEffect(() => {
    setFromDate(initialDate || "");
    setToDate(initialDate || "");
    setNote("");
  }, [initialDate, open]);

  useEffect(() => {
    const policy = LEAVE_TYPE_POLICY[type] || { deductFromBalance: false, affectsPayroll: false };
    setDeductFromBalance(policy.deductFromBalance);
    setAffectsPayroll(policy.affectsPayroll);
  }, [type]);

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
    <div className="modal-overlay">
      <div className="modal-dialog">
        <h3>تسجيل إجازة</h3>
        <div className="form-row">
          <label>نوع الإجازة</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="annual">annual</option>
            <option value="sick">sick</option>
            <option value="emergency">emergency</option>
            <option value="unpaid">unpaid</option>
            <option value="rest">rest</option>
            <option value="other">other</option>
          </select>
        </div>
        <div className="form-row">
          <label>من تاريخ</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="form-row">
          <label>إلى تاريخ</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="form-row">
          <label>عدد الأيام</label>
          <input type="text" readOnly value={String(days)} />
        </div>
        <div className="form-row">
          <label>
            <input type="checkbox" checked={deductFromBalance} onChange={(e) => setDeductFromBalance(e.target.checked)} /> خصم من الرصيد
          </label>
          <label style={{ marginLeft: 12 }}>
            <input type="checkbox" checked={affectsPayroll} onChange={(e) => setAffectsPayroll(e.target.checked)} /> تؤثر على الراتب
          </label>
        </div>
        <div className="form-row">
          <label>ملاحظة</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {errors.length > 0 && (
          <div className="form-errors">
            {errors.map((err, i) => (
              <div key={i} className="error">{err}</div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose} disabled={submitting}>إلغاء</button>
          <button onClick={handleSubmit} disabled={submitting}>حفظ واعتماد</button>
        </div>
      </div>
    </div>
  );
}
