import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiEdit3, FiRefreshCw, FiX } from "react-icons/fi";
import Modal from "../../components/Modal";
import ClientPackagesPanel from "../../components/packages/ClientPackagesPanel";
import { CoreApiError } from "../../services/coreApiClient";
import { CoreClientService, type CoreClientOverview } from "../../services/CoreClientService";
import type { BookingDocWithId, BookingStatus } from "../../services/firestoreBookings";
import type { CoreClient } from "../../types/coreApi";
import {
  customerPhoneDigits,
  formatCustomerLastVisit,
  getCustomerStatusLabel,
  normalizeCustomerName,
  normalizeSaudiCustomerPhone,
  UNNAMED_CUSTOMER_LABEL,
} from "./customerFormatters";
import type { CustomerRow } from "./customerTypes";

type UiRole = "owner" | "admin" | "hr" | "accountant" | "reception" | "staff" | "client" | "guest";
type Feedback = { type: "success" | "error"; text: string } | null;

const NOTES_KEY = "dashboard_client_notes_v1";

const bookingStatusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

function plainNumber(value: unknown, maximumFractionDigits = 0): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(
    Number.isFinite(amount) ? amount : 0
  );
}

function formatHalalas(value: unknown): string {
  return `${plainNumber(Number(value ?? 0) / 100, 2)} ريال`;
}

function formatMoney(value: unknown): string {
  return `${plainNumber(value, 2)} ريال`;
}

