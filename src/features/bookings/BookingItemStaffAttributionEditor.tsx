import { useCallback, useEffect, useState } from "react";
import { CoreBookingService } from "../../services/CoreBookingService";
import { coreApiRequest } from "../../services/coreApiClient";
import type { CoreBooking, CoreBookingItem } from "../../types/coreApi";

type StaffRow = { id: string; name: string };
type Props = {
  bookingId: string;
  canCorrect: boolean;
  language: "ar" | "en";
};

function displayStaff(item: CoreBookingItem) {
  return item.staffName || item.staffId || "—";
}

// This section always reads the actual Core booking items, not the flattened
// legacy booking/first-service projection used by the main edit form.
export default function BookingItemStaffAttributionEditor({ bookingId, canCorrect, language }: Props) {
  const [booking, setBooking] = useState<CoreBooking | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingItemId, setEditingItemId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const english = language === "en";

  const refresh = useCallback(async () => {
    const result = await CoreBookingService.get(bookingId);
    setBooking(result);
  }, [bookingId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSuccess("");
    setEditingItemId("");
    setReason("");
    void Promise.all([
      CoreBookingService.get(bookingId),
      canCorrect
        ? coreApiRequest<Record<string, unknown>[]>("/api/core/staff", { query: { active: false } })
        : Promise.resolve([]),
    ]).then(([details, employees]) => {
      if (!active) return;
      setBooking(details);
      // Raw Core IDs are intentional: the historical DB has multiple
      // differently encoded employee identities that must not be merged here.
      setStaff(employees.map(row => ({
        id: String(row.id || "").trim(),
        name: String(row.name || "").trim(),
      })).filter(row => row.id && row.name));
    }).catch(() => {
      if (active) setError(english ? "Could not load service assignments." : "تعذر تحميل موظفات الخدمات من Core.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [bookingId, canCorrect, english]);

  const correct = async (item: CoreBookingItem) => {
    if (!canCorrect || busy || !staffId || reason.trim().length < 10) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await CoreBookingService.correctCompletedItemStaff(bookingId, item.id, {
        expectedStaffId: item.staffId || "",
        staffId,
        reason: reason.trim(),
      });
      await refresh();
      setEditingItemId("");
      setStaffId("");
      setReason("");
      setSuccess(english
        ? "Only this service's staff assignment was corrected and audited."
        : "تم تصحيح إسناد هذه الخدمة وحدها وتسجيل العملية في سجل التدقيق.");
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
      const messages: Record<string, string> = {
        "core_booking_item:concurrent_staff_change": "تغيّر إسناد الخدمة من جلسة أخرى. أعيدي فتح الحجز.",
        "core_booking_item:target_not_employed_on_service_date": "الموظفة المختارة ليست ضمن فترة عملها بتاريخ تنفيذ الخدمة.",
        "core_booking_item:approved_payroll_requires_review": "يوجد راتب معتمد لهذه الفترة؛ يلزم مراجعته قبل تصحيح إسناد الخدمة.",
        "core_booking_item:closed_financial_day_requires_review": "هذا اليوم المالي مقفل؛ يلزم مسار مراجعة مالي معتمد قبل تغيير إسناد الخدمة.",
      };
      setError(messages[code] || (english
        ? "Correction was rejected. Refresh and verify the employee."
        : "تعذر التصحيح. حدّثي الحجز وتحققي من الموظفة."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bk-edit-grid" aria-label={english ? "Services and assigned staff" : "الخدمات والموظفات المسجلات"}>
      <div className="bk-field-label">
        {english ? "Staff assigned to each service (Core D1)" : "الموظفة المسجلة لكل خدمة (من Core D1)"}
      </div>
      {loading ? (
        <small className="bk-helper-text">{english ? "Loading service items..." : "جاري تحميل بنود الخدمات..."}</small>
      ) : (booking?.items || []).length === 0 ? (
        <small className="bk-helper-text">{english ? "No service items." : "لا توجد بنود خدمات."}</small>
      ) : (
        (booking?.items || []).map(item => (
          <div key={item.id} className="bk-edit-picker-field" style={{ padding: "10px 0" }}>
            <div className="bk-field-label">{item.serviceNameSnapshot}</div>
            <div>{english ? "Recorded staff" : "الموظفة المسجلة"}: <strong>{displayStaff(item)}</strong></div>
            <small className="bk-helper-text">ID: {item.id} | {item.staffId || "—"}</small>
            {canCorrect && booking?.status === "completed" && (
              editingItemId !== item.id ? (
                <button type="button" className="dsv2-btn dsv2-btn--secondary"
                  onClick={() => { setEditingItemId(item.id); setStaffId(""); setReason(""); setError(""); setSuccess(""); }}>
                  {english ? "Correct this service's staff" : "تصحيح موظفة هذه الخدمة فقط"}
                </button>
              ) : (
                <div className="bk-edit-grid">
                  <label>
                    <span className="bk-field-label">{english ? "Actual specialist" : "الموظفة التي نفذت الخدمة فعلًا"}</span>
                    <select className="bk-input" value={staffId} disabled={busy}
                      onChange={e => setStaffId(e.target.value)}>
                      <option value="">{english ? "Select" : "اختاري الموظفة"}</option>
                      {staff.map(row => <option key={row.id} value={row.id}>{row.name} — {row.id}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="bk-field-label">{english ? "Audited correction reason" : "سبب التصحيح الموثق"}</span>
                    <textarea className="bk-input" rows={2} maxLength={1000} value={reason} disabled={busy}
                      onChange={e => setReason(e.target.value)}
                      placeholder={english ? "Describe the verified evidence of who performed this service." : "اذكري الدليل الذي يؤكد من نفذت هذه الخدمة."} />
                  </label>
                  <small className="bk-helper-text">
                    {english
                      ? "Historical correction only. Invoice, payment and other services remain unchanged."
                      : "تصحيح إسناد تاريخي فقط؛ لن تتغير الفاتورة أو المدفوعات أو بقية الخدمات."}
                  </small>
                  <button type="button" className="dsv2-btn dsv2-btn--primary"
                    disabled={busy || !staffId || staffId === (item.staffId || "") || reason.trim().length < 10}
                    onClick={() => void correct(item)}>
                    {busy ? (english ? "Saving..." : "جاري الحفظ...") : (english ? "Confirm audited correction" : "تأكيد التصحيح الموثق")}
                  </button>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={busy}
                    onClick={() => setEditingItemId("")}>{english ? "Cancel" : "إلغاء"}</button>
                </div>
              )
            )}
          </div>
        ))
      )}
      {error && <div className="bk-inline-error" role="alert">{error}</div>}
      {success && <small role="status">{success}</small>}
    </section>
  );
}
