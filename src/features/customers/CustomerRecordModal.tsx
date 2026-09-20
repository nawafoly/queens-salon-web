import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiEdit3, FiRefreshCw } from "react-icons/fi";
import { DashboardModalV2 } from "../../components/dashboard-v2";
import { clientsText, type DashboardLanguage } from "../../helpers/dashboardClientsLanguage";
import DashboardNumberInputV2 from "../../components/dashboard-v2/DashboardNumberInputV2";
import ClientPackagesPanel from "../../components/packages/ClientPackagesPanel";
import { CoreApiError } from "../../services/coreApiClient";
import { CoreClientService, type CoreClientOverview } from "../../services/CoreClientService";
import type { BookingDocWithId, BookingStatus } from "../../services/firestoreBookings";
import type { CoreClient } from "../../types/coreApi";
import {
  formatCustomerLastVisit,
  getCustomerStatusLabel,
  isCustomerActive,
  normalizeCustomerName,
  normalizeSaudiCustomerPhone,
  repairCustomerDisplayText,
  UNNAMED_CUSTOMER_LABEL,
} from "./customerFormatters";
import type { CustomerRow } from "./customerTypes";

type UiRole = "owner" | "admin" | "hr" | "accountant" | "reception" | "staff" | "client" | "guest";
type Feedback = { type: "success" | "error"; text: string } | null;

const bookingStatusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

function bookingStatusBadgeClass(status: BookingStatus): string {
  if (status === "confirmed" || status === "completed") return "dsv2-badge--success";
  if (status === "cancelled") return "dsv2-badge--danger";
  return "dsv2-badge--gold";
}

function plainNumber(value: unknown, maximumFractionDigits = 0, language: DashboardLanguage = "ar"): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat(language === "en" ? "en-US" : "ar-SA-u-nu-latn", { maximumFractionDigits }).format(
    Number.isFinite(amount) ? amount : 0
  );
}

function formatHalalas(value: unknown, language: DashboardLanguage): string {
  return `${plainNumber(Number(value ?? 0) / 100, 2, language)} ${clientsText(language, "ريال")}`;
}

function formatMoney(value: unknown, language: DashboardLanguage): string {
  return `${plainNumber(value, 2, language)} ${clientsText(language, "ريال")}`;
}