function formatDateTime(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "لا يوجد نشاط";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("ar-SA-u-ca-gregory", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function bookingNoOf(booking: BookingDocWithId): string {
  const row = booking as BookingDocWithId & { bookingNumber?: unknown; bookingNo?: unknown };
  const raw = [row.publicId, row.bookingNumber, row.bookingNo]
    .map((value) => String(value ?? "").trim())
    .find(Boolean) || "";
  if (!raw) return "غير متوفر";
  const upper = raw.toUpperCase();
  if (/^MK-\d+$/.test(upper)) return upper;
  if (/^\d+$/.test(upper)) return `MK-${upper}`;
  return "غير متوفر";
}

function noteKeysForCustomer(customer: CustomerRow): string[] {
  const keys: string[] = [];
  if (customer.clientId) keys.push(`id:${customer.clientId}`);
  const phone = customerPhoneDigits(customer.phone);
  if (phone) keys.push(`p:${phone}`);
  keys.push(`n:${normalizeCustomerName(customer.name).toLocaleLowerCase("ar")}`);
  return keys;
}

function readNotes(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function initialNoteForCustomer(customer: CustomerRow): string {
  const notes = readNotes();
  return noteKeysForCustomer(customer).map((key) => notes[key]).find(Boolean) || "";
}

function editErrorMessage(cause: unknown): string {
  if (cause instanceof CoreApiError) {
    if (cause.code === "core_client:phone_conflict") {
      return "رقم الجوال مستخدم في ملف عميلة أخرى. أدخلي رقمًا مختلفًا.";
    }
    if (cause.code === "core_client:invalid_phone") {
      return "رقم الجوال غير صحيح. استخدمي إحدى الصيغ السعودية المعتمدة.";
    }
    if (cause.code.includes("required_text")) {
      return "اسم العميلة مطلوب ولا يمكن أن يتكون من مسافات فقط.";
    }
  }
  return cause instanceof Error ? cause.message : "تعذر حفظ بيانات العميلة.";
}

type Props = {
  customer: CustomerRow;
  bookings: BookingDocWithId[];
  currentRole: UiRole;
  onCustomerUpdated: (client: CoreClient) => void;
  onClose: () => void;
};

export default function CustomerRecordModal({
  customer,
  bookings,
  currentRole,
  onCustomerUpdated,
  onClose,
}: Props) {
  const canManage = currentRole === "owner" || currentRole === "admin";
  const [overview, setOverview] = useState<CoreClientOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editFeedback, setEditFeedback] = useState<Feedback>(null);
  const [loyaltyPoints, setLoyaltyPoints] = useState("");
  const [loyaltyReason, setLoyaltyReason] = useState("");
  const [loyaltySaving, setLoyaltySaving] = useState(false);
  const [loyaltyMessage, setLoyaltyMessage] = useState("");
  const [noteText, setNoteText] = useState(() => initialNoteForCustomer(customer));
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteFeedback, setNoteFeedback] = useState<Feedback>(null);
  const noteSavedTimer = useRef<number | null>(null);

  const selectedBookings = useMemo(() => [...bookings].sort((a, b) => {
    const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
    return dateCompare || String(b.time || "").localeCompare(String(a.time || ""));
  }), [bookings]);

  const totalSpend = useMemo(() => selectedBookings.reduce((sum, booking) => {
    const total = Number(booking.total ?? 0);
    return sum + (Number.isFinite(total) ? total : 0);
  }, 0), [selectedBookings]);

  const loadOverview = useCallback(async () => {
    const clientId = String(customer.clientId || "").trim();
    if (!clientId) {
      setOverview(null);
      setOverviewError("هذه العميلة غير مرتبطة بعد بمعرّف Core D1 موحّد.");
      return;
    }
    setOverviewLoading(true);
    setOverviewError("");
    try {
      setOverview(await CoreClientService.overview(clientId));
    } catch (cause) {
      setOverview(null);
      setOverviewError(cause instanceof Error ? cause.message : "تعذر تحميل السجل المالي للعميلة");
    } finally {
      setOverviewLoading(false);
    }
  }, [customer.clientId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (editing) return;
    const currentName = normalizeCustomerName(customer.name);
    setEditName(currentName === UNNAMED_CUSTOMER_LABEL ? "" : currentName);
    setEditPhone(customer.phone === "—" ? "" : customer.phone);
  }, [customer.name, customer.phone, editing]);

  useEffect(() => () => {
    if (noteSavedTimer.current) window.clearTimeout(noteSavedTimer.current);
  }, []);

  const beginEditing = () => {
    const currentName = normalizeCustomerName(customer.name);
    setEditName(currentName === UNNAMED_CUSTOMER_LABEL ? "" : currentName);
    setEditPhone(customer.phone === "—" ? "" : customer.phone);
    setEditFeedback(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditFeedback(null);
  };

  const saveProfile = async () => {
    if (editSaving) return;
    const clientId = String(customer.clientId || "").trim();
    const name = editName.trim().replace(/\s+/gu, " ");
    const phone = normalizeSaudiCustomerPhone(editPhone);

    if (!clientId) {
      setEditFeedback({ type: "error", text: "لا يمكن تعديل عميلة غير مرتبطة بسجل Core D1." });
      return;
    }
    if (!name) {
      setEditFeedback({ type: "error", text: "اسم العميلة مطلوب ولا يمكن أن يتكون من مسافات فقط." });
      return;
    }
    if (!phone) {
      setEditFeedback({ type: "error", text: "أدخلي رقم جوال سعوديًا صحيحًا مثل 0500000000." });
      return;
    }

    setEditSaving(true);
    setEditFeedback(null);
    try {
      const updated = await CoreClientService.updateProfile(clientId, { name, phone });
      const notes = readNotes();
      const stableNoteKey = `id:${updated.id}`;
      if (noteText.trim() && !notes[stableNoteKey]) {
        localStorage.setItem(NOTES_KEY, JSON.stringify({
          ...notes,
          [stableNoteKey]: noteText.trim(),
        }));
      }
      onCustomerUpdated(updated);
      setOverview((current) => current ? { ...current, client: updated } : current);
      setEditName(updated.name);
      setEditPhone(updated.phoneNormalized);
      setEditing(false);
      setEditFeedback({ type: "success", text: "تم حفظ اسم العميلة ورقم الجوال في Core بنجاح." });
    } catch (cause) {
      setEditFeedback({ type: "error", text: editErrorMessage(cause) });
    } finally {
      setEditSaving(false);
    }
  };

  const saveNote = async () => {
    if (noteSaving) return;
    setNoteSaving(true);
    setNoteFeedback(null);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const notes = readNotes();
      const key = noteKeysForCustomer(customer)[0];
      localStorage.setItem(NOTES_KEY, JSON.stringify({ ...notes, [key]: noteText.trim() }));
      setNoteFeedback({ type: "success", text: "تم حفظ الملاحظة." });
      if (noteSavedTimer.current) window.clearTimeout(noteSavedTimer.current);
      noteSavedTimer.current = window.setTimeout(() => setNoteFeedback(null), 2500);
    } catch {
      setNoteFeedback({ type: "error", text: "تعذر حفظ الملاحظة على هذا الجهاز." });
    } finally {
      setNoteSaving(false);
    }
  };

  const adjustLoyalty = async () => {
    const clientId = String(customer.clientId || "").trim();
    const points = Number(loyaltyPoints);
    const reason = loyaltyReason.trim();
    if (!clientId || !Number.isInteger(points) || points === 0 || !reason) {
      setLoyaltyMessage("أدخل عدد نقاط صحيحًا غير صفري وسبب التعديل.");
      return;
    }
    setLoyaltySaving(true);
    setLoyaltyMessage("");
    try {
      const operationId = crypto.randomUUID?.() || `loyalty_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const loyalty = await CoreClientService.adjustLoyalty(clientId, { points, reason, operationId });
      setOverview((current) => current ? { ...current, loyalty } : current);
      setLoyaltyPoints("");
      setLoyaltyReason("");
      setLoyaltyMessage("تم تسجيل حركة النقاط بنجاح.");
    } catch (cause) {
      setLoyaltyMessage(cause instanceof Error ? cause.message : "تعذر تعديل النقاط");
    } finally {
      setLoyaltySaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} ariaLabel="ملف العميلة" panelClassName="customers-record-modal" size="lg">
      <header className="customers-modal-header">
        <div className="customers-modal-identity">
          <p className="customers-eyebrow">ملف العميلة</p>
          <div className="customers-modal-title-row">
            <h2>{normalizeCustomerName(customer.name)}</h2>
            <span className="customers-status-pill">{getCustomerStatusLabel(customer.status)}</span>
            {customer.vip ? <span className="customers-vip-pill">VIP</span> : null}
          </div>
          <bdi dir="ltr">{customer.phone === "—" ? "بدون رقم جوال" : customer.phone}</bdi>
        </div>
        <div className="customers-modal-actions">
          {canManage && customer.clientId ? (
            <button type="button" className="customers-button is-secondary customers-header-edit" onClick={beginEditing} disabled={editing || editSaving}>
              <FiEdit3 /> تعديل البيانات
            </button>
          ) : null}
          <button type="button" className="customers-modal-close" onClick={onClose} aria-label="إغلاق" title="إغلاق"><FiX /></button>
        </div>
      </header>

      <div className="customers-modal-body">
        <section className="customers-client-data" aria-labelledby="customer-data-title">
          <header>
            <div>
              <p className="customers-eyebrow">البيانات الأساسية</p>
              <h3 id="customer-data-title">بيانات العميلة</h3>
            </div>
            {!editing && canManage && customer.clientId ? (
              <button type="button" className="customers-button is-secondary customers-section-edit" onClick={beginEditing}>
                <FiEdit3 /> تعديل البيانات
              </button>
            ) : null}
          </header>

          {editing ? (
            <div className="customers-client-edit-form">
              <label>
                <span>اسم العميلة</span>
                <input value={editName} onChange={(event) => setEditName(event.target.value)} autoComplete="name" placeholder="أدخلي اسم العميلة" disabled={editSaving} />
              </label>
              <label>
                <span>رقم الجوال</span>
                <input dir="ltr" inputMode="tel" value={editPhone} onChange={(event) => setEditPhone(event.target.value)} autoComplete="tel" placeholder="05XXXXXXXX" disabled={editSaving} />
              </label>
              <div className="customers-client-edit-actions">
                <button type="button" className="customers-button is-secondary" onClick={cancelEditing} disabled={editSaving}>إلغاء</button>
                <button type="button" className="customers-button is-primary" onClick={() => void saveProfile()} disabled={editSaving}>
                  {editSaving ? "جارٍ حفظ التعديلات..." : "حفظ التعديلات"}
                </button>
              </div>
            </div>
          ) : (
            <dl className="customers-client-data-grid">
              <div><dt>اسم العميلة</dt><dd>{normalizeCustomerName(customer.name)}</dd></div>
              <div><dt>رقم الجوال</dt><dd><bdi dir="ltr">{customer.phone === "—" ? "غير مسجل" : customer.phone}</bdi></dd></div>
            </dl>
          )}

          {editFeedback ? <p className={`customers-form-feedback is-${editFeedback.type}`} role="status">{editFeedback.text}</p> : null}
          {!canManage ? <p className="customers-permission-hint">التعديل متاح للمديرة أو المشرفة فقط.</p> : null}
        </section>

        <section className="customers-record-summary">
          <article><strong>{plainNumber(selectedBookings.length)}</strong><span>عدد الحجوزات</span></article>
          <article><strong>{formatCustomerLastVisit(customer.lastVisitDate, customer.lastVisitTime)}</strong><span>آخر زيارة</span></article>
          <article><strong>{formatMoney(totalSpend)}</strong><span>إجمالي الصرف</span></article>
        </section>

        <section className="customers-overview-section" aria-label="السجل المالي والولاء">
          <header>
            <div><h3>السجل الموحد للعميلة</h3><p>الحجوزات والدفعات والاسترجاعات والنقاط من Core D1.</p></div>
            {customer.clientId ? <button type="button" className="customers-button is-secondary" onClick={() => void loadOverview()} disabled={overviewLoading}><FiRefreshCw className={overviewLoading ? "is-spinning" : ""} /> تحديث</button> : null}
          </header>

          {overviewLoading ? <div className="customers-overview-state"><span className="customers-skeleton" /> جارٍ تحميل السجل...</div>
            : overviewError ? <div className="customers-overview-state is-error">{overviewError}</div>
              : overview ? (
                <>
                  <div className="customers-overview-grid">
                    <article><span>صافي المدفوع</span><strong>{formatHalalas(overview.summary.netPaidHalalas)}</strong></article>
                    <article><span>الاسترجاعات</span><strong>{formatHalalas(overview.summary.refundedHalalas)}</strong></article>
                    <article><span>الرصيد الحالي</span><strong>{plainNumber(overview.loyalty.balance)} نقطة</strong></article>
                    <article><span>آخر نشاط</span><strong>{formatDateTime(overview.summary.lastActivityAt)}</strong></article>
                  </div>
                  <div className="customers-overview-columns">
                    <section>
                      <h4>النقاط والولاء</h4>
                      <div className="customers-loyalty-summary">
                        <span>المستوى <b>{overview.loyalty.levelLabel || "غير محدد"}</b></span>
                        <span>مكتسبة <b>{plainNumber(overview.loyalty.earned)}</b></span>
                        <span>مستخدمة <b>{plainNumber(overview.loyalty.used)}</b></span>
                        <span>معكوسة <b>{plainNumber(overview.loyalty.reversed)}</b></span>
                      </div>
                      <div className="customers-record-list">
                        {overview.loyalty.transactions.slice(0, 5).map((transaction) => (
                          <div key={transaction.id}><span>{transaction.reason || transaction.type}</span><b className={transaction.points < 0 ? "is-negative" : "is-positive"}>{transaction.points > 0 ? "+" : ""}{plainNumber(transaction.points)}</b></div>
                        ))}
                        {!overview.loyalty.transactions.length ? <p>لا توجد حركات نقاط.</p> : null}
                      </div>
                      {canManage ? (
                        <div className="customers-loyalty-adjust">
                          <input type="number" step="1" value={loyaltyPoints} onChange={(event) => setLoyaltyPoints(event.target.value)} placeholder="20 أو -20" aria-label="عدد النقاط" />
                          <input value={loyaltyReason} onChange={(event) => setLoyaltyReason(event.target.value)} placeholder="سبب التعديل" aria-label="سبب تعديل النقاط" />
                          <button type="button" className="customers-button is-primary" onClick={() => void adjustLoyalty()} disabled={loyaltySaving}>{loyaltySaving ? "جارٍ الحفظ" : "تسجيل الحركة"}</button>
                        </div>
                      ) : null}
                      {loyaltyMessage ? <p className="customers-loyalty-message">{loyaltyMessage}</p> : null}
                    </section>
                    <section>
                      <h4>الدفعات والاسترجاعات</h4>
                      <div className="customers-record-list">
                        {overview.payments.slice(0, 4).map((payment, index) => <div key={String(payment.id || `payment-${index}`)}><span>دفعة · {String(payment.method || payment.provider || "غير محدد")}</span><b className="is-positive">{formatHalalas(payment.amount_halalas)}</b></div>)}
                        {overview.refunds.slice(0, 4).map((refund, index) => <div key={String(refund.id || `refund-${index}`)}><span>استرجاع · {formatDateTime(refund.refunded_at || refund.created_at)}</span><b className="is-negative">-{formatHalalas(refund.amount_halalas)}</b></div>)}
                        {!overview.payments.length && !overview.refunds.length ? <p>لا توجد حركات مالية.</p> : null}
                      </div>
                    </section>
                    <section>
                      <h4>العروض المستخدمة</h4>
                      <div className="customers-record-list">
                        {overview.offersUsed.map((offer, index) => <div key={String(offer.id || offer.code || index)}><span>{offer.title}</span><b>{formatDateTime(offer.usedAt)}</b></div>)}
                        {!overview.offersUsed.length ? <p>لم تُستخدم عروض مسجلة.</p> : null}
                      </div>
                    </section>
                  </div>
                </>
              ) : null}
        </section>

        {customer.importedNote ? <section className="customers-note-card"><h3>ملاحظة من ملف العميلة</h3><p>{customer.importedNote}</p></section> : null}

        <section className="customers-note-card">
          <h3>ملاحظات إدارية داخلية</h3>
          <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="مثال: تفضّل موظفة معينة، حساسية، أو أوقات مناسبة..." disabled={noteSaving} />
          <div className="customers-note-actions">
            <button type="button" className="customers-button is-primary" onClick={() => void saveNote()} disabled={noteSaving}>{noteSaving ? "جارٍ حفظ الملاحظة..." : "حفظ الملاحظة"}</button>
            {noteFeedback ? <span className={`customers-form-feedback is-${noteFeedback.type}`} role="status">{noteFeedback.text}</span> : null}
          </div>
        </section>

        <section className="customers-packages-section">
          <ClientPackagesPanel clientId={customer.clientId || customer.legacyClientDocId} canManage={canManage} />
        </section>

        <section className="customers-bookings-history">
          <header><div><p className="customers-eyebrow">السجل</p><h3>حجوزات العميلة</h3></div><span>{plainNumber(selectedBookings.length)} حجزًا</span></header>
          <div className="customers-history-table-wrap">
            <table>
              <thead><tr><th>رقم الحجز</th><th>الخدمة</th><th>الموظفة</th><th>التاريخ والوقت</th><th>الحالة</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {selectedBookings.map((booking) => (
                  <tr key={booking.id}>
                    <td><bdi dir="ltr">{bookingNoOf(booking)}</bdi></td>
                    <td>{String(booking.serviceName || "غير محددة")}</td>
                    <td>{String(booking.employeeName || "غير محددة")}</td>
                    <td>{formatCustomerLastVisit(booking.date, booking.time)}</td>
                    <td><span className={`status-badge ${booking.status}`}>{bookingStatusLabel[booking.status] || booking.status}</span></td>
                    <td>{formatMoney(booking.total)}</td>
                  </tr>
                ))}
                {!selectedBookings.length ? <tr><td colSpan={6} className="customers-history-empty">لا توجد حجوزات مسجلة لهذه العميلة.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="customers-history-mobile">
            {selectedBookings.map((booking) => (
              <article key={booking.id}>
                <header><bdi dir="ltr">{bookingNoOf(booking)}</bdi><span className={`status-badge ${booking.status}`}>{bookingStatusLabel[booking.status] || booking.status}</span></header>
                <dl><div><dt>الخدمة</dt><dd>{String(booking.serviceName || "غير محددة")}</dd></div><div><dt>الموظفة</dt><dd>{String(booking.employeeName || "غير محددة")}</dd></div><div><dt>التاريخ والوقت</dt><dd>{formatCustomerLastVisit(booking.date, booking.time)}</dd></div><div><dt>الإجمالي</dt><dd>{formatMoney(booking.total)}</dd></div></dl>
              </article>
            ))}
            {!selectedBookings.length ? <p className="customers-history-empty">لا توجد حجوزات مسجلة لهذه العميلة.</p> : null}
          </div>
        </section>
      </div>
    </Modal>
  );
}
