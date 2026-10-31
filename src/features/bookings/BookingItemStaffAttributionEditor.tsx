import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CoreBookingService } from "../../services/CoreBookingService";
import DashboardSelectV2 from "../../components/dashboard-v2/DashboardSelectV2";
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
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [candidateDate, setCandidateDate] = useState("");
  const [excludedLegacyCount, setExcludedLegacyCount] = useState(0);
  const [search, setSearch] = useState("");
  const [editingItemId, setEditingItemId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const candidateRequest = useRef(0);
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
    candidateRequest.current += 1;
    void CoreBookingService.get(bookingId).then(details => {
      if (!active) return;
      setBooking(details);
    }).catch(() => {
      if (active) setError(english ? "Could not load service assignments." : "تعذر تحميل موظفات الخدمات من Core.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; candidateRequest.current += 1; };
  }, [bookingId, english]);

  const openCorrection = (item: CoreBookingItem) => {
    const request = ++candidateRequest.current;
    setEditingItemId(item.id);
    setStaffId("");
    setReason("");
    setSearch("");
    setStaff([]);
    setCandidateError("");
    setCandidateDate("");
    setExcludedLegacyCount(0);
    setError("");
    setSuccess("");
    setCandidateLoading(true);
    void CoreBookingService.listItemStaffCorrectionCandidates(bookingId, item.id)
      .then(data => {
        if (candidateRequest.current !== request) return;
        setStaff(data.candidates);
        setCandidateDate(data.serviceDate);
        setExcludedLegacyCount(data.excludedLegacyIdentityCount);
      })
      .catch(() => {
        if (candidateRequest.current !== request) return;
        setCandidateError(english
          ? "Could not verify eligible staff for this service date."
          : "تعذر التحقق من الموظفات المؤهلات في تاريخ هذه الخدمة.");
      })
      .finally(() => {
        if (candidateRequest.current === request) setCandidateLoading(false);
      });
  };

  const closeCorrection = () => {
    candidateRequest.current += 1;
    setEditingItemId("");
    setStaffId("");
    setReason("");
  };

  const duplicateNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of staff) {
      const key = row.name.toLocaleLowerCase("ar");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [staff]);

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar");
    return staff.filter(row =>
      !term || `${row.name} ${row.id}`.toLocaleLowerCase("ar").includes(term)
    );
  }, [staff, search]);

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
      closeCorrection();
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
        "core_booking_item:target_ledger_reconciliation_required": "توجد حركات تارجت أو مكافآت مرتبطة بالحجز؛ يلزم مسار تسوية التارجت أولًا حتى لا تتغير حقوق الموظفات.",
        "core_booking_item:noncanonical_staff_identity_requires_review": "هذه هوية موظفة قديمة بترميز مكرر؛ لا يمكن استخدامها في التصحيح قبل تدقيق وربط الهوية.",
      };
      setError(messages[code] || (english
        ? "Correction was rejected. Refresh and verify the employee."
        : "تعذر التصحيح. حدّثي الحجز وتحققي من الموظفة."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bk-attribution" aria-label={english ? "Services and assigned staff" : "الخدمات والموظفات المسجلات"}>
      <header className="bk-attribution__head">
        <strong>{english ? "Staff assigned to each service" : "الموظفة المسجلة لكل خدمة"}</strong>
        <small>{english ? "Each service has an independent audited assignment." : "لكل خدمة إسناد مستقل؛ التصحيح لا يغيّر بقية الخدمات."}</small>
      </header>
      {loading ? (
        <small className="bk-helper-text">{english ? "Loading service items..." : "جاري تحميل بنود الخدمات..."}</small>
      ) : (booking?.items || []).length === 0 ? (
        <small className="bk-helper-text">{english ? "No service items." : "لا توجد بنود خدمات."}</small>
      ) : (
        <div className="bk-attribution__list">
          {(booking?.items || []).map(item => (
            <article key={item.id} className="bk-attribution__item">
              <div className="bk-attribution__summary">
                <strong className="bk-attribution__service">{item.serviceNameSnapshot}</strong>
                <span className="bk-attribution__staff">
                  {english ? "Recorded staff" : "الموظفة المسجلة"}: <strong>{displayStaff(item)}</strong>
                </span>
                {canCorrect && (
                  <details className="bk-attribution__details">
                    <summary>{english ? "Audit identifiers" : "عرض معرفات التدقيق"}</summary>
                    <small className="bk-attribution__id" dir="ltr">{item.id} · {item.staffId || "—"}</small>
                  </details>
                )}
              </div>
              {canCorrect && booking?.status === "completed" && (
                editingItemId !== item.id ? (
                  <button type="button" className="dsv2-btn dsv2-btn--secondary bk-attribution__open"
                    onClick={() => openCorrection(item)}>
                    {english ? "Correct this service's staff" : "تصحيح موظفة هذه الخدمة فقط"}
                  </button>
                ) : (
                  <div className="bk-attribution__correction">
                    <div className="bk-attribution__fields">
                      <div className="bk-attribution__field">
                        <span className="bk-field-label">{english ? "Actual specialist" : "الموظفة التي نفذت الخدمة فعلًا"}</span>
                        <input type="search" className="bk-input" autoComplete="off" value={search}
                          disabled={busy || candidateLoading || !!candidateError}
                          onChange={e => { setSearch(e.target.value); setStaffId(""); }}
                          placeholder={english ? "Search eligible staff..." : "ابحثي عن الموظفة المؤهلة..."}
                          aria-label={english ? "Search eligible staff" : "البحث في الموظفات المؤهلات"} />
                        {/* The booking dialog is portalled outside the dashboard shell. */}
                        <div className="dashboard-v2 bk-attribution__picker-scope">
                          <DashboardSelectV2
                            value={staffId}
                            placeholder={candidateLoading
                              ? (english ? "Checking eligibility..." : "جاري التحقق من الأهلية...")
                              : (english ? "Select eligible staff" : "اختاري الموظفة المؤهلة")}
                            disabled={busy || candidateLoading || !!candidateError || filteredStaff.length === 0}
                            options={filteredStaff.map(row => ({
                              value: row.id,
                              label: (duplicateNameCounts.get(row.name.toLocaleLowerCase("ar")) || 0) > 1
                                ? `${row.name} — ${row.id}` : row.name,
                            }))}
                            onChange={value => setStaffId(value)}
                          />
                        </div>
                        <small className="bk-helper-text" aria-live="polite">
                          {candidateDate && (english ? `Service date: ${candidateDate}. ` : `تاريخ الخدمة: ${candidateDate}. `)}
                          {english ? `${filteredStaff.length} staff with employment dates matching this service.` : `الموظفات المطابقة فترة عملهن لتاريخ الخدمة: ${filteredStaff.length}.`}
                        </small>
                        {staffId && <small className="bk-attribution__id" dir="ltr">ID: {staffId}</small>}
                        {excludedLegacyCount > 0 && (
                          <small className="bk-attribution__legacy">
                            {english
                              ? `${excludedLegacyCount} legacy encoded identity record(s) excluded; no automatic merging.`
                              : `استُبعد ${excludedLegacyCount} سجل بهوية قديمة مشفّرة؛ لا يتم دمج الهويات تلقائيًا.`}
                          </small>
                        )}
                        {!candidateLoading && !candidateError && staff.length === 0 && (
                          <small className="bk-attribution__legacy">
                            {english ? "No staff with a verified employment period on this date." : "لا توجد موظفات بفترة توظيف موثقة في تاريخ الخدمة."}
                          </small>
                        )}
                        {!candidateLoading && !candidateError && staff.length > 0 && filteredStaff.length === 0 && (
                          <small className="bk-helper-text">{english ? "No matching employee." : "لا توجد موظفة مطابقة للبحث."}</small>
                        )}
                        {candidateError && <small className="bk-inline-error" role="alert">{candidateError}</small>}
                      </div>
                      <label className="bk-attribution__field">
                        <span className="bk-field-label">{english ? "Audited correction reason" : "سبب التصحيح الموثق"}</span>
                        <textarea className="bk-input" rows={3} maxLength={1000} value={reason} disabled={busy}
                          onChange={e => setReason(e.target.value)}
                          placeholder={english ? "Describe the verified evidence of who performed this service." : "اذكري الدليل الذي يؤكد من نفذت هذه الخدمة."} />
                      </label>
                    </div>
                    <p className="bk-attribution__notice">
                      {english
                        ? "Employment dates are checked here; closed financial days, payroll and bonus-ledger restrictions are checked again on save. Invoice, payment and other services remain unchanged."
                        : "القائمة تتحقق من فترة العمل؛ قيود الإقفال المالي والرواتب والتارجت تُفحص مجددًا عند الحفظ. لن تتغير الفاتورة أو المدفوعات أو بقية الخدمات."}
                    </p>
                    <div className="bk-attribution__actions">
                      <button type="button" className="dsv2-btn dsv2-btn--primary"
                        disabled={busy || candidateLoading || !!candidateError || !staffId || staffId === (item.staffId || "") || reason.trim().length < 10}
                        onClick={() => void correct(item)}>
                        {busy ? (english ? "Saving..." : "جاري الحفظ...") : (english ? "Confirm audited correction" : "تأكيد التصحيح الموثق")}
                      </button>
                      <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={busy}
                        onClick={closeCorrection}>{english ? "Cancel" : "إلغاء"}</button>
                    </div>
                  </div>
                )
              )}
            </article>
          ))}
        </div>
      )}
      {error && <div className="bk-inline-error" role="alert">{error}</div>}
      {success && <small role="status">{success}</small>}
    </section>
  );
}