function formatDateTime(value: unknown, language: DashboardLanguage): string {
  const raw = String(value ?? "").trim();
  if (!raw) return clientsText(language, "لا يوجد نشاط");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString(language === "en" ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function bookingNoOf(booking: BookingDocWithId, language: DashboardLanguage): string {
  const row = booking as BookingDocWithId & { bookingNumber?: unknown; bookingNo?: unknown };
  const raw = [row.publicId, row.bookingNumber, row.bookingNo]
    .map((value) => String(value ?? "").trim())
    .find(Boolean) || "";
  if (!raw) return clientsText(language, "غير متوفر");
  const upper = raw.toUpperCase();
  if (/^MK-\d+$/.test(upper)) return upper;
  if (/^\d+$/.test(upper)) return `MK-${upper}`;
  return clientsText(language, "غير متوفر");
}

function editErrorMessage(cause: unknown, language: DashboardLanguage): string {
  if (cause instanceof CoreApiError) {
    if (cause.code === "core_client:phone_conflict") {
      return clientsText(language, "رقم الجوال مستخدم في ملف عميلة أخرى. أدخلي رقمًا مختلفًا.");
    }
    if (cause.code === "core_client:invalid_phone") {
      return clientsText(language, "رقم الجوال غير صحيح. استخدمي إحدى الصيغ السعودية المعتمدة.");
    }
    if (cause.code.includes("required_text")) {
      return clientsText(language, "اسم العميلة مطلوب ولا يمكن أن يتكون من مسافات فقط.");
    }
  }
  return cause instanceof Error ? cause.message : clientsText(language, "تعذر حفظ بيانات العميلة.");
}

type Props = {
  language: DashboardLanguage;
  customer: CustomerRow;
  bookings: BookingDocWithId[];
  currentRole: UiRole;
  onCustomerUpdated: (client: CoreClient) => void;
  onClose: () => void;
};

export default function CustomerRecordModal({
  language,
  customer,
  bookings,
  currentRole,
  onCustomerUpdated,
  onClose,
}: Props) {
  const t = (text: string) => clientsText(language, text);
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
  const [noteText, setNoteText] = useState(() => repairCustomerDisplayText(customer.importedNote));
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
      setOverviewError(t("هذه العميلة غير مرتبطة بعد بمعرّف Core D1 موحّد."));
      return;
    }
    setOverviewLoading(true);
    setOverviewError("");
    try {
      setOverview(await CoreClientService.overview(clientId));
    } catch (cause) {
      setOverview(null);
      setOverviewError(cause instanceof Error ? cause.message : t("تعذر تحميل السجل المالي للعميلة"));
    } finally {
      setOverviewLoading(false);
    }
  }, [customer.clientId, language]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (editing) return;
    const currentName = normalizeCustomerName(customer.name);
    setEditName(currentName === UNNAMED_CUSTOMER_LABEL ? "" : currentName);
    setEditPhone(customer.phone === "—" ? "" : customer.phone);
  }, [customer.name, customer.phone, editing]);

  useEffect(() => {
    setNoteText(repairCustomerDisplayText(customer.importedNote));
    setNoteFeedback(null);
  }, [customer.clientId, customer.importedNote]);

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
      setEditFeedback({ type: "error", text: t("لا يمكن تعديل عميلة غير مرتبطة بسجل Core D1.") });
      return;
    }
    if (!name) {
      setEditFeedback({ type: "error", text: t("اسم العميلة مطلوب ولا يمكن أن يتكون من مسافات فقط.") });
      return;
    }
    if (!phone) {
      setEditFeedback({ type: "error", text: t("أدخلي رقم جوال سعوديًا صحيحًا مثل 0500000000.") });
      return;
    }

    setEditSaving(true);
    setEditFeedback(null);
    try {
      const updated = await CoreClientService.updateProfile(clientId, { name, phone });
      onCustomerUpdated(updated);
      setOverview((current) => current ? { ...current, client: updated } : current);
      setEditName(updated.name);
      setEditPhone(updated.phoneNormalized);
      setEditing(false);
      setEditFeedback({ type: "success", text: t("تم حفظ اسم العميلة ورقم الجوال في Core بنجاح.") });
    } catch (cause) {
      setEditFeedback({ type: "error", text: editErrorMessage(cause, language) });
    } finally {
      setEditSaving(false);
    }
  };

  const saveNote = async () => {
    if (noteSaving) return;
    const clientId = String(customer.clientId || "").trim();
    if (!clientId) {
      setNoteFeedback({ type: "error", text: t("لا يمكن حفظ ملاحظة لعميلة غير مرتبطة بسجل Core D1.") });
      return;
    }

    setNoteSaving(true);
    setNoteFeedback(null);
    try {
      const updated = await CoreClientService.patch(clientId, { notes: noteText.trim() });
      const canonicalNote = repairCustomerDisplayText(updated.notes);
      setNoteText(canonicalNote);
      onCustomerUpdated(updated);
      setOverview((current) => current ? { ...current, client: updated } : current);
      setNoteFeedback({ type: "success", text: t("تم حفظ الملاحظة في Core.") });
      if (noteSavedTimer.current) window.clearTimeout(noteSavedTimer.current);
      noteSavedTimer.current = window.setTimeout(() => setNoteFeedback(null), 2500);
    } catch (cause) {
      setNoteFeedback({
        type: "error",
        text: cause instanceof Error ? cause.message : t("تعذر حفظ الملاحظة في Core."),
      });
    } finally {
      setNoteSaving(false);
    }
  };

  const adjustLoyalty = async () => {
    const clientId = String(customer.clientId || "").trim();
    const points = Number(loyaltyPoints);
    const reason = loyaltyReason.trim();
    if (!clientId || !Number.isInteger(points) || points === 0 || !reason) {
      setLoyaltyMessage(t("أدخل عدد نقاط صحيحًا غير صفري وسبب التعديل."));
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
      setLoyaltyMessage(t("تم تسجيل حركة النقاط بنجاح."));
    } catch (cause) {
      setLoyaltyMessage(cause instanceof Error ? cause.message : t("تعذر تعديل النقاط"));
    } finally {
      setLoyaltySaving(false);
    }
  };

  return (
    <DashboardModalV2
      open
      onClose={onClose}
      title={normalizeCustomerName(customer.name) === UNNAMED_CUSTOMER_LABEL ? t(UNNAMED_CUSTOMER_LABEL) : normalizeCustomerName(customer.name)}
      description={<bdi dir="ltr">{customer.phone === "—" ? t("بدون رقم جوال") : customer.phone}</bdi>}
      eyebrow={t("ملف العميلة")}
      size="xl"
      tone="gold"
      className="dsv2-customers-record-modal"
    >
      <div className="dsv2-customers-modal-stack">
        <div className="dsv2-customers-modal-identity-row">
          <div className="dsv2-customers-badges">
            <span className={`dsv2-badge ${isCustomerActive(customer.status) ? "dsv2-badge--success" : ""}`}>{getCustomerStatusLabel(customer.status, language)}</span>
            {customer.vip ? <span className="dsv2-badge dsv2-badge--gold">VIP</span> : null}
          </div>

        </div>
        <section className="dsv2-card dsv2-card--padded dsv2-customers-client-data" aria-labelledby="customer-data-title">
          <header className="dsv2-section-head">
            <div>
              <p className="dsv2-customers-eyebrow">{t("البيانات الأساسية")}</p>
              <h3 id="customer-data-title" className="dsv2-section-title">{t("بيانات العميلة")}</h3>
            </div>
            {!editing && canManage && customer.clientId ? (
              <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm dsv2-customers-section-edit" onClick={beginEditing}>
                <FiEdit3 /> {t("تعديل البيانات")}
              </button>
            ) : null}
          </header>

          {editing ? (
            <div className="dsv2-customers-client-edit-form">
              <label className="dsv2-field">
                <span className="dsv2-field__label">{t("اسم العميلة")}</span>
                <input className="dsv2-input" value={editName} onChange={(event) => setEditName(event.target.value)} autoComplete="name" placeholder={t("أدخلي اسم العميلة")} disabled={editSaving} />
              </label>
              <label className="dsv2-field">
                <span className="dsv2-field__label">{t("رقم الجوال")}</span>
                <input className="dsv2-input" dir="ltr" inputMode="tel" value={editPhone} onChange={(event) => setEditPhone(event.target.value)} autoComplete="tel" placeholder="05XXXXXXXX" disabled={editSaving} />
              </label>
              <div className="dsv2-customers-client-edit-actions">
                <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={cancelEditing} disabled={editSaving}>{t("إلغاء")}</button>
                <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void saveProfile()} disabled={editSaving}>
                  {editSaving ? t("جارٍ حفظ التعديلات...") : t("حفظ التعديلات")}
                </button>
              </div>
            </div>
          ) : (
            <dl className="dsv2-customers-client-data-grid">
              <div><dt>{t("اسم العميلة")}</dt><dd>{t(normalizeCustomerName(customer.name))}</dd></div>
              <div><dt>{t("رقم الجوال")}</dt><dd><bdi dir="ltr">{customer.phone === "—" ? t("غير مسجل") : customer.phone}</bdi></dd></div>
            </dl>
          )}

          {editFeedback ? <p className={`dsv2-customers-form-feedback is-${editFeedback.type}`} role="status">{editFeedback.text}</p> : null}
          {!canManage ? <p className="dsv2-section-caption">{t("التعديل متاح للمديرة أو المشرفة فقط.")}</p> : null}
        </section>

        <section className="dsv2-customers-record-summary">
          <article><strong>{plainNumber(selectedBookings.length, 0, language)}</strong><span>{t("عدد الحجوزات")}</span></article>
          <article><strong>{formatCustomerLastVisit(customer.lastVisitDate, customer.lastVisitTime, language)}</strong><span>{t("آخر زيارة")}</span></article>
          <article><strong>{formatMoney(totalSpend, language)}</strong><span>{t("إجمالي الصرف")}</span></article>
        </section>

        <section className="dsv2-card dsv2-card--padded dsv2-customers-overview-section" aria-label={t("السجل المالي والولاء")}>
          <header className="dsv2-section-head">
            <div><h3 className="dsv2-section-title">{t("السجل الموحد للعميلة")}</h3><p className="dsv2-section-caption">{t("الحجوزات والدفعات والاسترجاعات والنقاط من Core D1.")}</p></div>
            {customer.clientId ? <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void loadOverview()} disabled={overviewLoading}><FiRefreshCw className={overviewLoading ? "dsv2-customers-spin" : ""} /> {t("تحديث")}</button> : null}
          </header>

          {overviewLoading ? <div className="dsv2-customers-overview-state"><span className="dsv2-skeleton" /> {t("جارٍ تحميل السجل...")}</div>
            : overviewError ? <div className="dsv2-customers-overview-state is-error">{overviewError}</div>
              : overview ? (
                <>
                  <div className="dsv2-customers-overview-grid">
                    <article><span>{t("صافي المدفوع")}</span><strong>{formatHalalas(overview.summary.netPaidHalalas, language)}</strong></article>
                    <article><span>{t("الاسترجاعات")}</span><strong>{formatHalalas(overview.summary.refundedHalalas, language)}</strong></article>
                    <article><span>{t("الرصيد الحالي")}</span><strong>{plainNumber(overview.loyalty.balance, 0, language)} {t("نقطة")}</strong></article>
                    <article><span>{t("آخر نشاط")}</span><strong>{formatDateTime(overview.summary.lastActivityAt, language)}</strong></article>
                  </div>
                  <div className="dsv2-customers-overview-columns">
                    <section>
                      <h4>{t("النقاط والولاء")}</h4>
                      <div className="dsv2-customers-loyalty-summary">
                        <span>{t("المستوى")} <b>{overview.loyalty.levelLabel || t("غير محدد")}</b></span>
                        <span>{t("مكتسبة")} <b>{plainNumber(overview.loyalty.earned, 0, language)}</b></span>
                        <span>{t("مستخدمة")} <b>{plainNumber(overview.loyalty.used, 0, language)}</b></span>
                        <span>{t("معكوسة")} <b>{plainNumber(overview.loyalty.reversed, 0, language)}</b></span>
                      </div>
                      <div className="dsv2-customers-record-list">
                        {overview.loyalty.transactions.slice(0, 5).map((transaction) => (
                          <div key={transaction.id}><span>{repairCustomerDisplayText(transaction.reason || transaction.type)}</span><b className={transaction.points < 0 ? "is-negative" : "is-positive"}>{transaction.points > 0 ? "+" : ""}{plainNumber(transaction.points, 0, language)}</b></div>
                        ))}
                        {!overview.loyalty.transactions.length ? <p>{t("لا توجد حركات نقاط.")}</p> : null}
                      </div>
                      {canManage ? (
                        <div className="dsv2-customers-loyalty-adjust">
                          <DashboardNumberInputV2 className="dsv2-input" step="1" value={loyaltyPoints} onChange={(event) => setLoyaltyPoints(event.target.value)} placeholder={language === "en" ? "20 or -20" : "20 أو -20"} aria-label={t("عدد النقاط")} />
                          <input className="dsv2-input" value={loyaltyReason} onChange={(event) => setLoyaltyReason(event.target.value)} placeholder={t("سبب التعديل")} aria-label={t("سبب تعديل النقاط")} />
                          <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void adjustLoyalty()} disabled={loyaltySaving}>{loyaltySaving ? t("جارٍ الحفظ") : t("تسجيل الحركة")}</button>
                        </div>
                      ) : null}
                      {loyaltyMessage ? <p className="dsv2-customers-loyalty-message">{loyaltyMessage}</p> : null}
                    </section>
                    <section>
                      <h4>{t("الدفعات والاسترجاعات")}</h4>
                      <div className="dsv2-customers-record-list">
                        {overview.payments.slice(0, 4).map((payment, index) => <div key={String(payment.id || `payment-${index}`)}><span>{t("دفعة")} · {String(payment.method || payment.provider || t("غير محدد"))}</span><b className="is-positive">{formatHalalas(payment.amount_halalas, language)}</b></div>)}
                        {overview.refunds.slice(0, 4).map((refund, index) => <div key={String(refund.id || `refund-${index}`)}><span>{t("استرجاع")} · {formatDateTime(refund.refunded_at || refund.created_at, language)}</span><b className="is-negative">-{formatHalalas(refund.amount_halalas, language)}</b></div>)}
                        {!overview.payments.length && !overview.refunds.length ? <p>{t("لا توجد حركات مالية.")}</p> : null}
                      </div>
                    </section>
                    <section>
                      <h4>{t("العروض المستخدمة")}</h4>
                      <div className="dsv2-customers-record-list">
                        {overview.offersUsed.map((offer, index) => <div key={String(offer.id || offer.code || index)}><span>{repairCustomerDisplayText(offer.title)}</span><b>{formatDateTime(offer.usedAt, language)}</b></div>)}
                        {!overview.offersUsed.length ? <p>{t("لم تُستخدم عروض مسجلة.")}</p> : null}
                      </div>
                    </section>
                  </div>
                </>
              ) : null}
        </section>

        <section className="dsv2-card dsv2-card--padded dsv2-customers-note-card">
          <h3 className="dsv2-section-title">{t("ملاحظات إدارية داخلية")}</h3>
          <textarea className="dsv2-textarea" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder={t("مثال: تفضّل موظفة معينة، حساسية، أو أوقات مناسبة...")} disabled={noteSaving || !customer.clientId} />
          <div className="dsv2-customers-note-actions">
            <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void saveNote()} disabled={noteSaving || !customer.clientId}>{noteSaving ? t("جارٍ حفظ الملاحظة...") : t("حفظ الملاحظة")}</button>
            {noteFeedback ? <span className={`dsv2-customers-form-feedback is-${noteFeedback.type}`} role="status">{noteFeedback.text}</span> : null}
          </div>
        </section>

        <section className="dsv2-card dsv2-card--padded dsv2-customers-packages">
          <ClientPackagesPanel clientId={customer.clientId || customer.legacyClientDocId} canManage={canManage} language={language} />
        </section>

        <section className="dsv2-table-card dsv2-customers-bookings-history">
          <header className="dsv2-card--padded dsv2-customers-history-heading"><div><p className="dsv2-customers-eyebrow">{t("السجل")}</p><h3 className="dsv2-section-title">{t("حجوزات العميلة")}</h3></div><span className="dsv2-badge">{plainNumber(selectedBookings.length, 0, language)} {t("حجزًا")}</span></header>
          <div className="dsv2-table-scroll dsv2-customers-history-table-wrap">
            <table className="dsv2-table dsv2-customers-history-table">
              <thead><tr><th>{t("رقم الحجز")}</th><th>{t("الخدمة")}</th><th>{t("الموظفة")}</th><th>{t("التاريخ والوقت")}</th><th>{t("الحالة")}</th><th>{t("الإجمالي")}</th></tr></thead>
              <tbody>
                {selectedBookings.map((booking) => (
                  <tr key={booking.id}>
                    <td><bdi dir="ltr">{bookingNoOf(booking, language)}</bdi></td>
                    <td>{String(booking.serviceName || t("غير محددة"))}</td>
                    <td>{String(booking.employeeName || t("غير محددة"))}</td>
                    <td>{formatCustomerLastVisit(booking.date, booking.time, language)}</td>
                    <td><span className={`dsv2-badge ${bookingStatusBadgeClass(booking.status)}`}>{t(bookingStatusLabel[booking.status] || booking.status)}</span></td>
                    <td>{formatMoney(booking.total, language)}</td>
                  </tr>
                ))}
                {!selectedBookings.length ? <tr><td colSpan={6} className="dsv2-customers-history-empty">{t("لا توجد حجوزات مسجلة لهذه العميلة.")}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="dsv2-customers-history-mobile">
            {selectedBookings.map((booking) => (
              <article className="dsv2-card dsv2-card--padded" key={booking.id}>
                <header><bdi dir="ltr">{bookingNoOf(booking, language)}</bdi><span className={`dsv2-badge ${bookingStatusBadgeClass(booking.status)}`}>{t(bookingStatusLabel[booking.status] || booking.status)}</span></header>
                <dl><div><dt>{t("الخدمة")}</dt><dd>{String(booking.serviceName || t("غير محددة"))}</dd></div><div><dt>{t("الموظفة")}</dt><dd>{String(booking.employeeName || t("غير محددة"))}</dd></div><div><dt>{t("التاريخ والوقت")}</dt><dd>{formatCustomerLastVisit(booking.date, booking.time, language)}</dd></div><div><dt>{t("الإجمالي")}</dt><dd>{formatMoney(booking.total, language)}</dd></div></dl>
              </article>
            ))}
            {!selectedBookings.length ? <p className="dsv2-customers-history-empty">{t("لا توجد حجوزات مسجلة لهذه العميلة.")}</p> : null}
          </div>
        </section>
      </div>
    </DashboardModalV2>
  );
}
